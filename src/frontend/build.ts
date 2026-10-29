import type { ParserRuleContext, TerminalNode, Token } from "antlr4ng";
import type * as A from "./ast.js";
import * as P from "./gen/CompisParser.js";

/**
 * Convierte el árbol concreto de ANTLR en el AST.
 * Solo se invoca sobre árboles sin errores sintácticos: con errores, ANTLR
 * deja huecos (tokens faltantes) que no tienen representación en el AST.
 */
export function buildProgram(ctx: P.ProgramContext): A.Program {
  return { body: ctx.stmt().map(stmt) };
}

const posOf = (t: Token): A.Pos => ({ line: t.line, column: t.column + 1 });
const at = (ctx: ParserRuleContext): A.Pos => posOf(ctx.start!);
const text = (node: TerminalNode): string => node.getText();

function unsupported(ctx: ParserRuleContext): never {
  const { line, column } = at(ctx);
  return fail(`Construcción no reconocida en ${line}:${column}: ${ctx.getText()}`);
}

function fail(message: string): never {
  throw new Error(message);
}

// ---------- Sentencias ----------

function stmt(ctx: P.StmtContext): A.Stmt {
  const pos = at(ctx);
  if (ctx instanceof P.VarStmtContext) return letDecl(ctx.varDecl());
  if (ctx instanceof P.ConstStmtContext) return constDecl(ctx.constDecl());
  if (ctx instanceof P.FuncStmtContext) return funcDecl(ctx.funcDecl());
  if (ctx instanceof P.ClassStmtContext) return classDecl(ctx.classDecl());
  if (ctx instanceof P.BlockStmtContext) return block(ctx.block());
  if (ctx instanceof P.PrintStmtContext) return { kind: "print", value: expr(ctx.expr()), pos };
  if (ctx instanceof P.ExprStmtContext) return { kind: "expr", expr: expr(ctx.expr()), pos };
  if (ctx instanceof P.IfStmtContext) {
    // Sin llaves, cada rama es una sola sentencia y se envuelve en un bloque.
    const [then, otherwise] = ctx.stmt().map((s): A.Block => {
      const body = stmt(s);
      return body.kind === "block" ? body : { kind: "block", body: [body], pos: body.pos };
    });
    return { kind: "if", cond: expr(ctx.expr()), then, otherwise, pos };
  }
  if (ctx instanceof P.WhileStmtContext) {
    return { kind: "while", cond: expr(ctx.expr()), body: block(ctx.block()), pos };
  }
  if (ctx instanceof P.DoWhileStmtContext) {
    return { kind: "doWhile", body: block(ctx.block()), cond: expr(ctx.expr()), pos };
  }
  if (ctx instanceof P.ForStmtContext) return forStmt(ctx);
  if (ctx instanceof P.ForeachStmtContext) {
    return { kind: "foreach", name: text(ctx.ID()), iterable: expr(ctx.expr()), body: block(ctx.block()), pos };
  }
  if (ctx instanceof P.TryStmtContext) {
    const [body, handler] = ctx.block().map(block);
    return { kind: "try", body, errorName: text(ctx.ID()), handler, pos };
  }
  if (ctx instanceof P.SwitchStmtContext) {
    const cases = ctx.caseClause().map((c) => ({ test: expr(c.expr()), body: c.stmt().map(stmt), pos: at(c) }));
    return { kind: "switch", subject: expr(ctx.expr()), cases, fallback: ctx.defaultClause()?.stmt().map(stmt), pos };
  }
  if (ctx instanceof P.BreakStmtContext) return { kind: "break", pos };
  if (ctx instanceof P.ContinueStmtContext) return { kind: "continue", pos };
  if (ctx instanceof P.ReturnStmtContext) {
    const value = ctx.expr();
    return { kind: "return", value: value ? expr(value) : undefined, pos };
  }
  return unsupported(ctx);
}

function forStmt(ctx: P.ForStmtContext): A.Stmt {
  const init = ctx.forInit();
  let initNode: A.LetDecl | A.ExprStmt | undefined;
  if (init instanceof P.ForDeclInitContext) {
    const value = init.expr();
    initNode = { ...binding(init.bindingHead()), init: value ? expr(value) : undefined, pos: at(init) };
  } else if (init instanceof P.ForExprInitContext) {
    initNode = { kind: "expr", expr: expr(init.expr()), pos: at(init) };
  }
  // La condición va entre los dos ';' del encabezado; la actualización, después.
  const secondSemi = ctx.SEMI(1)!.symbol.tokenIndex;
  let cond: A.Expr | undefined;
  let update: A.Expr | undefined;
  for (const e of ctx.expr()) {
    if (e.start!.tokenIndex < secondSemi) cond = expr(e);
    else update = expr(e);
  }
  return { kind: "for", init: initNode, cond, update, body: block(ctx.block()), pos: at(ctx) };
}

function block(ctx: P.BlockContext): A.Block {
  return { kind: "block", body: ctx.stmt().map(stmt), pos: at(ctx) };
}

// ---------- Declaraciones ----------

function binding(ctx: P.BindingHeadContext): Pick<A.LetDecl, "kind" | "name" | "type"> {
  return { kind: "let", name: text(ctx.ID()), type: typeAnn(ctx.typeAnn()) };
}

function letDecl(ctx: P.VarDeclContext): A.LetDecl {
  const value = ctx.expr();
  return { ...binding(ctx.bindingHead()), init: value ? expr(value) : undefined, pos: at(ctx) };
}

