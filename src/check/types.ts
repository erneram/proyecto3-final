import type { Pos } from "../frontend/ast.js";

/**
 * Tipos del lenguaje. `unknown` (sin información para inferir) y `error`
 * (ya reportado) son absorbentes: combinan con todo y no generan más errores.
 */
export type Type =
  | { tag: "int" }
  | { tag: "float" }
  | { tag: "string" }
  | { tag: "bool" }
  | { tag: "null" }
  | { tag: "void" }
  | { tag: "unknown" }
  | { tag: "error" }
  | { tag: "array"; elem: Type }
  | { tag: "fn"; params: Type[]; ret: Type }
  | { tag: "instance"; cls: ClassInfo }
  | { tag: "classRef"; cls: ClassInfo };

export interface Member {
  name: string;
  kind: "field" | "method";
  type: Type;
  mutable: boolean;
  pos: Pos;
  owner: ClassInfo;
}

/** Identidad de una clase: dos clases homónimas en ámbitos distintos son tipos distintos. */
export interface ClassInfo {
  id: number;
  name: string;
  parent?: ClassInfo;
  members: Map<string, Member>;
  pos: Pos;
}

export const INT: Type = { tag: "int" };
export const FLOAT: Type = { tag: "float" };
export const STRING: Type = { tag: "string" };
export const BOOL: Type = { tag: "bool" };
export const NULL: Type = { tag: "null" };
export const VOID: Type = { tag: "void" };
export const UNKNOWN: Type = { tag: "unknown" };
export const ERROR: Type = { tag: "error" };

export const arrayOf = (elem: Type): Type => ({ tag: "array", elem });
export const fnType = (params: Type[], ret: Type): Type => ({ tag: "fn", params, ret });
export const instanceOf = (cls: ClassInfo): Type => ({ tag: "instance", cls });

const PRIMITIVES: Record<string, Type> = { integer: INT, float: FLOAT, string: STRING, boolean: BOOL };

/** Tipo primitivo nombrado en una anotación, o `undefined` si es nombre de clase. */
export const primitiveByName = (name: string): Type | undefined => PRIMITIVES[name];

export const isAbsorbing = (t: Type): boolean => t.tag === "unknown" || t.tag === "error";
export const isNumeric = (t: Type): boolean => t.tag === "int" || t.tag === "float";
const isReference = (t: Type): boolean => t.tag === "array" || t.tag === "instance" || t.tag === "null";

export function isSubclass(cls: ClassInfo, ancestor: ClassInfo): boolean {
  for (let c: ClassInfo | undefined = cls; c; c = c.parent) if (c === ancestor) return true;
  return false;
}

/** Busca un miembro subiendo por la cadena de herencia. */
export function findMember(cls: ClassInfo, name: string): Member | undefined {
  for (let c: ClassInfo | undefined = cls; c; c = c.parent) {
    const m = c.members.get(name);
    if (m) return m;
  }
  return undefined;
}

export function sameType(a: Type, b: Type): boolean {
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case "array":
      return sameType(a.elem, (b as typeof a).elem);
    case "fn": {
      const f = b as typeof a;
      return a.params.length === f.params.length && a.params.every((p, i) => sameType(p, f.params[i])) && sameType(a.ret, f.ret);
    }
    case "instance":
    case "classRef":
      return a.cls === (b as typeof a).cls;
    default:
      return true;
  }
}

/** ¿Se puede guardar un valor de tipo `from` donde se espera `to`? */
export function assignable(to: Type, from: Type): boolean {
  if (isAbsorbing(to) || isAbsorbing(from) || sameType(to, from)) return true;
  if (to.tag === "float" && from.tag === "int") return true;
  if (from.tag === "null") return to.tag === "array" || to.tag === "instance";
  if (to.tag === "array" && from.tag === "array") return assignable(to.elem, from.elem);
  if (to.tag === "instance" && from.tag === "instance") return isSubclass(from.cls, to.cls);
  return false;
}

/** Operandos válidos para `==` y `!=`. */
export function comparable(a: Type, b: Type): boolean {
  if (isAbsorbing(a) || isAbsorbing(b)) return true;
  if (isNumeric(a) && isNumeric(b)) return true;
  if (a.tag === "null" || b.tag === "null") return isReference(a) && isReference(b);
  return assignable(a, b) || assignable(b, a);
}

/** Resultado aritmético: float si alguno lo es. */
export const numericResult = (a: Type, b: Type): Type => (a.tag === "float" || b.tag === "float" ? FLOAT : INT);

/**
 * Tipo que abarca a ambos (literales de arreglo, ramas del ternario, retornos inferidos),
 * o `undefined` si no hay uno común.
 */
export function commonType(a: Type, b: Type): Type | undefined {
  if (isAbsorbing(a)) return b;
  if (isAbsorbing(b) || sameType(a, b)) return a;
  if (isNumeric(a) && isNumeric(b)) return FLOAT;
  if (a.tag === "null" && isReference(b)) return b;
  if (b.tag === "null" && isReference(a)) return a;
  if (a.tag === "array" && b.tag === "array") {
    const elem = commonType(a.elem, b.elem);
    return elem && arrayOf(elem);
  }
  if (a.tag === "instance" && b.tag === "instance") {
    for (let c: ClassInfo | undefined = a.cls; c; c = c.parent) if (isSubclass(b.cls, c)) return instanceOf(c);
  }
  return undefined;
}

export function typeName(t: Type): string {
  switch (t.tag) {
    case "int":
      return "integer";
    case "bool":
      return "boolean";
    case "unknown":
      return "desconocido";
    case "array":
      return `${t.elem.tag === "fn" ? `(${typeName(t.elem)})` : typeName(t.elem)}[]`;
    case "fn":
      return `(${t.params.map(typeName).join(", ")}) => ${typeName(t.ret)}`;
    case "instance":
      return t.cls.name;
    case "classRef":
      return `clase ${t.cls.name}`;
    default:
      return t.tag;
  }
}
