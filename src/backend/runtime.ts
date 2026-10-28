/**
 * Rutinas de apoyo escritas a mano. Solo usan $a0–$a3, $v0, $v1, $t8 y $t9:
 * los registros que reparte el asignador sobreviven a una llamada a ellas.
 */

/** Mensajes de los errores en tiempo de ejecución; `catch` recibe el mismo texto. */
export const RUNTIME_ERRORS = {
  bounds: "Runtime error: array index out of bounds",
  nullArray: "Runtime error: null array",
  nullObject: "Runtime error: null reference",
  divByZero: "Runtime error: division by zero",
} as const;

export type RuntimeError = keyof typeof RUNTIME_ERRORS;

export type Routine = "concat" | "streq" | "raise" | `error_${RuntimeError}`;

export const routineLabel = (r: Routine): string => `__${r}`;

/** Tope de la pila de manejadores de `try` (0 si no hay ninguno activo). */
export const HANDLER_TOP = "__handler";

/**
 * Registro de un `try` activo, en el marco de la función que lo ejecuta:
 * manejador anterior, dirección del `catch` y el $sp/$fp que hay que restaurar.
 */
export const HANDLER_WORDS = 4;

const CODE: Record<"concat" | "streq" | "raise", string> = {
  // $v0 = cadena nueva con $a0 seguida de $a1.
  concat: `
__concat:
    li $t8, 0
    move $a2, $a0
__concat_len1:
    lb $t9, 0($a2)
    beqz $t9, __concat_len2_start
    addiu $a2, $a2, 1
    addiu $t8, $t8, 1
    j __concat_len1
__concat_len2_start:
    move $a2, $a1
__concat_len2:
    lb $t9, 0($a2)
    beqz $t9, __concat_alloc
    addiu $a2, $a2, 1
    addiu $t8, $t8, 1
    j __concat_len2
__concat_alloc:
    move $a2, $a0
    addiu $a0, $t8, 1
    li $v0, 9
    syscall
    move $v1, $v0
__concat_copy1:
    lb $t9, 0($a2)
    beqz $t9, __concat_copy2
    sb $t9, 0($v1)
    addiu $a2, $a2, 1
    addiu $v1, $v1, 1
    j __concat_copy1
__concat_copy2:
    lb $t9, 0($a1)
    sb $t9, 0($v1)
    beqz $t9, __concat_done
    addiu $a1, $a1, 1
    addiu $v1, $v1, 1
    j __concat_copy2
__concat_done:
    jr $ra`,
  // $v0 = 1 si las cadenas $a0 y $a1 tienen los mismos caracteres.
  streq: `
__streq:
    lb $t8, 0($a0)
    lb $t9, 0($a1)
    bne $t8, $t9, __streq_no
    beqz $t8, __streq_yes
    addiu $a0, $a0, 1
    addiu $a1, $a1, 1
    j __streq
__streq_yes:
    li $v0, 1
    jr $ra
__streq_no:
    li $v0, 0
    jr $ra`,
  // Error con mensaje en $a0: salta al catch más reciente (con el mensaje en $v0)
  // o, si no hay, imprime el mensaje y termina con código 1.
  raise: `
__raise:
    lw $t8, ${HANDLER_TOP}
    beqz $t8, __raise_uncaught
    lw $t9, 0($t8)
    sw $t9, ${HANDLER_TOP}
    lw $sp, 8($t8)
    lw $fp, 12($t8)
    move $v0, $a0
    lw $t9, 4($t8)
    jr $t9
__raise_uncaught:
    li $v0, 4
    syscall
    li $a0, 10
    li $v0, 11
    syscall
    li $a0, 1
    li $v0, 17
    syscall`,
};

/**
 * Código de las rutinas pedidas (y de las que estas necesitan). `message` da la
 * etiqueta de cada mensaje en el segmento de datos.
 */
export function runtimeCode(uses: Set<Routine>, message: (text: string) => string): string[] {
  const lines: string[] = [];
  for (const [name, text] of Object.entries(RUNTIME_ERRORS) as [RuntimeError, string][]) {
    if (!uses.has(`error_${name}`)) continue;
    uses.add("raise");
    lines.push("", `__error_${name}:`, `    la $a0, ${message(text)}`, "    j __raise");
  }
  for (const r of ["concat", "streq", "raise"] as const) if (uses.has(r)) lines.push(CODE[r]);
  return lines;
}
