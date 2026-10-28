import { useMemo } from "react";
import { Terminal } from "@/components/thegridcn/terminal";
import type { CompileReply } from "@/worker";

type Line = { text: string; type?: "input" | "output" | "error" | "system" };

function consoleLines(reply: CompileReply | null, fileName: string): Line[] {
  const lines: Line[] = [{ type: "input", text: `compis run ${fileName}.cps` }];
  if (!reply) return [...lines, { type: "system", text: "Compilando…" }];
  const run = reply.run;
  if (!run) return [...lines, { type: "system", text: "Sin ejecución: corrige los errores de compilación." }];
  if (run.omitted) lines.push({ type: "system", text: `… ${run.omitted} líneas anteriores omitidas` });
  run.output.forEach((text, i) => {
    // El mensaje de un error sin capturar es la última línea impresa.
    lines.push({ type: run.uncaught && i === run.output.length - 1 ? "error" : "output", text });
  });
  if (run.timedOut) lines.push({ type: "error", text: "El programa no terminó en un millón de pasos." });
  else if (run.error) lines.push({ type: "error", text: run.error });
  else lines.push({ type: "system", text: `Terminó con código ${run.uncaught ? 1 : 0}` });
  return lines;
}

/** Lo que imprime el programa al ejecutarlo con el intérprete del código intermedio. */
export function Console({ reply, fileName }: { reply: CompileReply | null; fileName: string }) {
  const lines = useMemo(() => consoleLines(reply, fileName), [reply, fileName]);
  const failed = reply?.run && (reply.run.uncaught || reply.run.timedOut || reply.run.error);
  return (
    <Terminal
      title="Salida · intérprete de TAC"
      lines={lines}
      typewriter={false}
      variant={failed ? "danger" : "default"}
      className="flex min-h-0 flex-1 flex-col"
      bodyClassName="max-h-none min-h-0 flex-1 whitespace-pre text-xs"
    />
  );
}
