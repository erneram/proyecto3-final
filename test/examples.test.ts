import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { check } from "../src/check/checker.js";
import { buildProgram } from "../src/frontend/build.js";
import { parse } from "../src/frontend/parse.js";

const files = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".cps"))
    .map((f) => `${dir}/${f}`);

function analyze(file: string) {
  const { tree, diagnostics } = parse(readFileSync(file, "utf8"));
  assert.deepEqual(diagnostics, [], `${file} debe ser sintácticamente válido`);
  return check(buildProgram(tree)).diagnostics;
}

/** Lo que declara la primera línea: `// esperado: ...`. */
function expected(file: string): string[] {
  const header = /^\/\/ esperado: (.+)$/m.exec(readFileSync(file, "utf8"));
  assert.ok(header, "falta la línea '// esperado: ...'");
  return header[1].trim().split(/\s+/);
}

describe("ejemplos con errores léxicos y sintácticos", () => {
  // Declaran la posición (línea:columna) de cada error, en el orden en que se reportan.
  for (const [dir, phase] of [["examples/errors/lexico", "lexer"], ["examples/errors/sintaxis", "parser"]]) {
    for (const file of files(dir)) {
      it(file, () => {
        const { diagnostics } = parse(readFileSync(file, "utf8"));
        assert.deepEqual(new Set(diagnostics.map((d) => d.phase)), new Set([phase]));
        assert.deepEqual(diagnostics.map((d) => `${d.line}:${d.column}`), expected(file));
      });
    }
  }
});

describe("ejemplos con errores semánticos", () => {
  for (const file of files("examples/errors/semantica")) {
    it(file, () => {
      // Declaran los códigos que el ejemplo debe producir.
      const found = [...new Set(analyze(file).map((d) => d.code!))].sort();
      assert.deepEqual(found, expected(file).sort());
    });
  }
});

describe("ejemplos válidos", () => {
  for (const file of files("examples/lang")) {
    it(file, () => assert.deepEqual(analyze(file), []));
  }
});
