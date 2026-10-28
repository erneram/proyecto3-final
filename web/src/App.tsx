import { useState } from "react";
import { CodeEditor } from "@/CodeEditor";
import { ProblemsPanel } from "@/ProblemsPanel";
import { Empty, OutlineTree, SymbolsPanel, TokensPanel } from "@/panels";
import { useCompiler } from "@/useCompiler";
import { HUDFrame } from "@/components/thegridcn/hud-frame";
import { StatusBar } from "@/components/thegridcn/status-bar";
import { UplinkHeader } from "@/components/thegridcn/uplink-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NO_DIAGNOSTICS: never[] = [];

const INITIAL_SOURCE = `function factorial(n: integer): integer {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
}

print(factorial(5));
`;

/** Marco de la IDE: cabecera, editor a la izquierda, resultados a la derecha y barra de estado. */
export function App() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const lines = source.split("\n").length;
  const { reply, busy } = useCompiler(source);
  const diagnostics = reply?.diagnostics ?? NO_DIAGNOSTICS;
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const status = busy ? "Compilando…" : errors ? `${errors} errores` : "Sin errores";

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <UplinkHeader leftText="COMPISCRIPT // IDE" rightText="MIPS32 · MARS 4.5" />
      <header className="flex items-baseline justify-between gap-4 px-6 py-4">
        <h1 className="font-heading text-lg tracking-[0.3em] text-primary">Compiscript</h1>
        <span className="font-mono text-xs text-muted-foreground">fuente → código intermedio → MIPS</span>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-2">
        <HUDFrame label="Editor" className="flex min-h-0 flex-col p-4 pt-5">
          <CodeEditor value={source} onChange={setSource} diagnostics={diagnostics} />
        </HUDFrame>
        <HUDFrame label="Resultados" className="flex min-h-0 flex-col p-4 pt-5">
          <Tabs defaultValue="problems" className="min-h-0 flex-1">
            <TabsList className="w-full">
              <TabsTrigger value="problems">
                Problemas
                {diagnostics.length > 0 && (
                  <Badge variant={errors ? "destructive" : "secondary"} className="px-1.5 py-0">
                    {diagnostics.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="tokens">Tokens</TabsTrigger>
              <TabsTrigger value="ast">AST</TabsTrigger>
              <TabsTrigger value="scopes">Ámbitos</TabsTrigger>
              <TabsTrigger value="symbols">Símbolos</TabsTrigger>
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
            <span className="text-primary">Tron · #00D4FF</span>
          </>
        }
      />
    </div>
  );
}
