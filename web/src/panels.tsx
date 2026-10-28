import { useMemo } from "react";
import type { OutlineNode } from "../../src/frontend/outline.js";
import type { TokenInfo } from "../../src/frontend/parse.js";
import { DataTable } from "@/components/thegridcn/data-table";
import { StatCard } from "@/components/thegridcn/stat-card";
import { Terminal } from "@/components/thegridcn/terminal";
import { Badge } from "@/components/ui/badge";
import type { CompileReply, SymbolRow } from "@/worker";

export function Empty({ children }: { children: string }) {
  return <p className="font-mono text-sm text-muted-foreground">{children}</p>;
}

export function TokensPanel({ tokens }: { tokens: TokenInfo[] }) {
  const rows = tokens.map((t, i) => ({ n: i + 1, line: t.line, column: t.column, kind: t.kind, text: t.text }));
  return (
    <DataTable
      label={`${tokens.length} tokens`}
      data={rows}
      columns={[
        { key: "n", label: "#", align: "right" },
        { key: "line", label: "Línea", align: "right", sortable: true },
        { key: "column", label: "Col", align: "right" },
        { key: "kind", label: "Tipo", sortable: true, render: (v) => <span className="text-primary">{String(v)}</span> },
        { key: "text", label: "Lexema", render: (v) => <span className="whitespace-pre">{String(v)}</span> },
      ]}
    />
  );
}

function TreeNode({ node, depth }: { node: OutlineNode; depth: number }) {
  const where = node.pos && (
    <span className="ml-2 text-muted-foreground/70">
      {node.pos.line}:{node.pos.column}
    </span>
  );
  if (!node.children.length) {
    return (
      <div className="py-0.5 pl-4">
        {node.label}
        {where}
      </div>
    );
  }
  return (
    <details open={depth < 3} className="pl-1">
      <summary className="cursor-pointer py-0.5 marker:text-primary hover:text-primary">
        {node.label}
        {where}
      </summary>
      <div className="ml-1.5 border-l border-primary/20 pl-1">
        {node.children.map((c, i) => (
          <TreeNode key={i} node={c} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

/** Árbol plegable para el AST y los ámbitos; los primeros niveles empiezan abiertos. */
export function OutlineTree({ root }: { root: OutlineNode }) {
  return (
    <div className="font-mono text-xs leading-5">
      <TreeNode node={root} depth={0} />
    </div>
  );
}

export function SymbolsPanel({ symbols }: { symbols: SymbolRow[] }) {
  const captured = symbols.filter((s) => s.captured).length;
  return (
    <DataTable
      label={`${symbols.length} símbolos · ${captured} capturados`}
      data={symbols.map((s) => ({ ...s }))}
      columns={[
        { key: "id", label: "id", align: "right" },
        { key: "name", label: "Nombre", sortable: true, render: (v) => <span className="text-primary">{String(v)}</span> },
        { key: "kind", label: "Clase", sortable: true },
        { key: "type", label: "Tipo" },
        { key: "scope", label: "Ámbito", sortable: true },
        { key: "line", label: "Línea", align: "right", sortable: true },
        { key: "uses", label: "Usos", align: "right", sortable: true },
        { key: "captured", label: "Capturado", render: (v) => (v ? <Badge variant="secondary">sí</Badge> : null) },
      ]}
    />
  );
}

/** Salida de una etapa (TAC, CFG o MIPS) como terminal, sin efecto de máquina de escribir. */
export function CodePanel({ title, code }: { title: string; code: string }) {
  const lines = useMemo(() => code.split("\n").map((text) => ({ text })), [code]);
  return <Terminal title={title} lines={lines} typewriter={false} bodyClassName="max-h-none whitespace-pre text-xs" />;
}

export function BackendStats({ stats }: { stats: NonNullable<CompileReply["stats"]> }) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <StatCard title="Funciones" value={String(stats.functions)} />
      <StatCard title="Cuádruplos" value={String(stats.quads)} />
      <StatCard title="Bloques básicos" value={String(stats.blocks)} />
      <StatCard title="Líneas MIPS" value={String(stats.asmLines)} />
    </div>
  );
}
