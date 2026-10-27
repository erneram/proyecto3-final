import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marsAvailable, runMars } from "../scripts/mars.js";
import { generate } from "../src/backend/emit.js";
import { compile } from "../src/compile.js";
import { runIr } from "./support/interp.js";

function asm(src: string): string {
  const { ir, diagnostics } = compile(src);
  assert.ok(ir, JSON.stringify(diagnostics));
  return generate(ir);
}

/** Lo que MARS imprime debe coincidir con lo que imprime el intérprete del código intermedio. */
function sameAsInterpreter(src: string): string[] {
  const { ir } = compile(src);
  assert.ok(ir);
  const expected = runIr(ir).output;
  const r = runMars(generate(ir));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split("\n").slice(0, -1), expected);
  return expected;
}

const skipMars = process.env.REQUIRE_MARS !== "1" && !marsAvailable() ? "MARS no disponible" : false;

describe("MIPS: estructura", () => {
  it("datos primero, luego el arranque que llama a main y termina", () => {
    const text = asm('print("hola");');
    assert.match(text, /^\.data\nstr_0: \.asciiz "hola"\n\n\.text\n__inicio:\n {4}jal main\n {4}li \$v0, 10\n {4}syscall\n\nmain:/);
  });

  it("las cadenas repetidas se guardan una vez y se escapan", () => {
    const text = asm('print("a\\tb"); print("a\\tb"); print("di \\"hola\\"");');
    assert.deepEqual(text.match(/^str_\d+: .*$/gm), ['str_0: .asciiz "a\\tb"', 'str_1: .asciiz "di \\"hola\\""']);
  });

  it("globales y flotantes son palabras antes de las cadenas", () => {
    const data = asm('let x = 1.5; let s = "z"; print(x);').split("\n\n")[0]!.split("\n").slice(1);
    assert.deepEqual(data, ["glb_0_x: .word 0", "glb_1_s: .word 0", "flt_0: .float 1.5", 'str_0: .asciiz "z"']);
  });
});

describe("MIPS: ejecución en MARS", { skip: skipMars }, () => {
  it("imprime cada tipo con su syscall y un salto de línea", () => {
    assert.deepEqual(
      sameAsInterpreter('print(42); print(2.5); print(4.0); print("hola\\tmundo"); print(true); print(false); print(null);'),
      ["42", "2.5", "4.0", "hola\tmundo", "true", "false", "null"],
    );
  });

  it("guarda y lee variables globales de cada clase", () => {
    assert.deepEqual(
      sameAsInterpreter('let x = 7; let y = 1.5; let s = "z"; let b = true; print(x); print(y); print(s); print(b);'),
      ["7", "1.5", "z", "true"],
    );
  });
});
