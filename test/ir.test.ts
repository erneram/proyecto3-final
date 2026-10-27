import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classOf, type IrModule } from "../src/ir/ir.js";
import { printModule } from "../src/ir/print.js";

describe("IR: impresión", () => {
  it("muestra clases, globales y funciones en texto de tres direcciones", () => {
    const m: IrModule = {
      globals: [{ name: "total", cls: "word" }],
      classes: [{ label: "C0_Punto", name: "Punto", words: 2, fields: [{ name: "x", offset: 4 }], vtable: [{ name: "get", fn: "Punto_get" }] }],
      functions: [
        {
          label: "suma",
          name: "suma",
          params: 2,
          slots: [{ name: "a", cls: "word" }, { name: "b", cls: "float" }],
          temps: ["float", "float"],
          body: [
            { op: "itof", dst: { k: "temp", id: 0 }, a: { k: "slot", index: 0 } },
            { op: "fadd", dst: { k: "temp", id: 1 }, a: { k: "temp", id: 0 }, b: { k: "slot", index: 1 } },
            { op: "label", name: "L0" },
            { op: "ifnot", a: { k: "int", value: 1 }, target: "L0" },
            { op: "ret", a: { k: "temp", id: 1 } },
          ],
        },
        {
          label: "main",
          name: "main",
          params: 0,
          slots: [],
          temps: ["word"],
          body: [
            { op: "param", a: { k: "int", value: 2 } },
            { op: "param", a: { k: "float", value: 3 } },
            { op: "call", dst: { k: "temp", id: 0 }, fn: "suma", argc: 2 },
            { op: "mov", dst: { k: "global", index: 0 }, a: { k: "temp", id: 0 } },
            { op: "print", a: { k: "str", value: "fin\n" }, format: "string" },
          ],
        },
      ],
    };
    assert.equal(
      printModule(m),
      [
        "class Punto  ; C0_Punto, 2 palabras",
        "    campos: x@4",
        "    vtable: get",
        "",
        "globales: total",
        "",
        "func suma(a, b)  ; suma",
        "    t0 = (float) a",
        "    t1 = t0 +. b",
        "L0:",
        "    ifnot 1 goto L0",
        "    return t1",
        "end",
        "",
        "func main()  ; main",
        "    param 2",
        "    param 3.0",
        "    t0 = call suma, 2",
        "    @total = t0",
        '    print.string "fin\\n"',
        "end",
      ].join("\n"),
    );
    assert.equal(classOf({ k: "slot", index: 1 }, m.functions[0], m), "float");
    assert.equal(classOf({ k: "global", index: 0 }, m.functions[1], m), "word");
  });
});
