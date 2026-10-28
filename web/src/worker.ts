import { SYMBOL_KIND_LABEL, type Scope, type ScopeKind, type SymbolTable } from "../../src/check/scope.js";
import { typeName } from "../../src/check/types.js";
import { compile, type Compilation } from "../../src/compile.js";
import type { Diagnostic } from "../../src/diagnostic.js";
import { outline, type OutlineNode } from "../../src/frontend/outline.js";
import type { TokenInfo } from "../../src/frontend/parse.js";

export interface CompileRequest {
  id: number;
  source: string;
}

export interface CompileReply {
  id: number;
  ok: boolean;
  diagnostics: Diagnostic[];
  stopped?: Compilation["stopped"];
  tokens: TokenInfo[];
  /** Árbol sintáctico abstracto, si el análisis sintáctico no tuvo errores. */
  ast?: OutlineNode;
  /** Ámbitos anidados con sus símbolos, si corrió el análisis semántico. */
  scopes?: OutlineNode;
  symbols?: SymbolRow[];
  /** Duración de la compilación en milisegundos. */
  ms: number;
}

export interface SymbolRow {
  id: number;
  name: string;
  kind: string;
  type: string;
  scope: string;
  line: number;
  column: number;
  uses: number;
  captured: boolean;
}

const SCOPE_KIND_LABEL: Record<ScopeKind, string> = {
  global: "global",
  function: "función",
  method: "método",
  class: "clase",
  block: "bloque",
  loop: "ciclo",
  switch: "switch",
  catch: "catch",
};

function scopeTree(scope: Scope): OutlineNode {
  const symbols = [...scope.symbols.values()].map((s) => ({
    label: `${s.name}: ${typeName(s.type)} · ${SYMBOL_KIND_LABEL[s.kind]}${s.captured ? " · capturado" : ""}`,
    pos: s.pos,
    children: [],
  }));
  const label = scope.kind === "global" ? "global" : `${SCOPE_KIND_LABEL[scope.kind]} ${scope.name}`;
  return { label, pos: scope.pos, children: [...symbols, ...scope.children.map(scopeTree)] };
}

const symbolRows = (table: SymbolTable): SymbolRow[] =>
  table.symbols.map((s) => ({
    id: s.id,
    name: s.name,
    kind: SYMBOL_KIND_LABEL[s.kind],
    type: typeName(s.type),
    scope: s.scope.name,
    line: s.pos.line,
    column: s.pos.column,
    uses: s.uses.length,
    captured: s.captured,
  }));

/** Compila fuera del hilo de la interfaz; un fallo interno se reporta como diagnóstico, no tumba la IDE. */
addEventListener("message", (e: MessageEvent<CompileRequest>) => {
  const { id, source } = e.data;
  const start = performance.now();
  let reply: CompileReply;
  try {
    const c = compile(source);
    reply = {
      id,
      ok: c.ok,
      diagnostics: c.diagnostics,
      stopped: c.stopped,
      tokens: c.tokens,
      ast: c.program && outline(c.program),
      scopes: c.checked && scopeTree(c.checked.table.root),
      symbols: c.checked && symbolRows(c.checked.table),
      ms: 0,
    };
  } catch (err) {
    const message = `Error interno del compilador: ${err instanceof Error ? err.message : String(err)}`;
    reply = { id, ok: false, diagnostics: [{ phase: "backend", severity: "error", line: 1, column: 1, message }], tokens: [], ms: 0 };
  }
  reply.ms = performance.now() - start;
  postMessage(reply);
});
