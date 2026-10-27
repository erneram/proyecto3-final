import { CharStream, CommonTokenStream, ListTokenSource, type CommonToken, type Token } from "antlr4ng";
import { pushCapped, type Diagnostic } from "../diagnostic.js";
import { SpanishErrorStrategy } from "./errors.js";
import { CompisLexer } from "./gen/CompisLexer.js";
import { CompisParser, type ProgramContext } from "./gen/CompisParser.js";

export interface TokenInfo {
  kind: string;
  text: string;
  line: number;
  column: number;
}

export interface ParseResult {
  tokens: TokenInfo[];
  tree: ProgramContext;
  /** Errores léxicos primero, luego sintácticos. */
  diagnostics: Diagnostic[];
}

/** Una cadena mal formada está cerrada si termina en comillas no escapadas. */
function isClosed(text: string): boolean {
  if (text.length < 2 || !text.endsWith('"')) return false;
  let slashes = 0;
  for (let i = text.length - 2; text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 0;
}

export function parse(source: string): ParseResult {
  const lexer = new CompisLexer(CharStream.fromString(source));
  lexer.removeErrorListeners();
  const raw = lexer.getAllTokens();

  const lexical: Diagnostic[] = [];
  const kept: Token[] = [];
  // Tokens que siguen a basura descartada: sus errores sintácticos son consecuencia del léxico.
  const tainted = new Set<Token>();
  let taintNext = false;

  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t.type === CompisLexer.ERROR_CHAR) {
      let text = t.text ?? "";
      while (raw[i + 1]?.type === CompisLexer.ERROR_CHAR && raw[i + 1].start === raw[i].stop + 1 && raw[i + 1].line === t.line) {
        text += raw[++i].text ?? "";
      }
      pushCapped(lexical, {
        phase: "lexer",
        severity: "error",
        line: t.line,
        column: t.column + 1,
        symbol: text,
        message: `${text.length === 1 ? "Carácter no reconocido" : "Secuencia no reconocida"}: ${JSON.stringify(text)}.`,
      });
      taintNext = true;
      continue;
    }
    let unclosed = false;
    if (t.type === CompisLexer.BAD_STRING) {
      const text = t.text ?? "";
      unclosed = !isClosed(text);
      pushCapped(lexical, {
        phase: "lexer",
        severity: "error",
        line: t.line,
        column: t.column + 1,
        symbol: text,
        message: unclosed
          ? "La cadena no se cierra antes del final de la línea."
          : "La cadena usa una secuencia de escape inválida; solo se admiten \\n, \\r, \\t, \\\" y \\\\.",
      });
      // Se recupera como literal para que el parser no arrastre errores en cascada.
      (t as CommonToken).type = CompisLexer.STRING_LIT;
    }
    if (taintNext) {
      tainted.add(t);
      taintNext = false;
    }
    kept.push(t);
    // Una cadena sin cierre se traga el resto de la línea (incluido un posible ';').
    if (unclosed) taintNext = true;
  }

  const syntax: Diagnostic[] = [];
  const parser = new CompisParser(new CommonTokenStream(new ListTokenSource(kept)));
  parser.removeErrorListeners();
  parser.errorHandler = new SpanishErrorStrategy((offending, line, column, message) => {
    if (tainted.has(offending)) return;
    pushCapped(syntax, { phase: "parser", severity: "error", line, column, message, symbol: offending.text });
  });
  const tree = parser.program();

  const tokens = kept.map((t) => ({
    kind: lexer.vocabulary.getSymbolicName(t.type) ?? String(t.type),
    text: t.text ?? "",
    line: t.line,
    column: t.column + 1,
  }));
  return { tokens, tree, diagnostics: [...lexical, ...syntax] };
}
