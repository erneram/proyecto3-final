import { buildCfg } from "../ir/cfg.js";
import { classOf, type FloatOp, type IntOp, type IrFunction, type Operand, type Quad } from "../ir/ir.js";
import type { DataSection } from "./emit.js";
import { isVariable, Registers, type Emitter } from "./regs.js";

/** Cuádruplos que cierran su bloque saltando: vacían los registros ellos mismos antes del salto. */
const JUMPS = new Set<Quad["op"]>(["goto", "if", "ifnot", "ret", "try"]);

/** Operaciones enteras de una instrucción (varias son pseudoinstrucciones de MARS). */
const INT_INSTR: Record<Exclude<IntOp, "div" | "mod">, string> = {
  add: "addu", sub: "subu", mul: "mul",
  lt: "slt", le: "sle", gt: "sgt", ge: "sge", eq: "seq", ne: "sne",
};
const FLOAT_ARITH: Partial<Record<FloatOp, string>> = { fadd: "add.s", fsub: "sub.s", fmul: "mul.s", fdiv: "div.s" };
/** Comparación flotante como `c.xx.s` con operandos en orden o invertidos; `fne` es `feq` negado. */
const FLOAT_COMPARE: Partial<Record<FloatOp, { cond: string; swap: boolean }>> = {
  flt: { cond: "lt", swap: false }, fle: { cond: "le", swap: false },
  fgt: { cond: "lt", swap: true }, fge: { cond: "le", swap: true },
  feq: { cond: "eq", swap: false }, fne: { cond: "eq", swap: false },
};
/** Los primeros argumentos van en registros; los flotantes, como bits crudos. */
const ARG_REGS = ["$a0", "$a1", "$a2", "$a3"];

