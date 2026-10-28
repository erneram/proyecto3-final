import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { marsAvailable, runMars } from "../scripts/mars.js";
import { compile } from "../src/compile.js";
import { runIr } from "./support/interp.js";

/**
 * Cada `examples/run/X.cps` trae al lado `X.out` con la salida exacta esperada.
 * El intérprete del código intermedio la verifica siempre; MARS, cuando está
 * disponible (o siempre, con REQUIRE_MARS=1).
 */
const DIR = new URL("../examples/run/", import.meta.url);
const programs = readdirSync(DIR).filter((f) => f.endsWith(".cps")).sort();
const skipMars = process.env.REQUIRE_MARS !== "1" && !marsAvailable() ? "MARS no disponible" : false;

const load = (name: string) => {
  const result = compile(readFileSync(new URL(name, DIR), "utf8"));
  assert.ok(result.ir && result.asm, JSON.stringify(result.diagnostics));
  return { ...result, expected: readFileSync(new URL(name.replace(/\.cps$/, ".out"), DIR), "utf8") };
};

describe("programas de ejemplo", () => {
  it("hay ejemplos y cada uno tiene su salida esperada", () => {
    assert.ok(programs.length >= 10);
  });

  for (const name of programs) {
    describe(name, () => {
      it("el código intermedio produce la salida esperada", () => {
        const { ir, expected, diagnostics } = load(name);
        assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
        assert.equal(runIr(ir!).output.map((line) => `${line}\n`).join(""), expected);
      });

      it("MARS produce la salida esperada", { skip: skipMars }, () => {
        const { ir, asm, expected } = load(name);
        const r = runMars(asm!);
        assert.equal(r.timedOut, false);
        assert.equal(r.stdout, expected);
        // Solo un error sin capturar termina con código 1.
        assert.equal(r.status, runIr(ir!).uncaught ? 1 : 0, r.stderr);
      });
    });
  }
});
