// esperado: E301 E302 E303 E304 E305 E306 W502
// Errores de funciones en una calculadora.

function sumar(a: integer, b: integer): integer {
  return a + b;
}

print(sumar(1));                     // E301
print(sumar(1, "2"));                // E302

let base = 10;
base(3);                             // E303

function signo(n: integer): string {
  if (n > 0) {
    return "positivo";
  }
}                                    // W502: falta return en un camino

function mitad(n: integer): float {
  return;                            // E305
}

function nombre(): string {
  return 7;                          // E306
}

return 0;                            // E304
