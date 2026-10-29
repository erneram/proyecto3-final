import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCfg } from "../src/ir/cfg.js";
import { runIr } from "../src/ir/interp.js";
import type { IrFunction, IrModule, Operand, Quad, ValueClass } from "../src/ir/ir.js";
import { recycleTemps } from "../src/ir/recycle.js";

const temp = (id: number): Operand => ({ k: "temp", id });
const int = (value: number): Operand => ({ k: "int", value });
const makeFunction = (temps: ValueClass[], body: Quad[]): IrFunction => ({
  label: "main", name: "main", params: 0, slots: [], temps, body,
});
const moduleOf = (fn: IrFunction, others: IrFunction[] = []): IrModule => ({
  functions: [fn, ...others], globals: [], classes: [],
});
const destination = (fn: IrFunction, index: number): Operand => {
  const q = fn.body[index]!;
  assert.ok("dst" in q && q.dst);
  return q.dst;
};
const assertEquivalent = (fn: IrFunction, expected: string[], others: IrFunction[] = []): IrFunction => {
  const optimized = recycleTemps(fn);
  const originalRun = runIr(moduleOf(fn, others));
  assert.deepEqual(originalRun, { output: expected });
  assert.deepEqual(runIr(moduleOf(optimized, others.map(recycleTemps))), originalRun);
  return optimized;
};

