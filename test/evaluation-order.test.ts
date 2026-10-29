import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/compile.js";
import { runIr } from "../src/ir/interp.js";

function prints(source: string, ...expected: string[]): void {
  const result = compile(source, "ir");
  assert.ok(result.ok && result.ir, JSON.stringify(result.diagnostics));
  assert.deepEqual(runIr(result.ir), { output: expected });
}

describe("orden de evaluación", () => {
  it("conserva el operando izquierdo antes de una llamada que cambia una global", () => {
    prints(`
      let x = 1;
      function bump(): integer { x = x + 1; return x; }
      print(x + bump());
      print(x);
    `, "3", "2");
  });

  it("conserva operandos locales y valores float y string", () => {
    prints(`
      function local(): integer { let x = 1; return x + (x = 2); }
      let f = 1.5;
      let s = "a";
      print(local());
      print(f + (f = 2.5));
      print(s + (s = "b"));
      print(s == (s = "c"));
    `, "3", "4.0", "ab", "false");
  });

  it("conserva cada argumento antes de evaluar los siguientes", () => {
    prints(`
      function show(a: integer, b: integer, c: integer) { print(a); print(b); print(c); }
      let x = 1;
      show(x, x = 2, x = 3);
      function local() { let y = 4; show(y, y = 5, y = 6); }
      local();
    `, "1", "2", "3", "4", "5", "6");
  });

  it("conserva argumentos a través de llamadas anidadas", () => {
    prints(`
      let x = 1;
      function bump(): integer { x = x + 1; return x; }
      function show(a: integer, b: integer) { print(a); print(b); }
      show(x, bump());
    `, "1", "2");
  });

  it("conserva la clausura elegida antes de cambiarla en un argumento", () => {
    prints(`
      function first(a: integer): integer { return 10 + a; }
      function second(a: integer): integer { return 20 + a; }
      let f = first;
      function replace(): integer { f = second; return 1; }
      print(f(replace()));
      print(f(1));
    `, "11", "21");
  });

  it("conserva argumentos de clausuras y variables capturadas", () => {
    prints(`
      function outer() {
        let x = 1;
        function show(a: integer, b: integer) { print(a); print(b); }
        function bump(): integer { x = x + 1; return x; }
        let f = show;
        f(x, bump());
        f(x, x = 3);
        let y = 4;
        f(y, y = 5);
      }
      outer();
    `, "1", "2", "2", "3", "4", "5");
  });

  it("conserva el receptor y el despacho antes de evaluar argumentos", () => {
    prints(`
      class A {
        let value = 10;
        function show(a: integer, b: integer): integer { return this.value + a + b; }
      }
      class B : A {
        function show(a: integer, b: integer): integer { return 100 + a + b; }
      }
      let receiver: A = new A();
      function replace(): integer { receiver = new B(); return 2; }
      let x = 1;
      print(receiver.show(x, x = replace()));
      print(receiver.show(0, 0));
    `, "13", "100");
  });

  it("conserva los argumentos del constructor", () => {
    prints(`
      class Pair {
        let a: integer;
        let b: integer;
        function constructor(a: integer, b: integer) { this.a = a; this.b = b; }
      }
      let x = 1;
      let p = new Pair(x, x = 2);
      print(p.a);
      print(p.b);
    `, "1", "2");
  });

  it("conserva el arreglo antes de un índice que lo reemplaza", () => {
    prints(`
      let a = [10];
      function replace(): integer { a = [20]; return 0; }
      print(a[replace()]);
      print(a[0]);
    `, "10", "20");
  });

  it("conserva el arreglo destino antes del índice y del valor", () => {
    prints(`
      let a = [1];
      let original = a;
      function index(): integer { a = [2]; return 0; }
      function value(): integer { a = [3]; return 9; }
      a[index()] = value();
      print(original[0]);
      print(a[0]);
    `, "9", "3");
  });

  it("conserva el índice destino antes de evaluar el valor", () => {
    prints(`
      let a = [0, 0];
      let i = 0;
      a[i] = i = 1;
      print(a[0]);
      print(a[1]);
      print(i);
    `, "1", "0", "1");
  });

  it("conserva el receptor de un campo antes de evaluar el valor", () => {
    prints(`
      class Box { let value = 0; }
      let box = new Box();
      let original = box;
      function replace(): integer { box = new Box(); return 9; }
      box.value = replace();
      print(original.value);
      print(box.value);
    `, "9", "0");
  });

  it("conserva el resultado de asignaciones encadenadas", () => {
    prints(`
      let a = 0;
      let b = 0;
      let x = 1;
      print((a = b = x) + (x = 2));
      print(a);
      print(b);
      class Box { let value = 0; }
      let box = new Box();
      let items = [0];
      print((box.value = items[0] = x) + (x = 3));
      print(box.value);
      print(items[0]);
    `, "3", "1", "1", "5", "2", "2");
  });

  it("guarda cada inicializador antes de evaluar el siguiente", () => {
    prints(`
      let x = 1;
      let items = [x, x = 2, x + (x = 3)];
      class Values {
        let first = x;
        let second = x = 4;
        let third = x + (x = 5);
      }
      let values = new Values();
      print(items[0]);
      print(items[1]);
      print(items[2]);
      print(values.first);
      print(values.second);
      print(values.third);
    `, "1", "2", "5", "3", "4", "9");
  });

  it("no copia lecturas cuando las expresiones siguientes no pueden cambiar variables", () => {
    const result = compile(`
      function add(a: integer, b: integer): integer { return a + b; }
      let x = 1;
      let y = 2;
      let a = [0];
      class Box { let value = 0; }
      let box = new Box();
      print(x + y);
      print(add(x, y));
      print(a[x - 1]);
      a[0] = x;
      box.value = y;
    `, "ir");
    assert.ok(result.ok && result.ir, JSON.stringify(result.diagnostics));
    const copies = result.ir.functions.flatMap((fn) => fn.body)
      .filter((q) => q.op === "mov" && q.dst.k === "temp" && (q.a.k === "slot" || q.a.k === "global"));
    assert.deepEqual(copies, []);
    assert.deepEqual(runIr(result.ir), { output: ["3", "3", "0"] });
  });
});
