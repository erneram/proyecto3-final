import { FileCode, FolderOpen } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { CodeEditor } from "@/CodeEditor";
import { ProblemsPanel } from "@/ProblemsPanel";
import { Splitter } from "@/Splitter";
import type { Example } from "@/examples";
import { ExamplesNav } from "@/ExamplesNav";
import { IrStats, CodePanel, Empty, OutlineTree, SymbolsPanel, TokensPanel } from "@/panels";
import { useCompiler } from "@/useCompiler";
import { AgentAvatar } from "@/components/thegridcn/agent-avatar";
import { HUDFrame } from "@/components/thegridcn/hud-frame";
import { StatusBar } from "@/components/thegridcn/status-bar";
import { UplinkHeader } from "@/components/thegridcn/uplink-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NO_DIAGNOSTICS: never[] = [];
const NO_CODE = "Sin código: corrige los errores para generar TAC y CFG.";
const BUTTON =
  "inline-flex items-center gap-2 rounded border border-primary/40 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40";

const INITIAL_SOURCE = `function factorial(n: integer): integer {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
}

print(factorial(5));
`;

export function App() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const [example, setExample] = useState<Example | null>(null);
  const [fileName, setFileName] = useState("programa");
  const [navOpen, setNavOpen] = useState(false);
  const [split, setSplit] = useState(50);
  const lines = source.split("\n").length;
  const { reply, busy } = useCompiler(source);
  const diagnostics = reply?.diagnostics ?? NO_DIAGNOSTICS;
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const problems = diagnostics.length;
  const status = busy ? "Analizando…" : errors ? `${errors} errores` : "Sin errores";

  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setNavOpen((open) => !open);
      }
    };
    addEventListener("keydown", toggle);
    return () => removeEventListener("keydown", toggle);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <UplinkHeader leftText="COMPISCRIPT // IDE" rightText="FASE 2 · TAC / CFG" />
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <AgentAvatar seed="compiscript" size={36} hue={190} aria-hidden />
          <h1 className="font-heading text-lg tracking-[0.3em] text-primary">Compiscript</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className={`${BUTTON} cursor-pointer focus-within:ring-1 focus-within:ring-primary`}>
            <FolderOpen className="size-3.5" />
            Abrir .cps
            <input
              type="file"
              accept=".cps"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setSource(await file.text());
                setFileName(file.name.replace(/\.cps$/, ""));
                setExample(null);
              }}
            />
          </label>
          <button type="button" className={BUTTON} onClick={() => setNavOpen(true)}>
            <FileCode className="size-3.5" />
            Ejemplos
            <kbd className="text-muted-foreground">⌘K</kbd>
          </button>
        </div>
      </header>
      <ExamplesNav
        open={navOpen}
        onOpenChange={setNavOpen}
        current={example}
        onSelect={(e) => {
          setExample(e);
          setFileName(e.name);
          setSource(e.source);
          setNavOpen(false);
        }}
      />
      <main
        className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-[minmax(0,var(--left))_1.5rem_minmax(0,var(--right))] lg:gap-0"
        style={{ "--left": `${split}fr`, "--right": `${100 - split}fr` } as CSSProperties}
      >
        <HUDFrame label={`${fileName}.cps`} className="flex min-h-0 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col">
          <CodeEditor value={source} onChange={setSource} diagnostics={diagnostics} />
        </HUDFrame>
        <Splitter value={split} onChange={setSplit} />
        <HUDFrame label="Resultados" className="flex min-h-0 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col">
          <Tabs defaultValue="problems" className="min-h-0 flex-1">
            <TabsList className="h-auto w-full flex-wrap">
              <TabsTrigger value="problems">
                Problemas
                {problems > 0 && (
                  <Badge variant={errors ? "destructive" : "secondary"} className="px-1.5 py-0">
                    {problems}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="tokens">Tokens</TabsTrigger>
              <TabsTrigger value="ast">AST</TabsTrigger>
              <TabsTrigger value="scopes">Ámbitos</TabsTrigger>
              <TabsTrigger value="symbols">Símbolos</TabsTrigger>
              <TabsTrigger value="tac">TAC</TabsTrigger>
              <TabsTrigger value="cfg">CFG</TabsTrigger>
            </TabsList>
            <TabsContent value="problems" className="min-h-0 overflow-y-auto">
              <ProblemsPanel reply={reply} />
            </TabsContent>
            <TabsContent value="tokens" className="min-h-0 overflow-y-auto">
              <TokensPanel tokens={reply?.tokens ?? []} />
            </TabsContent>
            <TabsContent value="ast" className="min-h-0 overflow-auto">
              {reply?.ast ? <OutlineTree root={reply.ast} /> : <Empty>Sin AST: corrige primero los errores léxicos o sintácticos.</Empty>}
            </TabsContent>
            <TabsContent value="scopes" className="min-h-0 overflow-auto">
              {reply?.scopes ? <OutlineTree root={reply.scopes} /> : <Empty>Sin ámbitos: el análisis semántico no corrió.</Empty>}
            </TabsContent>
            <TabsContent value="symbols" className="min-h-0 overflow-y-auto">
              {reply?.symbols ? <SymbolsPanel symbols={reply.symbols} /> : <Empty>Sin tabla de símbolos: el análisis semántico no corrió.</Empty>}
            </TabsContent>
            <TabsContent value="tac" className="flex min-h-0 flex-col gap-3 overflow-auto">
              {reply?.tac && reply.stats ? (
                <>
                  <IrStats stats={reply.stats} />
                  <CodePanel title="Código de tres direcciones" code={reply.tac} />
                </>
              ) : (
                <Empty>{NO_CODE}</Empty>
              )}
            </TabsContent>
            <TabsContent value="cfg" className="min-h-0 overflow-auto">
              {reply?.cfg ? <CodePanel title="Bloques básicos por función" code={reply.cfg} /> : <Empty>{NO_CODE}</Empty>}
            </TabsContent>
          </Tabs>
        </HUDFrame>
      </main>
      <StatusBar
        leftContent={
          <>
            <span className={errors && !busy ? "text-destructive" : undefined}>{status}</span>
            {warnings > 0 && <span>{warnings} advertencias</span>}
          </>
        }
        rightContent={
          <>
            <span>{lines} líneas</span>
            <span className="text-primary">Fase 2 · código intermedio</span>
          </>
        }
      />
    </div>
  );
}
