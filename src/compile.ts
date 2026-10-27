import { check, type CheckResult } from "./check/checker.js";
import type { Diagnostic } from "./diagnostic.js";
import type { Program } from "./frontend/ast.js";
import { buildProgram } from "./frontend/build.js";
import { parse, type TokenInfo } from "./frontend/parse.js";

/** Etapas en orden; cada una solo corre si la anterior terminó sin errores. */
export const STAGES = ["parse", "check"] as const;
export type Stage = (typeof STAGES)[number];

export interface Compilation {
  tokens: TokenInfo[];
  /** Diagnósticos de todas las etapas que corrieron, en orden de etapa. */
  diagnostics: Diagnostic[];
  program?: Program;
  checked?: CheckResult;
  /** Primera etapa pedida que no corrió, con el motivo. */
  stopped?: { stage: Stage; reason: string };
  /** Se llegó a la etapa pedida y no hubo errores (las advertencias no cuentan). */
  ok: boolean;
}

const hasErrors = (list: Diagnostic[]): boolean => list.some((d) => d.severity === "error");

export function compile(source: string, upTo: Stage = STAGES[STAGES.length - 1]): Compilation {
  const wants = (stage: Stage): boolean => STAGES.indexOf(stage) <= STAGES.indexOf(upTo);
  const parsed = parse(source);
  const result: Compilation = { tokens: parsed.tokens, diagnostics: [...parsed.diagnostics], ok: false };

  if (hasErrors(parsed.diagnostics)) {
    if (wants("check")) result.stopped = { stage: "check", reason: "Hay errores léxicos o sintácticos; no se revisa la semántica." };
    return result;
  }
  result.program = buildProgram(parsed.tree);
  if (!wants("check")) return { ...result, ok: true };

  result.checked = check(result.program);
  result.diagnostics.push(...result.checked.diagnostics);
  result.ok = !hasErrors(result.checked.diagnostics);
  return result;
}
