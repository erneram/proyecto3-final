import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { check } from "../src/check/checker.js";
import { buildProgram } from "../src/frontend/build.js";
import { parse } from "../src/frontend/parse.js";

function analyze(src: string) {
  const { tree, diagnostics } = parse(src);
  assert.deepEqual(diagnostics, [], "el programa de prueba debe ser sintácticamente válido");
  return check(buildProgram(tree));
}

const codes = (src: string): string[] => analyze(src).diagnostics.map((d) => d.code!);

describe("checker: declaraciones y nombres", () => {
  it("reporta nombres no declarados y respeta el alcance de bloque", () => {
    assert.deepEqual(codes("print(nada);"), ["E101"]);
    assert.deepEqual(codes("{ let y = 1; } print(y);"), ["E101"]);
    assert.deepEqual(codes("let x = x;"), ["E101"]);
  });

  it("rechaza redeclarar en el mismo ámbito pero permite sombrear", () => {
    assert.deepEqual(codes("let a = 1; let a = 2;"), ["E103"]);
    assert.deepEqual(codes("let a = 1; { let a = \"otra\"; print(a); }"), []);
    assert.deepEqual(codes("function f() { } let f = 1;"), ["E103"]);
  });

  it("iza funciones y clases dentro de su lista de sentencias", () => {
    assert.deepEqual(codes("print(doble(2)); function doble(n: integer): integer { return n + n; }"), []);
    assert.deepEqual(codes("let a: Animal; class Animal { }"), []);
    assert.deepEqual(codes("let a: Planta;"), ["E102"]);
  });

  it("verifica el tipo declarado contra el inicializador", () => {
    assert.deepEqual(codes('let x: integer = "a";'), ["E201"]);
    assert.deepEqual(codes("let x: float = 1;"), []);
    assert.deepEqual(codes("const c: boolean = 3;"), ["E201"]);
  });

  it("no permite modificar constantes, funciones ni el error de un catch", () => {
    assert.deepEqual(codes("const c = 1; c = 2;"), ["E203"]);
    assert.deepEqual(codes("function f() { } f = 3;"), ["E203"]);
    assert.deepEqual(codes('try { } catch (e) { e = "x"; }'), ["E203"]);
    assert.deepEqual(codes('let n: integer = 1; n = "uno";'), ["E202"]);
  });

  it("advierte usos antes de asignar, pero no la asignación misma", () => {
    assert.deepEqual(codes("let x: integer; print(x);"), ["W503"]);
    assert.deepEqual(codes("let x: integer; x = 1; print(x);"), []);
  });

  it("reporta parámetros repetidos", () => {
    assert.deepEqual(codes("function f(a, a) { }"), ["E104"]);
  });

  it("marca como capturadas las variables usadas desde funciones anidadas", () => {
    const { table } = analyze("let g = 0; function f() { let n = 1; function h() { return n + g; } }");
    const byName = new Map(table.symbols.map((s) => [s.name, s]));
    assert.equal(byName.get("n")!.captured, true);
    assert.equal(byName.get("g")!.captured, false);
  });
});
