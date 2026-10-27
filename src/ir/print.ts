import type { BinaryOp, IrFunction, IrModule, Operand, Quad, UnaryOp } from "./ir.js";

const BINARY: Record<BinaryOp, string> = {
  add: "+", sub: "-", mul: "*", div: "/", mod: "%",
  lt: "<", le: "<=", gt: ">", ge: ">=", eq: "==", ne: "!=",
  fadd: "+.", fsub: "-.", fmul: "*.", fdiv: "/.",
  flt: "<.", fle: "<=.", fgt: ">.", fge: ">=.", feq: "==.", fne: "!=.",
  concat: "++", streq: "==s",
};

const UNARY: Record<UnaryOp, string> = { neg: "-", fneg: "-.", not: "!", itof: "(float) " };

function operand(o: Operand, fn: IrFunction, m: IrModule): string {
  switch (o.k) {
    case "temp":
      return `t${o.id}`;
    case "slot":
      return fn.slots[o.index].name;
    case "global":
      return `@${m.globals[o.index].name}`;
    case "int":
      return String(o.value);
    case "float":
      return Number.isInteger(o.value) ? o.value.toFixed(1) : String(o.value);
    case "str":
      return JSON.stringify(o.value);
  }
}

export function printQuad(q: Quad, fn: IrFunction, m: IrModule): string {
  const v = (o: Operand): string => operand(o, fn, m);
  const assign = (dst: Operand | undefined, rhs: string): string => (dst ? `${v(dst)} = ${rhs}` : rhs);
  switch (q.op) {
    case "label":
      return `${q.name}:`;
    case "mov":
      return `${v(q.dst)} = ${v(q.a)}`;
    case "neg":
    case "fneg":
    case "not":
    case "itof":
      return `${v(q.dst)} = ${UNARY[q.op]}${v(q.a)}`;
    case "goto":
      return `goto ${q.target}`;
    case "if":
      return `if ${v(q.a)} goto ${q.target}`;
    case "ifnot":
      return `ifnot ${v(q.a)} goto ${q.target}`;
    case "param":
      return `param ${v(q.a)}`;
    case "call":
      return assign(q.dst, `call ${q.fn}, ${q.argc}`);
    case "callc":
      return assign(q.dst, `callc ${v(q.closure)}, ${q.argc}`);
    case "callm":
      return assign(q.dst, `callm ${v(q.object)}.vtable[${q.slot}], ${q.argc}`);
    case "ret":
      return q.a ? `return ${v(q.a)}` : "return";
    case "print":
      return `print.${q.format} ${v(q.a)}`;
    case "alloc":
      return `${v(q.dst)} = alloc ${q.words}`;
    case "load":
      return `${v(q.dst)} = ${v(q.base)}[${q.offset}]`;
    case "store":
      return `${v(q.base)}[${q.offset}] = ${v(q.a)}`;
    case "closure":
      return `${v(q.dst)} = closure ${q.fn}, ${v(q.env)}`;
    case "newobj":
      return `${v(q.dst)} = new ${q.cls}`;
    case "getf":
      return `${v(q.dst)} = ${v(q.object)}.[${q.offset}]`;
    case "setf":
      return `${v(q.object)}.[${q.offset}] = ${v(q.a)}`;
    case "newarr":
      return `${v(q.dst)} = newarray ${v(q.length)}`;
    case "aget":
      return `${v(q.dst)} = ${v(q.array)}{${v(q.index)}}`;
    case "aset":
      return `${v(q.array)}{${v(q.index)}} = ${v(q.a)}`;
    case "alen":
      return `${v(q.dst)} = length ${v(q.array)}`;
    case "try":
      return `try ${q.handler}`;
    case "endtry":
      return "endtry";
    case "caught":
      return `${v(q.dst)} = caught`;
    default:
      return `${v(q.dst)} = ${v(q.a)} ${BINARY[q.op]} ${v(q.b)}`;
  }
}

export function printFunction(fn: IrFunction, m: IrModule): string {
  const params = fn.slots.slice(0, fn.params).map((s) => s.name).join(", ");
  const lines = [`func ${fn.name}(${params})  ; ${fn.label}`];
  for (const q of fn.body) lines.push(q.op === "label" ? printQuad(q, fn, m) : `    ${printQuad(q, fn, m)}`);
  lines.push("end");
  return lines.join("\n");
}

export function printModule(m: IrModule): string {
  const parts: string[] = [];
  for (const c of m.classes) {
    const fields = c.fields.map((f) => `${f.name}@${f.offset}`).join(", ") || "-";
    const vtable = c.vtable.map((e) => e.name).join(", ") || "-";
    parts.push(`class ${c.name}  ; ${c.label}, ${c.words} palabras\n    campos: ${fields}\n    vtable: ${vtable}`);
  }
  if (m.globals.length) parts.push(`globales: ${m.globals.map((g) => g.name).join(", ")}`);
  for (const fn of m.functions) parts.push(printFunction(fn, m));
  return parts.join("\n\n");
}
