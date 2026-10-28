import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const CONTROL = new Set([
  "if", "else", "while", "do", "for", "foreach", "in", "break", "continue",
  "return", "try", "catch", "switch", "case", "default",
]);
const DEFINITION = new Set(["let", "var", "const", "function", "class"]);
const TYPES = new Set(["boolean", "integer", "float", "string"]);
const OPERATORS = /^(?:&&|\|\||[=!<>]=|[-+*/%=<>!?:])/;

interface State {
  /** Dentro de un comentario de bloque que sigue en la línea siguiente. */
  comment: boolean;
  /** Palabra clave previa que da significado al siguiente identificador. */
  pending: "function" | "class" | "new" | null;
}

function blockComment(stream: Parameters<StreamParser<State>["token"]>[0], state: State): string {
  state.comment = !stream.skipTo("*/");
  if (state.comment) stream.skipToEnd();
  else stream.pos += 2;
  return "blockComment";
}

/** Resaltado léxico de Compiscript: sigue las mismas reglas de tokens que la gramática. */
const parser: StreamParser<State> = {
  name: "compiscript",
  startState: () => ({ comment: false, pending: null }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (state.comment) return blockComment(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "lineComment";
    }
    if (stream.match("/*")) return blockComment(stream, state);
    if (stream.eat('"')) {
      for (let ch; (ch = stream.next()) !== undefined; ) {
        if (ch === "\\") stream.next();
        else if (ch === '"') return "string";
      }
      return "invalid";
    }
    if (stream.match(/^\d+\.\d+/)) return "number";
    if (stream.match(/^\d+/)) return "number";
    const word = stream.match(/^[a-zA-Z_]\w*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      const pending = state.pending;
      state.pending = w === "function" || w === "class" || w === "new" ? w : null;
      if (CONTROL.has(w)) return "controlKeyword";
      if (DEFINITION.has(w)) return "definitionKeyword";
      if (TYPES.has(w)) return "typeName";
      if (w === "true" || w === "false") return "bool";
      if (w === "null") return "null";
      if (w === "this") return "self";
      if (w === "new" || w === "print") return "keyword";
      if (pending === "function") return "variableName.function.definition";
      if (pending === "class" || pending === "new") return "className";
      if (stream.match(/^\s*\(/, false)) return "variableName.function";
      return "variableName";
    }
    if (stream.match(OPERATORS)) return "operator";
    stream.next();
    return "punctuation";
  },
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
};

export const compiscript = StreamLanguage.define(parser);

const tron = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword], color: "#00d4ff", fontWeight: "600" },
  { tag: [t.typeName, t.className], color: "#7ae8ff" },
  { tag: t.function(t.variableName), color: "#e6f7ff" },
  { tag: t.function(t.definition(t.variableName)), color: "#e6f7ff", fontWeight: "600" },
  { tag: [t.number, t.bool, t.null, t.self], color: "#ffb347" },
  { tag: t.string, color: "#9cf2c8" },
  { tag: [t.lineComment, t.blockComment], color: "#4f6b80", fontStyle: "italic" },
  { tag: t.operator, color: "#5fb8d6" },
  { tag: t.punctuation, color: "#6f8899" },
  { tag: t.invalid, color: "#ff4d6d", textDecoration: "underline wavy" },
]);

/** Tema del editor sobre los tokens de GridCN para que siga al fondo y al borde del tema Tron. */
const chrome = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "transparent", color: "var(--foreground)", fontSize: "13px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-content": { caretColor: "#00d4ff" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#00d4ff", borderLeftWidth: "2px" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--muted-foreground)",
      borderRight: "1px solid color-mix(in oklch, var(--border) 60%, transparent)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklch, #00d4ff 6%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#00d4ff" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in oklch, #00d4ff 25%, transparent) !important",
    },
    ".cm-matchingBracket": { color: "#00d4ff", outline: "1px solid color-mix(in oklch, #00d4ff 50%, transparent)" },
  },
  { dark: true },
);

export const tronTheme = [chrome, syntaxHighlighting(tron)];
