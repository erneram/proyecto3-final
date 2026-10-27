import { buildCfg } from "../ir/cfg.js";
import { classOf, type IrFunction, type Operand, type Quad } from "../ir/ir.js";
import type { DataSection } from "./emit.js";
import { isVariable, Registers, type Emitter } from "./regs.js";

/** Cuádruplos que cierran su bloque saltando: vacían los registros ellos mismos antes del salto. */
const JUMPS = new Set<Quad["op"]>(["goto", "if", "ifnot", "ret", "try"]);

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
export class FunctionEmitter implements Emitter {
  readonly #out: string[] = [];
  readonly #size: number;
  readonly regs: Registers;
  /** Contador para etiquetas internas de esta función. */
  #local = 0;

  constructor(
    readonly fn: IrFunction,
    readonly data: DataSection,
  ) {
    this.#size = 4 * (fn.slots.length + fn.temps.length) + 8;
    this.#blocks = buildCfg(fn);
    // Temporales que aparecen en un solo bloque: al salir de él ya no se usan.
    const seenIn = new Map<number, Set<number>>();
    for (const b of this.#blocks) {
      for (const q of b.quads) {
        for (const v of Object.values(q)) {
          if (v && typeof v === "object" && "k" in v && v.k === "temp") {
            const blocks = seenIn.get(v.id) ?? new Set();
            seenIn.set(v.id, blocks.add(b.id));
          }
        }
      }
    }
    this.regs = new Registers(
      this,
      (o) => this.classOf(o),
      (v) => v.k === "temp" && seenIn.get(v.id)?.size === 1,
    );
  }

  readonly #blocks: ReturnType<typeof buildCfg>;

  emit(): string[] {
    this.#out.length = 0;
    this.#out.push(`${this.fn.label}:`);
    this.ins("addiu", "$sp", "$sp", -this.#size);
    this.ins("sw", "$ra", `${this.#size - 4}($sp)`);
    this.ins("sw", "$fp", `${this.#size - 8}($sp)`);
    this.ins("move", "$fp", "$sp");
    for (const block of this.#blocks) {
      this.regs.reset();
      for (const q of block.quads) {
        this.regs.begin();
        this.quad(q);
      }
      if (!JUMPS.has(block.quads.at(-1)!.op)) this.regs.flush("block");
    }
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

  classOf(o: Operand): "word" | "float" {
    return classOf(o, this.fn, this.data.module);
  }

  constant(o: Operand, reg: string): void {
    const float = reg.startsWith("$f");
    if (o.k === "str") this.ins("la", reg, this.data.string(o.value));
    else if (o.k === "int" && !float) this.ins("li", reg, o.value);
    else if (o.k === "int" || o.k === "float") this.ins(float ? "lwc1" : "lw", reg, this.data.float(o.value));
    else throw new Error(`${o.k} no es una constante`);
  }

  /** Deja el valor de `o` en un registro fijo (argumento de syscall o de llamada, retorno). */
  into(o: Operand, reg: string): void {
    if (!isVariable(o)) return this.constant(o, reg);
    const from = this.regs.read(o);
    if (from !== reg) this.ins(reg.startsWith("$f") ? "mov.s" : "move", reg, from);
  }

  // ---------- Cuádruplos ----------

  quad(q: Quad): void {
    switch (q.op) {
      case "label":
        this.label(q.name);
        return;
      case "mov": {
        if (!isVariable(q.dst)) throw new Error("Destino de mov no asignable");
        // Copia sin instrucción: el destino pasa a compartir el registro del origen.
        this.regs.assign(q.dst, this.regs.read(q.a));
        return;
      }
      case "print":
        this.print(q);
        return;
      case "ret":
        if (q.a) this.into(q.a, this.classOf(q.a) === "float" ? "$f0" : "$v0");
        this.regs.flush("globals");
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
        this.into(q.a, "$a0");
        this.syscall(1);
        break;
      case "float":
        this.into(q.a, "$f12");
        this.syscall(2);
        break;
      case "string":
        this.into(q.a, "$a0");
        this.syscall(4);
        break;
      case "bool": {
        const value = this.regs.read(q.a);
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
