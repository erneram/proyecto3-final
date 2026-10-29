import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/compile.js";
import { RUNTIME_ERRORS, runIr, type IrRun } from "../src/ir/interp.js";

function run(src: string): IrRun {
  const r = compile(src);
  assert.ok(r.ir, JSON.stringify(r.diagnostics));
  return runIr(r.ir);
}

const prints = (src: string, ...expected: string[]): void => {
  const result = run(src);
  assert.equal(result.uncaught, undefined, result.uncaught);
  assert.deepEqual(result.output, expected);
};

describe("ejecución del código intermedio", () => {
  describe("expresiones y control de flujo", () => {
    it("aritmética entera, flotante y cadenas", () => {
      prints('let a = 7; print(a / 2); print(a % 3); print(a / 2.0); let s = "ho" + "la"; print(s); print(s == "hola");',
        "3", "1", "3.5", "hola", "true");
    });

    it("el ternario promueve y elige ramas", () => {
      prints('print(true ? 2 : 3.5); let s = 1 > 0 ? "yes" : "no"; print(s);', "2.0", "yes");
    });

    it("for con continue y break", () => {
      prints("let s = 0; for (let i = 0; i < 10; i = i + 1) { if (i % 2 == 0) { continue; } if (i > 7) { break; } s = s + i; } print(s);", "16");
    });

    it("if sin llaves y else if", () => {
      prints("function f(n: integer): integer { if (n <= 1) return 1; return n * f(n - 1); } print(f(5));", "120");
      prints('let n = 7; if (n < 5) print("chico"); else if (n < 10) print("medio"); else print("grande");', "medio");
      prints("foreach (n in [50, 70, 100, 80]) { if (n < 60) continue; if (n == 100) break; print(n); }", "70");
    });

    it("do-while corre al menos una vez", () => {
      prints("let i = 10; do { print(i); i = i + 1; } while (i < 3);", "10");
    });

    it("un ciclo infinito se detiene al pasar el límite de pasos y conserva lo impreso", () => {
      const r = compile("let i = 0; while (true) { print(i); i = i + 1; }");
      const result = runIr(r.ir!, 100);
      assert.equal(result.timedOut, true);
      assert.deepEqual(result.output.slice(0, 3), ["0", "1", "2"]);
    });

    it("switch cae al siguiente caso hasta un break", () => {
      prints('switch (2) { case 1: print("uno"); case 2: print("dos"); case 3: print("tres"); break; default: print("otro"); }', "dos", "tres");
      prints('switch ("z") { case "a": print(1); default: print("otro"); }', "otro");
    });
  });

  describe("funciones y clausuras", () => {
    it("recursión", () => {
      prints("function fact(n: integer): integer { if (n <= 1) { return 1; } return n * fact(n - 1); } print(fact(5));", "120");
    });

    it("argumentos anidados promovidos a float y retorno convertido", () => {
      prints("function f(a: float, b: float): float { return a + b; } let n = 2; print(f(n, f(n, n)));", "6.0");
      prints("function tres(): float { return 3; } print(tres());", "3.0");
    });

    it("funciones guardadas en un arreglo", () => {
      prints(
        "function doble(n: integer): integer { return n * 2; } function triple(n: integer): integer { return n * 3; } let fs = [doble, triple]; print(fs[0](1) + fs[1](2));",
        "8",
      );
    });

    it("la función dueña y su clausura comparten la variable", () => {
      prints(
        "function f() { let n = 5; function inc(): integer { n = n + 1; return n; } print(inc()); print(n); print(inc()); print(inc()); } f();",
        "6", "6", "7", "8",
      );
    });

    it("cada llamada crea un entorno independiente", () => {
      prints(
        "function hacer(inicio: integer) { let c = inicio; function sig(): integer { c = c + 1; return c; } return sig; } let a = hacer(0); let b = hacer(10); print(a()); print(b()); print(a());",
        "1", "11", "2",
      );
    });

    it("captura a través de una función intermedia y captura de float", () => {
      prints(
        "function ext() { let x = 5; function medio() { function interior(): integer { return x; } print(interior()); x = x + 1; print(interior()); } medio(); } ext();",
        "5", "6",
      );
      prints("function g() { let v = 2.5; function sube() { v = v + 1; } print(v); sube(); print(v); } g();", "2.5", "3.5");
    });

    it("clausura recursiva, función elevada y función devuelta", () => {
      prints(
        "function h(): integer { function suma(n: integer): integer { if (n == 0) { return 0; } return n + suma(n - 1); } return suma(3) + 1; } print(h());",
        "7",
      );
      prints("function k(): integer { return despues(); function despues(): integer { return 5; } } print(k());", "5");
      prints("function suma(x: integer) { function por(y: integer): integer { return x + y; } return por; } print(suma(4)(5));", "9");
    });
  });

  describe("arreglos", () => {
    it("literales con tipo y foreach sobre floats", () => {
      prints("let a: integer[] = [2]; let b: float[] = [1]; print(a[0]); print(b[0]); foreach (x in [1.5, 2.5]) { print(x); }", "2", "1.0", "1.5", "2.5");
    });

    it("matrices", () => {
      prints("let m = [[1, 2], [3, 4]]; m[1][0] = m[0][1] * 10; print(m[1][0] + m[1][1]);", "24");
    });

    it("un error de arreglo sin capturar detiene el programa", () => {
      assert.deepEqual(run('let a = [1]; print(a[1]); print("nunca");'), { output: [RUNTIME_ERRORS.bounds], uncaught: RUNTIME_ERRORS.bounds });
      assert.deepEqual(run("let a: integer[] = null; print(a[0]);").uncaught, RUNTIME_ERRORS.nullArray);
    });
  });

  describe("clases", () => {
    it("constructor heredado y campos boolean", () => {
      prints(
        "class Base { let valor: float; let listo: boolean; function constructor(v: float) { this.valor = v; this.listo = true; } } class Hija : Base { function mostrar() { print(this.valor); print(this.listo); } } let h = new Hija(3); h.mostrar();",
        "3.0", "true",
      );
    });

    it("despacho dinámico por la vtable", () => {
      prints(
        'class Animal { function sonido(): string { return "..."; } function hablar() { print(this.sonido()); } } class Perro : Animal { function sonido(): string { return "guau"; } } let a: Animal = new Perro(); a.hablar(); let b = new Animal(); b.hablar();',
        "guau", "...",
      );
    });

    it("argumento promovido en un método e inicializadores de campo", () => {
      prints("class Caja { let v: float = 1; function poner(x: float) { this.v = this.v + x; } } let c = new Caja(); c.poner(2); print(c.v);", "3.0");
    });

    it("clases homónimas en bloques hermanos son distintas", () => {
      prints("if (true) { class P { let x = 1; } let p = new P(); print(p.x); } if (true) { class P { let x = 2.5; } let p = new P(); print(p.x); }", "1", "2.5");
    });

    it("métodos de una clase local usan variables de la función", () => {
      prints(
        "function f(): integer { let n = 1; class C { function inc(): integer { n = n + 1; return n; } } let c = new C(); c.inc(); return c.inc() + n; } print(f());",
        "6",
      );
    });
  });

  describe("try/catch", () => {
    it("atrapa errores en tiempo de ejecución y sigue después", () => {
      prints('let a = [1, 2]; try { print(a[2]); print("no"); } catch (e) { print(e); } print("sigue");', RUNTIME_ERRORS.bounds, "sigue");
    });

    it("atrapa errores lanzados dentro de funciones llamadas", () => {
      prints(
        'function leer(xs: integer[], i: integer): integer { return xs[i]; } try { print(leer([1], 3)); } catch (e) { print("atrapado"); } print(leer([7], 0));',
        "atrapado", "7",
      );
    });

    it("salir del try con break no deja el manejador activo", () => {
      const result = run(
        'let a = [1]; while (true) { try { break; } catch (e) { print("mal"); } } print(a[3]);',
      );
      assert.deepEqual(result.output, [RUNTIME_ERRORS.bounds]);
      assert.equal(result.uncaught, RUNTIME_ERRORS.bounds);
    });

    it("un try anidado atrapa primero el interior", () => {
      prints(
        'let a = [0]; try { try { print(a[9]); } catch (e) { print("interior"); } print(a[9]); } catch (e) { print("exterior"); }',
        "interior", "exterior",
      );
    });
  });
});

describe("formato de flotantes como MARS", () => {
  it("usa los dígitos más cortos del float de 32 bits y notación científica fuera de rango", async () => {
    const { formatFloat } = await import("../src/ir/interp.js");
    const f = Math.fround;
    assert.deepEqual(
      [f(1 / 3), f(0.1) + f(0.2), 1e8, 0.001, 0.0001, 4, -0.5, 1234567, 12345678, 0].map((v) => formatFloat(f(v))),
      ["0.33333334", "0.3", "1.0E8", "0.001", "1.0E-4", "4.0", "-0.5", "1234567.0", "1.2345678E7", "0.0"],
    );
  });
});
