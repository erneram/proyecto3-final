import type { CheckResult } from "../check/checker.js";
import type { Sym } from "../check/scope.js";
import { isNumeric, type Type } from "../check/types.js";
import type { BinaryOp as AstBinaryOp, Expr, ExprOf, Program, Stmt } from "../frontend/ast.js";
import { hops, planStorage, type Frame, type Place, type StoragePlan } from "./frames.js";
import type { BinaryOp, IntOp, IrFunction, IrModule, Operand, PrintFormat, Quad, ValueClass } from "./ir.js";

/** Traduce el AST ya verificado a código de tres direcciones. */
export function lower(program: Program, checked: CheckResult): IrModule {
  const builder = new ModuleBuilder(checked, planStorage(checked));
  const main = new FunctionLowerer(builder, builder.plan.main);
  main.stmts(program.body);
  builder.finish(main);
  return builder.module;
}

class ModuleBuilder {
  readonly module: IrModule;
  #labels = 0;

  constructor(
    readonly checked: CheckResult,
    readonly plan: StoragePlan,
  ) {
    this.module = { functions: [], globals: plan.globals, classes: [] };
  }

  label(): string {
    return `L${this.#labels++}`;
  }

  finish(f: FunctionLowerer): IrFunction {
    const last = f.quads.at(-1);
    if (last?.op !== "ret") f.emit({ op: "ret" });
    const fn: IrFunction = {
      label: f.frame.label,
      name: f.frame.name,
      params: f.frame.params,
      slots: f.frame.slots,
      envParam: f.frame.envIn,
      temps: f.temps,
      body: f.quads,
    };
    this.module.functions.push(fn);
    return fn;
  }
}

const isFloat = (t: Type | undefined): boolean => t?.tag === "float";
const classOfType = (t: Type | undefined): ValueClass => (isFloat(t) ? "float" : "word");

const INT_OPS: Partial<Record<AstBinaryOp, IntOp>> = {
  "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod",
  "<": "lt", "<=": "le", ">": "gt", ">=": "ge", "==": "eq", "!=": "ne",
};
const FLOAT_OPS: Partial<Record<AstBinaryOp, BinaryOp>> = {
  "+": "fadd", "-": "fsub", "*": "fmul", "/": "fdiv",
  "<": "flt", "<=": "fle", ">": "fgt", ">=": "fge", "==": "feq", "!=": "fne",
};

class FunctionLowerer {
  readonly quads: Quad[] = [];
  readonly temps: ValueClass[] = [];

  constructor(
    readonly m: ModuleBuilder,
    readonly frame: Frame,
  ) {}

  emit(q: Quad): void {
    this.quads.push(q);
  }

  temp(cls: ValueClass): Operand {
    return { k: "temp", id: this.temps.push(cls) - 1 };
  }

  typeOf(e: Expr): Type {
    const t = this.m.checked.types.get(e);
    if (!t) throw new Error(`Expresión sin tipo en ${e.pos.line}:${e.pos.column}`);
    return t;
  }

  symOf(node: object): Sym {
    const sym = this.m.checked.refs.get(node);
    if (!sym) throw new Error("Nodo sin símbolo resuelto");
    return sym;
  }

  placeOf(sym: Sym): Place {
    return this.m.plan.places.get(sym)!;
  }

  // ---------- Sentencias ----------

  stmts(list: Stmt[]): void {
    for (const s of list) this.stmt(s);
  }

  stmt(s: Stmt): void {
    switch (s.kind) {
      case "let":
      case "const": {
        const sym = this.symOf(s);
        if (s.init) this.write(sym, this.coerced(s.init, sym.type));
        else if (this.placeOf(sym).at !== "global") this.write(sym, zero(sym.type));
        return;
      }
      case "expr":
        this.expr(s.expr);
        return;
      case "print":
        this.print(s.value);
        return;
      case "block":
        this.stmts(s.body);
        return;
      default:
        throw new Error(`Generación de código pendiente para '${s.kind}'`);
    }
  }

  print(e: Expr): void {
    const t = this.typeOf(e);
    const value = this.expr(e);
    if (t.tag === "null" || t.tag === "void") {
      this.emit({ op: "print", a: { k: "str", value: "null" }, format: "string" });
      return;
    }
    const format: PrintFormat = t.tag === "float" ? "float" : t.tag === "string" ? "string" : t.tag === "bool" ? "bool" : "int";
    this.emit({ op: "print", a: value, format });
  }

  // ---------- Variables ----------

  /** Puntero al entorno de `owner`, siguiendo la cadena de enlaces desde el entorno actual. */
  envOf(owner: Frame): Operand {
    const n = hops(this.frame, owner) ?? 0;
    const own = this.frame.envOwn ?? this.frame.envIn;
    if (own === undefined) throw new Error(`${this.frame.name} no tiene entorno`);
    let base: Operand = { k: "slot", index: own };
    for (let i = 0; i < n; i++) {
      const next = this.temp("word");
      this.emit({ op: "load", dst: next, base, offset: 0 });
      base = next;
    }
    return base;
  }

