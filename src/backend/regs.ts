import type { Operand, ValueClass } from "../ir/ir.js";

/** Lo que el asignador necesita del emisor: escribir instrucciones y ubicar cada variable en memoria. */
export interface Emitter {
  ins(op: string, ...args: (string | number)[]): void;
  home(o: Operand): string;
  /** Carga una constante directo en `reg`. */
  constant(o: Operand, reg: string): void;
}

export type Variable = Extract<Operand, { k: "temp" | "slot" | "global" }>;

export const isVariable = (o: Operand): o is Variable => o.k === "temp" || o.k === "slot" || o.k === "global";

const keyOf = (v: Variable): string => (v.k === "temp" ? `t${v.id}` : v.k === "slot" ? `s${v.index}` : `g${v.index}`);

/** Registros que reparte el asignador; los de paso, argumentos y retorno quedan fuera. */
export const POOLS: Record<ValueClass, readonly string[]> = {
  word: ["$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7"],
  float: ["$f2", "$f4", "$f6", "$f8", "$f10", "$f14", "$f16", "$f18"],
};

/** Descriptor de dirección: dónde está hoy el valor de una variable. */
interface Location {
  v: Variable;
  cls: ValueClass;
  /** La copia en su lugar de memoria está al día. */
  inMemory: boolean;
  regs: Set<string>;
}

/** Qué variables se guardan en memoria al vaciar los registros. */
export type FlushPolicy =
  /** Fin de bloque o antes de algo que puede fallar: los temporales de un solo bloque no hacen falta. */
  | "block"
  /** Antes de una llamada: todo, porque la llamada pisa los registros y los temporales siguen vivos. */
  | "all"
  /** Al retornar: solo globales; los slots y temporales mueren con el marco. */
  | "globals";

/**
 * getReg por bloque básico (libro del dragón) con descriptores de registro y de dirección.
 * Al empezar cada bloque nada está en registros; los valores se cargan al usarse,
 * las copias solo agregan nombres al registro, y al cerrar el bloque se guarda lo modificado.
 */
export class Registers {
  /** Descriptor de registro: nombres de variables cuyo valor tiene. */
  readonly #holds = new Map<string, Set<string>>();
  readonly #locations = new Map<string, Location>();
  /** Registros que lee la instrucción en curso: no se reasignan hasta la siguiente. */
  readonly #pinned = new Set<string>();
  readonly #turn: Record<ValueClass, number> = { word: 0, float: 0 };

  constructor(
    readonly out: Emitter,
    readonly classOf: (o: Operand) => ValueClass,
    /** Temporales que solo aparecen en un bloque: muertos al salir de él. */
    readonly blockLocal: (v: Variable) => boolean,
  ) {
    for (const r of [...POOLS.word, ...POOLS.float]) this.#holds.set(r, new Set());
  }

  /** Marca el inicio de una instrucción. */
  begin(): void {
    this.#pinned.clear();
  }

  /** Registro con el valor de `o`, cargándolo si hace falta. */
  read(o: Operand): string {
    const cls = this.classOf(o);
    if (o.k === "int" && o.value === 0 && cls === "word") return "$zero";
    if (!isVariable(o)) {
      const r = this.take(cls, false);
      this.out.constant(o, r);
      this.#pinned.add(r);
      return r;
    }
    const loc = this.location(o);
    let r = [...loc.regs].find((x) => this.#holds.has(x)) ?? [...loc.regs][0];
    if (!r) {
      r = this.take(cls, false);
      this.out.ins(cls === "float" ? "lwc1" : "lw", r, this.out.home(o));
      loc.regs.add(r);
      this.#holds.get(r)!.add(keyOf(o));
    }
    this.#pinned.add(r);
    return r;
  }

  /** Registro donde dejar el nuevo valor de `v`; desde ahí `v` solo vale en ese registro. */
  write(v: Variable): string {
    const loc = this.location(v);
    const own = [...loc.regs].find((r) => this.#holds.get(r)?.size === 1);
    const r = own ?? this.take(loc.cls, true);
    this.assign(v, r);
    return r;
  }

  /** `v` pasa a valer lo que tiene `reg`, sin instrucción (copia `v = x` con `x` ya en `reg`). */
  assign(v: Variable, reg: string): void {
    const loc = this.location(v);
    for (const old of loc.regs) this.#holds.get(old)?.delete(keyOf(v));
    loc.regs = new Set([reg]);
    loc.inMemory = false;
    this.#holds.get(reg)?.add(keyOf(v));
  }

  /** Guarda en memoria los valores modificados que la política pide; los registros siguen válidos. */
  flush(policy: FlushPolicy): void {
    for (const loc of this.#locations.values()) {
      if (loc.inMemory) continue;
      if (policy === "globals" && loc.v.k !== "global") continue;
      if (policy === "block" && this.blockLocal(loc.v)) continue;
      this.store(loc);
    }
  }

  /** Olvida todo lo que hay en registros (inicio de bloque o después de una llamada). */
  reset(): void {
    for (const set of this.#holds.values()) set.clear();
    this.#locations.clear();
  }

  location(v: Variable): Location {
    const key = keyOf(v);
    let loc = this.#locations.get(key);
    if (!loc) this.#locations.set(key, (loc = { v, cls: this.classOf(v), inMemory: true, regs: new Set() }));
    return loc;
  }

  store(loc: Location): void {
    const r = [...loc.regs][0];
    if (!r) throw new Error(`${keyOf(loc.v)} no está ni en memoria ni en registros`);
    this.out.ins(loc.cls === "float" ? "swc1" : "sw", r, this.out.home(loc.v));
    loc.inMemory = true;
  }

  /** Un valor se puede soltar si está en memoria o en otro registro. */
  #safe(key: string): boolean {
    const loc = this.#locations.get(key)!;
    return loc.inMemory || loc.regs.size > 1;
  }

  /**
   * Elige un registro de la clase: uno libre, uno cuyos valores ya están a salvo
   * o, si no queda otro, uno cuyo contenido se guarda primero en memoria.
   * Al escribir se acepta, en último caso, un registro leído por la misma
   * instrucción: MIPS lee los operandos antes de escribir el resultado.
   */
  take(cls: ValueClass, mayReusePinned: boolean): string {
    const pool = POOLS[cls];
    const candidates = pool.filter((r) => !this.#pinned.has(r));
    const choice =
      candidates.find((r) => this.#holds.get(r)!.size === 0) ??
      candidates.find((r) => [...this.#holds.get(r)!].every((k) => this.#safe(k))) ??
      this.#roundRobin(cls, candidates.length ? candidates : mayReusePinned ? pool : []);
    for (const key of this.#holds.get(choice)!) {
      if (!this.#safe(key)) this.store(this.#locations.get(key)!);
      this.#locations.get(key)!.regs.delete(choice);
    }
    this.#holds.get(choice)!.clear();
    return choice;
  }

  #roundRobin(cls: ValueClass, options: readonly string[]): string {
    if (!options.length) throw new Error(`Sin registros ${cls} libres`);
    return options[this.#turn[cls]++ % options.length]!;
  }
}
