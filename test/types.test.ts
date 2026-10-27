import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arrayOf, assignable, BOOL, commonType, comparable, ERROR, FLOAT, fnType, instanceOf, INT, NULL,
  STRING, typeName, UNKNOWN, VOID, type ClassInfo,
} from "../src/check/types.js";

const pos = { line: 1, column: 1 };
const cls = (id: number, name: string, parent?: ClassInfo): ClassInfo => ({ id, name, parent, members: new Map(), pos });
const animal = cls(0, "Animal");
const perro = cls(1, "Perro", animal);
const gato = cls(2, "Gato", animal);
const otroAnimal = cls(3, "Animal");

describe("tipos", () => {
  it("asignación: promoción numérica, null, herencia y covarianza de arreglos", () => {
    assert.ok(assignable(FLOAT, INT));
    assert.ok(!assignable(INT, FLOAT));
    assert.ok(assignable(instanceOf(animal), NULL));
    assert.ok(assignable(arrayOf(INT), NULL));
    assert.ok(!assignable(STRING, NULL));
    assert.ok(assignable(instanceOf(animal), instanceOf(perro)));
    assert.ok(!assignable(instanceOf(perro), instanceOf(animal)));
    assert.ok(assignable(arrayOf(FLOAT), arrayOf(INT)));
    assert.ok(!assignable(instanceOf(animal), instanceOf(otroAnimal)), "homónimas no son el mismo tipo");
  });

  it("los tipos absorbentes no producen errores en cascada", () => {
    for (const t of [UNKNOWN, ERROR]) {
      assert.ok(assignable(INT, t) && assignable(t, STRING) && comparable(t, BOOL));
      assert.deepEqual(commonType(t, FLOAT), FLOAT);
    }
  });

  it("comparación con == y !=", () => {
    assert.ok(comparable(INT, FLOAT));
    assert.ok(comparable(NULL, instanceOf(perro)));
    assert.ok(comparable(instanceOf(animal), instanceOf(gato)));
    assert.ok(!comparable(STRING, INT));
    assert.ok(!comparable(NULL, BOOL));
  });

  it("tipo común", () => {
    assert.deepEqual(commonType(INT, FLOAT), FLOAT);
    assert.deepEqual(commonType(instanceOf(perro), instanceOf(gato)), instanceOf(animal));
    assert.deepEqual(commonType(NULL, arrayOf(INT)), arrayOf(INT));
    assert.equal(commonType(STRING, INT), undefined);
  });

  it("nombres legibles", () => {
    assert.equal(typeName(arrayOf(arrayOf(INT))), "integer[][]");
    assert.equal(typeName(fnType([INT, BOOL], VOID)), "(integer, boolean) => void");
    assert.equal(typeName(arrayOf(fnType([], STRING))), "(() => string)[]");
    assert.equal(typeName(instanceOf(perro)), "Perro");
  });
});
