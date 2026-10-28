// esperado: E209 E210 E211 E212
// Errores con arreglos en un registro de notas.

let notas: integer[] = [90, 85, 70];
let mezcla = [1, "dos", 3];          // E212
print(notas[1.5]);                   // E209
let promedio: integer = 80;
print(promedio[0]);                  // E210
foreach (n in promedio) {            // E211
  print(n);
}
