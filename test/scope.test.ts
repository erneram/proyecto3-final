import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crossesFunction, SymbolTable } from "../src/check/scope.js";
import { INT, STRING } from "../src/check/types.js";

const pos = { line: 1, column: 1 };

describe("ámbitos", () => {
  it("resuelve hacia afuera y permite sombrear en ámbitos hijos", () => {
    const t = new SymbolTable();
    const outer = t.define(t.root, { name: "x", kind: "variable", type: INT, pos }).sym;
    const block = t.open("block", "bloque", pos, t.root);
    assert.equal(block.lookup("x"), outer);
    const inner = t.define(block, { name: "x", kind: "constant", type: STRING, pos }).sym;
    assert.equal(block.lookup("x"), inner);
    assert.equal(t.root.lookup("x"), outer);
    assert.equal(inner.mutable, false);
    assert.deepEqual(t.root.children, [block]);
  });

  it("rechaza redeclarar en el mismo ámbito sin perder el original", () => {
    const t = new SymbolTable();
    const first = t.define(t.root, { name: "f", kind: "function", type: INT, pos }).sym;
    const again = t.define(t.root, { name: "f", kind: "variable", type: INT, pos });
    assert.equal(again.clash, first);
    assert.equal(t.root.lookup("f"), first);
    assert.equal(t.symbols.length, 1);
  });

  it("detecta capturas solo entre funciones, nunca de globales", () => {
    const t = new SymbolTable();
    const global = t.define(t.root, { name: "g", kind: "variable", type: INT, pos }).sym;
    const outerFn = t.open("function", "externa", pos, t.root);
    const local = t.define(outerFn, { name: "n", kind: "variable", type: INT, pos }).sym;
    const loop = t.open("loop", "while", pos, outerFn);
    const innerFn = t.open("function", "interna", pos, loop);
    assert.equal(innerFn.owner, innerFn);
    assert.equal(loop.owner, outerFn);
    assert.ok(crossesFunction(local, innerFn));
    assert.ok(!crossesFunction(local, loop));
    assert.ok(!crossesFunction(global, innerFn));
    assert.equal(innerFn.nearest("loop"), loop);
  });
});
