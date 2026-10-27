/**
 * Representación intermedia: código de tres direcciones en cuádruplos.
 * Cada función del programa es una `IrFunction` aparte (el código global es `main`).
 * Los temporales son virtuales e ilimitados; el backend decide registros.
 */

/** Clase de valor a nivel máquina: palabra (enteros, booleanos, punteros) o flotante. */
export type ValueClass = "word" | "float";

export type Operand =
  | { k: "temp"; id: number }
  /** Variable de la pila de la función actual (parámetro o local). */
  | { k: "slot"; index: number }
  /** Variable global, en el segmento de datos. */
  | { k: "global"; index: number }
  /** Entero, booleano (0/1) o null (0). */
  | { k: "int"; value: number }
  | { k: "float"; value: number }
  | { k: "str"; value: string };

export type IntOp = "add" | "sub" | "mul" | "div" | "mod" | "lt" | "le" | "gt" | "ge" | "eq" | "ne";
export type FloatOp = "fadd" | "fsub" | "fmul" | "fdiv" | "flt" | "fle" | "fgt" | "fge" | "feq" | "fne";
export type BinaryOp = IntOp | FloatOp | "concat" | "streq";
export type UnaryOp = "neg" | "fneg" | "not" | "itof";
export type PrintFormat = "int" | "float" | "string" | "bool";

export type Quad =
  | { op: "mov"; dst: Operand; a: Operand }
  | { op: BinaryOp; dst: Operand; a: Operand; b: Operand }
  | { op: UnaryOp; dst: Operand; a: Operand }
  | { op: "label"; name: string }
  | { op: "goto"; target: string }
  | { op: "if" | "ifnot"; a: Operand; target: string }
  /** Apila el siguiente argumento de la próxima llamada. */
  | { op: "param"; a: Operand }
  /** Llamada directa a una función conocida. */
  | { op: "call"; dst?: Operand; fn: string; argc: number }
  /** Llamada a un valor función (clausura {código, entorno}). */
  | { op: "callc"; dst?: Operand; closure: Operand; argc: number }
  /** Llamada a método por vtable; el objeto ya fue apilado como primer argumento (cuenta en `argc`). */
  | { op: "callm"; dst?: Operand; object: Operand; slot: number; argc: number }
  | { op: "ret"; a?: Operand }
  | { op: "print"; a: Operand; format: PrintFormat }
  /** Bloque de `words` palabras en el heap (entornos y clausuras). */
  | { op: "alloc"; dst: Operand; words: number }
  | { op: "load"; dst: Operand; base: Operand; offset: number }
  | { op: "store"; base: Operand; offset: number; a: Operand }
  | { op: "closure"; dst: Operand; fn: string; env: Operand }
  /** Objeto en ceros con su vtable y el entorno donde se declaró la clase (lo usan sus métodos). */
  | { op: "newobj"; dst: Operand; cls: string; env: Operand }
  /** Acceso a campo con verificación de null. */
  | { op: "getf"; dst: Operand; object: Operand; offset: number }
  | { op: "setf"; object: Operand; offset: number; a: Operand }
  | { op: "newarr"; dst: Operand; length: Operand }
  /** Acceso a arreglo con verificación de null y de límites. */
  | { op: "aget"; dst: Operand; array: Operand; index: Operand }
  | { op: "aset"; array: Operand; index: Operand; a: Operand }
  | { op: "alen"; dst: Operand; array: Operand }
  /** Activa un manejador: un error en tiempo de ejecución salta a `handler`. */
  | { op: "try"; handler: string }
  | { op: "endtry" }
  /** Mensaje del error capturado (primera instrucción del manejador). */
  | { op: "caught"; dst: Operand };

export type QuadOp = Quad["op"];

export interface SlotInfo {
  name: string;
  cls: ValueClass;
}

export interface IrFunction {
  /** Etiqueta única en el ensamblador. */
  label: string;
  /** Nombre legible (`Punto.get`, `contador.siguiente`). */
  name: string;
  /** Los primeros `params` slots son los parámetros, en orden (incluye `this` en métodos). */
  params: number;
  slots: SlotInfo[];
  /** Slot que recibe el entorno de la clausura al entrar, si la función lo usa. */
  envParam?: number;
  temps: ValueClass[];
  body: Quad[];
}

export interface ClassLayout {
  label: string;
  name: string;
  /** Palabras por instancia: vtable (palabra 0), entorno (palabra 1) y luego los campos. */
  words: number;
  fields: { name: string; offset: number }[];
  /** Etiqueta de función por cada entrada de la vtable (incluye el constructor). */
  vtable: { name: string; fn: string }[];
}

export interface IrModule {
  functions: IrFunction[];
  globals: SlotInfo[];
  classes: ClassLayout[];
}

/** Clase de valor de un operando dentro de `fn`. */
export function classOf(o: Operand, fn: IrFunction, module: IrModule): ValueClass {
  switch (o.k) {
    case "temp":
      return fn.temps[o.id];
    case "slot":
      return fn.slots[o.index].cls;
    case "global":
      return module.globals[o.index].cls;
    case "float":
      return "float";
    default:
      return "word";
  }
}
