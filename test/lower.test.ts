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

describe("generación: control de flujo", () => {
  it("las condiciones con && y || se traducen a saltos", () => {
    assert.deepEqual(mainBody("let a = 1; if (a > 0 && a < 5 || !(a == 3)) { print(1); } else { print(2); }"), [
      "@a = 1",
      "t0 = @a > 0",
      "ifnot t0 goto L3",
      "t1 = @a < 5",
      "if t1 goto L2",
      "L3:",
      "t2 = @a == 3",
      "if t2 goto L1",
      "L2:",
      "print.int 1",
      "goto L0",
      "L1:",
      "print.int 2",
      "L0:",
      "return",
    ]);
  });

  it("while (true) no evalúa la condición y break/continue saltan al lugar correcto", () => {
    assert.deepEqual(mainBody("let i = 0; while (true) { i = i + 1; if (i == 2) { continue; } if (i > 4) { break; } }"), [
      "@i = 0",
      "L0:",
      "t0 = @i + 1",
      "@i = t0",
      "t1 = @i == 2",
      "ifnot t1 goto L2",
      "goto L0",
      "L2:",
      "t2 = @i > 4",
      "ifnot t2 goto L3",
      "goto L1",
      "L3:",
      "goto L0",
      "L1:",
      "return",
    ]);
  });

  it("continue en for salta a la actualización y do-while prueba al final", () => {
    const forBody = mainBody("for (let i = 0; i < 2; i = i + 1) { if (i == 1) { continue; } }");
    assert.equal(forBody[forBody.indexOf("t1 = @i == 1") + 2], "goto L1");
    assert.deepEqual(forBody.slice(forBody.indexOf("L1:")), ["L1:", "t2 = @i + 1", "@i = t2", "goto L0", "L2:", "return"]);
    assert.deepEqual(mainBody("let i = 0; do { i = i + 1; } while (i < 3);").slice(-4), [
      "t1 = @i < 3",
      "if t1 goto L0",
      "L2:",
      "return",
    ]);
  });

  it("switch prueba los casos en orden y los cuerpos caen al siguiente sin break", () => {
    assert.deepEqual(
      mainBody('let s = "b"; switch (s) { case "a": print(1); case "b": print(2); break; default: print(3); }'),
      [
        '@s = "b"',
        "t0 = @s",
        't1 = t0 ==s "a"',
        "if t1 goto L1",
        't2 = t0 ==s "b"',
        "if t2 goto L2",
        "goto L3",
        "L1:",
        "print.int 1",
        "L2:",
        "print.int 2",
        "goto L0",
        "L3:",
        "print.int 3",
        "L0:",
        "return",
      ],
    );
  });

  it("switch sobre float promueve los casos enteros", () => {
    assert.ok(mainBody("let x = 2.5; switch (x) { case 1: print(1); }").includes("t1 = t0 ==. 1.0"));
  });
});
