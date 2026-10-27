import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MAX_DIAGNOSTICS } from "../src/diagnostic.js";
import { buildProgram } from "../src/frontend/build.js";
import { parse } from "../src/frontend/parse.js";

const where = (src: string): string[] => parse(src).diagnostics.map((d) => `${d.phase}@${d.line}:${d.column}`);
const kinds = (src: string): string[] => parse(src).tokens.map((t) => t.kind);

describe("lexer", () => {
  it("entrega tokens con línea y columna desde 1, sin espacios ni comentarios", () => {
    const { tokens, diagnostics } = parse("let x = 4.5; /* nada */\n// nota\nprint(x);");
    assert.equal(diagnostics.length, 0);
    assert.deepEqual(
      tokens.slice(0, 5).map((t) => [t.kind, t.text, t.line, t.column]),
      [["LET", "let", 1, 1], ["ID", "x", 1, 5], ["ASSIGN", "=", 1, 7], ["FLOAT_LIT", "4.5", 1, 9], ["SEMI", ";", 1, 12]],
    );
    assert.deepEqual(tokens.slice(5).map((t) => [t.text, t.line, t.column]).at(0), ["print", 3, 1]);
  });

  it("distingue palabras reservadas de identificadores", () => {
    assert.deepEqual(kinds("constructor clase class _x9"), ["ID", "ID", "CLASS", "ID"]);
  });

  it("un número con punto final no es float", () => {
    assert.deepEqual(kinds("1."), ["INT_LIT", "DOT"]);
  });

  it("agrupa caracteres desconocidos contiguos y evita errores sintácticos en cascada", () => {
    const { diagnostics } = parse("let a = 1 @@@ 2;");
    assert.deepEqual(diagnostics.map((d) => [d.phase, d.line, d.column, d.symbol]), [["lexer", 1, 11, "@@@"]]);
  });

  it("reporta cadenas sin cierre y escapes inválidos sin errores en cascada", () => {
    const { diagnostics } = parse('let a = "abierta;\nlet b = "mal\\q";\nprint(a);');
    assert.deepEqual(where('let a = "abierta;\nlet b = "mal\\q";\nprint(a);'), ["lexer@1:9", "lexer@2:9"]);
    assert.match(diagnostics[0].message, /no se cierra/);
    assert.match(diagnostics[1].message, /escape/);
  });

  it("limita la cantidad de errores reportados", () => {
    const { diagnostics } = parse("@ ".repeat(150));
    assert.equal(diagnostics.length, MAX_DIAGNOSTICS);
    assert.match(diagnostics.at(-1)!.message, /límite/);
  });
});

describe("parser", () => {
  it("acepta un programa que recorre toda la sintaxis", () => {
    const { tree, diagnostics } = parse(readFileSync("examples/lang/sintaxis.cps", "utf8"));
    assert.deepEqual(diagnostics, []);
    assert.equal(buildProgram(tree).body.length, 21);
  });

  it("ubica un ';' faltante justo después del token anterior", () => {
    assert.deepEqual(where("let a = 10\nlet b = 2;"), ["parser@1:11"]);
  });

  it("redacta los mensajes en español", () => {
    for (const src of ["let = 3;", "print(1", "x = ;", "class { }", "if (a) { } else if (b) { }"]) {
      const messages = parse(src).diagnostics.map((d) => d.message);
      assert.ok(messages.length > 0, src);
      for (const m of messages) assert.doesNotMatch(m, /missing|mismatched|extraneous|viable|expecting|recognition/, m);
    }
  });

  it("exige bloques en el cuerpo de las sentencias de control", () => {
    assert.ok(where("if (true) print(1);").length > 0);
    assert.ok(where("while (true) x = 1;").length > 0);
  });

  it("no permite sufijos sobre literales ni expresiones entre paréntesis", () => {
    for (const src of ["[1][0];", "(f)();", '"a".largo;']) assert.ok(where(src).length > 0, src);
  });

  it("respeta precedencia y asociatividad", () => {
    const [stmt] = buildProgram(parse("x = y = 1 - 2 - 3 * 4;").tree).body;
    assert.equal(stmt.kind, "expr");
    const outer = stmt.kind === "expr" ? stmt.expr : null;
    assert.ok(outer?.kind === "assign" && outer.value.kind === "assign");
    const sub = outer.value.value;
    assert.ok(sub.kind === "binary" && sub.op === "-");
    assert.ok(sub.left.kind === "binary" && sub.left.op === "-");
    assert.ok(sub.right.kind === "binary" && sub.right.op === "*");
  });
});
