import {
  DefaultErrorStrategy,
  InputMismatchException,
  NoViableAltException,
  Token,
  type IntervalSet,
  type Parser,
  type RecognitionException,
  type Vocabulary,
} from "antlr4ng";
import { CompisLexer as L } from "./gen/CompisLexer.js";

const FRIENDLY: Record<number, string> = {
  [Token.EOF]: "el final del archivo",
  [L.ID]: "un identificador",
  [L.INT_LIT]: "un número entero",
  [L.FLOAT_LIT]: "un número decimal",
  [L.STRING_LIT]: "una cadena de texto",
};

const EXPRESSION_START = [
  L.ID, L.INT_LIT, L.FLOAT_LIT, L.STRING_LIT, L.TRUE, L.FALSE, L.NULL,
  L.NEW, L.THIS, L.LPAREN, L.LBRACKET, L.MINUS, L.NOT,
];

function describeSet(set: IntervalSet, vocabulary: Vocabulary): string {
  let types = set.toArray();
  const parts: string[] = [];
  if (EXPRESSION_START.every((t) => types.includes(t))) {
    parts.push("una expresión");
    types = types.filter((t) => !EXPRESSION_START.includes(t));
  }
  for (const t of types) {
    parts.push(FRIENDLY[t] ?? vocabulary.getLiteralName(t) ?? vocabulary.getSymbolicName(t) ?? `#${t}`);
  }
  return parts.length === 1 ? parts[0] : `uno de: ${parts.join(", ")}`;
}

function describeToken(t: Token | null): string {
  return !t || t.type === Token.EOF ? "el final del archivo" : `"${t.text}"`;
}

/** "de" seguido del token, contraído a "del" ante el final del archivo. */
function ofToken(t: Token | null): string {
  return `de ${describeToken(t)}`.replace(/^de el /, "del ");
}

export type SyntaxReporter = (offending: Token, line: number, column: number, message: string) => void;

/**
 * Misma recuperación que la estrategia por defecto de ANTLR, pero los mensajes
 * se redactan en español y se entregan a `report` en vez de a los listeners.
 */
export class SpanishErrorStrategy extends DefaultErrorStrategy {
  readonly #report: SyntaxReporter;

  constructor(report: SyntaxReporter) {
    super();
    this.#report = report;
  }

  override reportError(p: Parser, e: RecognitionException): void {
    if (this.inErrorRecoveryMode(p)) return;
    this.beginErrorCondition(p);
    const t = e.offendingToken ?? p.getCurrentToken();
    if (e instanceof NoViableAltException) {
      this.#at(t, `No se reconoce una construcción válida en ${describeToken(t)}.`);
    } else if (e instanceof InputMismatchException) {
      const expected = e.getExpectedTokens() ?? this.getExpectedTokens(p);
      this.#at(t, `Se encontró ${describeToken(t)}, pero se esperaba ${describeSet(expected, p.vocabulary)}.`);
    } else {
      this.#at(t, `Estructura inválida cerca ${ofToken(t)}.`);
    }
  }

  override reportUnwantedToken(p: Parser): void {
    if (this.inErrorRecoveryMode(p)) return;
    this.beginErrorCondition(p);
    const t = p.getCurrentToken();
    const expected = describeSet(this.getExpectedTokens(p), p.vocabulary);
    this.#at(
      t,
      t.type === Token.EOF
        ? `El archivo termina antes de tiempo; se esperaba ${expected}.`
        : `Sobra ${describeToken(t)}; se esperaba ${expected}.`,
    );
  }

  override reportMissingToken(p: Parser): void {
    if (this.inErrorRecoveryMode(p)) return;
    this.beginErrorCondition(p);
    const t = p.getCurrentToken();
    const message = `Falta ${describeSet(this.getExpectedTokens(p), p.vocabulary)} antes ${ofToken(t)}.`;
    // Se señala justo después del token anterior: ahí es donde falta algo.
    const prev = p.tokenStream.LT(-1);
    if (prev) this.#report(t, prev.line, prev.column + (prev.text?.length ?? 0) + 1, message);
    else this.#at(t, message);
  }

  #at(t: Token, message: string): void {
    this.#report(t, t.line, t.column + 1, message);
  }
}
