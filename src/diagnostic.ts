export type Phase = "lexer" | "parser" | "semantic" | "backend";

export interface Diagnostic {
  phase: Phase;
  severity: "error" | "warning";
  /** Línea y columna, ambas desde 1. */
  line: number;
  column: number;
  message: string;
  code?: string;
  symbol?: string;
}

export const MAX_DIAGNOSTICS = 100;

/** Agrega `d` respetando el tope por fase; el último lugar avisa que hubo recorte. */
export function pushCapped(list: Diagnostic[], d: Diagnostic): void {
  if (list.length < MAX_DIAGNOSTICS - 1) {
    list.push(d);
  } else if (list.length === MAX_DIAGNOSTICS - 1) {
    list.push({
      phase: d.phase,
      severity: "error",
      line: d.line,
      column: d.column,
      message: `Se alcanzó el límite de ${MAX_DIAGNOSTICS} diagnósticos; los siguientes se omiten.`,
    });
  }
}
