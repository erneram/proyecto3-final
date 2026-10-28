const sources = import.meta.glob<string>(["../../examples/{run,lang}/*.cps", "../../examples/errors/*/*.cps"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Carpetas en el orden en que se muestran, con su título. */
const GROUPS: [dir: string, title: string][] = [
  ["run", "Programas"],
  ["lang", "Lenguaje"],
  ["lexico", "Errores léxicos"],
  ["sintaxis", "Errores sintácticos"],
  ["semantica", "Errores semánticos"],
  ["advertencias", "Advertencias"],
  ["ejecucion", "Errores en ejecución"],
];

export interface Example {
  name: string;
  /** Primer comentario del archivo que no es la línea `// esperado:`. */
  description: string;
  source: string;
}

export interface ExampleGroup {
  title: string;
  examples: Example[];
}

const byDir = new Map<string, Example[]>();
for (const [path, source] of Object.entries(sources)) {
  const [dir, file] = path.split("/").slice(-2);
  const comment = source.split("\n").find((l) => l.startsWith("//") && !l.startsWith("// esperado:"));
  const list = byDir.get(dir) ?? [];
  list.push({ name: file.replace(/\.cps$/, ""), description: comment?.slice(2).trim() ?? "", source });
  byDir.set(dir, list);
}

/** Programas de `examples/` empaquetados en la IDE, agrupados por carpeta. */
export const EXAMPLE_GROUPS: ExampleGroup[] = GROUPS.filter(([dir]) => byDir.has(dir)).map(([dir, title]) => ({
  title,
  examples: byDir.get(dir)!.sort((a, b) => a.name.localeCompare(b.name)),
}));
