import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marsAvailable, runMars } from "../scripts/mars.js";
import { generate } from "../src/backend/emit.js";
import { compile } from "../src/compile.js";
import type { IrModule, Operand, Quad, ValueClass } from "../src/ir/ir.js";
import { runIr } from "./support/interp.js";

const slot = (index: number): Operand => ({ k: "slot", index });
const temp = (id: number): Operand => ({ k: "temp", id });
const int = (value: number): Operand => ({ k: "int", value });

/** Módulo con un solo `main` hecho a mano. */
function moduleOf(body: Quad[], slots: ValueClass[] = [], temps: ValueClass[] = []): IrModule {
  return {
    globals: [],
    classes: [],
    functions: [{ label: "main", name: "main", params: 0, slots: slots.map((cls, i) => ({ name: `s${i}`, cls })), temps, body }],
  };
}

/** Instrucciones de `main` después del prólogo. */
const mainCode = (m: IrModule): string[] =>
  generate(m).split("\nmain:\n")[1]!.split("\n").map((l) => l.trim()).filter(Boolean).slice(4);

describe("asignación de registros", () => {
  it("un valor se carga una vez, las copias no cuestan instrucciones y se guarda al final", () => {
    const { ir } = compile("let x = 7; let z = x; print(x); print(z);");
    const code = mainCode(ir!);
    assert.equal(code.filter((l) => l.startsWith("li $t")).length, 1);
    assert.equal(code.filter((l) => l.startsWith("lw $t")).length, 0);
    assert.deepEqual(code.filter((l) => l.startsWith("sw $t0")), ["sw $t0, glb_0_x", "sw $t0, glb_1_z"]);
  });

  it("al cerrar un bloque se guarda lo modificado y el siguiente vuelve a cargar", () => {
    const code = mainCode(
      moduleOf([{ op: "mov", dst: slot(0), a: int(5) }, { op: "label", name: "L0" }, { op: "print", a: slot(0), format: "int" }, { op: "ret" }], ["word"]),
    );
    assert.deepEqual(code.slice(0, 4), ["li $t0, 5", "sw $t0, 0($fp)", "L0:", "lw $t0, 0($fp)"]);
  });

  it("un temporal de un solo bloque no se guarda; uno que cruza bloques sí", () => {
    const local = mainCode(moduleOf([{ op: "mov", dst: temp(0), a: int(3) }, { op: "print", a: temp(0), format: "int" }, { op: "label", name: "L0" }, { op: "ret" }], [], ["word"]));
    assert.ok(!local.some((l) => l.startsWith("sw $t")));
    const crossing = mainCode(moduleOf([{ op: "mov", dst: temp(0), a: int(3) }, { op: "label", name: "L0" }, { op: "print", a: temp(0), format: "int" }, { op: "ret" }], [], ["word"]));
    assert.ok(crossing.includes("sw $t0, 0($fp)"));
  });

  it("al retornar solo se guardan las globales", () => {
    const code = mainCode(moduleOf([{ op: "mov", dst: slot(0), a: int(1) }, { op: "ret" }], ["word"]));
    assert.ok(!code.some((l) => l.startsWith("sw $t")));
  });
});

describe("asignación de registros en MARS", { skip: process.env.REQUIRE_MARS !== "1" && !marsAvailable() ? "MARS no disponible" : false }, () => {
  it("con más valores vivos que registros, los que se desalojan se guardan y recargan bien", () => {
    const n = 12;
    const body: Quad[] = [];
    for (let i = 0; i < n; i++) body.push({ op: "mov", dst: slot(i), a: int(i * 10) });
    for (let i = 0; i < n; i++) body.push({ op: "mov", dst: slot(n + i), a: { k: "float", value: i + 0.5 } });
    for (let i = 0; i < n; i++) body.push({ op: "print", a: slot(i), format: "int" }, { op: "print", a: slot(n + i), format: "float" });
    body.push({ op: "ret" });
    const m = moduleOf(body, [...Array<ValueClass>(n).fill("word"), ...Array<ValueClass>(n).fill("float")]);
    const r = runMars(generate(m));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.split("\n").slice(0, -1), runIr(m).output);
  });
});
