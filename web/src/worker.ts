import { compile, type Compilation } from "../../src/compile.js";
import type { Diagnostic } from "../../src/diagnostic.js";

export interface CompileRequest {
  id: number;
  source: string;
}

export interface CompileReply {
  id: number;
  ok: boolean;
  diagnostics: Diagnostic[];
  stopped?: Compilation["stopped"];
  /** Duración de la compilación en milisegundos. */
  ms: number;
}

/** Compila fuera del hilo de la interfaz; un fallo interno se reporta como diagnóstico, no tumba la IDE. */
addEventListener("message", (e: MessageEvent<CompileRequest>) => {
  const { id, source } = e.data;
  const start = performance.now();
  let reply: CompileReply;
  try {
    const c = compile(source);
    reply = { id, ok: c.ok, diagnostics: c.diagnostics, stopped: c.stopped, ms: 0 };
  } catch (err) {
    const message = `Error interno del compilador: ${err instanceof Error ? err.message : String(err)}`;
    reply = { id, ok: false, diagnostics: [{ phase: "backend", severity: "error", line: 1, column: 1, message }], ms: 0 };
  }
  reply.ms = performance.now() - start;
  postMessage(reply);
});
