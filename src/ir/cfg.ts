import type { IrFunction, IrModule, Quad } from "./ir.js";
import { printQuad } from "./print.js";

/** Secuencia de cuádruplos que se ejecuta entera: solo se entra por el primero y se sale por el último. */
export interface BasicBlock {
  id: number;
  /** Etiqueta con la que empieza, si tiene. */
  label?: string;
  quads: Quad[];
  succ: number[];
  pred: number[];
}

/** Cierran un bloque: después de ellos la ejecución puede no seguir con el cuádruplo siguiente. */
const ENDS_BLOCK = new Set<Quad["op"]>(["goto", "if", "ifnot", "ret", "try"]);

/**
 * Grafo de flujo de una función. Inicia un bloque cada etiqueta y cada cuádruplo
 * que sigue a un salto. `try` también cierra bloque, con una arista al manejador:
 * desde ahí cualquier error puede llegar al `catch`.
 */
export function buildCfg(fn: IrFunction): BasicBlock[] {
  const blocks: BasicBlock[] = [];
  let current: BasicBlock | undefined;
  for (const q of fn.body) {
    if (!current || q.op === "label") {
      current = { id: blocks.length, label: q.op === "label" ? q.name : undefined, quads: [], succ: [], pred: [] };
      blocks.push(current);
    }
    current.quads.push(q);
    if (ENDS_BLOCK.has(q.op)) current = undefined;
  }

  const byLabel = new Map(blocks.filter((b) => b.label).map((b) => [b.label!, b.id]));
  const edge = (from: BasicBlock, to: number | undefined): void => {
    if (to === undefined || to >= blocks.length || from.succ.includes(to)) return;
    from.succ.push(to);
    blocks[to]!.pred.push(from.id);
  };
  for (const b of blocks) {
    const last = b.quads.at(-1)!;
    const next = b.id + 1;
    switch (last.op) {
      case "goto":
        edge(b, byLabel.get(last.target));
        break;
      case "if":
      case "ifnot":
        edge(b, byLabel.get(last.target));
        edge(b, next);
        break;
      case "try":
        edge(b, next);
        edge(b, byLabel.get(last.handler));
        break;
      case "ret":
        break;
      default:
        edge(b, next);
    }
  }
  return blocks;
}

export function printCfg(fn: IrFunction, m: IrModule): string {
  const lines = [`func ${fn.name}  ; ${fn.label}`];
  for (const b of buildCfg(fn)) {
    const names = (ids: number[]): string => ids.map((id) => `B${id}`).join(", ") || "-";
    lines.push(`  B${b.id}${b.label ? ` (${b.label})` : ""}  entra: ${names(b.pred)}  sale: ${names(b.succ)}`);
    for (const q of b.quads) if (q.op !== "label") lines.push(`      ${printQuad(q, fn, m)}`);
  }
  return lines.join("\n");
}
