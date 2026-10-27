import type { Diagnostic } from "../diagnostic.js";
import { pushCapped } from "../diagnostic.js";
import type { Block, Expr, FuncDecl, Pos, Program, Stmt, TypeRef } from "../frontend/ast.js";
import { CODES, severityOf, type CodeArgs, type CodeKey } from "./codes.js";
import { crossesFunction, SymbolTable, type Scope, type ScopeKind, type Sym } from "./scope.js";
import {
  arrayOf, assignable, BOOL, ERROR, FLOAT, fnType, instanceOf, INT, NULL, primitiveByName, STRING,
  typeName, UNKNOWN, type ClassInfo, type Type,
} from "./types.js";

export interface CheckResult {
  diagnostics: Diagnostic[];
  table: SymbolTable;
  /** Tipo calculado para cada expresión. */
  types: Map<Expr, Type>;
  /** Símbolo de cada declaración y de cada nombre usado. */
  refs: Map<object, Sym>;
  /** Ámbito que abre cada nodo (programa, funciones, bloques, ciclos...). */
  scopes: Map<object, Scope>;
}

export function check(program: Program): CheckResult {
  const checker = new Checker();
  checker.scopes.set(program, checker.table.root);
  checker.stmts(program.body, checker.table.root);
  return checker;
}

const IMMUTABLE_WHAT: Partial<Record<Sym["kind"], string>> = {
  constant: "una constante",
  function: "una función",
  class: "una clase",
  catch: "el error de un catch",
};

class Checker implements CheckResult {
  readonly diagnostics: Diagnostic[] = [];
  readonly table = new SymbolTable();
  readonly types = new Map<Expr, Type>();
  readonly refs = new Map<object, Sym>();
  readonly scopes = new Map<object, Scope>();
  #classIds = 0;
  #warnedUninitialized = new Set<Sym>();

  report<K extends CodeKey>(key: K, pos: Pos, ...args: CodeArgs<K>): void {
    const { code, message } = CODES[key];
    pushCapped(this.diagnostics, {
      phase: "semantic",
      severity: severityOf(code),
      code,
      line: pos.line,
      column: pos.column,
      message: (message as (...a: CodeArgs<K>) => string)(...args),
    });
  }

  // ---------- Declaraciones ----------

  /** Lista de sentencias: clases y funciones se declaran antes de recorrer el resto. */
  stmts(list: Stmt[], scope: Scope): void {
    this.hoist(list, scope);
    for (const s of list) this.stmt(s, scope);
  }

