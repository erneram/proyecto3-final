import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { peephole } from "../src/backend/peephole.js";

const opt = (...lines: string[]): string[] => peephole(lines.map((l) => (l.endsWith(":") ? l : `    ${l}`))).map((l) => l.trim());

describe("mirilla", () => {
  it("quita copias de un registro a sí mismo", () => {
    assert.deepEqual(opt("move $t0, $t0", "mov.s $f2, $f2", "move $t1, $t0"), ["move $t1, $t0"]);
  });

  it("quita saltos a la línea siguiente, incluso con varias etiquetas en medio", () => {
    assert.deepEqual(opt("beqz $t0, L1", "L0:", "L1:", "j L2", "L2:", "jr $ra"), ["L0:", "L1:", "L2:", "jr $ra"]);
  });

  it("encadena saltos hacia el destino final", () => {
    assert.deepEqual(opt("bnez $t0, A", "jr $ra", "A:", "j B", "C:", "j A", "D:", "jr $ra", "B:", "jr $ra"), [
      "bnez $t0, B",
      "jr $ra",
      "A:",
      "j B",
      "C:",
      "j B",
      "D:",
      "jr $ra",
      "B:",
      "jr $ra",
    ]);
    // Un ciclo de saltos no cuelga la optimización y sigue siendo un ciclo.
    assert.deepEqual(opt("X:", "j Y", "Y:", "j X"), ["X:", "Y:", "j X"]);
  });

  it("reenvía un valor recién guardado en vez de volver a cargarlo", () => {
    assert.deepEqual(opt("sw $t0, 4($fp)", "lw $t1, 4($fp)", "swc1 $f2, x", "lwc1 $f2, x"), ["sw $t0, 4($fp)", "move $t1, $t0", "swc1 $f2, x"]);
  });

  it("no reenvía a través de una etiqueta ni con otra dirección", () => {
    const code = ["sw $t0, 4($fp)", "L0:", "lw $t1, 4($fp)", "sw $t0, 8($fp)", "lw $t1, 4($fp)"];
    assert.deepEqual(opt(...code), code);
  });

  it("borra lo inalcanzable después de un salto incondicional", () => {
    assert.deepEqual(opt("j L0", "li $t0, 1", "addu $t0, $t0, $t0", "L1:", "jr $ra", "li $v0, 1", "L0:", "jr $ra"), ["j L0", "L1:", "jr $ra", "L0:", "jr $ra"]);
  });
});
