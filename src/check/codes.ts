/**
 * Catálogo de diagnósticos semánticos.
 * Prefijo E = error, W = advertencia. Centena: 1 nombres y ámbitos, 2 tipos,
 * 3 funciones, 4 clases, 5 flujo de control.
 */

type Entry<A extends unknown[]> = {
  code: string;
  title: string;
  message: (...args: A) => string;
};

/** Contracciones obligatorias: los datos pueden empezar con "el" ("de el" → "del", "a el" → "al"). */
const contract = (text: string): string => text.replace(/\bde el /g, "del ").replace(/\ba el /g, "al ");

const entry = <A extends unknown[]>(code: string, title: string, message: (...args: A) => string): Entry<A> => ({
  code,
  title,
  message: (...args) => contract(message(...args)),
});

export const CODES = {
  // Nombres y ámbitos
  undeclared: entry("E101", "Nombre no declarado", (name: string) => `'${name}' no está declarado en este punto.`),
  unknownType: entry("E102", "Tipo inexistente", (name: string) => `El tipo '${name}' no existe; declara la clase o corrige el nombre.`),
  redeclared: entry("E103", "Redeclaración", (name: string, line: number) => `'${name}' ya está declarado en este ámbito (línea ${line}).`),
  duplicateParam: entry("E104", "Parámetro repetido", (name: string) => `El parámetro '${name}' aparece más de una vez.`),
  duplicateMember: entry("E105", "Miembro repetido", (cls: string, name: string) => `La clase '${cls}' ya tiene un miembro llamado '${name}'.`),

  // Tipos
  badInit: entry("E201", "Inicialización incompatible", (name: string, declared: string, value: string) =>
    `'${name}' es de tipo '${declared}' y no puede iniciar con un valor '${value}'.`),
  badAssign: entry("E202", "Asignación incompatible", (target: string, value: string) =>
    `No se puede asignar un valor '${value}' a un destino de tipo '${target}'.`),
  immutable: entry("E203", "Destino inmutable", (name: string, what: string) => `'${name}' no se puede modificar: es ${what}.`),
  invalidTarget: entry("E204", "Destino inválido", (what: string) => `No se puede asignar a ${what}.`),
  badOperands: entry("E205", "Operandos inválidos", (op: string, left: string, right: string) =>
    `El operador '${op}' no admite operandos '${left}' y '${right}'.`),
  badOperand: entry("E206", "Operando inválido", (op: string, operand: string) => `El operador '${op}' no admite un operando '${operand}'.`),
  notBoolean: entry("E207", "Condición no booleana", (where: string, found: string) => `La condición de ${where} debe ser boolean; se recibió '${found}'.`),
  ternaryMismatch: entry("E208", "Ramas incompatibles", (a: string, b: string) => `Las ramas del operador ternario no comparten tipo: '${a}' y '${b}'.`),
  indexType: entry("E209", "Índice no entero", (found: string) => `Un índice debe ser integer; se recibió '${found}'.`),
  notIndexable: entry("E210", "Valor no indexable", (found: string) => `No se puede indexar un valor '${found}'.`),
  notIterable: entry("E211", "foreach sin arreglo", (found: string) => `foreach recorre arreglos; se recibió '${found}'.`),
  mixedArray: entry("E212", "Arreglo heterogéneo", (a: string, b: string) => `Los elementos del arreglo no comparten tipo ('${a}' y '${b}').`),
  switchType: entry("E213", "Valor de switch inválido", (found: string) =>
    `El valor de switch debe ser integer, float, string o boolean; se recibió '${found}'.`),
  caseType: entry("E214", "Caso incompatible", (found: string, subject: string) =>
    `Un caso '${found}' no se puede comparar con el valor '${subject}' del switch.`),
  voidValue: entry("E215", "Valor ausente", (what: string) => `${what} no produce ningún valor.`),

  // Funciones
  argCount: entry("E301", "Cantidad de argumentos", (callee: string, expected: number, given: number) =>
    `${callee[0].toUpperCase()}${callee.slice(1)} espera ${expected} argumento(s), pero se pasaron ${given}.`),
  argType: entry("E302", "Argumento incompatible", (index: number, callee: string, expected: string, found: string) =>
    `El argumento ${index} de ${callee} debe ser '${expected}'; se recibió '${found}'.`),
  notCallable: entry("E303", "Valor no invocable", (found: string) => `Un valor '${found}' no se puede invocar.`),
  returnOutside: entry("E304", "return fuera de función", () => "return solo puede usarse dentro de una función."),
  returnMissingValue: entry("E305", "return sin valor", (fn: string, type: string) => `'${fn}' debe devolver un valor '${type}'.`),
  returnType: entry("E306", "Retorno incompatible", (fn: string, type: string, found: string) =>
    `'${fn}' debe devolver '${type}', pero aquí devuelve '${found}'.`),

  // Clases
  notAClass: entry("E401", "No es una clase", (name: string) => `'${name}' no es una clase.`),
  noMember: entry("E402", "Miembro inexistente", (cls: string, name: string) => `La clase '${cls}' no tiene un miembro '${name}'.`),
  memberOnNonObject: entry("E403", "Acceso sobre no-objeto", (name: string, found: string) =>
    `No se puede acceder a '.${name}' sobre un valor '${found}'.`),
  thisOutside: entry("E404", "this fuera de método", () => "'this' solo existe dentro de los métodos de una clase."),
  unknownParent: entry("E405", "Clase padre inexistente", (cls: string, parent: string) =>
    `La clase '${cls}' hereda de '${parent}', que no está declarada.`),
  cyclicInheritance: entry("E406", "Herencia circular", (cls: string) => `La herencia de '${cls}' forma un ciclo.`),
  overrideMismatch: entry("E407", "Redefinición incompatible", (method: string, parent: string) =>
    `El método '${method}' redefine al de '${parent}' con una firma distinta.`),

  // Flujo de control
  breakOutside: entry("E501", "break fuera de ciclo", () => "break solo puede usarse dentro de un ciclo o un switch."),
  continueOutside: entry("E502", "continue fuera de ciclo", () => "continue solo puede usarse dentro de un ciclo."),
  unreachable: entry("W501", "Código inalcanzable", () => "Esta instrucción nunca se ejecuta."),
  missingReturn: entry("W502", "Retorno no garantizado", (fn: string, type: string) =>
    `'${fn}' declara devolver '${type}', pero no todos sus caminos terminan en return.`),
  useBeforeInit: entry("W503", "Uso antes de asignar", (name: string) => `'${name}' se usa antes de recibir un valor.`),
};

export type CodeKey = keyof typeof CODES;
export type CodeArgs<K extends CodeKey> = Parameters<(typeof CODES)[K]["message"]>;

export const severityOf = (code: string): "error" | "warning" => (code.startsWith("W") ? "warning" : "error");

/** Catálogo en forma de tabla, para la documentación y el IDE. */
export const catalog = (): { code: string; title: string; severity: "error" | "warning" }[] =>
  Object.values(CODES)
    .map(({ code, title }) => ({ code, title, severity: severityOf(code) }))
    .sort((a, b) => a.code.slice(1).localeCompare(b.code.slice(1)) || a.code.localeCompare(b.code));
