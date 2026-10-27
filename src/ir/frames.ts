import type { CheckResult } from "../check/checker.js";
import type { Scope, Sym } from "../check/scope.js";
import type { SlotInfo, ValueClass } from "./ir.js";

/**
 * Dónde vive cada símbolo en tiempo de ejecución.
 * Las variables capturadas por funciones anidadas no van en la pila: viven en un
 * registro de entorno en el heap, propio de la función que las declara. Cada
 * entorno guarda en su palabra 0 el entorno de la función que lo encierra.
 */
export type Place =
  | { at: "global"; index: number }
  | { at: "slot"; index: number }
  | { at: "env"; owner: Frame; offset: number }
  /** Función global: se llama por etiqueta, sin almacenamiento. */
  | { at: "label"; label: string }
  /** Clases: no tienen valor en tiempo de ejecución. */
  | { at: "none" };

export interface Frame {
  /** Ámbito de la función o método; para `main`, el ámbito global. */
  scope: Scope;
  label: string;
  name: string;
  /** Función que la encierra léxicamente. */
  parent?: Frame;
  slots: SlotInfo[];
  params: number;
  /** Slot donde se guarda el entorno recibido al entrar (solo funciones anidadas). */
  envIn?: number;
  /** Slot con el entorno propio (solo si declara variables capturadas). */
  envOwn?: number;
  /** Tamaño del entorno propio en palabras, contando el enlace al entorno padre. */
  envWords: number;
}

export interface StoragePlan {
  main: Frame;
  frames: Map<Scope, Frame>;
  globals: SlotInfo[];
  places: Map<Sym, Place>;
}

export const valueClass = (sym: Sym): ValueClass => (sym.type.tag === "float" ? "float" : "word");

/** Marcos con entorno propio, desde `frame` hacia afuera: la cadena que se recorre en tiempo de ejecución. */
export function envChain(frame: Frame | undefined): Frame[] {
  const chain: Frame[] = [];
  for (let f = frame; f; f = f.parent) if (f.envOwn !== undefined) chain.push(f);
  return chain;
}

/**
 * Saltos por la palabra 0 desde el entorno actual de `from` hasta el entorno
 * que `target` ve como actual; `undefined` si `target` no ve ningún entorno.
 */
export function hops(from: Frame, target: Frame): number | undefined {
  const wanted = envChain(target)[0];
  if (!wanted) return undefined;
  const index = envChain(from).indexOf(wanted);
  if (index < 0) throw new Error(`El entorno de ${target.name} no es visible desde ${from.name}`);
  return index;
}

export function planStorage(checked: CheckResult): StoragePlan {
  const { table } = checked;
  const usedLabels = new Set<string>();
  const unique = (base: string): string => {
    const clean = base.replace(/[^A-Za-z0-9_]/g, "_");
    let label = clean;
    for (let n = 2; usedLabels.has(label); n++) label = `${clean}_${n}`;
    usedLabels.add(label);
    return label;
  };

  const main: Frame = { scope: table.root, label: unique("main"), name: "main", slots: [], params: 0, envWords: 0 };
  const frames = new Map<Scope, Frame>([[table.root, main]]);
  const places = new Map<Sym, Place>();
  const globals: SlotInfo[] = [];
  // Etiqueta de cada función, por su símbolo (declarado en el ámbito que la contiene).
  const fnLabels = new Map<Sym, string>();

  // Marcos de funciones y métodos, en orden de aparición (los padres primero).
  for (const scope of table.scopes) {
    if (scope.kind !== "function" && scope.kind !== "method") continue;
    const parent = scope.parent?.owner ? frames.get(scope.parent.owner) : undefined;
    const cls = scope.kind === "method" ? scope.parent?.name : undefined;
    const name = [parent?.name, cls, scope.name].filter(Boolean).join(".");
    const label = unique(`${cls ? "m" : "f"}_${name}`);
    frames.set(scope, { scope, label, name, parent, slots: [], params: 0, envWords: 1 });
    const fnSym = scope.kind === "function" ? scope.parent?.symbols.get(scope.name) : undefined;
    if (fnSym?.kind === "function") fnLabels.set(fnSym, label);
  }

  // Parámetros (incluido `this`) primero, luego los enlaces de entorno.
  for (const frame of frames.values()) {
    if (frame === main) continue;
    for (const sym of frame.scope.symbols.values()) {
      if (sym.kind !== "parameter") continue;
      frame.slots.push({ name: sym.name, cls: valueClass(sym) });
      frame.params++;
    }
    if (frame.parent) frame.envIn = addSlot(frame, "$env_in");
  }

  for (const sym of table.symbols) {
    const owner = sym.scope.owner;
    if (sym.kind === "class") {
      places.set(sym, { at: "none" });
    } else if (!owner) {
      if (sym.kind === "function") places.set(sym, { at: "label", label: fnLabels.get(sym)! });
      else places.set(sym, { at: "global", index: globals.push({ name: sym.name, cls: valueClass(sym) }) - 1 });
    } else {
      const frame = frames.get(owner)!;
      if (sym.captured) {
        frame.envOwn ??= addSlot(frame, "$env");
        places.set(sym, { at: "env", owner: frame, offset: 4 * frame.envWords++ });
      } else if (sym.kind === "parameter" && sym.scope === owner) {
        const index = [...owner.symbols.values()].filter((s) => s.kind === "parameter").indexOf(sym);
        places.set(sym, { at: "slot", index });
      } else {
        places.set(sym, { at: "slot", index: addSlot(frame, sym.name, valueClass(sym)) });
      }
    }
  }
  for (const frame of frames.values()) if (frame.envOwn === undefined) frame.envWords = 0;
  return { main, frames, globals, places };
}

function addSlot(frame: Frame, name: string, cls: ValueClass = "word"): number {
  return frame.slots.push({ name, cls }) - 1;
}
