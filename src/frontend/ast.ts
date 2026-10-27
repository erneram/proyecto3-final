/**
 * Árbol de sintaxis abstracta de Compiscript.
 * Los nodos son datos planos; las fases posteriores guardan tipos y símbolos
 * en tablas aparte (indexadas por nodo), así el árbol no cambia tras construirse.
 */

export interface Pos {
  line: number;
  column: number;
}

/** `integer[][]` → { name: "integer", dims: 2 }. */
export interface TypeRef {
  name: string;
  dims: number;
  pos: Pos;
}

export interface Program {
  body: Stmt[];
}

// ---------- Sentencias ----------

export interface LetDecl {
  kind: "let";
  name: string;
  type?: TypeRef;
  init?: Expr;
  pos: Pos;
}

export interface ConstDecl {
  kind: "const";
  name: string;
  type?: TypeRef;
  init: Expr;
  pos: Pos;
}

export interface Param {
  name: string;
  type?: TypeRef;
  pos: Pos;
}

export interface FuncDecl {
  kind: "func";
  name: string;
  params: Param[];
  returnType?: TypeRef;
  body: Stmt[];
  pos: Pos;
}

export interface ClassDecl {
  kind: "class";
  name: string;
  parent?: { name: string; pos: Pos };
  fields: (LetDecl | ConstDecl)[];
  methods: FuncDecl[];
  pos: Pos;
}

export interface Block {
  kind: "block";
  body: Stmt[];
  pos: Pos;
}

export interface ExprStmt {
  kind: "expr";
  expr: Expr;
  pos: Pos;
}

export interface SwitchCase {
  test: Expr;
  body: Stmt[];
  pos: Pos;
}

export type Stmt =
  | LetDecl
  | ConstDecl
  | FuncDecl
  | ClassDecl
  | Block
  | ExprStmt
  | { kind: "print"; value: Expr; pos: Pos }
  | { kind: "if"; cond: Expr; then: Block; otherwise?: Block; pos: Pos }
  | { kind: "while"; cond: Expr; body: Block; pos: Pos }
  | { kind: "doWhile"; body: Block; cond: Expr; pos: Pos }
  | { kind: "for"; init?: LetDecl | ExprStmt; cond?: Expr; update?: Expr; body: Block; pos: Pos }
  | { kind: "foreach"; name: string; iterable: Expr; body: Block; pos: Pos }
  | { kind: "try"; body: Block; errorName: string; handler: Block; pos: Pos }
  | { kind: "switch"; subject: Expr; cases: SwitchCase[]; fallback?: Stmt[]; pos: Pos }
  | { kind: "break"; pos: Pos }
  | { kind: "continue"; pos: Pos }
  | { kind: "return"; value?: Expr; pos: Pos };

export type StmtKind = Stmt["kind"];
export type StmtOf<K extends StmtKind> = Extract<Stmt, { kind: K }>;

// ---------- Expresiones ----------

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "<" | "<=" | ">" | ">="
  | "==" | "!="
  | "&&" | "||";

export type Expr =
  | { kind: "int"; value: number; pos: Pos }
  | { kind: "float"; value: number; pos: Pos }
  | { kind: "string"; value: string; pos: Pos }
  | { kind: "bool"; value: boolean; pos: Pos }
  | { kind: "null"; pos: Pos }
  | { kind: "array"; items: Expr[]; pos: Pos }
  | { kind: "name"; name: string; pos: Pos }
  | { kind: "this"; pos: Pos }
  | { kind: "new"; className: string; args: Expr[]; pos: Pos }
  | { kind: "call"; callee: Expr; args: Expr[]; pos: Pos }
  | { kind: "index"; object: Expr; index: Expr; pos: Pos }
  | { kind: "member"; object: Expr; name: string; pos: Pos }
  | { kind: "unary"; op: "-" | "!"; operand: Expr; pos: Pos }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr; pos: Pos }
  | { kind: "ternary"; cond: Expr; then: Expr; otherwise: Expr; pos: Pos }
  | { kind: "assign"; target: Expr; value: Expr; pos: Pos };

export type ExprKind = Expr["kind"];
export type ExprOf<K extends ExprKind> = Extract<Expr, { kind: K }>;
