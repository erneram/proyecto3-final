import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { compiscript, tronTheme } from "@/editor";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** CodeMirror montado una sola vez; los cambios externos de `value` se aplican como transacción. */
export function CodeEditor({ value, onChange }: Props) {
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

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}
