// esperado: W502
// Funciones que no devuelven un valor en todos los caminos.

function calificacion(nota: integer): string {     // W502: falta el caso nota < 60
  if (nota >= 90) {
    return "excelente";
  }
  if (nota >= 60) {
    return "aprobado";
  }
}

function maximo(xs: integer[]): integer {          // W502: el return está dentro del ciclo
  foreach (x in xs) {
    return x;
  }
}

print(calificacion(95));
print(maximo([7, 3, 9]));
