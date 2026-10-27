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

describe("ejemplos con errores semánticos", () => {
  for (const file of files("examples/errors")) {
    it(file, () => {
      // La primera línea declara los códigos que el ejemplo debe producir.
      const header = /^\/\/ esperado: (.+)$/m.exec(readFileSync(file, "utf8"));
      assert.ok(header, "falta la línea '// esperado: ...'");
      const expected = header[1].trim().split(/\s+/).sort();
      const found = [...new Set(analyze(file).map((d) => d.code!))].sort();
      assert.deepEqual(found, expected);
    });
  }
});

describe("ejemplos válidos", () => {
  for (const file of files("examples/lang")) {
    it(file, () => assert.deepEqual(analyze(file), []));
  }
});
