import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Simulador MARS 4.5 que ejecuta el ensamblador generado. */
export const MARS_URL = "https://github.com/dpetersanderson/MARS/releases/download/v.4.5.1/Mars4_5.jar";
export const MARS_SHA256 = "ac340b676ba2b62246b9df77e62f81ad4447bcfd329ab539716bcd09950b7096";
export const MARS_JAR = resolve(dirname(fileURLToPath(import.meta.url)), "../tools/Mars4_5.jar");
/** Límite de instrucciones por ejecución, para que un bucle infinito no cuelgue las pruebas. */
export const MAX_STEPS = 1_000_000;

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

const javaWorks = (): boolean => spawnSync("java", ["-version"], { stdio: "ignore" }).status === 0;

/** MARS se puede usar: el jar está, coincide con el publicado y hay Java. */
export function marsAvailable(): boolean {
  return existsSync(MARS_JAR) && javaWorks();
}

/** Descarga el jar si falta (o si no coincide) y verifica su sha256. */
export async function setupMars(): Promise<void> {
  if (existsSync(MARS_JAR) && sha256(readFileSync(MARS_JAR)) === MARS_SHA256) return;
  const response = await fetch(MARS_URL);
  if (!response.ok) throw new Error(`No se pudo descargar MARS: HTTP ${response.status}`);
  const jar = Buffer.from(await response.arrayBuffer());
  const hash = sha256(jar);
  if (hash !== MARS_SHA256) throw new Error(`El jar descargado no coincide (sha256 ${hash}).`);
  mkdirSync(dirname(MARS_JAR), { recursive: true });
  writeFileSync(MARS_JAR, jar);
}

export interface MarsRun {
  stdout: string;
  stderr: string;
  /** 0 si terminó bien; 1 si falló al ensamblar o en la simulación. */
  status: number;
  /** Se acabaron las instrucciones permitidas. */
  timedOut: boolean;
}

const STEP_LIMIT_NOTICE = /\n?Program terminated when maximum step limit \d+ reached\.?\s*$/;

/** Ensambla y simula un archivo `.asm` sin interfaz gráfica. */
export function runMarsFile(path: string): MarsRun {
  // nc: sin aviso de copyright; ae1/se1: código de salida 1 ante errores de ensamblado o simulación.
  const r = spawnSync("java", ["-jar", MARS_JAR, "nc", "ae1", "se1", String(MAX_STEPS), path], { encoding: "utf8" });
  if (r.error) throw r.error;
  const timedOut = STEP_LIMIT_NOTICE.test(r.stdout);
  // MARS agrega un salto de línea propio al terminar; no es salida del programa.
  const stdout = timedOut ? r.stdout.replace(STEP_LIMIT_NOTICE, "") : r.stdout.replace(/\n$/, "");
  return { stdout, stderr: r.stderr, status: r.status ?? 1, timedOut };
}

export function runMars(asm: string): MarsRun {
  const dir = mkdtempSync(join(tmpdir(), "compis-"));
  try {
    const path = join(dir, "programa.asm");
    writeFileSync(path, asm);
    return runMarsFile(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const USAGE = "Uso: tsx scripts/mars.ts setup | run <archivo.asm>";

async function main([command, file]: string[]): Promise<number> {
  if (command === "setup") {
    await setupMars();
    console.log(`MARS listo en ${MARS_JAR}`);
    return 0;
  }
  if (command === "run" && file) {
    if (!marsAvailable()) {
      console.error("MARS no está disponible: corre `npm run mars:setup` y verifica que Java esté instalado.");
      return 1;
    }
    const r = runMarsFile(file);
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    if (r.timedOut) console.error(`\nSe alcanzó el límite de ${MAX_STEPS} instrucciones.`);
    return r.status;
  }
  console.error(USAGE);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e: Error) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
}
