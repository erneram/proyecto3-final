import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marsAvailable, runMars } from "../scripts/mars.js";

// Sin MARS (jar o Java) estas pruebas se omiten, salvo que REQUIRE_MARS=1 las exija.
const skip = process.env.REQUIRE_MARS !== "1" && !marsAvailable() ? "MARS no disponible (npm run mars:setup)" : false;

describe("MARS", { skip }, () => {
  it("ejecuta un programa y devuelve su salida", () => {
    const r = runMars(`
      .data
saludo: .asciiz "hola\\n"
      .text
main: li $v0, 4
      la $a0, saludo
      syscall
      li $v0, 1
      li $a0, 42
      syscall
      li $v0, 10
      syscall
`);
    assert.deepEqual({ stdout: r.stdout, status: r.status, timedOut: r.timedOut }, { stdout: "hola\n42", status: 0, timedOut: false });
  });

  it("syscall 17 termina con el código pedido", () => {
    const r = runMars("main: li $v0, 1\n li $a0, 7\n syscall\n li $v0, 17\n li $a0, 1\n syscall\n");
    assert.deepEqual({ stdout: r.stdout, status: r.status }, { stdout: "7", status: 1 });
  });

  it("un error de ensamblado sale con código 1", () => {
    assert.equal(runMars("main: instruccion_inexistente $t0\n").status, 1);
  });

  it("un bucle infinito se corta en el límite de instrucciones", () => {
    const r = runMars("main: j main\n");
    assert.equal(r.timedOut, true);
    assert.equal(r.stdout, "");
  });
});
