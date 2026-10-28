import type { IrModule } from "../ir/ir.js";
import { FunctionEmitter } from "./isel.js";
import { HANDLER_TOP, routineLabel, runtimeCode, type Routine } from "./runtime.js";

/** Escapes que MARS entiende dentro de `.asciiz`. */
const ESCAPES: Record<string, string> = { "\n": "\\n", "\t": "\\t", "\r": "\\r", '"': '\\"', "\\": "\\\\" };
const asciiz = (s: string): string => `"${s.replace(/[\n\t\r"\\]/g, (c) => ESCAPES[c]!)}"`;

/** Segmento de datos: globales y constantes compartidas por todas las funciones. */
export class DataSection {
  readonly #strings = new Map<string, string>();
  readonly #floats = new Map<number, string>();
  /** Rutinas del runtime que el programa usa: solo esas se incluyen. */
  readonly routines = new Set<Routine>();
  /** Hay algún `try` o algún error posible: hace falta la pila de manejadores. */
  handlers = false;

  constructor(readonly module: IrModule) {}

  routine(r: Routine): string {
    this.routines.add(r);
    if (r !== "concat" && r !== "streq") this.handlers = true;
    return routineLabel(r);
  }

  /** Etiqueta de una cadena constante; las repetidas comparten una sola copia. */
  string(value: string): string {
    let label = this.#strings.get(value);
    if (!label) this.#strings.set(value, (label = `str_${this.#strings.size}`));
    return label;
  }

  float(value: number): string {
    let label = this.#floats.get(value);
    if (!label) this.#floats.set(value, (label = `flt_${this.#floats.size}`));
    return label;
  }

  global(index: number): string {
    return `glb_${index}_${this.module.globals[index]!.name}`;
  }

  /** Palabras primero (quedan alineadas) y las cadenas al final. */
  render(): string[] {
    const lines = this.module.globals.map((_, i) => `${this.global(i)}: .word 0`);
    if (this.handlers) lines.push(`${HANDLER_TOP}: .word 0`);
    // Cada vtable es la lista de direcciones de sus métodos.
    for (const c of this.module.classes) lines.push(`${c.label}: .word ${c.vtable.map((e) => e.fn).join(", ") || 0}`);
    for (const [value, label] of this.#floats) lines.push(`${label}: .float ${value}`);
    for (const [value, label] of this.#strings) lines.push(`${label}: .asciiz ${asciiz(value)}`);
    return lines;
  }
}

/** Programa completo para MARS: datos, arranque y una rutina por función. */
export function generate(m: IrModule): string {
  const data = new DataSection(m);
  // MARS empieza en la primera instrucción de .text: el arranque llama a main y termina.
  const text = ["__inicio:", "    jal main", "    li $v0, 10", "    syscall"];
  for (const fn of m.functions) text.push("", ...new FunctionEmitter(fn, data).emit());
  text.push(...runtimeCode(data.routines, (msg) => data.string(msg)));
  return [".data", ...data.render(), "", ".text", ...text, ""].join("\n");
}
