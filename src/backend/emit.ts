import type { IrModule } from "../ir/ir.js";
import { FunctionEmitter } from "./isel.js";

/** Escapes que MARS entiende dentro de `.asciiz`. */
const ESCAPES: Record<string, string> = { "\n": "\\n", "\t": "\\t", "\r": "\\r", '"': '\\"', "\\": "\\\\" };
const asciiz = (s: string): string => `"${s.replace(/[\n\t\r"\\]/g, (c) => ESCAPES[c]!)}"`;

/** Segmento de datos: globales y constantes compartidas por todas las funciones. */
export class DataSection {
  readonly #strings = new Map<string, string>();
  readonly #floats = new Map<number, string>();

  constructor(readonly module: IrModule) {}

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
  return [".data", ...data.render(), "", ".text", ...text, ""].join("\n");
}
