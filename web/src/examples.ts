const sources = import.meta.glob<string>(["../../examples/{run,lang}/*.cps", "../../examples/errors/*/*.cps"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const GROUP: Record<string, string> = {
  run: "Ejecución",
  lang: "Lenguaje",
  lexico: "Errores léxicos",
  sintaxis: "Errores sintácticos",
  semantica: "Errores semánticos",
  advertencias: "Advertencias",
  ejecucion: "Errores en ejecución",
};

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
