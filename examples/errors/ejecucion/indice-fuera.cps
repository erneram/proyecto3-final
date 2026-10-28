// El ciclo usa <= en vez de <: el último índice válido es 2, no 3.
let colores: string[] = ["rojo", "verde", "azul"];
for (let i: integer = 0; i <= 3; i = i + 1) {
  print(colores[i]);
}
print("no se imprime");
