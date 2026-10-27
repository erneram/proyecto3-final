import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/compile.js";
import { buildCfg } from "../src/ir/cfg.js";

function cfgOf(src: string, name: string) {
  const { ir } = compile(src);
  assert.ok(ir);
  const fn = ir.functions.find((f) => f.name === name);
  assert.ok(fn);
  return buildCfg(fn).map((b) => ({ label: b.label, size: b.quads.length, succ: b.succ, pred: b.pred }));
}

describe("grafo de flujo", () => {
  it("un salto condicional abre dos caminos y cada return cierra el suyo", () => {
    assert.deepEqual(cfgOf("function f(n: integer): integer { if (n > 0) { return n; } return 0; }", "f"), [
      { label: undefined, size: 2, succ: [2, 1], pred: [] },
      { label: undefined, size: 1, succ: [], pred: [0] },
      { label: "L0", size: 2, succ: [], pred: [0] },
    ]);
  });

  it("try tiene arista al manejador y ambos caminos se juntan al final", () => {
    assert.deepEqual(cfgOf("try { print(1); } catch (e) { print(e); }", "main"), [
      { label: undefined, size: 1, succ: [1, 2], pred: [] },
      { label: undefined, size: 3, succ: [3], pred: [0] },
      { label: "L0", size: 4, succ: [3], pred: [0] },
      { label: "L1", size: 2, succ: [], pred: [1, 2] },
    ]);
  });

  it("un bucle tiene una arista de regreso a su cabecera", () => {
    const blocks = cfgOf("let i = 0; while (i < 3) { i = i + 1; }", "main");
    const header = blocks.findIndex((b) => b.label === "L0");
    assert.ok(blocks[header]!.pred.some((p) => p > header));
  });
});