const fitsImmediate = (o: Operand): o is { k: "int"; value: number } => o.k === "int" && o.value >= -32768 && o.value <= 32767;

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
  /** Argumentos de la próxima llamada, en orden. */
  readonly #pending: Operand[] = [];

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
    // Los parámetros pasan a sus slots: de $a0–$a3 o de la zona que dejó quien llamó, justo encima del marco.
    for (let i = 0; i < this.fn.params; i++) {
      if (i < ARG_REGS.length) {
        this.ins("sw", ARG_REGS[i]!, `${4 * i}($fp)`);
      } else {
        this.ins("lw", "$t8", `${this.#size + 4 * (i - ARG_REGS.length)}($fp)`);
        this.ins("sw", "$t8", `${4 * i}($fp)`);
      }
    }
    if (this.fn.envParam !== undefined) this.ins("sw", "$v1", `${4 * this.fn.envParam}($fp)`);
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
    const toFloat = reg.startsWith("$f");
    const fromFloat = from.startsWith("$f");
    if (from === reg) return;
    if (toFloat === fromFloat) this.ins(toFloat ? "mov.s" : "move", reg, from);
    else this.ins(toFloat ? "mtc1" : "mfc1", toFloat ? from : reg, toFloat ? reg : from);
  }

  /**
   * Coloca los argumentos (de $a0 a $a3 y el resto en la pila), guarda todo lo
   * modificado y salta. La llamada pisa los registros temporales, así que al
   * volver no se confía en ninguno.
   */
  call(target: string, argc: number, dst: Operand | undefined): void {
    const args = this.#pending.splice(this.#pending.length - argc, argc);
    const extra = Math.max(0, argc - ARG_REGS.length);
    if (extra) this.ins("addiu", "$sp", "$sp", -4 * extra);
    args.slice(ARG_REGS.length).forEach((a, i) => {
      const r = this.regs.read(a);
      this.ins(r.startsWith("$f") ? "swc1" : "sw", r, `${4 * i}($sp)`);
    });
    args.slice(0, ARG_REGS.length).forEach((a, i) => this.into(a, ARG_REGS[i]!));
    this.regs.flush("all");
    this.ins("jal", target);
    if (extra) this.ins("addiu", "$sp", "$sp", 4 * extra);
    this.regs.reset();
    if (!dst) return;
    const float = this.classOf(dst) === "float";
    this.ins(float ? "mov.s" : "move", this.write(dst), float ? "$f0" : "$v0");
  }

  // ---------- Cuádruplos ----------

  quad(q: Quad): void {
    switch (q.op) {
      case "label":
        this.label(q.name);
        return;
      case "mov": {
        if (!isVariable(q.dst)) throw new Error(`Destino no asignable: ${q.dst.k}`);
        // Copia sin instrucción: el destino pasa a compartir el registro del origen.
        this.regs.assign(q.dst, this.regs.read(q.a));
        return;
      }
      case "print":
        this.print(q);
        return;
      case "add":
      case "sub":
      case "mul":
      case "lt":
      case "le":
      case "gt":
      case "ge":
      case "eq":
      case "ne": {
        const a = this.regs.read(q.a);
        // Sumar o restar una constante pequeña no necesita registro para ella.
        if ((q.op === "add" || q.op === "sub") && fitsImmediate(q.b)) {
          const imm = q.op === "add" ? q.b.value : -q.b.value;
          if (imm >= -32768 && imm <= 32767) return this.ins("addiu", this.write(q.dst), a, imm);
        }
        const b = this.regs.read(q.b);
        this.ins(INT_INSTR[q.op], this.write(q.dst), a, b);
        return;
      }
      case "div":
      case "mod": {
        const a = this.regs.read(q.a);
        const b = this.regs.read(q.b);
        this.ins("div", a, b);
        this.ins(q.op === "div" ? "mflo" : "mfhi", this.write(q.dst));
        return;
      }
      case "fadd":
      case "fsub":
      case "fmul":
      case "fdiv": {
        const a = this.regs.read(q.a);
        const b = this.regs.read(q.b);
        this.ins(FLOAT_ARITH[q.op]!, this.write(q.dst), a, b);
        return;
      }
      case "flt":
      case "fle":
      case "fgt":
      case "fge":
      case "feq":
      case "fne": {
        const { cond, swap } = FLOAT_COMPARE[q.op]!;
        const a = this.regs.read(q.a);
        const b = this.regs.read(q.b);
        this.ins(`c.${cond}.s`, ...(swap ? [b, a] : [a, b]));
        const d = this.write(q.dst);
        this.ins("li", d, 1);
        // La condición queda en la bandera de coma flotante: se apaga el 1 si no se cumple.
        this.ins(q.op === "fne" ? "movt" : "movf", d, "$zero");
        return;
      }
      case "neg":
      case "fneg":
      case "not":
      case "itof":
        this.unaryOp(q);
        return;
      case "goto":
        this.regs.flush("block");
        this.ins("j", q.target);
        return;
      case "if":
      case "ifnot": {
        const a = this.regs.read(q.a);
        this.regs.flush("block");
        this.ins(q.op === "if" ? "bnez" : "beqz", a, q.target);
        return;
      }
      case "param":
        this.#pending.push(q.a);
        return;
      case "call":
        this.call(q.fn, q.argc, q.dst);
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

  /** Registro para el nuevo valor de `o`. */
  write(o: Operand): string {
    if (!isVariable(o)) throw new Error(`Destino no asignable: ${o.k}`);
    return this.regs.write(o);
  }

  unaryOp(q: Extract<Quad, { op: "neg" | "fneg" | "not" | "itof" }>): void {
    const a = this.regs.read(q.a);
    const d = this.write(q.dst);
    if (q.op === "neg") this.ins("subu", d, "$zero", a);
    else if (q.op === "fneg") this.ins("neg.s", d, a);
    // Los booleanos son 0 o 1: `!a` es `a < 1` sin signo.
    else if (q.op === "not") this.ins("sltiu", d, a, 1);
    else {
      this.ins("mtc1", a, d);
      this.ins("cvt.s.w", d, d);
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
