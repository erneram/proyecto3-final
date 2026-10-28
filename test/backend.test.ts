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

describe("MIPS: aritmética, comparaciones y saltos en MARS", { skip: skipMars }, () => {
  it("operaciones enteras, incluida la división con signo", () => {
    sameAsInterpreter(
      "let a = 17; let b = 5; print(a + b); print(a - b); print(a * b); print(a / b); print(a % b); print(-a); print(-7 / 2); print(-7 % 2); print(a - 40000); print(a + 1);",
    );
  });

  it("comparaciones enteras y negación lógica", () => {
    sameAsInterpreter(
      "let a = 3; let b = 5; print(a < b); print(a <= 3); print(a > b); print(a >= 4); print(a == 3); print(a != 3); print(!(a < b)); print(0 == 0);",
    );
  });

  it("operaciones y comparaciones flotantes con promoción", () => {
    sameAsInterpreter(
      "let x = 7.5; let y = 2; print(x + y); print(x - y); print(x * y); print(x / y); print(-x); print(x < y); print(x <= 7.5); print(x > y); print(x >= 8); print(x == 7.5); print(x != 7.5); let z: float = y; print(z);",
    );
  });

  it("bucles, cortocircuito, ternario y switch", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        let s = 0;
        for (let i = 0; i < 10; i = i + 1) { if (i % 2 == 0) { continue; } if (i > 7) { break; } s = s + i; }
        print(s);
        let n = 0;
        while (true) { n = n + 1; if (n >= 3 && !(n == 4) || n > 10) { break; } }
        print(n);
        let k = 5;
        do { k = k - 2; } while (k > 0);
        print(k);
        let t = s > 10 ? 1.5 : 2;
        print(t);
        switch (n) { case 2: print("dos"); case 3: print("tres"); case 4: print("cuatro"); break; default: print("otro"); }
        switch (t) { case 1.5: print("uno y medio"); }
      `),
      ["16", "3", "-1", "1.5", "tres", "cuatro", "uno y medio"],
    );
  });
});

describe("MIPS: llamadas en MARS", { skip: skipMars }, () => {
  it("recursión y funciones mutuamente recursivas", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        function fact(n: integer): integer { if (n <= 1) { return 1; } return n * fact(n - 1); }
        function fib(n: integer): integer { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
        function par(n: integer): boolean { if (n == 0) { return true; } return impar(n - 1); }
        function impar(n: integer): boolean { if (n == 0) { return false; } return par(n - 1); }
        print(fact(5)); print(fib(10)); print(par(7));
      `),
      ["120", "55", "false"],
    );
  });

  it("argumentos flotantes, anidados y retorno convertido", () => {
    assert.deepEqual(
      sameAsInterpreter("function f(a: float, b: float): float { return a + b; } function tres(): float { return 3; } let n = 2; print(f(n, f(n, n))); print(tres());"),
      ["6.0", "3.0"],
    );
  });

  it("más de cuatro argumentos pasan por la pila", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        function mezcla(a: integer, b: float, c: integer, d: float, e: integer, f: float, g: integer): float {
          return a + b + c + d + e * 10 + f * 100 + g * 1000;
        }
        print(mezcla(1, 0.5, 2, 0.25, 3, 4.5, 5));
      `),
      ["5483.75"],
    );
  });

  it("los valores vivos sobreviven a la llamada y las globales que cambia se ven después", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        let total = 0;
        function suma(a: integer, b: integer): integer { total = total + a + b; return a + b; }
        function nada() { print("nada"); }
        let a = 2;
        print(a * 3 + suma(a, 1));
        nada();
        print(total);
        for (let i = 0; i < 3; i = i + 1) { suma(i, i); }
        print(total);
      `),
      ["9", "nada", "3", "9"],
    );
  });
});
