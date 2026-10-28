// Funciones con tipos, argumentos promovidos y muchos parámetros.
function area(base: float, altura: float): float {
  return base * altura / 2;
}

function maximo(a: integer, b: integer): integer {
  if (a > b) { return a; }
  return b;
}

function ponderado(a: integer, b: integer, c: integer, d: integer, e: integer, f: integer): integer {
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f;
}

function saludar(quien: string) {
  print("hola " + quien);
}

print(area(3, 4));
print(maximo(maximo(3, 9), 4));
print(ponderado(1, 1, 1, 1, 1, 2));
saludar("mundo");
