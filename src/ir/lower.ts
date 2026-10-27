import type { CheckResult } from "../check/checker.js";
import type { Sym } from "../check/scope.js";
import { isNumeric, UNKNOWN, VOID, type Type } from "../check/types.js";
import type { BinaryOp as AstBinaryOp, Expr, ExprOf, FuncDecl, Program, Stmt, StmtOf } from "../frontend/ast.js";
import { hops, planStorage, type Frame, type Place, type StoragePlan } from "./frames.js";
import type { BinaryOp, IntOp, IrFunction, IrModule, Operand, PrintFormat, Quad, ValueClass } from "./ir.js";

/** Traduce el AST ya verificado a código de tres direcciones. */
export function lower(program: Program, checked: CheckResult): IrModule {
  const builder = new ModuleBuilder(checked, planStorage(checked));
  const main = new FunctionLowerer(builder, builder.plan.main, VOID);
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

/** Destinos de `break` y `continue` del bucle o `switch` más cercano. */
interface JumpTargets {
  breakTo: string;
  continueTo?: string;
}

class FunctionLowerer {
  readonly quads: Quad[] = [];
  readonly temps: ValueClass[] = [];
  readonly #targets: JumpTargets[] = [];

  constructor(
    readonly m: ModuleBuilder,
    readonly frame: Frame,
    /** Tipo de retorno de la función; los `return` se convierten a él. */
    readonly ret: Type,
  ) {}

  /** Crea el entorno propio, lo enlaza al recibido y copia ahí los parámetros capturados. */
  prologue(): void {
    const { envOwn, envIn, envWords, scope } = this.frame;
    if (envOwn === undefined) return;
    const env = this.temp("word");
    this.emit({ op: "alloc", dst: env, words: envWords });
    this.emit({ op: "store", base: env, offset: 0, a: envIn === undefined ? { k: "int", value: 0 } : { k: "slot", index: envIn } });
    this.emit({ op: "mov", dst: { k: "slot", index: envOwn }, a: env });
    [...scope.symbols.values()]
      .filter((sym) => sym.kind === "parameter")
      .forEach((sym, i) => {
        const place = this.placeOf(sym);
        if (place.at === "env") this.emit({ op: "store", base: env, offset: place.offset, a: { k: "slot", index: i } });
      });
  }

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
    // Las funciones anidadas se elevan: su clausura existe desde el inicio de la lista.
    for (const s of list) {
      if (s.kind !== "func") continue;
      const sym = this.symOf(s);
      if (this.placeOf(sym).at === "label") continue;
      const closure = this.temp("word");
      this.emit({ op: "closure", dst: closure, fn: this.frameOf(s).label, env: this.currentEnv() });
      this.write(sym, closure);
    }
    for (const s of list) this.stmt(s);
  }

  frameOf(f: FuncDecl): Frame {
    return this.m.plan.frames.get(this.m.checked.scopes.get(f)!)!;
  }

  /** Genera el cuerpo de `f` como una `IrFunction` aparte. */
  func(f: FuncDecl): void {
    const type = this.symOf(f).type;
    const inner = new FunctionLowerer(this.m, this.frameOf(f), type.tag === "fn" ? type.ret : UNKNOWN);
    inner.prologue();
    inner.stmts(f.body);
    this.m.finish(inner);
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
      case "if": {
        const end = this.m.label();
        const otherwise = s.otherwise ? this.m.label() : end;
        this.jump(s.cond, false, otherwise);
        this.stmts(s.then.body);
        if (s.otherwise) {
          this.emit({ op: "goto", target: end });
          this.emit({ op: "label", name: otherwise });
          this.stmts(s.otherwise.body);
        }
        this.emit({ op: "label", name: end });
        return;
      }
      case "while": {
        const top = this.m.label();
        const end = this.m.label();
        this.emit({ op: "label", name: top });
        this.jump(s.cond, false, end);
        this.loopBody(s.body.body, end, top);
        this.emit({ op: "goto", target: top });
        this.emit({ op: "label", name: end });
        return;
      }
      case "doWhile": {
        const top = this.m.label();
        const test = this.m.label();
        const end = this.m.label();
        this.emit({ op: "label", name: top });
        this.loopBody(s.body.body, end, test);
        this.emit({ op: "label", name: test });
        this.jump(s.cond, true, top);
        this.emit({ op: "label", name: end });
        return;
      }
      case "for": {
        if (s.init) this.stmt(s.init);
        const top = this.m.label();
        const step = this.m.label();
        const end = this.m.label();
        this.emit({ op: "label", name: top });
        if (s.cond) this.jump(s.cond, false, end);
        this.loopBody(s.body.body, end, step);
        this.emit({ op: "label", name: step });
        if (s.update) this.expr(s.update);
        this.emit({ op: "goto", target: top });
        this.emit({ op: "label", name: end });
        return;
      }
      case "switch":
        this.switch(s);
        return;
      case "foreach":
        this.foreach(s);
        return;
      case "func":
        this.func(s);
        return;
      case "return":
        this.emit(s.value ? { op: "ret", a: this.coerced(s.value, this.ret) } : { op: "ret" });
        return;
      case "break":
      case "continue": {
        const target =
          s.kind === "break" ? this.#targets.at(-1)?.breakTo : [...this.#targets].reverse().find((t) => t.continueTo)?.continueTo;
        if (!target) throw new Error(`'${s.kind}' fuera de un bucle`);
        this.emit({ op: "goto", target });
        return;
      }
      default:
        throw new Error(`Generación de código pendiente para '${s.kind}'`);
    }
  }

  loopBody(body: Stmt[], breakTo: string, continueTo?: string): void {
    this.#targets.push({ breakTo, continueTo });
    this.stmts(body);
    this.#targets.pop();
  }

  /** El arreglo se evalúa una sola vez; `alen` falla si es null y `aget` verifica límites. */
  foreach(s: StmtOf<"foreach">): void {
    const array = this.temp("word");
    const length = this.temp("word");
    const i = this.temp("word");
    this.emit({ op: "mov", dst: array, a: this.expr(s.iterable) });
    this.emit({ op: "alen", dst: length, array });
    this.emit({ op: "mov", dst: i, a: { k: "int", value: 0 } });
    const top = this.m.label();
    const step = this.m.label();
    const end = this.m.label();
    this.emit({ op: "label", name: top });
    const more = this.temp("word");
    this.emit({ op: "lt", dst: more, a: i, b: length });
    this.emit({ op: "ifnot", a: more, target: end });
    const item = this.symOf(s);
    const value = this.temp(classOfType(item.type));
    this.emit({ op: "aget", dst: value, array, index: i });
    this.write(item, value);
    this.loopBody(s.body.body, end, step);
    this.emit({ op: "label", name: step });
    this.emit({ op: "add", dst: i, a: i, b: { k: "int", value: 1 } });
    this.emit({ op: "goto", target: top });
    this.emit({ op: "label", name: end });
  }

  /**
   * Primero se prueban todos los casos en orden y luego vienen los cuerpos uno
   * tras otro, así que un caso sin `break` cae en el siguiente.
   */
  switch(s: StmtOf<"switch">): void {
    const st = this.typeOf(s.subject);
    const subject = this.temp(classOfType(st));
    this.emit({ op: "mov", dst: subject, a: this.expr(s.subject) });
    const end = this.m.label();
    const bodies = s.cases.map(() => this.m.label());
    s.cases.forEach((c, i) => {
      const hit = this.compute("==", subject, st, this.expr(c.test), this.typeOf(c.test));
      this.emit({ op: "if", a: hit, target: bodies[i]! });
    });
    const fallback = s.fallback ? this.m.label() : end;
    this.emit({ op: "goto", target: fallback });
    this.#targets.push({ breakTo: end });
    s.cases.forEach((c, i) => {
      this.emit({ op: "label", name: bodies[i]! });
      this.stmts(c.body);
    });
    if (s.fallback) {
      this.emit({ op: "label", name: fallback });
      this.stmts(s.fallback);
    }
    this.#targets.pop();
    this.emit({ op: "label", name: end });
  }

  /**
   * Código de saltos para condiciones: va a `target` si `e` vale `when` y si no
   * continúa. `&&`, `||` y `!` se resuelven con saltos, sin materializar booleanos.
   */
  jump(e: Expr, when: boolean, target: string): void {
    if (e.kind === "bool") {
      if (e.value === when) this.emit({ op: "goto", target });
      return;
    }
    if (e.kind === "unary" && e.op === "!") return this.jump(e.operand, !when, target);
    if (e.kind === "binary" && (e.op === "&&" || e.op === "||")) {
      // Valor del operando izquierdo que ya decide el resultado.
      const decisive = e.op === "||";
      if (when === decisive) {
        this.jump(e.left, when, target);
        this.jump(e.right, when, target);
      } else {
        const skip = this.m.label();
        this.jump(e.left, decisive, skip);
        this.jump(e.right, when, target);
        this.emit({ op: "label", name: skip });
      }
      return;
    }
    this.emit({ op: when ? "if" : "ifnot", a: this.expr(e), target });
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

  /** Entorno que ve esta función: el propio, el recibido o ninguno (0). */
  currentEnv(): Operand {
    const own = this.frame.envOwn ?? this.frame.envIn;
    return own === undefined ? { k: "int", value: 0 } : { k: "slot", index: own };
  }

  /** Puntero al entorno de `owner`, siguiendo la cadena de enlaces desde el entorno actual. */
  envOf(owner: Frame): Operand {
    const n = hops(this.frame, owner) ?? 0;
    let base = this.currentEnv();
    if (base.k !== "slot") throw new Error(`${this.frame.name} no tiene entorno`);
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
      case "call":
        return this.call(e);
      case "array": {
        const t = this.typeOf(e);
        const elem = t.tag === "array" ? t.elem : UNKNOWN;
        const dst = this.temp("word");
        this.emit({ op: "newarr", dst, length: { k: "int", value: e.items.length } });
        e.items.forEach((item, i) => {
          this.emit({ op: "aset", array: dst, index: { k: "int", value: i }, a: this.coerced(item, elem) });
        });
        return dst;
      }
      case "index": {
        const array = this.expr(e.object);
        const index = this.expr(e.index);
        const dst = this.temp(classOfType(this.typeOf(e)));
        this.emit({ op: "aget", dst, array, index });
        return dst;
      }
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
        this.jump(e.cond, false, otherwise);
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

  /**
   * Las funciones globales se llaman directo por etiqueta; cualquier otro valor
   * función es una clausura y se llama a través de ella. Los argumentos se
   * evalúan todos antes de apilar el primero, así una llamada anidada no se mezcla.
   */
  call(e: ExprOf<"call">): Operand {
    if (e.callee.kind === "member") throw new Error("Generación de código pendiente para llamadas a métodos");
    const sym = e.callee.kind === "name" ? this.symOf(e.callee) : undefined;
    const place = sym && this.placeOf(sym);
    // El símbolo de una función tiene el retorno ya inferido; el tipo de la expresión puede ser anterior.
    const type = sym?.kind === "function" ? sym.type : this.typeOf(e.callee);
    const params = type.tag === "fn" ? type.params : [];
    const ret = type.tag === "fn" ? type.ret : UNKNOWN;
    const target = place?.at === "label" ? place.label : this.expr(e.callee);
    const args = e.args.map((a, i) => this.coerced(a, params[i] ?? this.typeOf(a)));
    for (const a of args) this.emit({ op: "param", a });
    const dst = ret.tag === "void" ? undefined : this.temp(classOfType(ret));
    if (typeof target === "string") this.emit({ op: "call", dst, fn: target, argc: args.length });
    else this.emit({ op: "callc", dst, closure: target, argc: args.length });
    return dst ?? { k: "int", value: 0 };
  }

  assign(e: ExprOf<"assign">): Operand {
    if (e.target.kind === "index") {
      const array = this.expr(e.target.object);
      const index = this.expr(e.target.index);
      const value = this.coerced(e.value, this.typeOf(e.target));
      this.emit({ op: "aset", array, index, a: value });
      return value;
    }
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
    const a = this.expr(e.left);
    return this.compute(e.op, a, this.typeOf(e.left), this.expr(e.right), this.typeOf(e.right));
  }

  /** Aplica un operador binario a dos valores ya evaluados según sus tipos. */
  compute(operator: AstBinaryOp, a: Operand, lt: Type, b: Operand, rt: Type): Operand {
    if (lt.tag === "string" && rt.tag === "string" && (operator === "+" || operator === "==" || operator === "!=")) {
      const dst = this.temp("word");
      this.emit({ op: operator === "+" ? "concat" : "streq", dst, a, b });
      if (operator !== "!=") return dst;
      const negated = this.temp("word");
      this.emit({ op: "not", dst: negated, a: dst });
      return negated;
    }

    const float = (isFloat(lt) || isFloat(rt)) && isNumeric(lt) && isNumeric(rt);
    if (float) {
      a = this.convert(a, lt, { tag: "float" });
      b = this.convert(b, rt, { tag: "float" });
    }
    const op = float ? FLOAT_OPS[operator] : INT_OPS[operator];
    if (!op) throw new Error(`Operador sin traducción: ${operator}`);
    const comparison = ["<", "<=", ">", ">=", "==", "!="].includes(operator);
    const dst = this.temp(float && !comparison ? "float" : "word");
    this.emit({ op, dst, a, b });
    return dst;
  }
}

function zero(t: Type): Operand {
  return isFloat(t) ? { k: "float", value: 0 } : { k: "int", value: 0 };
}
