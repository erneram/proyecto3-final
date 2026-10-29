import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import config from "../vite.config.js";

it("la IDE resuelve su alias como ruta absoluta del sistema", () => {
  const aliases = config.resolve?.alias;
  assert.ok(aliases && "@" in aliases);
  const source = aliases["@"];
  assert.equal(source, fileURLToPath(new URL("../src", import.meta.url)));
  assert.ok(typeof source === "string" && isAbsolute(source));
});
