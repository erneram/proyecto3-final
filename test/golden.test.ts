import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { marsAvailable, runMars } from "../scripts/mars.js";
import { compile } from "../src/compile.js";
import { runIr } from "./support/interp.js";

/**
 * Cada `examples/run/X.cps` y `examples/errors/ejecucion/X.cps` trae al lado
 * `X.out` con la salida exacta esperada.
 * El intérprete del código intermedio la verifica siempre; MARS, cuando está
 * disponible (o siempre, con REQUIRE_MARS=1).
 */
const DIRS = ["run", "errors/ejecucion"].map((d) => new URL(`../examples/${d}/`, import.meta.url));
const programs = DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".cps"))
    .sort()
    .map((f) => new URL(f, dir)),
);
const skipMars = process.env.REQUIRE_MARS !== "1" && !marsAvailable() ? "MARS no disponible" : false;

const load = (file: URL) => {
  const result = compile(readFileSync(file, "utf8"));
  assert.ok(result.ir && result.asm, JSON.stringify(result.diagnostics));
  return { ...result, expected: readFileSync(new URL(file.href.replace(/\.cps$/, ".out")), "utf8") };
};

describe("programas de ejemplo", () => {
  it("hay ejemplos y cada uno tiene su salida esperada", () => {
    assert.ok(programs.length >= 10);
  });

  for (const file of programs) {
    describe(file.pathname.split("/examples/")[1], () => {
      it("el código intermedio produce la salida esperada", () => {
        const { ir, expected, diagnostics } = load(file);
        assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
        assert.equal(runIr(ir!).output.map((line) => `${line}\n`).join(""), expected);
      });

      it("MARS produce la salida esperada", { skip: skipMars }, () => {
        const { ir, asm, expected } = load(file);
        const r = runMars(asm!);
        assert.equal(r.timedOut, false);
        assert.equal(r.stdout, expected);
        // Solo un error sin capturar termina con código 1.
        assert.equal(r.status, runIr(ir!).uncaught ? 1 : 0, r.stderr);
      });
    });
  }
});
