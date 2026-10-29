import { buildCfg } from "./cfg.js";
import type { IrFunction, Operand, Quad, ValueClass } from "./ir.js";

interface TempRange {
  original: number;
  block: number;
  first: number;
  last: number;
  pinned: boolean;
}

const isTemp = (value: unknown): value is Extract<Operand, { k: "temp" }> =>
  typeof value === "object" && value !== null && "k" in value && value.k === "temp";

export function recycleTemps(fn: IrFunction): IrFunction {
  const ranges = new Map<number, TempRange>();
  let position = 0;
  for (const block of buildCfg(fn)) {
    for (const q of block.quads) {
      for (const [key, operand] of Object.entries(q)) {
        if (!isTemp(operand)) continue;
        let range = ranges.get(operand.id);
        if (!range) {
          range = {
            original: operand.id,
            block: block.id,
            first: position,
            last: position,
            pinned: key !== "dst",
          };
          ranges.set(operand.id, range);
        }
        range.last = position;
        if (range.block !== block.id || q.op === "param") range.pinned = true;
        if (range.first === position && key !== "dst") range.pinned = true;
      }
      position++;
    }
  }

  const temps: ValueClass[] = [];
  const remap = new Map<number, number>();
  const pools = new Map<number, { id: number; last: number }[]>();
  for (const range of [...ranges.values()].sort((a, b) => a.first - b.first)) {
    const cls = fn.temps[range.original]!;
    const pool = pools.get(range.block) ?? [];
    pools.set(range.block, pool);
    const reusable = !range.pinned && pool.find((slot) => slot.last < range.first && temps[slot.id] === cls);
    if (reusable) {
      remap.set(range.original, reusable.id);
      reusable.last = range.last;
    } else {
      const id = temps.push(cls) - 1;
      remap.set(range.original, id);
      if (!range.pinned) pool.push({ id, last: range.last });
    }
  }

  const body = fn.body.map((q) => Object.fromEntries(
    Object.entries(q).map(([key, operand]) => [
      key,
      isTemp(operand) ? { k: "temp", id: remap.get(operand.id)! } : operand,
    ]),
  ) as Quad);
  return { ...fn, temps, body };
}
