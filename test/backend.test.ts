import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marsAvailable, runMars } from "../scripts/mars.js";
import { generate } from "../src/backend/emit.js";
import { compile } from "../src/compile.js";
import { RUNTIME_ERRORS, runIr } from "./support/interp.js";

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

describe("MIPS: runtime en MARS", { skip: skipMars }, () => {
  it("concatena y compara cadenas", () => {
    assert.deepEqual(
      sameAsInterpreter('let a = "ho"; let b = a + "la"; print(b); print(b == "hola"); print(b != "hola"); print(a + a + "!"); let vacia = ""; print(vacia + b); print("" == ""); print("a" == "ab");'),
      ["hola", "true", "false", "hoho!", "hola", "true", "false"],
    );
  });

  it("catch recibe el error y ve los valores asignados antes de fallar", () => {
    assert.deepEqual(
      sameAsInterpreter('let x = 1; try { x = 2; print(10 / (x - 2)); print("no"); } catch (e) { print(e); print(x); } print("sigue");'),
      [RUNTIME_ERRORS.divByZero, "2", "sigue"],
    );
  });

  it("un error en una función llamada se atrapa más arriba y la pila queda bien", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        function dividir(a: integer, b: integer): integer { return a / b; }
        function medio(b: integer): integer { let local = 5; return dividir(local, b) + local; }
        function seguro(a: integer, b: integer): integer { try { return a / b; } catch (e) { print(e); } return -1; }
        try { print(medio(0)); } catch (e) { print("atrapado: " + e); }
        print(medio(1));
        print(seguro(7, 2));
        print(seguro(1, 0));
      `),
      ["atrapado: " + RUNTIME_ERRORS.divByZero, "10", "3", RUNTIME_ERRORS.divByZero, "-1"],
    );
  });

  it("try anidados y try repetido en un bucle", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        let z = 0;
        try { try { print(1 / z); } catch (e) { print("interior"); } print(2 % z); } catch (e) { print("exterior"); }
        let c = 0;
        for (let i = 0; i < 1000; i = i + 1) { try { c = c + 10 / (i % 2); } catch (e) { c = c + 1; } }
        print(c);
        while (true) { try { break; } catch (e) { print("mal"); } }
        print("fin");
      `),
      ["interior", "exterior", "5500", "fin"],
    );
  });

  it("un error sin capturar imprime el mensaje y termina con código 1", () => {
    const { ir } = compile("print(1); let z = 0; print(5 / z); print(2);");
    const r = runMars(generate(ir!));
    assert.deepEqual({ stdout: r.stdout, status: r.status }, { stdout: `1\n${RUNTIME_ERRORS.divByZero}\n`, status: 1 });
    assert.deepEqual(runIr(ir!).output, ["1", RUNTIME_ERRORS.divByZero]);
  });
});

describe("MIPS: arreglos en MARS", { skip: skipMars }, () => {
  it("literales, lectura y escritura por índice, matrices y foreach", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        let a = [10, 20, 30];
        let i = 2;
        a[i] = a[0] + a[1];
        print(a[2]);
        let m = [[1, 2], [3, 4]];
        m[1][0] = m[0][1] * 10;
        print(m[1][0] + m[1][1]);
        let f: float[] = [1, 2.5];
        f[0] = f[0] + f[1];
        print(f[0]);
        let suma = 0;
        foreach (x in a) { suma = suma + x; }
        print(suma);
        foreach (y in f) { print(y); }
        let palabras = ["uno", "dos"];
        foreach (p in palabras) { print(p + "!"); }
        let vacio: integer[] = [];
        foreach (z in vacio) { print("nunca"); }
      `),
      ["30", "24", "3.5", "60", "3.5", "2.5", "uno!", "dos!"],
    );
  });

  it("los arreglos se pasan por referencia", () => {
    assert.deepEqual(
      sameAsInterpreter("function llenar(xs: integer[], v: integer) { let i = 0; while (i < 3) { xs[i] = v + i; i = i + 1; } } let a = [0, 0, 0]; llenar(a, 7); print(a[0] + a[1] + a[2]);"),
      ["24"],
    );
  });

  it("índices fuera de rango, negativos y arreglos null se atrapan", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        let a = [1, 2];
        let k = -1;
        try { print(a[2]); } catch (e) { print(e); }
        try { print(a[k]); } catch (e) { print(e); }
        try { a[5] = 1; } catch (e) { print(e); }
        let n: integer[] = null;
        try { print(n[0]); } catch (e) { print(e); }
        try { foreach (x in n) { print(x); } } catch (e) { print(e); }
        print(a[1]);
      `),
      [RUNTIME_ERRORS.bounds, RUNTIME_ERRORS.bounds, RUNTIME_ERRORS.bounds, RUNTIME_ERRORS.nullArray, RUNTIME_ERRORS.nullArray, "2"],
    );
  });

  it("un error de arreglo sin capturar detiene el programa", () => {
    const { ir } = compile('let a = [1]; print(a[0]); print(a[1]); print("nunca");');
    const r = runMars(generate(ir!));
    assert.deepEqual({ stdout: r.stdout, status: r.status }, { stdout: `1\n${RUNTIME_ERRORS.bounds}\n`, status: 1 });
  });
});

