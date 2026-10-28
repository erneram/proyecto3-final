import { CircleAlert, CircleCheck, OctagonX, TriangleAlert } from "lucide-react";
import type { Diagnostic, Phase } from "../../src/diagnostic.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { CompileReply, RunResult } from "@/worker";

/** Problema de la ejecución: error sin capturar, ciclo sin fin o fallo del intérprete. */
export function runProblem(run: RunResult | undefined): { title: string; message: string } | undefined {
  if (run?.uncaught) return { title: "Error en ejecución", message: `${run.uncaught}. El programa terminó con código 1.` };
  if (run?.timedOut) return { title: "Ejecución detenida", message: "El programa no terminó en un millón de pasos; revisa si tiene un ciclo infinito." };
  if (run?.error) return { title: "Ejecución fallida", message: run.error };
}

const PHASE: Record<Phase, string> = {
  lexer: "léxico",
  parser: "sintáctico",
  semantic: "semántico",
  backend: "generación",
};

function Problem({ d }: { d: Diagnostic }) {
  const error = d.severity === "error";
  return (
    <Alert variant={error ? "destructive" : "default"} className={error ? "border-destructive/60" : "border-chart-5/50"}>
      {error ? <CircleAlert /> : <TriangleAlert className="text-chart-5" />}
      <AlertTitle className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <span>
          {d.line}:{d.column}
        </span>
        <Badge variant="outline">{PHASE[d.phase]}</Badge>
        {d.code && <Badge variant={error ? "destructive" : "secondary"}>{d.code}</Badge>}
      </AlertTitle>
      <AlertDescription className="text-foreground/90">{d.message}</AlertDescription>
    </Alert>
  );
}

/** Lista de errores y advertencias de la última compilación, en el orden en que los produjo el compilador. */
export function ProblemsPanel({ reply }: { reply: CompileReply | null }) {
  if (!reply) return <p className="font-mono text-sm text-muted-foreground">Compilando…</p>;
  const failed = runProblem(reply.run);
  return (
    <div className="flex flex-col gap-2 pr-1">
      {reply.diagnostics.map((d, i) => (
        <Problem key={i} d={d} />
      ))}
      {reply.stopped && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Compilación detenida</AlertTitle>
          <AlertDescription>{reply.stopped.reason}</AlertDescription>
        </Alert>
      )}
      {reply.ok && (
        <Alert className="border-primary/60">
          <CircleCheck className="text-primary" />
          <AlertTitle className="text-primary">Compilación correcta</AlertTitle>
          <AlertDescription>Se generó código intermedio y MIPS en {reply.ms.toFixed(0)} ms.</AlertDescription>
        </Alert>
      )}
      {failed && (
        <Alert variant="destructive" className="border-destructive/60">
          <OctagonX />
          <AlertTitle>{failed.title}</AlertTitle>
          <AlertDescription className="text-foreground/90">{failed.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
