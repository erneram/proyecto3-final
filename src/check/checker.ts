import type { Diagnostic } from "../diagnostic.js";
import { pushCapped } from "../diagnostic.js";
import type { Block, ClassDecl, Expr, FuncDecl, Pos, Program, Stmt, TypeRef } from "../frontend/ast.js";
import { CODES, severityOf, type CodeArgs, type CodeKey } from "./codes.js";
import { crossesFunction, SymbolTable, type Scope, type ScopeKind, type Sym } from "./scope.js";
import {
  arrayOf, assignable, BOOL, commonType, comparable, ERROR, findMember, FLOAT, fnType, instanceOf, INT,
  isAbsorbing, isNumeric, NULL, numericResult, primitiveByName, sameType, STRING, typeName, UNKNOWN, VOID,
  type ClassInfo, type Member, type Type,
} from "./types.js";
import type { BinaryOp } from "../frontend/ast.js";

export interface CheckResult {
  diagnostics: Diagnostic[];
  table: SymbolTable;
  /** Tipo calculado para cada expresión. */
  types: Map<Expr, Type>;
  /** Símbolo de cada declaración y de cada nombre usado. */
  refs: Map<object, Sym>;
  /** Ámbito que abre cada nodo (programa, funciones, bloques, ciclos...). */
  scopes: Map<object, Scope>;
  /** Miembro resuelto por cada acceso `obj.nombre`. */
  members: Map<Expr, Member>;
}

export function check(program: Program): CheckResult {
  const checker = new Checker();
  checker.scopes.set(program, checker.table.root);
  checker.stmts(program.body, checker.table.root);
  return checker;
}

