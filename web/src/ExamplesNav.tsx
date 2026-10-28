import { Search } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EXAMPLE_GROUPS, type Example } from "@/examples";
import { cn } from "@/lib/utils";

const TOTAL = EXAMPLE_GROUPS.reduce((n, g) => n + g.examples.length, 0);

interface ExamplesNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: Example | null;
  onSelect: (example: Example) => void;
}

/** Panel que entra desde la izquierda con los ejemplos agrupados por carpeta y un filtro. */
export function ExamplesNav({ open, onOpenChange, current, onSelect }: ExamplesNavProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = EXAMPLE_GROUPS.map((g) => ({
    ...g,
    examples: g.examples.filter(
      (e) => !q || [e.name, e.description, g.title].some((text) => text.toLowerCase().includes(q)),
    ),
  })).filter((g) => g.examples.length > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 gap-0 border-primary/40 bg-background/95 backdrop-blur-md sm:max-w-80">
        <SheetHeader className="border-b border-primary/20">
          <SheetTitle className="font-heading text-sm uppercase tracking-[0.3em] text-primary">Ejemplos</SheetTitle>
          <SheetDescription className="font-mono text-xs">{TOTAL} programas de examples/</SheetDescription>
        </SheetHeader>
        <label className="relative block border-b border-primary/20">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Filtrar ejemplos</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar…"
            className="w-full bg-transparent py-3 pr-4 pl-10 font-mono text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <nav aria-label="Ejemplos" className="min-h-0 flex-1 overflow-y-auto py-2">
          {groups.map((g) => (
            <section key={g.title}>
              <h3 className="flex justify-between px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                {g.title}
                <span>{g.examples.length}</span>
              </h3>
              <ul>
                {g.examples.map((e) => {
                  const active = e === current;
                  return (
                    <li key={e.name}>
                      <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onSelect(e)}
                        className={cn(
                          "w-full border-l-2 px-4 py-1.5 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-transparent text-foreground/80 hover:border-primary/50 hover:bg-primary/5 hover:text-foreground",
                        )}
                      >
                        <span className="block font-mono text-xs">{e.name}</span>
                        {e.description && (
                          <span className="block truncate text-[11px] text-muted-foreground">{e.description}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="px-4 py-6 text-center font-mono text-xs text-muted-foreground">Sin resultados</p>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
