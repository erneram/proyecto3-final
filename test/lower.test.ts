import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/compile.js";
import { lower } from "../src/ir/lower.js";
import { printFunction } from "../src/ir/print.js";

/** Cuerpo de `main` como lista de líneas, sin encabezado ni cierre. */
function mainBody(src: string): string[] {
  const r = compile(src, "check");
  assert.ok(r.ok && r.program && r.checked, JSON.stringify(r.diagnostics));
  const m = lower(r.program, r.checked);
  return printFunction(m.functions.at(-1)!, m).split("\n").slice(1, -1).map((l) => l.trim());
}

describe("generación: expresiones y asignaciones", () => {
  it("promueve enteros a float donde hace falta", () => {
    assert.deepEqual(mainBody("let x: integer = 2; let y: float = x * 3; print(y + 1);"), [
      "@x = 2",
      "t0 = @x * 3",
      "t1 = (float) t0",
      "@y = t1",
      "t2 = @y +. 1.0",
      "print.float t2",
      "return",
    ]);
  });

  it("concatena y compara cadenas con operaciones propias", () => {
    assert.deepEqual(mainBody('let s = "a" + "b"; print(s != "ab");'), [
      't0 = "a" ++ "b"',
      "@s = t0",
      't1 = @s ==s "ab"',
      "t2 = !t1",
      "print.bool t2",
      "return",
    ]);
  });

  it("evalúa && y || en cortocircuito", () => {
    assert.deepEqual(mainBody("let a = true; print(a && !a || false);"), [
      "@a = 1",
      "t1 = @a",
      "ifnot t1 goto L1",
      "t2 = !@a",
      "t1 = t2",
      "L1:",
      "t0 = t1",
      "if t0 goto L0",
      "t0 = 0",
      "L0:",
      "print.bool t0",
      "return",
    ]);
  });

  it("el ternario convierte ambas ramas al tipo común", () => {
    assert.deepEqual(mainBody("let v = true ? 2 : 3.5; print(v);"), [
      "ifnot 1 goto L0",
      "t0 = 2.0",
      "goto L1",
      "L0:",
      "t0 = 3.5",
      "L1:",
      "@v = t0",
      "print.float @v",
      "return",
    ]);
  });

  it("la asignación encadenada devuelve el valor asignado", () => {
    assert.deepEqual(mainBody("let a = 0; let b = 0; a = b = -5; print(null);"), [
      "@a = 0",
      "@b = 0",
      "t0 = -5",
      "@b = t0",
      "@a = t0",
      'print.string "null"',
      "return",
    ]);
  });
});
