const sources = import.meta.glob<string>("../../examples/{run,lang,errors}/*.cps", {
  query: "?raw",
  import: "default",
  eager: true,
});

const GROUP: Record<string, string> = { run: "Ejecución", lang: "Lenguaje", errors: "Errores" };

export interface Example {
  name: string;
  group: string;
  source: string;
}

/** Programas de `examples/` empaquetados en la IDE, agrupados por carpeta. */
export const EXAMPLES: Example[] = Object.entries(sources).map(([path, source]) => {
  const [dir, file] = path.split("/").slice(-2);
  return { name: file.replace(/\.cps$/, ""), group: GROUP[dir] ?? dir, source };
});
