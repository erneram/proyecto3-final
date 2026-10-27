import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { check } from "./check/checker.js";
import { SYMBOL_KIND_LABEL } from "./check/scope.js";
import { typeName } from "./check/types.js";
import type { Diagnostic } from "./diagnostic.js";
import { buildProgram } from "./frontend/build.js";
import { outline, renderOutline } from "./frontend/outline.js";
import { parse } from "./frontend/parse.js";

const USAGE = `Uso: compis <comando> <archivo.cps>

Comandos:
  tokens   Lista los tokens reconocidos
  tree     Muestra el árbol sintáctico abstracto
  check    Valida la semántica y muestra la tabla de símbolos

Opciones:
  -h, --help   Muestra esta ayuda`;

const PHASE_LABEL: Record<Diagnostic["phase"], string> = {
  lexer: "léxico",
  parser: "sintáctico",
  semantic: "semántico",
  backend: "backend",
};

/** Formato estilo compilador: `archivo:línea:columna: error fase [código]: mensaje`. */
export function formatDiagnostic(file: string, d: Diagnostic): string {
  const severity = d.severity === "error" ? "error" : "advertencia";
  const code = d.code ? ` [${d.code}]` : "";
  return `${file}:${d.line}:${d.column}: ${severity} ${PHASE_LABEL[d.phase]}${code}: ${d.message}`;
}

class UsageError extends Error {}

type Command = (file: string, source: string) => number;

function report(file: string, diagnostics: Diagnostic[]): void {
  for (const d of diagnostics) console.error(formatDiagnostic(file, d));
}

const commands: Record<string, Command> = {
  tokens(file, source) {
    const { tokens, diagnostics } = parse(source);
    const lexical = diagnostics.filter((d) => d.phase === "lexer");
    const width = Math.max(0, ...tokens.map((t) => t.kind.length));
    for (const t of tokens) {
      console.log(`${`${t.line}:${t.column}`.padEnd(8)} ${t.kind.padEnd(width)}  ${t.text}`);
    }
    console.log(`\n${tokens.length} tokens`);
    report(file, lexical);
    return lexical.length ? 1 : 0;
  },

  tree(file, source) {
    const { tree, diagnostics } = parse(source);
    if (diagnostics.length) {
      report(file, diagnostics);
      return 1;
    }
    console.log(renderOutline(outline(buildProgram(tree))));
    return 0;
  },

  check(file, source) {
    const { tree, diagnostics } = parse(source);
    if (diagnostics.length) {
      report(file, diagnostics);
      return 1;
    }
    const result = check(buildProgram(tree));
    const rows = result.table.symbols.map((s) => [
      String(s.id),
      s.name,
      SYMBOL_KIND_LABEL[s.kind],
      typeName(s.type),
      s.scope.name,
      String(s.uses.length),
      s.captured ? "sí" : "",
    ]);
    printTable(["id", "nombre", "clase", "tipo", "ámbito", "usos", "capturado"], rows);
    const captured = result.table.symbols.filter((s) => s.captured).length;
    console.log(`\n${result.table.symbols.length} símbolos · ${result.table.scopes.length} ámbitos · ${captured} capturados`);
    report(file, result.diagnostics);
    return result.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
  },
};

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  console.log(line(header));
  console.log(line(widths.map((w) => "─".repeat(w))));
  for (const r of rows) console.log(line(r));
}

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { help: { type: "boolean", short: "h" } } });
  } catch (e) {
    const option = /'([^']+)'/.exec((e as Error).message)?.[1];
    throw new UsageError(option ? `Opción desconocida: ${option}.` : "Argumentos inválidos.");
  }
  const [name, file, ...extra] = parsed.positionals;
  if (parsed.values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!name) throw new UsageError("Falta el comando.");
  const command = commands[name];
  if (!command) throw new UsageError(`Comando desconocido: ${name}.`);
  if (!file) throw new UsageError("Falta el archivo de entrada.");
  if (extra.length) throw new UsageError(`Argumentos de más: ${extra.join(" ")}.`);
  if (!file.endsWith(".cps")) throw new UsageError("El archivo debe tener extensión .cps.");

  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`No se pudo leer ${file}.`);
  }
  return command(file, source);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exitCode = 1;
  } else {
    console.error(`Error interno: ${(e as Error).stack ?? e}`);
    process.exitCode = 2;
  }
}
