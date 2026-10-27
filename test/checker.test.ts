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

describe("checker: expresiones", () => {
  const typeOf = (src: string): string => {
    const r = analyze(`let v = ${src};`);
    assert.deepEqual(r.diagnostics, [], src);
    const sym = r.table.symbols.find((s) => s.name === "v")!;
    return sym.type.tag === "array" ? `${sym.type.elem.tag}[]` : sym.type.tag;
  };

  it("infiere tipos aritméticos con promoción a float", () => {
    assert.equal(typeOf("1 + 2 * 3"), "int");
    assert.equal(typeOf("1 + 2.5"), "float");
    assert.equal(typeOf("-4.0"), "float");
    assert.equal(typeOf("7 % 2"), "int");
    assert.equal(typeOf('"a" + "b"'), "string");
  });

  it("rechaza operandos inválidos", () => {
    assert.deepEqual(codes("let x = 5.5 % 2;"), ["E205"]);
    assert.deepEqual(codes('let x = "a" + 1;'), ["E205"]);
    assert.deepEqual(codes('let x = "a" < "b";'), ["E205"]);
    assert.deepEqual(codes("let x = 1 && true;"), ["E205"]);
    assert.deepEqual(codes('let x = !"no";'), ["E206"]);
    assert.deepEqual(codes("let x = -true;"), ["E206"]);
  });

  it("comparaciones y lógica producen boolean", () => {
    assert.equal(typeOf("1 < 2.0 && !(3 == 4) || null == null"), "bool");
    assert.deepEqual(codes('let x = 1 == "1";'), ["E205"]);
  });

  it("arreglos: tipo común, índices enteros y valores indexables", () => {
    assert.equal(typeOf("[1, 2.5]"), "float[]");
    assert.deepEqual(codes("let m = [[1], [2]]; let fila: integer[] = m[0];"), []);
    assert.deepEqual(codes('let a = [1, "dos"];'), ["E212"]);
    assert.deepEqual(codes("let a = [1, 2]; print(a[1.5]);"), ["E209"]);
    assert.deepEqual(codes("let n = 3; print(n[0]);"), ["E210"]);
    assert.deepEqual(codes("let a: integer[] = [1]; a[0] = true;"), ["E202"]);
    assert.deepEqual(codes("let a: float[] = [1, 2];"), []);
  });

  it("ternario: condición booleana y ramas compatibles", () => {
    assert.equal(typeOf("true ? 2 : 3.5"), "float");
    assert.deepEqual(codes("let x = 1 ? 2 : 3;"), ["E207"]);
    assert.deepEqual(codes('let x = true ? 1 : "uno";'), ["E208"]);
  });

  it("foreach exige un arreglo y tipa la variable con su elemento", () => {
    assert.deepEqual(codes("foreach (n in [1, 2]) { let m: integer = n; }"), []);
    assert.deepEqual(codes("foreach (n in 5) { }"), ["E211"]);
  });

  it("no permite asignar a llamadas, objetos nuevos ni a this", () => {
    assert.deepEqual(codes("function f(): integer { return 1; } f() = 2;"), ["E204"]);
  });
});