describe("MIPS: objetos en MARS", { skip: skipMars }, () => {
  it("constructor heredado, campos boolean y flotantes, argumento promovido", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        class Base { let valor: float; let listo: boolean; function constructor(v: float) { this.valor = v; this.listo = true; } }
        class Hija : Base { let extra = 2; function mostrar() { print(this.valor); print(this.listo); print(this.extra); } }
        let h = new Hija(3);
        h.mostrar();
        class Caja { let v: float = 1; function poner(x: float) { this.v = this.v + x; } }
        let c = new Caja();
        c.poner(2);
        print(c.v);
      `),
      ["3.0", "true", "2", "3.0"],
    );
  });

  it("despacho dinámico: el método redefinido gana aunque la variable sea de la clase padre", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        class Animal { let nombre: string; function constructor(n: string) { this.nombre = n; } function sonido(): string { return "..."; } function hablar() { print(this.nombre + ": " + this.sonido()); } }
        class Perro : Animal { function sonido(): string { return "guau"; } }
        class Cachorro : Perro { function sonido(): string { return "guau" + "i"; } }
        let zoo: Animal[] = [new Animal("x"), new Perro("rex"), new Cachorro("bob")];
        foreach (a in zoo) { a.hablar(); }
      `),
      ["x: ...", "rex: guau", "bob: guaui"],
    );
  });

  it("métodos recursivos, muchos argumentos y clases homónimas en bloques hermanos", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        class Mate {
          function fact(n: integer): integer { if (n <= 1) { return 1; } return n * this.fact(n - 1); }
          function suma(a: integer, b: integer, c: integer, d: integer, e: float): float { return a + b + c + d + e; }
        }
        let m = new Mate();
        print(m.fact(6));
        print(m.suma(1, 2, 3, 4, 0.5));
        if (true) { class P { let x = 1; } let p = new P(); print(p.x); }
        if (true) { class P { let x = 2.5; } let p = new P(); print(p.x); }
      `),
      ["720", "10.5", "1", "2.5"],
    );
  });

  it("usar un objeto null se atrapa como error", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        class Nodo { let v = 1; function get(): integer { return this.v; } }
        let n: Nodo = null;
        try { print(n.v); } catch (e) { print(e); }
        try { n.v = 2; } catch (e) { print(e); }
        try { print(n.get()); } catch (e) { print(e); }
        n = new Nodo();
        print(n.get());
      `),
      [RUNTIME_ERRORS.nullObject, RUNTIME_ERRORS.nullObject, RUNTIME_ERRORS.nullObject, "1"],
    );
  });
});

describe("MIPS: clausuras en MARS", { skip: skipMars }, () => {
  it("la función dueña y su clausura comparten estado; cada llamada crea un entorno nuevo", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        function f() { let n = 5; function inc(): integer { n = n + 1; return n; } print(inc()); print(n); print(inc()); print(inc()); }
        f();
        function hacer(inicio: integer) { let c = inicio; function sig(): integer { c = c + 1; return c; } return sig; }
        let a = hacer(0); let b = hacer(10);
        print(a()); print(b()); print(a());
      `),
      ["6", "6", "7", "8", "1", "11", "2"],
    );
  });

  it("captura transitiva, captura de float y hermanas que comparten variable", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        function ext() { let x = 5; function medio() { function interior(): integer { return x; } print(interior()); x = x + 1; print(interior()); } medio(); }
        ext();
        function g() { let v = 2.5; function sube() { v = v + 1; } print(v); sube(); print(v); }
        g();
        function par() { let k = 1; function uno() { k = k + 1; } function dos(): integer { return k; } uno(); print(dos()); uno(); print(dos()); }
        par();
      `),
      ["5", "6", "2.5", "3.5", "2", "3"],
    );
  });

  it("clausura recursiva, función elevada, función devuelta y funciones como valores", () => {
    assert.deepEqual(
      sameAsInterpreter(`
        function h(): integer { function suma(n: integer): integer { if (n == 0) { return 0; } return n + suma(n - 1); } return suma(3) + 1; }
        print(h());
        function k(): integer { return despues(); function despues(): integer { return 5; } }
        print(k());
        function sumador(x: integer) { function por(y: integer): integer { return x + y; } return por; }
        print(sumador(4)(5));
        function doble(n: integer): integer { return n * 2; }
        function triple(n: integer): integer { return n * 3; }
        let fs = [doble, triple];
        print(fs[0](1) + fs[1](2));
        function base(): integer { return 2; }
        function hacer(n: integer) { function mas(): integer { return n + 3; } return mas; }
        let elegida = true ? hacer(2) : base;
        print(elegida());
      `),
      ["7", "5", "9", "8", "5"],
    );
  });

  it("los métodos de una clase local usan las variables de la función", () => {
    assert.deepEqual(
      sameAsInterpreter(
        "function f(): integer { let n = 1; class C { function inc(): integer { n = n + 1; return n; } } let c = new C(); c.inc(); return c.inc() + n; } print(f());",
      ),
      ["6"],
    );
  });
});