  read(sym: Sym): Operand {
    const place = this.placeOf(sym);
    switch (place.at) {
      case "global":
        return { k: "global", index: place.index };
      case "slot":
        return { k: "slot", index: place.index };
      case "env": {
        const dst = this.temp(classOfType(sym.type));
        this.emit({ op: "load", dst, base: this.envOf(place.owner), offset: place.offset });
        return dst;
      }
      case "label": {
        const dst = this.temp("word");
        this.emit({ op: "closure", dst, fn: place.label, env: { k: "int", value: 0 } });
        return dst;
      }
      case "none":
        throw new Error(`'${sym.name}' no tiene valor en tiempo de ejecución`);
    }
  }

  write(sym: Sym, value: Operand): void {
    const place = this.placeOf(sym);
    if (place.at === "global") this.emit({ op: "mov", dst: { k: "global", index: place.index }, a: value });
    else if (place.at === "slot") this.emit({ op: "mov", dst: { k: "slot", index: place.index }, a: value });
    else if (place.at === "env") this.emit({ op: "store", base: this.envOf(place.owner), offset: place.offset, a: value });
    else throw new Error(`No se puede asignar a '${sym.name}'`);
  }

  // ---------- Expresiones ----------

  /** Evalúa `e` y lo convierte al tipo destino (solo cambia algo de integer a float). */
  coerced(e: Expr, to: Type): Operand {
    return this.convert(this.expr(e), this.typeOf(e), to);
  }

  convert(value: Operand, from: Type, to: Type): Operand {
    if (!isFloat(to) || isFloat(from) || !isNumeric(from)) return value;
    if (value.k === "int") return { k: "float", value: value.value };
    const dst = this.temp("float");
    this.emit({ op: "itof", dst, a: value });
    return dst;
  }

  expr(e: Expr): Operand {
    switch (e.kind) {
      case "int":
        return { k: "int", value: e.value };
      case "float":
        return { k: "float", value: e.value };
      case "string":
        return { k: "str", value: e.value };
      case "bool":
        return { k: "int", value: e.value ? 1 : 0 };
      case "null":
        return { k: "int", value: 0 };
      case "name":
        return this.read(this.symOf(e));
      case "assign":
        return this.assign(e);
      case "unary": {
        const a = this.expr(e.operand);
        const float = isFloat(this.typeOf(e.operand));
        const dst = this.temp(float && e.op === "-" ? "float" : "word");
        this.emit({ op: e.op === "!" ? "not" : float ? "fneg" : "neg", dst, a });
        return dst;
      }
      case "binary":
        return e.op === "&&" || e.op === "||" ? this.shortCircuit(e) : this.binary(e);
      case "ternary": {
        const t = this.typeOf(e);
        const dst = this.temp(classOfType(t));
        const otherwise = this.m.label();
        const end = this.m.label();
        this.emit({ op: "ifnot", a: this.expr(e.cond), target: otherwise });
        this.emit({ op: "mov", dst, a: this.coerced(e.then, t) });
        this.emit({ op: "goto", target: end });
        this.emit({ op: "label", name: otherwise });
        this.emit({ op: "mov", dst, a: this.coerced(e.otherwise, t) });
        this.emit({ op: "label", name: end });
        return dst;
      }
      default:
        throw new Error(`Generación de código pendiente para '${e.kind}'`);
    }
  }

  assign(e: ExprOf<"assign">): Operand {
    if (e.target.kind !== "name") throw new Error(`Generación de código pendiente para asignar a '${e.target.kind}'`);
    const sym = this.symOf(e.target);
    const value = this.coerced(e.value, sym.type);
    this.write(sym, value);
    return value;
  }

  /** `a && b` y `a || b` evalúan `b` solo si hace falta. */
  shortCircuit(e: ExprOf<"binary">): Operand {
    const dst = this.temp("word");
    const end = this.m.label();
    this.emit({ op: "mov", dst, a: this.expr(e.left) });
    this.emit({ op: e.op === "&&" ? "ifnot" : "if", a: dst, target: end });
    this.emit({ op: "mov", dst, a: this.expr(e.right) });
    this.emit({ op: "label", name: end });
    return dst;
  }

  binary(e: ExprOf<"binary">): Operand {
    const lt = this.typeOf(e.left);
    const rt = this.typeOf(e.right);
    let a = this.expr(e.left);
    let b = this.expr(e.right);

    if (lt.tag === "string" && rt.tag === "string" && (e.op === "+" || e.op === "==" || e.op === "!=")) {
      const dst = this.temp("word");
      this.emit({ op: e.op === "+" ? "concat" : "streq", dst, a, b });
      if (e.op !== "!=") return dst;
      const negated = this.temp("word");
      this.emit({ op: "not", dst: negated, a: dst });
      return negated;
    }

    const float = (isFloat(lt) || isFloat(rt)) && isNumeric(lt) && isNumeric(rt);
    if (float) {
      a = this.convert(a, lt, { tag: "float" });
      b = this.convert(b, rt, { tag: "float" });
    }
    const op = float ? FLOAT_OPS[e.op] : INT_OPS[e.op];
    if (!op) throw new Error(`Operador sin traducción: ${e.op}`);
    const comparison = ["<", "<=", ">", ">=", "==", "!="].includes(e.op);
    const dst = this.temp(float && !comparison ? "float" : "word");
    this.emit({ op, dst, a, b });
    return dst;
  }
}

function zero(t: Type): Operand {
  return isFloat(t) ? { k: "float", value: 0 } : { k: "int", value: 0 };
}
