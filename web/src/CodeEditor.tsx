import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { lintGutter, setDiagnostics, type Diagnostic as Marker } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Diagnostic } from "../../src/diagnostic.js";
import { compiscript, tronTheme } from "@/editor";

interface Props {
  value: string;
  onChange: (value: string) => void;
  diagnostics: Diagnostic[];
}

/** Línea y columna (desde 1) a un rango del documento: la palabra que empieza ahí, o un punto. */
function marker(doc: Text, d: Diagnostic): Marker {
  const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
  const from = Math.min(line.from + Math.max(d.column - 1, 0), line.to);
  const word = /^\w+/.exec(doc.sliceString(from, line.to));
  const to = word ? from + word[0].length : Math.min(from + 1, line.to);
  return { from, to, severity: d.severity, source: d.code, message: d.message };
}

/** CodeMirror montado una sola vez; los cambios externos de `value` se aplican como transacción. */
export function CodeEditor({ value, onChange, diagnostics }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      doc: value,
      extensions: [
        basicSetup,
        compiscript,
        lintGutter(),
        tronTheme,
        EditorView.contentAttributes.of({ "aria-label": "Código fuente" }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) change.current(u.state.doc.toString());
        }),
      ],
    });
    view.current = v;
    return () => v.destroy();
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, diagnostics.map((d) => marker(v.state.doc, d))));
  }, [diagnostics]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}
