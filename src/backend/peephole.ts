/**
 * Mejoras locales sobre el texto ensamblador ya generado. Cada regla mira unas
 * pocas líneas seguidas y se aplican hasta que ninguna cambia nada.
 */

const isLabel = (line: string): boolean => /^[\w.$]+:$/.test(line);
const labelName = (line: string): string => line.slice(0, -1);

interface Instr {
  op: string;
  args: string[];
}

function parse(line: string): Instr | undefined {
  const text = line.trim();
  if (!text || isLabel(text)) return undefined;
  const [op, ...rest] = text.split(/\s+/);
  return { op: op!, args: rest.join(" ").split(/,\s*/).filter(Boolean) };
}

const format = ({ op, args }: Instr): string => `    ${op} ${args.join(", ")}`.trimEnd();

const BRANCHES = new Set(["beqz", "bnez", "beq", "bne", "bgez", "bgtz", "blez", "bltz"]);
/** Saltos después de los cuales la línea siguiente solo se alcanza si tiene etiqueta. */
const UNCONDITIONAL = new Set(["j", "jr"]);
const PAIRS: Record<string, { load: string; move: string }> = {
  sw: { load: "lw", move: "move" },
  swc1: { load: "lwc1", move: "mov.s" },
};

/** Etiqueta a la que salta la instrucción, si es un salto a etiqueta. */
function jumpTarget(i: Instr): string | undefined {
  if (i.op === "j") return i.args[0];
  if (BRANCHES.has(i.op)) return i.args.at(-1);
  return undefined;
}

function retarget(i: Instr, label: string): Instr {
  return { op: i.op, args: [...i.args.slice(0, -1), label] };
}

/** Una pasada de todas las reglas; devuelve las líneas nuevas. */
function pass(lines: string[]): string[] {
  // Etiquetas cuya primera instrucción es `j X`: saltar a ellas es saltar a X.
  const forward = new Map<string, string>();
  lines.forEach((line, k) => {
    if (!isLabel(line.trim())) return;
    let n = k + 1;
    while (n < lines.length && isLabel(lines[n]!.trim())) n++;
    const next = parse(lines[n] ?? "");
    if (next?.op === "j") forward.set(labelName(line.trim()), next.args[0]!);
  });
  const resolve = (label: string): string => {
    const seen = new Set<string>();
    while (forward.has(label) && !seen.has(label)) {
      seen.add(label);
      label = forward.get(label)!;
    }
    return label;
  };

  const out: string[] = [];
  let dead = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    if (isLabel(line.trim())) {
      dead = false;
      out.push(line);
      continue;
    }
    let i = parse(line);
    if (!i) {
      out.push(line);
      continue;
    }
    // Código después de un salto incondicional y antes de una etiqueta: nunca corre.
    if (dead) continue;

    // move $x, $x
    if ((i.op === "move" || i.op === "mov.s") && i.args[0] === i.args[1]) continue;

    const target = jumpTarget(i);
    if (target) {
      // Saltos encadenados: ir directo al destino final.
      const final = resolve(target);
      if (final !== target) i = retarget(i, final);
      // Saltar a la línea siguiente no hace nada.
      let n = k + 1;
      let nextLabels = false;
      while (n < lines.length && isLabel(lines[n]!.trim())) {
        if (labelName(lines[n]!.trim()) === final) nextLabels = true;
        n++;
      }
      if (nextLabels) continue;
    }

    // sw $r, A seguido de lw $s, A: el valor ya está en $r.
    const pair = PAIRS[i.op];
    const next = parse(lines[k + 1] ?? "");
    if (pair && next?.op === pair.load && next.args[1] === i.args[1]) {
      out.push(format(i));
      if (next.args[0] !== i.args[0]) out.push(format({ op: pair.move, args: [next.args[0]!, i.args[0]!] }));
      k++;
      continue;
    }

    out.push(format(i));
    if (UNCONDITIONAL.has(i.op)) dead = true;
  }
  return out;
}

export function peephole(lines: string[]): string[] {
  let current = lines;
  for (;;) {
    const next = pass(current);
    if (next.length === current.length && next.every((l, k) => l === current[k])) return next;
    current = next;
  }
}
