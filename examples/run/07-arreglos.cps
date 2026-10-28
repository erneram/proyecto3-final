// Arreglos, matrices, foreach y paso por referencia.
function sumar(xs: integer[]): integer {
  let total = 0;
  foreach (x in xs) { total = total + x; }
  return total;
}

function duplicar(xs: integer[]) {
  let i = 0;
  while (i < 3) {
    xs[i] = xs[i] * 2;
    i = i + 1;
  }
}

let numeros = [4, 8, 15];
duplicar(numeros);
print(sumar(numeros));

let matriz = [[1, 2, 3], [4, 5, 6]];
let traza = matriz[0][0] + matriz[1][1];
print(traza);
matriz[1][2] = traza * 10;
print(matriz[1][2]);

let precios: float[] = [1, 2.5, 3.25];
foreach (p in precios) { print(p); }

let palabras = ["uno", "dos", "tres"];
let frase = "";
foreach (w in palabras) { frase = frase + w + " "; }
print(frase);
