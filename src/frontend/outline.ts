import type { Block, Expr, FuncDecl, Pos, Program, Stmt, TypeRef } from "./ast.js";

/** Vista genérica del AST: la consumen la CLI (como texto) y el IDE (como árbol navegable). */
export interface OutlineNode {
  label: string;
  pos?: Pos;
  children: OutlineNode[];
}

const node = (label: string, pos?: Pos, children: OutlineNode[] = []): OutlineNode => ({ label, pos, children });
const group = (label: string, children: OutlineNode[]): OutlineNode => node(label, undefined, children);
const ann = (t?: TypeRef): string => (t ? `: ${t.name}${"[]".repeat(t.dims)}` : "");
const body = (label: string, b: Block): OutlineNode => group(label, b.body.map(stmtNode));

export function outline(program: Program): OutlineNode {
  return group("programa", program.body.map(stmtNode));
}

function funcNode(f: FuncDecl, kind: string): OutlineNode {
  const params = f.params.map((p) => p.name + ann(p.type)).join(", ");
  return node(`${kind} ${f.name}(${params})${ann(f.returnType)}`, f.pos, f.body.map(stmtNode));
}

function stmtNode(s: Stmt): OutlineNode {
  switch (s.kind) {
    case "let":
    case "const":
      return node(`${s.kind} ${s.name}${ann(s.type)}`, s.pos, s.init ? [exprNode(s.init)] : []);
    case "func":
      return funcNode(s, "función");
    case "class":
      return node(`clase ${s.name}${s.parent ? ` : ${s.parent.name}` : ""}`, s.pos, [
        ...s.fields.map(stmtNode),
        ...s.methods.map((m) => funcNode(m, "método")),
      ]);
    case "block":
      return node("bloque", s.pos, s.body.map(stmtNode));
    case "expr":
      return exprNode(s.expr);
    case "print":
      return node("print", s.pos, [exprNode(s.value)]);
    case "if":
      return node("if", s.pos, [
        group("condición", [exprNode(s.cond)]),
        body("entonces", s.then),
        ...(s.otherwise ? [body("si no", s.otherwise)] : []),
      ]);
    case "while":
      return node("while", s.pos, [group("condición", [exprNode(s.cond)]), body("cuerpo", s.body)]);
    case "doWhile":
      return node("do-while", s.pos, [body("cuerpo", s.body), group("condición", [exprNode(s.cond)])]);
    case "for":
      return node("for", s.pos, [
        ...(s.init ? [group("inicio", [stmtNode(s.init)])] : []),
        ...(s.cond ? [group("condición", [exprNode(s.cond)])] : []),
        ...(s.update ? [group("paso", [exprNode(s.update)])] : []),
        body("cuerpo", s.body),
      ]);
    case "foreach":
      return node(`foreach ${s.name}`, s.pos, [group("en", [exprNode(s.iterable)]), body("cuerpo", s.body)]);
    case "try":
      return node("try", s.pos, [body("intento", s.body), body(`catch ${s.errorName}`, s.handler)]);
    case "switch":
      return node("switch", s.pos, [
        group("valor", [exprNode(s.subject)]),
        ...s.cases.map((c) => node("case", c.pos, [exprNode(c.test), ...c.body.map(stmtNode)])),
        ...(s.fallback ? [group("default", s.fallback.map(stmtNode))] : []),
      ]);
    case "break":
    case "continue":
      return node(s.kind, s.pos);
    case "return":
      return node("return", s.pos, s.value ? [exprNode(s.value)] : []);
  }
}

function exprNode(e: Expr): OutlineNode {
  switch (e.kind) {
    case "int":
    case "bool":
      return node(String(e.value), e.pos);
    case "float":
      return node(Number.isInteger(e.value) ? e.value.toFixed(1) : String(e.value), e.pos);
    case "string":
      return node(JSON.stringify(e.value), e.pos);
    case "null":
    case "this":
      return node(e.kind, e.pos);
    case "name":
      return node(e.name, e.pos);
    case "array":
      return node("[ ]", e.pos, e.items.map(exprNode));
    case "new":
      return node(`new ${e.className}`, e.pos, e.args.map(exprNode));
    case "call":
      return node("llamada", e.pos, [exprNode(e.callee), ...e.args.map(exprNode)]);
    case "index":
      return node("índice", e.pos, [exprNode(e.object), exprNode(e.index)]);
    case "member":
      return node(`.${e.name}`, e.pos, [exprNode(e.object)]);
    case "unary":
      return node(e.op, e.pos, [exprNode(e.operand)]);
    case "binary":
      return node(e.op, e.pos, [exprNode(e.left), exprNode(e.right)]);
    case "ternary":
      return node("?:", e.pos, [exprNode(e.cond), exprNode(e.then), exprNode(e.otherwise)]);
    case "assign":
      return node("=", e.pos, [exprNode(e.target), exprNode(e.value)]);
  }
}

/** Dibuja el árbol con conectores de caja. */
export function renderOutline(root: OutlineNode): string {
  const lines = [root.label];
  const walk = (n: OutlineNode, prefix: string): void => {
    n.children.forEach((child, i) => {
      const last = i === n.children.length - 1;
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${child.label}`);
      walk(child, prefix + (last ? "   " : "│  "));
    });
  };
  walk(root, "");
  return lines.join("\n");
}
