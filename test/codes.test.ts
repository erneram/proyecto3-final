import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalog, CODES } from "../src/check/codes.js";

describe("catálogo de diagnósticos", () => {
  it("tiene códigos únicos con formato E/W y tres dígitos", () => {
    const codes = catalog().map((e) => e.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of codes) assert.match(c, /^[EW][1-5]\d\d$/);
  });

  it("deriva la severidad del prefijo", () => {
    for (const e of catalog()) assert.equal(e.severity, e.code[0] === "W" ? "warning" : "error");
  });

  it("redacta mensajes con los datos recibidos", () => {
    assert.equal(CODES.argCount.message("la función 'f'", 2, 3), "La función 'f' espera 2 argumento(s), pero se pasaron 3.");
    assert.match(CODES.redeclared.message("x", 4), /línea 4/);
  });

  it("contrae 'de el' y 'a el'", () => {
    assert.equal(CODES.invalidTarget.message("el resultado de una llamada"), "No se puede asignar al resultado de una llamada.");
    assert.match(CODES.notBoolean.message("el operador ternario", "integer"), /^La condición del operador ternario/);
  });
});
