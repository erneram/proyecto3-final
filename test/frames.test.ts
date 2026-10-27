import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/compile.js";
import { envChain, hops, planStorage, type Frame } from "../src/ir/frames.js";

function plan(src: string) {
  const r = compile(src, "check");
  assert.ok(r.ok && r.checked, JSON.stringify(r.diagnostics));
  const p = planStorage(r.checked);
  const sym = (name: string) => r.checked!.table.symbols.find((s) => s.name === name)!;
  const frame = (name: string): Frame => [...p.frames.values()].find((f) => f.name === name)!;
  return { p, place: (name: string) => p.places.get(sym(name))!, frame };
}

describe("ubicación de símbolos", () => {
  it("lo global va al segmento de datos y las funciones globales se llaman por etiqueta", () => {
    const { place, p } = plan("let x = 1; { let y: float = 2.0; } function f() { }");
    assert.deepEqual(place("x"), { at: "global", index: 0 });
    assert.deepEqual(place("y"), { at: "global", index: 1 });
    assert.deepEqual(p.globals, [{ name: "x", cls: "word" }, { name: "y", cls: "float" }]);
    assert.deepEqual(place("f"), { at: "label", label: "f_f_2" });
  });

  it("locales en la pila después de los parámetros; capturadas en el entorno propio", () => {
    const { place, frame } = plan(
      "function contador(inicio: integer) { let paso = 1; let actual = inicio; function sig() { actual = actual + 1; return actual; } return sig; }",
    );
    const f = frame("contador");
    assert.deepEqual(place("inicio"), { at: "slot", index: 0 });
    // `sig` se iza antes que las variables del cuerpo, así que su slot va primero.
    assert.deepEqual(place("sig"), { at: "slot", index: 1 });
    assert.deepEqual(place("paso"), { at: "slot", index: 2 });
    const actual = place("actual");
    assert.ok(actual.at === "env" && actual.owner === f && actual.offset === 4);
    assert.equal(f.envWords, 2);
    assert.equal(f.envIn, undefined, "una función global no recibe entorno");
    assert.deepEqual(f.slots.map((s) => s.name), ["inicio", "sig", "paso", "$env"]);
    const sig = frame("contador.sig");
    assert.equal(sig.envIn, 0);
    assert.equal(hops(sig, f), 0);
  });

  it("los accesos atraviesan solo los marcos que tienen entorno propio", () => {
    const { frame } = plan(
      "function a() { let x = 1; function b() { let y = 2; function c() { return x + y; } return c; } return b; }",
    );
    const [fa, fb, fc] = [frame("a"), frame("a.b"), frame("a.b.c")];
    assert.deepEqual(envChain(fc), [fb, fa]);
    assert.equal(hops(fc, fb), 0);
    assert.equal(hops(fc, fa), 1);
    assert.equal(hops(fb, fa), 1);
  });

  it("los métodos reciben this como primer parámetro", () => {
    const { frame, place } = plan("class P { let v = 1; function get(n: integer) { return this.v + n; } }");
    const m = frame("P.get");
    assert.equal(m.label, "m_P_get");
    assert.equal(m.params, 2);
    assert.deepEqual(m.slots.map((s) => s.name), ["this", "n"]);
    assert.deepEqual(place("P"), { at: "none" });
  });
});
