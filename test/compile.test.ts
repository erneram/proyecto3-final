import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/compile.js";

describe("compile", () => {
  it("un programa válido atraviesa todas las etapas", () => {
    const r = compile("let x: integer = 2; print(x * 3);");
    assert.equal(r.ok, true);
    assert.ok(r.program && r.checked);
    assert.equal(r.stopped, undefined);
  });

  it("los errores sintácticos detienen la semántica y dicen por qué", () => {
    const r = compile("let x = ;");
    assert.equal(r.ok, false);
    assert.equal(r.program, undefined);
    assert.equal(r.checked, undefined);
    assert.equal(r.stopped?.stage, "check");
    assert.deepEqual(r.diagnostics.map((d) => d.phase), ["parser"]);
  });

  it("los errores semánticos marcan la compilación como fallida", () => {
    const r = compile("print(nada);");
    assert.equal(r.ok, false);
    assert.deepEqual(r.diagnostics.map((d) => d.code), ["E101"]);
  });

  it("las advertencias no impiden continuar", () => {
    const r = compile("let x: integer; print(x);");
    assert.equal(r.ok, true);
    assert.deepEqual(r.diagnostics.map((d) => d.severity), ["warning"]);
  });

  it("se puede pedir solo el análisis sintáctico", () => {
    const r = compile("print(nada);", "parse");
    assert.equal(r.ok, true);
    assert.equal(r.checked, undefined);
    assert.equal(r.stopped, undefined);
  });
});
