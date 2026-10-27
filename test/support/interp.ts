import type { ClassLayout, IrFunction, IrModule, Operand } from "../../src/ir/ir.js";

/**
 * Intérprete del código de tres direcciones, solo para pruebas: permite verificar
 * qué imprime un programa sin pasar por el backend ni por MARS.
 */

interface Closure {
  fn: string;
  env: Value;
}
interface ArrayRef {
  items: Value[];
}
/** `0` es null; los bloques del heap (entornos y objetos) son arreglos de palabras. */
type Value = number | string | Value[] | Closure | ArrayRef | ClassLayout;

export const RUNTIME_ERRORS = {
  bounds: "Runtime error: array index out of bounds",
  nullArray: "Runtime error: null array",
  nullObject: "Runtime error: null reference",
  divByZero: "Runtime error: division by zero",
};

class Fault extends Error {}

export interface IrRun {
  output: string[];
  /** Mensaje del error que nadie capturó, si lo hubo. */
  uncaught?: string;
}

const formatFloat = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

export function runIr(m: IrModule, maxSteps = 1_000_000): IrRun {
  const output: string[] = [];
  const fns = new Map(m.functions.map((f) => [f.label, f]));
  const globals: Value[] = m.globals.map(() => 0);
  let steps = 0;

  function invoke(label: string, args: Value[], env: Value): Value | undefined {
    const fn = fns.get(label);
    if (!fn) throw new Error(`Función inexistente: ${label}`);
    return run(fn, args, env);
  }

  function run(fn: IrFunction, args: Value[], env: Value): Value | undefined {
    const slots: Value[] = fn.slots.map((_, i) => args[i] ?? 0);
    if (fn.envParam !== undefined) slots[fn.envParam] = env;
    const temps: Value[] = [];
    const labels = new Map<string, number>();
    fn.body.forEach((q, i) => q.op === "label" && labels.set(q.name, i));
    const target = (name: string): number => {
      const at = labels.get(name);
      if (at === undefined) throw new Error(`Etiqueta inexistente en ${fn.label}: ${name}`);
      return at;
    };
    const handlers: string[] = [];
    const pending: Value[] = [];
    let message = "";

    const get = (o: Operand): Value => {
      switch (o.k) {
        case "temp":
          if (temps[o.id] === undefined) throw new Error(`t${o.id} se usa sin definir en ${fn.label}`);
          return temps[o.id]!;
        case "slot":
          return slots[o.index]!;
        case "global":
          return globals[o.index]!;
        case "int":
        case "float":
          return o.value;
        case "str":
          return o.value;
      }
    };
    const set = (o: Operand, v: Value): void => {
      if (o.k === "temp") temps[o.id] = v;
      else if (o.k === "slot") slots[o.index] = v;
      else if (o.k === "global") globals[o.index] = v;
      else throw new Error("Destino no asignable");
    };
    const num = (o: Operand): number => get(o) as number;
    const block = (o: Operand): Value[] => {
      const v = get(o);
      if (v === 0) throw new Fault(RUNTIME_ERRORS.nullObject);
      return v as Value[];
    };
    const array = (o: Operand, index?: Operand): ArrayRef => {
      const v = get(o);
      if (v === 0) throw new Fault(RUNTIME_ERRORS.nullArray);
      const arr = v as ArrayRef;
      if (index && (num(index) < 0 || num(index) >= arr.items.length)) throw new Fault(RUNTIME_ERRORS.bounds);
      return arr;
    };
    const take = (argc: number): Value[] => pending.splice(pending.length - argc, argc);

    let pc = 0;
    while (pc < fn.body.length) {
      if (++steps > maxSteps) throw new Error("El programa no terminó");
      const q = fn.body[pc++]!;
      try {
        switch (q.op) {
          case "mov":
            set(q.dst, get(q.a));
            break;
          case "add":
            set(q.dst, (num(q.a) + num(q.b)) | 0);
            break;
          case "sub":
            set(q.dst, (num(q.a) - num(q.b)) | 0);
            break;
          case "mul":
            set(q.dst, Math.imul(num(q.a), num(q.b)));
            break;
          case "div":
          case "mod":
            if (num(q.b) === 0) throw new Fault(RUNTIME_ERRORS.divByZero);
            set(q.dst, q.op === "div" ? Math.trunc(num(q.a) / num(q.b)) | 0 : num(q.a) % num(q.b));
            break;
          case "fadd":
            set(q.dst, num(q.a) + num(q.b));
            break;
          case "fsub":
            set(q.dst, num(q.a) - num(q.b));
            break;
          case "fmul":
            set(q.dst, num(q.a) * num(q.b));
            break;
          case "fdiv":
            set(q.dst, num(q.a) / num(q.b));
            break;
          case "lt":
          case "flt":
            set(q.dst, num(q.a) < num(q.b) ? 1 : 0);
            break;
          case "le":
          case "fle":
            set(q.dst, num(q.a) <= num(q.b) ? 1 : 0);
            break;
          case "gt":
          case "fgt":
            set(q.dst, num(q.a) > num(q.b) ? 1 : 0);
            break;
          case "ge":
          case "fge":
            set(q.dst, num(q.a) >= num(q.b) ? 1 : 0);
            break;
          case "eq":
          case "feq":
          case "streq":
            set(q.dst, get(q.a) === get(q.b) ? 1 : 0);
            break;
          case "ne":
          case "fne":
            set(q.dst, get(q.a) !== get(q.b) ? 1 : 0);
            break;
          case "concat":
            set(q.dst, String(get(q.a)) + String(get(q.b)));
            break;
          case "neg":
            set(q.dst, -num(q.a) | 0);
            break;
          case "fneg":
            set(q.dst, -num(q.a));
            break;
          case "not":
            set(q.dst, get(q.a) === 0 ? 1 : 0);
            break;
          case "itof":
            set(q.dst, num(q.a));
            break;
          case "label":
            break;
          case "goto":
            pc = target(q.target);
            break;
          case "if":
          case "ifnot":
            if ((get(q.a) !== 0) === (q.op === "if")) pc = target(q.target);
            break;
          case "param":
            pending.push(get(q.a));
            break;
          case "call": {
            const r = invoke(q.fn, take(q.argc), 0);
            if (q.dst) set(q.dst, r!);
            break;
          }
          case "callc": {
            const c = get(q.closure);
            if (c === 0) throw new Fault(RUNTIME_ERRORS.nullObject);
            const r = invoke((c as Closure).fn, take(q.argc), (c as Closure).env);
            if (q.dst) set(q.dst, r!);
            break;
          }
          case "callm": {
            const obj = block(q.object);
            const entry = (obj[0] as ClassLayout).vtable[q.slot];
            if (!entry) throw new Error(`Entrada ${q.slot} inexistente en la vtable`);
            const r = invoke(entry.fn, take(q.argc), obj[1]!);
            if (q.dst) set(q.dst, r!);
            break;
          }
          case "ret":
            return q.a && get(q.a);
          case "print": {
            const v = get(q.a);
            const text =
              q.format === "float" ? formatFloat(v as number) : q.format === "bool" ? (v ? "true" : "false") : String(v);
            output.push(text);
            break;
          }
          case "alloc":
            set(q.dst, new Array<Value>(q.words).fill(0));
            break;
          case "load":
            set(q.dst, block(q.base)[q.offset / 4]!);
            break;
          case "store":
            block(q.base)[q.offset / 4] = get(q.a);
            break;
          case "closure":
            set(q.dst, { fn: q.fn, env: get(q.env) });
            break;
          case "newobj": {
            const layout = m.classes.find((c) => c.label === q.cls);
            if (!layout) throw new Error(`Clase inexistente: ${q.cls}`);
            const obj = new Array<Value>(layout.words).fill(0);
            obj[0] = layout;
            obj[1] = get(q.env);
            set(q.dst, obj);
            break;
          }
          case "getf":
            set(q.dst, block(q.object)[q.offset / 4]!);
            break;
          case "setf":
            block(q.object)[q.offset / 4] = get(q.a);
            break;
          case "newarr":
            set(q.dst, { items: new Array<Value>(num(q.length)).fill(0) });
            break;
          case "aget":
            set(q.dst, array(q.array, q.index).items[num(q.index)]!);
            break;
          case "aset":
            array(q.array, q.index).items[num(q.index)] = get(q.a);
            break;
          case "alen":
            set(q.dst, array(q.array).items.length);
            break;
          case "try":
            handlers.push(q.handler);
            break;
          case "endtry":
            if (!handlers.pop()) throw new Error(`endtry sin try en ${fn.label}`);
            break;
          case "caught":
            set(q.dst, message);
            break;
        }
      } catch (e) {
        // El manejador más reciente de esta llamada atrapa el error; si no hay, sigue hacia quien llamó.
        if (!(e instanceof Fault) || handlers.length === 0) throw e;
        message = e.message;
        pc = target(handlers.pop()!);
      }
    }
    throw new Error(`${fn.label} terminó sin return`);
  }

  try {
    invoke("main", [], 0);
  } catch (e) {
    if (!(e instanceof Fault)) throw e;
    output.push(e.message);
    return { output, uncaught: e.message };
  }
  return { output };
}
