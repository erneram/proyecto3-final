import { useEffect, useRef, useState } from "react";
import type { CompileReply, CompileRequest } from "@/worker";

const DEBOUNCE_MS = 300;

/** Compila `source` en el worker tras una pausa al teclear; descarta respuestas de versiones viejas. */
export function useCompiler(source: string): { reply: CompileReply | null; busy: boolean } {
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const [reply, setReply] = useState<CompileReply | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<CompileReply>) => {
      if (e.data.id !== latest.current) return;
      setReply(e.data);
      setBusy(false);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    setBusy(true);
    const timer = setTimeout(() => {
      const request: CompileRequest = { id: ++latest.current, source };
      worker.current?.postMessage(request);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source]);

  return { reply, busy };
}