describe("checker: funciones", () => {
  it("valida return contra el tipo declarado", () => {
    assert.deepEqual(codes("return 1;"), ["E304"]);
    assert.deepEqual(codes('function f(): integer { return "a"; }'), ["E306"]);
    assert.deepEqual(codes("function f(): integer { return; }"), ["E305"]);
    assert.deepEqual(codes("function f(): float { return 3; }"), []);
  });

  it("infiere el retorno sin anotación", () => {
    const r = analyze("function f() { if (true) { return 1; } return 2.5; } let v = f();");
    assert.equal(r.table.symbols.find((s) => s.name === "v")!.type.tag, "float");
    assert.deepEqual(codes("function g() { } let x = g();"), ["E215"]);
  });

  it("valida cantidad y tipo de argumentos", () => {
    const decl = "function suma(a: integer, b: integer): integer { return a + b; }";
    assert.deepEqual(codes(`${decl} suma(1);`), ["E301"]);
    assert.deepEqual(codes(`${decl} suma(1, true);`), ["E302"]);
    assert.deepEqual(codes(`${decl} let x: integer = suma(1, suma(2, 3));`), []);
    assert.deepEqual(codes("let n = 1; n();"), ["E303"]);
  });

  it("admite recursión y funciones como valores", () => {
    assert.deepEqual(
      codes("function fact(n: integer): integer { if (n <= 1) { return 1; } return n * fact(n - 1); } print(fact(5));"),
      [],
    );
    assert.deepEqual(
      codes(
        "function contador(inicio: integer) { let actual = inicio; function sig(): integer { actual = actual + 1; return actual; } return sig; }" +
          " let paso = contador(1); let v: integer = paso();",
      ),
      [],
    );
  });
});

describe("checker: clases", () => {
  const punto = `class Punto {
    let x: integer;
    const origen = 0;
    function constructor(x: integer) { this.x = x; }
    function get() { return this.x; }
  }`;

  it("acepta campos, métodos, constructor y retorno inferido", () => {
    assert.deepEqual(codes(`${punto} let p = new Punto(3); let v: integer = p.get(); print(p.x);`), []);
  });

  it("reporta miembros inexistentes y accesos sobre no-objetos", () => {
    assert.deepEqual(codes(`${punto} let p = new Punto(1); print(p.y);`), ["E402"]);
    assert.deepEqual(codes("let n = 1; print(n.x);"), ["E403"]);
    assert.deepEqual(codes("print(new Nada());"), ["E401"]);
  });

  it("this solo existe dentro de métodos, incluidas sus funciones anidadas", () => {
    assert.deepEqual(codes("print(this);"), ["E404"]);
    assert.deepEqual(codes("class A { let a = this; }"), ["E404"]);
    assert.deepEqual(codes("class A { let n = 1; function f() { function g() { return this.n; } return g(); } }"), []);
  });

  it("valida los argumentos del constructor, incluido el heredado", () => {
    assert.deepEqual(codes(`${punto} new Punto();`), ["E301"]);
    assert.deepEqual(codes(`${punto} new Punto("x");`), ["E302"]);
    assert.deepEqual(codes(`${punto} class Punto3D : Punto { } let q: Punto = new Punto3D(1);`), []);
    assert.deepEqual(codes("class Vacia { } new Vacia(1);"), ["E301"]);
  });

  it("no permite modificar constantes de clase ni métodos", () => {
    assert.deepEqual(codes(`${punto} let p = new Punto(1); p.origen = 2;`), ["E203"]);
    assert.deepEqual(codes(`${punto} let p = new Punto(1); p.get = 2;`), ["E203"]);
  });

  it("valida herencia: padre declarado, sin ciclos ni miembros repetidos", () => {
    assert.deepEqual(codes("class A : Fantasma { }"), ["E405"]);
    assert.deepEqual(codes("class A : B { } class B : A { }"), ["E406"]);
    assert.deepEqual(codes("class A { let x = 1; function x() { } }"), ["E105"]);
  });

  it("los métodos redefinidos conservan la firma", () => {
    const base = "class Animal { function sonido(veces: integer): string { return \"...\"; } }";
    assert.deepEqual(codes(`${base} class Perro : Animal { function sonido(veces: integer): string { return "guau"; } }`), []);
    assert.deepEqual(codes(`${base} class Gato : Animal { function sonido(): string { return "miau"; } }`), ["E407"]);
  });

  it("las clases homónimas en bloques distintos son tipos distintos", () => {
    assert.deepEqual(codes("{ class A { } let a: A = new A(); } { class A { let v = 1; } let b: A = new A(); print(b.v); }"), []);
  });
});