function constDecl(ctx: P.ConstDeclContext): A.ConstDecl {
  return { kind: "const", name: text(ctx.ID()), type: typeAnn(ctx.typeAnn()), init: expr(ctx.expr()), pos: at(ctx) };
}

function funcDecl(ctx: P.FuncDeclContext): A.FuncDecl {
  const params = (ctx.paramList()?.param() ?? []).map((p) => ({
    name: text(p.ID()),
    type: typeAnn(p.typeAnn()),
    pos: at(p),
  }));
  return {
    kind: "func",
    name: text(ctx.ID()),
    params,
    returnType: typeAnn(ctx.typeAnn()),
    body: ctx.block().stmt().map(stmt),
    pos: at(ctx),
  };
}

function classDecl(ctx: P.ClassDeclContext): A.ClassDecl {
  const [name, parent] = ctx.ID();
  const node: A.ClassDecl = {
    kind: "class",
    name: text(name),
    parent: parent ? { name: text(parent), pos: posOf(parent.symbol) } : undefined,
    fields: [],
    methods: [],
    pos: at(ctx),
  };
  for (const member of ctx.classMember()) {
    const v = member.varDecl();
    const c = member.constDecl();
    const f = member.funcDecl();
    if (v) node.fields.push(letDecl(v));
    else if (c) node.fields.push(constDecl(c));
    else if (f) node.methods.push(funcDecl(f));
  }
  return node;
}

function typeAnn(ctx: P.TypeAnnContext | null): A.TypeRef | undefined {
  if (!ctx) return undefined;
  const ref = ctx.typeRef();
  return { name: ref.baseType().getText(), dims: ref.LBRACKET().length, pos: at(ref) };
}

// ---------- Expresiones ----------

function expr(ctx: P.ExprContext): A.Expr {
  if (ctx instanceof P.AssignExprContext) {
    return { kind: "assign", target: target(ctx.target()), value: expr(ctx.expr()), pos: at(ctx) };
  }
  if (ctx instanceof P.CondExprContext) {
    const cond = binary(ctx.binary());
    const question = ctx.QUESTION();
    if (!question) return cond;
    const [then, otherwise] = ctx.expr().map(expr);
    return { kind: "ternary", cond, then, otherwise, pos: posOf(question.symbol) };
  }
  return unsupported(ctx);
}

/** Los operadores se ubican en su propio token: ahí apunta cualquier error de tipos. */
function binary(ctx: P.BinaryContext): A.Expr {
  if (ctx instanceof P.AtomContext) return primary(ctx.primary());
  if (ctx instanceof P.PrefixContext) {
    const op = ctx._op!;
    return { kind: "unary", op: op.text as "-" | "!", operand: binary(ctx.binary()), pos: posOf(op) };
  }
  if (ctx instanceof P.InfixContext) {
    const op = ctx._op!;
    const [left, right] = ctx.binary().map(binary);
    return { kind: "binary", op: op.text as A.BinaryOp, left, right, pos: posOf(op) };
  }
  return unsupported(ctx);
}

function primary(ctx: P.PrimaryContext): A.Expr {
  if (ctx instanceof P.LiteralPrimaryContext) return literal(ctx.literal());
  if (ctx instanceof P.ParenPrimaryContext) return expr(ctx.expr());
  if (ctx instanceof P.TargetPrimaryContext) return target(ctx.target());
  return unsupported(ctx);
}

/** `a.b(1)[2]`: los sufijos se aplican de izquierda a derecha sobre la cabeza. */
function target(ctx: P.TargetContext): A.Expr {
  let node = head(ctx.head());
  for (const s of ctx.suffix()) {
    const pos = at(s);
    if (s instanceof P.CallSuffixContext) node = { kind: "call", callee: node, args: args(s.argList()), pos };
    else if (s instanceof P.IndexSuffixContext) node = { kind: "index", object: node, index: expr(s.expr()), pos };
    else if (s instanceof P.MemberSuffixContext) node = { kind: "member", object: node, name: text(s.ID()), pos };
    else return unsupported(s);
  }
  return node;
}

function head(ctx: P.HeadContext): A.Expr {
  const pos = at(ctx);
  if (ctx instanceof P.NameHeadContext) return { kind: "name", name: text(ctx.ID()), pos };
  if (ctx instanceof P.ThisHeadContext) return { kind: "this", pos };
  if (ctx instanceof P.NewHeadContext) return { kind: "new", className: text(ctx.ID()), args: args(ctx.argList()), pos };
  return unsupported(ctx);
}

const args = (ctx: P.ArgListContext | null): A.Expr[] => (ctx?.expr() ?? []).map(expr);

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

function literal(ctx: P.LiteralContext): A.Expr {
  const pos = at(ctx);
  const raw = ctx.getText();
  if (ctx.INT_LIT()) return { kind: "int", value: Number(raw), pos };
  if (ctx.FLOAT_LIT()) return { kind: "float", value: Number(raw), pos };
  if (ctx.STRING_LIT()) {
    const value = raw.slice(1, -1).replace(/\\(.)/g, (_, c: string) => ESCAPES[c] ?? c);
    return { kind: "string", value, pos };
  }
  if (ctx.TRUE()) return { kind: "bool", value: true, pos };
  if (ctx.FALSE()) return { kind: "bool", value: false, pos };
  if (ctx.NULL()) return { kind: "null", pos };
  if (ctx.LBRACKET()) return { kind: "array", items: ctx.expr().map(expr), pos };
  return unsupported(ctx);
}
