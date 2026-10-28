// Un promedio sin elementos divide entre cero y detiene el programa (código de salida 1).
function promedio(xs: integer[], n: integer): integer {
  let suma: integer = 0;
  for (let i: integer = 0; i < n; i = i + 1) {
    suma = suma + xs[i];
  }
  return suma / n;
}

let notas: integer[] = [8, 6, 10];
print(promedio(notas, 3));
print(promedio(notas, 0));
print("no se imprime");
