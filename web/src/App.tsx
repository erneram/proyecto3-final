import { useState } from "react";
import { HUDFrame } from "@/components/thegridcn/hud-frame";
import { StatusBar } from "@/components/thegridcn/status-bar";
import { UplinkHeader } from "@/components/thegridcn/uplink-header";

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

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <UplinkHeader leftText="COMPISCRIPT // IDE" rightText="MIPS32 · MARS 4.5" />
      <header className="flex items-baseline justify-between gap-4 px-6 py-4">
        <h1 className="font-heading text-lg tracking-[0.3em] text-primary">Compiscript</h1>
        <span className="font-mono text-xs text-muted-foreground">fuente → código intermedio → MIPS</span>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-2">
        <HUDFrame label="Editor" className="flex min-h-0 flex-col p-4 pt-5">
          <textarea
            aria-label="Código fuente"
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="min-h-0 flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-foreground outline-none"
          />
        </HUDFrame>
        <HUDFrame label="Resultados" className="flex min-h-0 flex-col p-4 pt-5">
          <p className="font-mono text-sm text-muted-foreground">Sin compilar todavía.</p>
        </HUDFrame>
      </main>
      <StatusBar
        leftContent={<span>Listo</span>}
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