describe("IR: reciclaje de temporales", () => {
  it("reutiliza valores del mismo tipo con vidas separadas sin modificar la entrada", () => {
    const fn = makeFunction(["word", "word", "word"], [
      { op: "add", dst: temp(0), a: int(2), b: int(3) },
      { op: "print", a: temp(0), format: "int" },
      { op: "mul", dst: temp(1), a: int(4), b: int(5) },
      { op: "print", a: temp(1), format: "int" },
      { op: "ret" },
    ]);
    const before = structuredClone(fn);
    const optimized = assertEquivalent(fn, ["5", "20"]);
    assert.deepEqual(fn, before);
    assert.notEqual(optimized, fn);
    assert.equal(optimized.temps.length, 1);
    assert.deepEqual(destination(optimized, 0), destination(optimized, 2));
  });

  it("no solapa valores vivos ni destino y fuentes de la misma instrucción", () => {
    const fn = makeFunction(["word", "word", "word", "word"], [
      { op: "mov", dst: temp(0), a: int(7) },
      { op: "mov", dst: temp(1), a: int(8) },
      { op: "add", dst: temp(2), a: temp(0), b: temp(1) },
      { op: "print", a: temp(2), format: "int" },
      { op: "mov", dst: temp(3), a: int(9) },
      { op: "print", a: temp(3), format: "int" },
      { op: "ret" },
    ]);
    const optimized = assertEquivalent(fn, ["15", "9"]);
    assert.equal(optimized.temps.length, 3);
    assert.notDeepEqual(destination(optimized, 0), destination(optimized, 1));
    assert.notDeepEqual(destination(optimized, 0), destination(optimized, 2));
    assert.notDeepEqual(destination(optimized, 1), destination(optimized, 2));
  });

  it("mantiene separados word y float", () => {
    const fn = makeFunction(["word", "float", "word", "float"], [
      { op: "mov", dst: temp(0), a: int(4) },
      { op: "print", a: temp(0), format: "int" },
      { op: "mov", dst: temp(1), a: { k: "float", value: 1.5 } },
      { op: "print", a: temp(1), format: "float" },
      { op: "mov", dst: temp(2), a: int(6) },
      { op: "print", a: temp(2), format: "int" },
      { op: "mov", dst: temp(3), a: { k: "float", value: 2.5 } },
      { op: "print", a: temp(3), format: "float" },
      { op: "ret" },
    ]);
    const optimized = assertEquivalent(fn, ["4", "1.5", "6", "2.5"]);
    assert.deepEqual(optimized.temps, ["word", "float"]);
    assert.notDeepEqual(destination(optimized, 0), destination(optimized, 2));
    assert.deepEqual(destination(optimized, 0), destination(optimized, 4));
    assert.deepEqual(destination(optimized, 2), destination(optimized, 6));
  });

  it("preserva temporales mutables a través de bucles y bifurcaciones", () => {
    const fn = makeFunction(["word", "word", "word", "word"], [
      { op: "mov", dst: temp(0), a: int(0) },
      { op: "label", name: "loop" },
      { op: "add", dst: temp(0), a: temp(0), b: int(1) },
      { op: "lt", dst: temp(1), a: temp(0), b: int(3) },
      { op: "if", a: temp(1), target: "loop" },
      { op: "eq", dst: temp(2), a: temp(0), b: int(3) },
      { op: "ifnot", a: temp(2), target: "wrong" },
      { op: "print", a: temp(0), format: "int" },
      { op: "goto", target: "done" },
      { op: "label", name: "wrong" },
      { op: "mov", dst: temp(3), a: int(99) },
      { op: "print", a: temp(3), format: "int" },
      { op: "label", name: "done" },
      { op: "ret" },
    ]);
    const optimized = assertEquivalent(fn, ["3"]);
    const blocksByTemp = new Map<number, Set<number>>();
    for (const block of buildCfg(optimized)) {
      for (const q of block.quads) {
        for (const operand of Object.values(q)) {
          if (operand && typeof operand === "object" && operand.k === "temp") {
            const seen = blocksByTemp.get(operand.id) ?? new Set<number>();
            blocksByTemp.set(operand.id, seen.add(block.id));
          }
        }
      }
    }
    const counter = destination(optimized, 0);
    assert.equal(counter.k, "temp");
    if (counter.k === "temp") assert.ok(blocksByTemp.get(counter.id)!.size > 1);
    assert.notDeepEqual(counter, destination(optimized, 3));
    assert.notDeepEqual(destination(optimized, 3), destination(optimized, 5));
  });

  it("conserva valores visibles en el manejador de una excepción", () => {
    const fn = makeFunction(["word", "word", "word", "word", "word"], [
      { op: "try", handler: "catch" },
      { op: "mov", dst: temp(0), a: int(42) },
      { op: "mov", dst: temp(1), a: int(8) },
      { op: "print", a: temp(1), format: "int" },
      { op: "div", dst: temp(2), a: int(1), b: int(0) },
      { op: "endtry" },
      { op: "goto", target: "done" },
      { op: "label", name: "catch" },
      { op: "caught", dst: temp(3) },
      { op: "print", a: temp(0), format: "int" },
      { op: "mov", dst: temp(4), a: int(9) },
      { op: "print", a: temp(4), format: "int" },
      { op: "label", name: "done" },
      { op: "ret" },
    ]);
    const optimized = assertEquivalent(fn, ["8", "42", "9"]);
    assert.notDeepEqual(destination(optimized, 1), destination(optimized, 2));
    assert.notDeepEqual(destination(optimized, 1), destination(optimized, 4));
  });

  it("preserva valores vivos durante llamadas y argumentos diferidos del backend", () => {
    const helper: IrFunction = {
      label: "identity", name: "identity", params: 1,
      slots: [{ name: "a", cls: "word" }], temps: [],
      body: [{ op: "ret", a: { k: "slot", index: 0 } }],
    };
    const fn = makeFunction(["word", "word", "word", "word"], [
      { op: "mov", dst: temp(0), a: int(40) },
      { op: "mov", dst: temp(1), a: int(12) },
      { op: "param", a: temp(1) },
      { op: "mov", dst: temp(2), a: int(99) },
      { op: "print", a: temp(2), format: "int" },
      { op: "call", dst: temp(3), fn: "identity", argc: 1 },
      { op: "print", a: temp(3), format: "int" },
      { op: "print", a: temp(0), format: "int" },
      { op: "ret" },
    ]);
    const optimized = assertEquivalent(fn, ["99", "12", "40"], [helper]);
    assert.notDeepEqual(destination(optimized, 0), destination(optimized, 3));
    assert.notDeepEqual(destination(optimized, 1), destination(optimized, 3));
    assert.notDeepEqual(destination(optimized, 1), destination(optimized, 5));
  });

  it("remapea todos los operandos de memoria, arreglos y clausuras", () => {
    const helper: IrFunction = {
      label: "answer", name: "answer", params: 0, slots: [], temps: [],
      body: [{ op: "ret", a: int(17) }],
    };
    const fn = makeFunction(Array<ValueClass>(10).fill("word"), [
      { op: "mov", dst: temp(0), a: int(1) },
      { op: "print", a: temp(0), format: "int" },
      { op: "alloc", dst: temp(1), words: 1 },
      { op: "store", base: temp(1), offset: 0, a: int(6) },
      { op: "load", dst: temp(2), base: temp(1), offset: 0 },
      { op: "print", a: temp(2), format: "int" },
      { op: "newarr", dst: temp(3), length: int(2) },
      { op: "mov", dst: temp(4), a: int(1) },
      { op: "aset", array: temp(3), index: temp(4), a: int(8) },
      { op: "aget", dst: temp(5), array: temp(3), index: temp(4) },
      { op: "print", a: temp(5), format: "int" },
      { op: "alen", dst: temp(6), array: temp(3) },
      { op: "print", a: temp(6), format: "int" },
      { op: "alloc", dst: temp(7), words: 1 },
      { op: "closure", dst: temp(8), fn: "answer", env: temp(7) },
      { op: "callc", dst: temp(9), closure: temp(8), argc: 0 },
      { op: "print", a: temp(9), format: "int" },
      { op: "ret" },
    ]);
    const optimized = assertEquivalent(fn, ["1", "6", "8", "2", "17"], [helper]);
    assert.ok(optimized.temps.length < fn.temps.length);
    for (const q of optimized.body) {
      for (const operand of Object.values(q)) {
        if (operand && typeof operand === "object" && operand.k === "temp") {
          assert.ok(operand.id < optimized.temps.length);
        }
      }
    }
  });

  it("conserva lecturas anteriores a la primera escritura y elimina temporales sin uso", () => {
    const fn = makeFunction(["word", "word", "word"], [
      { op: "label", name: "loop" },
      { op: "print", a: temp(0), format: "int" },
      { op: "mov", dst: temp(1), a: int(2) },
      { op: "print", a: temp(1), format: "int" },
      { op: "mov", dst: temp(0), a: int(1) },
      { op: "goto", target: "loop" },
    ]);
    const optimized = recycleTemps(fn);
    assert.equal(optimized.temps.length, 2);
    assert.notDeepEqual(destination(optimized, 2), destination(optimized, 4));
    assert.deepEqual(recycleTemps(makeFunction(["word"], [{ op: "ret" }])).temps, []);
  });
});