/** Función en curso: tipo de retorno declarado o, si no hay, los retornos vistos para inferirlo. */
interface FnContext {
  name: string;
  declared?: Type;
  returns: Type[];
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
  readonly members = new Map<Expr, Member>();
  #classIds = 0;
  #warnedUninitialized = new Set<Sym>();
  /** Nombres no declarados ya reportados, por función (o código global): cada uno se reporta solo en su primer uso. */
  #undeclared = new Map<Scope | undefined, Set<string>>();
  #fns: FnContext[] = [];

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
    let ended = false;
    let warned = false;
    for (const s of list) {
      // Las declaraciones de funciones y clases se izan: siguen siendo alcanzables.
      if (ended && !warned && s.kind !== "func" && s.kind !== "class") {
        this.report("unreachable", s.pos);
        warned = true;
      }
      this.stmt(s, scope);
      ended ||= terminates(s, scope);
    }
  }

  hoist(list: Stmt[], scope: Scope): void {
    for (const s of list) {
      if (s.kind !== "class") continue;
      const cls: ClassInfo = { id: this.#classIds++, name: s.name, members: new Map(), pos: s.pos };
      this.declare(scope, { name: s.name, kind: "class", type: { tag: "classRef", cls }, pos: s.pos, cls }, s);
    }
    const classes = list.filter((s): s is ClassDecl => s.kind === "class");
    for (const c of classes) this.linkParent(c, scope);
    for (const c of classes) this.breakCycle(c);
    for (const c of classes) this.collectMembers(c, scope);
    for (const c of classes) this.checkOverrides(c);
    for (const s of list) {
      if (s.kind !== "func") continue;
      const params = s.params.map((p) => this.resolveType(p.type, scope));
      const ret = s.returnType ? this.resolveType(s.returnType, scope) : UNKNOWN;
      this.declare(scope, { name: s.name, kind: "function", type: fnType(params, ret), pos: s.pos }, s);
    }
  }

  classOf(c: ClassDecl): ClassInfo {
    return this.refs.get(c)!.cls!;
  }

  linkParent(c: ClassDecl, scope: Scope): void {
    if (!c.parent) return;
    const parent = scope.lookup(c.parent.name);
    if (parent?.cls) this.classOf(c).parent = parent.cls;
    else this.report("unknownParent", c.parent.pos, c.name, c.parent.name);
  }

  /** Un ciclo de herencia se reporta en la primera clase que lo cierra y se corta ahí. */
  breakCycle(c: ClassDecl): void {
    const cls = this.classOf(c);
    const seen = new Set<ClassInfo>();
    for (let p = cls.parent; p && !seen.has(p); p = p.parent) {
      if (p === cls) {
        this.report("cyclicInheritance", c.pos, c.name);
        cls.parent = undefined;
        return;
      }
      seen.add(p);
    }
  }

  collectMembers(c: ClassDecl, scope: Scope): void {
    const cls = this.classOf(c);
    const add = (name: string, kind: Member["kind"], type: Type, mutable: boolean, pos: Pos): void => {
      if (cls.members.has(name)) this.report("duplicateMember", pos, cls.name, name);
      else cls.members.set(name, { name, kind, type, mutable, pos, owner: cls });
    };
    for (const f of c.fields) add(f.name, "field", this.resolveType(f.type, scope), f.kind === "let", f.pos);
    for (const m of c.methods) {
      const params = m.params.map((p) => this.resolveType(p.type, scope));
      add(m.name, "method", fnType(params, m.returnType ? this.resolveType(m.returnType, scope) : UNKNOWN), false, m.pos);
    }
  }

  /** Un método redefinido debe conservar la firma del heredado (el constructor queda libre). */
  checkOverrides(c: ClassDecl): void {
    const cls = this.classOf(c);
    for (const m of c.methods) {
      const own = cls.members.get(m.name);
      const inherited = cls.parent && findMember(cls.parent, m.name);
      if (m.name === "constructor" || own?.pos !== m.pos || inherited?.kind !== "method") continue;
      if (own.type.tag !== "fn" || inherited.type.tag !== "fn") continue;
      const a = own.type;
      const b = inherited.type;
      const fits = (x: Type, y: Type): boolean => isAbsorbing(x) || isAbsorbing(y) || sameType(x, y);
      const ok = a.params.length === b.params.length && a.params.every((t, i) => fits(t, b.params[i])) &&
        (isAbsorbing(a.ret) || assignable(b.ret, a.ret));
      if (!ok) this.report("overrideMismatch", m.pos, m.name, inherited.owner.name);
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
        this.classBody(s, scope);
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
        this.condition(s.cond, scope, "if");
        this.block(s.then, scope);
        if (s.otherwise) this.block(s.otherwise, scope);
        return;
      case "while":
        this.condition(s.cond, scope, "while");
        this.block(s.body, scope, "loop", "while");
        return;
      case "doWhile":
        this.block(s.body, scope, "loop", "do-while");
        this.condition(s.cond, scope, "do-while");
        return;
      case "for": {
        const loop = this.open(s, "loop", "for", scope);
        if (s.init) this.stmt(s.init, loop);
        if (s.cond) this.condition(s.cond, loop, "for");
        if (s.update) this.expr(s.update, loop);
        this.block(s.body, loop);
        return;
      }
      case "foreach": {
        const iterable = this.expr(s.iterable, scope);
        let elem = UNKNOWN;
        if (iterable.tag === "array") elem = iterable.elem;
        else if (!isAbsorbing(iterable)) {
          this.report("notIterable", s.iterable.pos, typeName(iterable));
          elem = ERROR;
        }
        const loop = this.open(s, "loop", "foreach", scope);
        this.declare(loop, { name: s.name, kind: "variable", type: elem, pos: s.pos }, s);
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
        const subject = this.expr(s.subject, scope);
        const switchable = isAbsorbing(subject) || ["int", "float", "string", "bool"].includes(subject.tag);
        if (!switchable) this.report("switchType", s.subject.pos, typeName(subject));
        const inner = this.open(s, "switch", "switch", scope);
        for (const c of s.cases) {
          const test = this.expr(c.test, inner);
          if (switchable && !comparable(subject, test)) this.report("caseType", c.test.pos, typeName(test), typeName(subject));
          this.stmts(c.body, inner);
        }
        if (s.fallback) this.stmts(s.fallback, inner);
        return;
      }
      case "return":
        this.returnStmt(s, scope);
        return;
      case "break":
        if (!jumpTarget(scope, ["loop", "switch"])) this.report("breakOutside", s.pos);
        return;
      case "continue":
        if (!jumpTarget(scope, ["loop"])) this.report("continueOutside", s.pos);
        return;
    }
  }

  /** Funciones y métodos; en un método, `cls` es su clase y el ámbito declara `this`. */
  func(f: FuncDecl, scope: Scope, cls?: ClassInfo): void {
    const inner = this.open(f, cls ? "method" : "function", f.name, scope);
    const member = cls?.members.get(f.name);
    // Quien guarda la firma: el símbolo de la función o el miembro de la clase (si no está repetido).
    const holder: { type: Type } | undefined = cls ? (member?.pos === f.pos ? member : undefined) : this.refs.get(f);
    const paramTypes = holder?.type.tag === "fn" ? holder.type.params : [];
    if (cls) this.table.define(inner, { name: "this", kind: "parameter", type: instanceOf(cls), pos: f.pos, mutable: false });
    f.params.forEach((p, i) => {
      if (f.params.findIndex((q) => q.name === p.name) < i) {
        this.report("duplicateParam", p.pos, p.name);
        return;
      }
      this.declare(inner, { name: p.name, kind: "parameter", type: paramTypes[i] ?? UNKNOWN, pos: p.pos }, p);
    });
    const ctx: FnContext = { name: f.name, returns: [] };
    if (f.returnType && holder?.type.tag === "fn") ctx.declared = holder.type.ret;
    this.#fns.push(ctx);
    this.stmts(f.body, inner);
    this.#fns.pop();
    if (ctx.declared && !isAbsorbing(ctx.declared) && !returnsOnAllPaths(f.body)) {
      this.report("missingReturn", f.pos, f.name, typeName(ctx.declared));
    }
    // Sin anotación, el retorno se infiere de los `return` del cuerpo.
    if (!f.returnType && holder?.type.tag === "fn") holder.type = fnType(holder.type.params, inferReturn(ctx.returns));
  }

  classBody(c: ClassDecl, scope: Scope): void {
    const cls = this.refs.get(c)?.cls;
    if (!cls) return;
    const inner = this.open(c, "class", c.name, scope);
    // Inicializadores primero: así los campos sin anotación ya tienen tipo al revisar los métodos.
    for (const f of c.fields) {
      if (!f.init) continue;
      const value = this.expr(f.init, inner);
      const member = cls.members.get(f.name);
      if (member?.pos !== f.pos) continue;
      if (!f.type) member.type = value.tag === "null" ? UNKNOWN : value;
      else if (!assignable(member.type, value)) this.report("badInit", f.init.pos, f.name, typeName(member.type), typeName(value));
    }
    for (const m of c.methods) this.func(m, inner, cls);
  }

  returnStmt(s: Extract<Stmt, { kind: "return" }>, scope: Scope): void {
    const value = s.value ? this.expr(s.value, scope) : VOID;
    const ctx = this.#fns.at(-1);
    if (!ctx) {
      this.report("returnOutside", s.pos);
    } else if (!ctx.declared) {
      ctx.returns.push(value);
    } else if (!s.value) {
      this.report("returnMissingValue", s.pos, ctx.name, typeName(ctx.declared));
    } else if (!assignable(ctx.declared, value)) {
      this.report("returnType", s.value.pos, ctx.name, typeName(ctx.declared), typeName(value));
    }
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
      case "array":
        return this.arrayLiteral(e, scope);
      case "index": {
        const object = this.expr(e.object, scope);
        const index = this.expr(e.index, scope);
        if (!isAbsorbing(index) && index.tag !== "int") this.report("indexType", e.index.pos, typeName(index));
        if (object.tag === "array") return object.elem;
        if (isAbsorbing(object)) return UNKNOWN;
        this.report("notIndexable", e.pos, typeName(object));
        return ERROR;
      }
      case "unary": {
        const operand = this.expr(e.operand, scope);
        const ok = e.op === "!" ? operand.tag === "bool" : isNumeric(operand);
        if (ok || isAbsorbing(operand)) return e.op === "!" ? BOOL : operand;
        this.report("badOperand", e.pos, e.op, typeName(operand));
        return e.op === "!" ? BOOL : ERROR;
      }
      case "call":
        return this.call(e, scope);
      case "this":
        return this.thisRef(e, scope);
      case "new":
        return this.newObject(e, scope);
      case "member":
        return this.member(e, scope);
      case "binary":
        return this.binary(e.op, this.expr(e.left, scope), this.expr(e.right, scope), e.pos);
      case "ternary": {
        this.condition(e.cond, scope, "el operador ternario");
        const a = this.expr(e.then, scope);
        const b = this.expr(e.otherwise, scope);
        const common = commonType(a, b);
        if (common) return common;
        this.report("ternaryMismatch", e.pos, typeName(a), typeName(b));
        return ERROR;
      }
      default:
        for (const child of children(e)) this.expr(child, scope);
        return UNKNOWN;
    }
  }

  /** Resuelve un nombre, registra el uso y marca capturas. */
  use(e: Extract<Expr, { kind: "name" }>, scope: Scope, reading: boolean): Sym | undefined {
    const sym = scope.lookup(e.name);
    if (!sym) {
      const reported = this.#undeclared.get(scope.owner) ?? new Set<string>();
      if (!reported.has(e.name)) this.report("undeclared", e.pos, e.name);
      this.#undeclared.set(scope.owner, reported.add(e.name));
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
    // Un nombre destino se resuelve antes que el valor, para reportar en orden de lectura.
    const sym = e.target.kind === "name" ? this.use(e.target, scope, false) : undefined;
    const value = this.expr(e.value, scope);
    if (e.target.kind !== "name") {
      const target = this.expr(e.target, scope);
      const invalid = INVALID_TARGET[e.target.kind];
      const member = this.members.get(e.target);
      if (invalid) this.report("invalidTarget", e.target.pos, invalid);
      else if (member && !member.mutable) {
        this.report("immutable", e.target.pos, `.${member.name}`, member.kind === "method" ? "un método" : "una constante");
      } else if (!assignable(target, value)) this.report("badAssign", e.target.pos, typeName(target), typeName(value));
      return value;
    }
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

  call(e: Extract<Expr, { kind: "call" }>, scope: Scope): Type {
    const callee = this.expr(e.callee, scope);
    const args = e.args.map((a) => this.expr(a, scope));
    if (isAbsorbing(callee)) return UNKNOWN;
    if (callee.tag !== "fn") {
      this.report("notCallable", e.pos, typeName(callee));
      return ERROR;
    }
    this.checkArgs(describeCallee(e.callee), callee.params, args, e);
    return callee.ret;
  }

  checkArgs(callee: string, params: Type[], args: Type[], e: { args: Expr[]; pos: Pos }): void {
    if (params.length !== args.length) {
      this.report("argCount", e.pos, callee, params.length, args.length);
      return;
    }
    args.forEach((a, i) => {
      if (!assignable(params[i], a)) this.report("argType", e.args[i].pos, i + 1, callee, typeName(params[i]), typeName(a));
    });
  }

  /** `this` es léxico: lo declara el método y lo ven también sus funciones anidadas. */
  thisRef(e: Extract<Expr, { kind: "this" }>, scope: Scope): Type {
    for (let s: Scope | undefined = scope; s && s.kind !== "class"; s = s.parent) {
      const sym = s.lookupLocal("this");
      if (!sym) continue;
      sym.uses.push(e.pos);
      this.refs.set(e, sym);
      if (crossesFunction(sym, scope)) sym.captured = true;
      return sym.type;
    }
    this.report("thisOutside", e.pos);
    return ERROR;
  }

  newObject(e: Extract<Expr, { kind: "new" }>, scope: Scope): Type {
    const args = e.args.map((a) => this.expr(a, scope));
    const sym = scope.lookup(e.className);
    if (!sym?.cls) {
      this.report("notAClass", e.pos, e.className);
      return ERROR;
    }
    sym.uses.push(e.pos);
    this.refs.set(e, sym);
    const ctor = findMember(sym.cls, "constructor");
    const params = ctor?.kind === "method" && ctor.type.tag === "fn" ? ctor.type.params : [];
    this.checkArgs(`el constructor de '${sym.cls.name}'`, params, args, e);
    return instanceOf(sym.cls);
  }

  member(e: Extract<Expr, { kind: "member" }>, scope: Scope): Type {
    const object = this.expr(e.object, scope);
    if (isAbsorbing(object)) return UNKNOWN;
    if (object.tag !== "instance") {
      this.report("memberOnNonObject", e.pos, e.name, typeName(object));
      return ERROR;
    }
    const m = findMember(object.cls, e.name);
    if (!m) {
      this.report("noMember", e.pos, object.cls.name, e.name);
      return ERROR;
    }
    this.members.set(e, m);
    return m.type;
  }

  /** Evalúa una condición y exige que sea boolean. */
  condition(e: Expr, scope: Scope, where: string): void {
    const t = this.expr(e, scope);
    if (t.tag !== "bool" && !isAbsorbing(t)) this.report("notBoolean", e.pos, where, typeName(t));
  }

  arrayLiteral(e: Extract<Expr, { kind: "array" }>, scope: Scope): Type {
    let elem: Type = UNKNOWN;
    let mixed = false;
    for (const item of e.items) {
      const t = this.expr(item, scope);
      const common = commonType(elem, t);
      if (common) elem = common;
      else if (!mixed) {
        mixed = true;
        this.report("mixedArray", item.pos, typeName(elem), typeName(t));
      }
    }
    return arrayOf(mixed ? ERROR : elem);
  }

  binary(op: BinaryOp, left: Type, right: Type, pos: Pos): Type {
    const result = binaryResult(op, left, right);
    if (result) return result;
    this.report("badOperands", pos, op, typeName(left), typeName(right));
    return BOOLEAN_OPS.has(op) ? BOOL : ERROR;
  }
}

/** ¿Hay un ciclo (o switch) que reciba el salto antes de cruzar el límite de una función? */
function jumpTarget(scope: Scope, kinds: ScopeKind[]): boolean {
  for (let s: Scope | undefined = scope; s; s = s.parent) {
    if (kinds.includes(s.kind)) return true;
    if (s.kind === "function" || s.kind === "method" || s.kind === "class") return false;
  }
  return false;
}

/**
 * La sentencia nunca deja seguir a la siguiente de su lista. Un salto inválido
 * (ya reportado como error) no cuenta, para no sumar advertencias en cascada.
 */
function terminates(s: Stmt, scope: Scope): boolean {
  switch (s.kind) {
    case "return":
      return scope.owner !== undefined;
    case "break":
      return jumpTarget(scope, ["loop", "switch"]);
    case "continue":
      return jumpTarget(scope, ["loop"]);
    case "block":
      return s.body.some((b) => terminates(b, scope));
    case "if":
      return !!s.otherwise && terminates(s.then, scope) && terminates(s.otherwise, scope);
    case "try":
      return terminates(s.body, scope) && terminates(s.handler, scope);
    default:
      return false;
  }
}

/** Todos los caminos de la lista terminan en return (los ciclos no cuentan: pueden no ejecutarse). */
function returnsOnAllPaths(list: Stmt[]): boolean {
  return list.some(returns);
}

function returns(s: Stmt): boolean {
  switch (s.kind) {
    case "return":
      return true;
    case "block":
      return returnsOnAllPaths(s.body);
    case "if":
      return !!s.otherwise && returns(s.then) && returns(s.otherwise);
    case "try":
      return returns(s.body) && returns(s.handler);
    case "switch": {
      // De atrás hacia adelante: un caso sin break cae en el siguiente.
      if (!s.fallback || !returnsOnAllPaths(s.fallback)) return false;
      let next = true;
      for (const c of [...s.cases].reverse()) {
        next = returnsOnAllPaths(c.body) || (next && !c.body.some((b) => b.kind === "break"));
        if (!next) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

function describeCallee(callee: Expr): string {
  if (callee.kind === "name") return `la función '${callee.name}'`;
  if (callee.kind === "member") return `el método '${callee.name}'`;
  return "la función";
}

/** Retorno inferido: tipo común de todos los `return`; ninguno = void; incompatibles = desconocido. */
function inferReturn(returns: Type[]): Type {
  if (returns.length === 0) return VOID;
  let t: Type | undefined = returns[0];
  for (const r of returns.slice(1)) t = t && commonType(t, r);
  return t ?? UNKNOWN;
}

const INVALID_TARGET: Partial<Record<Expr["kind"], string>> = {
  call: "el resultado de una llamada",
  new: "un objeto recién creado",
  this: "'this'",
};

const BOOLEAN_OPS = new Set<BinaryOp>(["<", "<=", ">", ">=", "==", "!=", "&&", "||"]);

/** Tipo resultante de un operador binario, o `undefined` si los operandos no sirven. */
function binaryResult(op: BinaryOp, left: Type, right: Type): Type | undefined {
  if (isAbsorbing(left) || isAbsorbing(right)) return BOOLEAN_OPS.has(op) ? BOOL : UNKNOWN;
  const numeric = isNumeric(left) && isNumeric(right);
  switch (op) {
    case "+":
      if (left.tag === "string" && right.tag === "string") return STRING;
      return numeric ? numericResult(left, right) : undefined;
    case "-":
    case "*":
    case "/":
      return numeric ? numericResult(left, right) : undefined;
    case "%":
      return left.tag === "int" && right.tag === "int" ? INT : undefined;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return numeric ? BOOL : undefined;
    case "==":
    case "!=":
      return comparable(left, right) ? BOOL : undefined;
    case "&&":
    case "||":
      return left.tag === "bool" && right.tag === "bool" ? BOOL : undefined;
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
