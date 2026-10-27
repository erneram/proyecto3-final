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

/** Cuerpo de la función `name` (nombre legible, p. ej. `contador.sig`). */
function fnBody(src: string, name: string): string[] {
  const r = compile(src, "check");
  assert.ok(r.ok && r.program && r.checked, JSON.stringify(r.diagnostics));
  const m = lower(r.program, r.checked);
  const fn = m.functions.find((f) => f.name === name);
  assert.ok(fn, `sin función ${name}`);
  return printFunction(fn, m).split("\n").slice(1, -1).map((l) => l.trim());
}

describe("generación: funciones y clausuras", () => {
  it("las funciones globales se llaman por etiqueta y la recursión también", () => {
    const src = "function fact(n: integer): integer { if (n <= 1) { return 1; } return n * fact(n - 1); } print(fact(5));";
    assert.deepEqual(fnBody(src, "fact").slice(-5), ["t1 = n - 1", "param t1", "t2 = call f_fact, 1", "t3 = n * t2", "return t3"]);
    assert.deepEqual(mainBody(src), ["param 5", "t0 = call f_fact, 1", "print.int t0", "return"]);
  });

  it("una llamada anidada apila sus argumentos antes que la exterior y promueve a float", () => {
    const src = "function f(a: float, b: float): float { return a + b; } let n = 2; print(f(n, f(n, n)));";
    assert.deepEqual(mainBody(src).slice(1, 10), [
      "t0 = (float) @n",
      "t1 = (float) @n",
      "t2 = (float) @n",
      "param t1",
      "param t2",
      "t3 = call f_f, 2",
      "param t0",
      "param t3",
      "t4 = call f_f, 2",
    ]);
    assert.deepEqual(fnBody("function f(): float { return 3; } print(f());", "f"), ["return 3.0"]);
  });

  it("las variables capturadas viven en el entorno y la clausura se crea al inicio del bloque", () => {
    const src =
      "function contador(): integer { let c = 0; function sig(): integer { c = c + 1; return c; } sig(); return sig(); } print(contador());";
    assert.deepEqual(fnBody(src, "contador"), [
      "t0 = alloc 2",
      "t0[0] = 0",
      "$env = t0",
      "t1 = closure f_contador_sig, $env",
      "sig = t1",
      "$env[4] = 0",
      "t2 = callc sig, 0",
      "t3 = callc sig, 0",
      "return t3",
    ]);
    assert.deepEqual(fnBody(src, "contador.sig"), [
      "t0 = $env_in[4]",
      "t1 = t0 + 1",
      "$env_in[4] = t1",
      "t2 = $env_in[4]",
      "return t2",
    ]);
  });

  it("los parámetros capturados se copian al entorno y la función devuelta se llama como clausura", () => {
    const src = "function suma(x: integer) { function por(y: integer): integer { return x + y; } return por; } let g = suma(4); print(g(5));";
    assert.ok(fnBody(src, "suma").includes("t0[4] = x"));
    assert.deepEqual(mainBody(src).slice(3, 6), ["param 5", "t1 = callc @g, 1", "print.int t1"]);
  });

  it("una función anidada sin capturas propias reenvía el entorno recibido", () => {
    const src =
      "function afuera() { let n = 5; function a() { function b(): integer { return n; } return b(); } return a(); } print(afuera());";
    assert.deepEqual(fnBody(src, "afuera.a"), ["t0 = closure f_afuera_a_b, $env_in", "b = t0", "t1 = callc b, 0", "return t1"]);
  });
});

describe("generación: arreglos", () => {
  it("los literales y las asignaciones por índice convierten al tipo del elemento", () => {
    assert.deepEqual(mainBody("let a: float[] = [1, 2.5]; a[0] = 3; print(a[1]);"), [
      "t0 = newarray 2",
      "t0{0} = 1.0",
      "t0{1} = 2.5",
      "@a = t0",
      "@a{0} = 3.0",
      "t1 = @a{1}",
      "print.float t1",
      "return",
    ]);
  });

  it("en una asignación por índice se evalúa primero el destino y luego el valor", () => {
    assert.deepEqual(mainBody("let m = [[1, 2], [3]]; m[1][0] = m[0][1];").slice(9, 13), [
      "t3 = @m{1}",
      "t4 = @m{0}",
      "t5 = t4{1}",
      "t3{0} = t5",
    ]);
  });

  it("foreach recorre con un índice y continue salta al incremento", () => {
    assert.deepEqual(mainBody("let xs = [1.5, 2.5]; foreach (x in xs) { if (x > 2) { continue; } print(x); }").slice(4), [
      "t1 = @xs",
      "t2 = length t1",
      "t3 = 0",
      "L0:",
      "t4 = t3 < t2",
      "ifnot t4 goto L2",
      "t5 = t1{t3}",
      "@x = t5",
      "t6 = @x >. 2.0",
      "ifnot t6 goto L3",
      "goto L1",
      "L3:",
      "print.float @x",
      "L1:",
      "t3 = t3 + 1",
      "goto L0",
      "L2:",
      "return",
    ]);
  });
});
