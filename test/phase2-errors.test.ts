import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/compile.js";

describe("fase 2: recuperación y bloqueo del código intermedio", () => {
  for (const [phase, source] of [
    ["lexer", "let a = @;\nlet b = #;"],
    ["parser", "let a = ;\nlet b = ;"],
    ["semantic", 'print(falta);\nprint(falta);\nprint(otra);\nlet n: integer = "texto";'],
  ] as const) {
    it(`recupera varios errores de ${phase} sin generar código`, () => {
      const result = compile(source);
      const errors = result.diagnostics.filter((d) => d.phase === phase && d.severity === "error");
      assert.equal(result.ok, false);
      assert.ok(errors.length >= 2, JSON.stringify(result.diagnostics));
      assert.equal(result.ir, undefined);
      assert.equal(result.asm, undefined);
      if (phase === "semantic") {
        assert.deepEqual(errors.map((d) => d.code), ["E101", "E101", "E201"]);
      } else {
        assert.equal(result.checked, undefined);
      }
    });
  }
});
