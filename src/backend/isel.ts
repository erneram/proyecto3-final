import { classOf, type IrFunction, type Operand, type Quad } from "../ir/ir.js";
import type { DataSection } from "./emit.js";

/** Registros de paso: el resultado de una instrucción se arma aquí antes de guardarse. */
const W0 = "$t8";
const W1 = "$t9";
const F0 = "$f4";

/**
 * Traduce una función del código intermedio a MIPS.
 *
 * Marco (crece hacia abajo, `$fp` = `$sp` tras el prólogo):
 *   0($fp) ...           slots (parámetros y locales), uno por palabra
 *   ...                  un lugar por temporal
 *   size-8($fp)          $fp de quien llamó
 *   size-4($fp)          $ra
 * Los flotantes ocupan una palabra como cualquier otro valor.
 */
export class FunctionEmitter {
  readonly #out: string[] = [];
  readonly #size: number;
  /** Contador para etiquetas internas de esta función. */
  #local = 0;

  constructor(
    readonly fn: IrFunction,
    readonly data: DataSection,
  ) {
    this.#size = 4 * (fn.slots.length + fn.temps.length) + 8;
  }

  emit(): string[] {
    this.#out.length = 0;
    this.#out.push(`${this.fn.label}:`);
    this.ins("addiu", "$sp", "$sp", -this.#size);
    this.ins("sw", "$ra", `${this.#size - 4}($sp)`);
    this.ins("sw", "$fp", `${this.#size - 8}($sp)`);
    this.ins("move", "$fp", "$sp");
    for (const q of this.fn.body) this.quad(q);
    return this.#out;
  }

  ins(op: string, ...args: (string | number)[]): void {
    this.#out.push(`    ${op} ${args.join(", ")}`.trimEnd());
  }

  label(name: string): void {
    this.#out.push(`${name}:`);
  }

  localLabel(): string {
    return `${this.fn.label}_${this.#local++}`;
  }

  // ---------- Operandos ----------

  /** Dirección en memoria de un operando que vive en el marco o en datos. */
  home(o: Operand): string {
    switch (o.k) {
      case "slot":
        return `${4 * o.index}($fp)`;
      case "temp":
        return `${4 * (this.fn.slots.length + o.id)}($fp)`;
      case "global":
        return this.data.global(o.index);
      default:
        throw new Error(`El operando ${o.k} no tiene dirección`);
    }
  }

  isFloat(o: Operand): boolean {
    return classOf(o, this.fn, this.data.module) === "float";
  }

  /** Carga un valor de palabra (entero, booleano, puntero) en `reg`. */
  loadWord(o: Operand, reg: string): string {
    if (o.k === "int") this.ins("li", reg, o.value);
    else if (o.k === "str") this.ins("la", reg, this.data.string(o.value));
    else if (o.k === "float") this.ins("lw", reg, this.data.float(o.value));
    else this.ins("lw", reg, this.home(o));
    return reg;
  }

  loadFloat(o: Operand, reg: string): string {
    if (o.k === "float" || o.k === "int") this.ins("lwc1", reg, this.data.float(o.value));
    else if (o.k === "str") throw new Error("Una cadena no es un valor flotante");
    else this.ins("lwc1", reg, this.home(o));
    return reg;
  }

  storeWord(reg: string, o: Operand): void {
    this.ins("sw", reg, this.home(o));
  }

  storeFloat(reg: string, o: Operand): void {
    this.ins("swc1", reg, this.home(o));
  }

  // ---------- Cuádruplos ----------

  quad(q: Quad): void {
    switch (q.op) {
      case "label":
        this.label(q.name);
        return;
      case "mov":
        if (this.isFloat(q.dst)) this.storeFloat(this.loadFloat(q.a, F0), q.dst);
        else this.storeWord(this.loadWord(q.a, W0), q.dst);
        return;
      case "print":
        this.print(q);
        return;
      case "ret":
        if (q.a && this.isFloat(q.a)) this.loadFloat(q.a, "$f0");
        else if (q.a) this.loadWord(q.a, "$v0");
        this.ins("lw", "$ra", `${this.#size - 4}($fp)`);
        this.ins("lw", "$fp", `${this.#size - 8}($fp)`);
        this.ins("addiu", "$sp", "$sp", this.#size);
        this.ins("jr", "$ra");
        return;
      default:
        throw new Error(`Generación de MIPS pendiente para '${q.op}'`);
    }
  }

  /** Cada print termina con un salto de línea. */
  print(q: Extract<Quad, { op: "print" }>): void {
    switch (q.format) {
      case "int":
        this.loadWord(q.a, "$a0");
        this.syscall(1);
        break;
      case "float":
        this.loadFloat(q.a, "$f12");
        this.syscall(2);
        break;
      case "string":
        this.loadWord(q.a, "$a0");
        this.syscall(4);
        break;
      case "bool": {
        const value = this.loadWord(q.a, W1);
        const done = this.localLabel();
        this.ins("la", "$a0", this.data.string("true"));
        this.ins("bnez", value, done);
        this.ins("la", "$a0", this.data.string("false"));
        this.label(done);
        this.syscall(4);
        break;
      }
    }
    this.ins("li", "$a0", 10);
    this.syscall(11);
  }

  syscall(code: number): void {
    this.ins("li", "$v0", code);
    this.ins("syscall");
  }
}