  hoist(list: Stmt[], scope: Scope): void {
    for (const s of list) {
      if (s.kind !== "class") continue;
      const cls: ClassInfo = { id: this.#classIds++, name: s.name, members: new Map(), pos: s.pos };
      this.declare(scope, { name: s.name, kind: "class", type: { tag: "classRef", cls }, pos: s.pos, cls }, s);
    }
    for (const s of list) {
      if (s.kind !== "func") continue;
      const params = s.params.map((p) => this.resolveType(p.type, scope));
      const ret = s.returnType ? this.resolveType(s.returnType, scope) : UNKNOWN;
      this.declare(scope, { name: s.name, kind: "function", type: fnType(params, ret), pos: s.pos }, s);
    }
  }

  declare(scope: Scope, fields: Parameters<SymbolTable["define"]>[1], node: object): Sym {
    const { sym, clash } = this.table.define(scope, fields);
    if (clash) this.report("redeclared", fields.pos, fields.name, clash.pos.line);
    this.refs.set(node, sym);
    return sym;
  }

  resolveType(ref: TypeRef | undefined, scope: Scope): Type {
    if (!ref) return UNKNOWN;
    let base = primitiveByName(ref.name);
    if (!base) {
      const sym = scope.lookup(ref.name);
      if (sym?.cls) {
        base = instanceOf(sym.cls);
      } else {
        this.report("unknownType", ref.pos, ref.name);
        return ERROR;
      }
    }
    let t = base;
    for (let i = 0; i < ref.dims; i++) t = arrayOf(t);
    return t;
  }

  // ---------- Sentencias ----------

  stmt(s: Stmt, scope: Scope): void {
    switch (s.kind) {
      case "let":
      case "const": {
        const declared = s.type ? this.resolveType(s.type, scope) : undefined;
        const value = s.init ? this.expr(s.init, scope) : undefined;
        if (s.init && value?.tag === "void") this.report("voidValue", s.init.pos, "La expresión");
        else if (declared && value && !assignable(declared, value)) {
          this.report("badInit", s.init!.pos, s.name, typeName(declared), typeName(value));
        }
        // Sin anotación, `null` no informa nada: el tipo se deja abierto.
        const type = declared ?? (value && value.tag !== "null" ? value : UNKNOWN);
        this.declare(scope, { name: s.name, kind: s.kind === "let" ? "variable" : "constant", type, pos: s.pos, initialized: !!s.init }, s);
        return;
      }
      case "func":
        this.func(s, scope);
        return;
      case "class":
        return;
      case "block":
        this.block(s, scope);
        return;
      case "print":
        this.expr(s.value, scope);
        return;
      case "expr":
        this.expr(s.expr, scope);
        return;
      case "if":
        this.expr(s.cond, scope);
        this.block(s.then, scope);
        if (s.otherwise) this.block(s.otherwise, scope);
        return;
      case "while":
        this.expr(s.cond, scope);
        this.block(s.body, scope, "loop", "while");
        return;
      case "doWhile":
        this.block(s.body, scope, "loop", "do-while");
        this.expr(s.cond, scope);
        return;
      case "for": {
        const loop = this.open(s, "loop", "for", scope);
        if (s.init) this.stmt(s.init, loop);
        if (s.cond) this.expr(s.cond, loop);
        if (s.update) this.expr(s.update, loop);
        this.block(s.body, loop);
        return;
      }
      case "foreach": {
        this.expr(s.iterable, scope);
        const loop = this.open(s, "loop", "foreach", scope);
        this.declare(loop, { name: s.name, kind: "variable", type: UNKNOWN, pos: s.pos }, s);
        this.block(s.body, loop);
        return;
      }
      case "try": {
        this.block(s.body, scope);
        const handler = this.open(s.handler, "catch", "catch", scope);
        this.declare(handler, { name: s.errorName, kind: "catch", type: STRING, pos: s.handler.pos, mutable: false }, s);
        this.stmts(s.handler.body, handler);
        return;
      }
      case "switch": {
        this.expr(s.subject, scope);
        const inner = this.open(s, "switch", "switch", scope);
        for (const c of s.cases) {
          this.expr(c.test, inner);
          this.stmts(c.body, inner);
        }
        if (s.fallback) this.stmts(s.fallback, inner);
        return;
      }
      case "return":
        if (s.value) this.expr(s.value, scope);
        return;
      case "break":
      case "continue":
        return;
    }
  }

  func(f: FuncDecl, scope: Scope): void {
    const inner = this.open(f, "function", f.name, scope);
    const sym = this.refs.get(f);
    const paramTypes = sym?.type.tag === "fn" ? sym.type.params : [];
    f.params.forEach((p, i) => {
      if (f.params.findIndex((q) => q.name === p.name) < i) {
        this.report("duplicateParam", p.pos, p.name);
        return;
      }
      this.declare(inner, { name: p.name, kind: "parameter", type: paramTypes[i] ?? UNKNOWN, pos: p.pos }, p);
    });
    this.stmts(f.body, inner);
  }

  open(node: object, kind: ScopeKind, name: string, parent: Scope, pos?: Pos): Scope {
    const scope = this.table.open(kind, name, pos ?? (node as { pos: Pos }).pos, parent);
    this.scopes.set(node, scope);
    return scope;
  }

  block(b: Block, parent: Scope, kind: ScopeKind = "block", name = "bloque"): void {
    this.stmts(b.body, this.open(b, kind, name, parent));
  }

  // ---------- Expresiones ----------

  expr(e: Expr, scope: Scope): Type {
    const t = this.exprType(e, scope);
    this.types.set(e, t);
    return t;
  }

  exprType(e: Expr, scope: Scope): Type {
    switch (e.kind) {
      case "int":
        return INT;
      case "float":
        return FLOAT;
      case "string":
        return STRING;
      case "bool":
        return BOOL;
      case "null":
        return NULL;
      case "name":
        return this.use(e, scope, true)?.type ?? ERROR;
      case "assign":
        return this.assign(e, scope);
      default:
        for (const child of children(e)) this.expr(child, scope);
        return UNKNOWN;
    }
  }

  /** Resuelve un nombre, registra el uso y marca capturas. */
  use(e: Extract<Expr, { kind: "name" }>, scope: Scope, reading: boolean): Sym | undefined {
    const sym = scope.lookup(e.name);
    if (!sym) {
      this.report("undeclared", e.pos, e.name);
      return undefined;
    }
    sym.uses.push(e.pos);
    this.refs.set(e, sym);
    if (crossesFunction(sym, scope)) sym.captured = true;
    if (reading && sym.kind === "variable" && !sym.initialized && !this.#warnedUninitialized.has(sym)) {
      this.#warnedUninitialized.add(sym);
      this.report("useBeforeInit", e.pos, sym.name);
    }
    return sym;
  }

  assign(e: Extract<Expr, { kind: "assign" }>, scope: Scope): Type {
    const value = this.expr(e.value, scope);
    if (e.target.kind !== "name") {
      this.expr(e.target, scope);
      return value;
    }
    const sym = this.use(e.target, scope, false);
    if (!sym) return value;
    this.types.set(e.target, sym.type);
    if (!sym.mutable) {
      this.report("immutable", e.target.pos, sym.name, IMMUTABLE_WHAT[sym.kind] ?? "de solo lectura");
    } else if (!assignable(sym.type, value)) {
      this.report("badAssign", e.target.pos, typeName(sym.type), typeName(value));
    }
    sym.initialized = true;
    return value;
  }
}

function children(e: Expr): Expr[] {
  switch (e.kind) {
    case "array":
      return e.items;
    case "new":
      return e.args;
    case "call":
      return [e.callee, ...e.args];
    case "index":
      return [e.object, e.index];
    case "member":
      return [e.object];
    case "unary":
      return [e.operand];
    case "binary":
      return [e.left, e.right];
    case "ternary":
      return [e.cond, e.then, e.otherwise];
    case "assign":
      return [e.target, e.value];
    default:
      return [];
  }
}
