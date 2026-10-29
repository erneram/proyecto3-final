// Recorrido por toda la sintaxis de Compiscript.
const LIMITE: integer = 3;
let saludo: string = "hola\tmundo";
var activo = true;
let tasas: float[] = [1.5, 2.25];
let matriz: integer[][] = [[1, 2], [3, 4]];

/* Clases con herencia */
class Figura {
  let nombre: string;
  function constructor(nombre: string) { this.nombre = nombre; }
  function area(): float { return 0.0; }
}

class Rectangulo : Figura {
  let ancho: float;
  let alto: float;
  function constructor(ancho: float, alto: float) {
    this.nombre = "rectangulo";
    this.ancho = ancho;
    this.alto = alto;
  }
  function area(): float { return this.ancho * this.alto; }
}

function contador(inicio: integer) {
  let actual: integer = inicio;
  function siguiente(): integer {
    actual = actual + 1;
    return actual;
  }
  return siguiente;
}

let figura: Figura = new Rectangulo(2.0, 3.5);
print(figura.area());
let paso = contador(10);
print(paso());

let suma: integer = 0;
for (let i: integer = 0; i < LIMITE; i = i + 1) {
  if (i % 2 == 0) { suma = suma + i; } else { continue; }
}
while (suma < 10 && activo) { suma = suma + matriz[1][0]; }
do { suma = suma - 1; } while (!(suma <= 5) || false);
if (suma > 100) print("grande"); else if (suma > 5) print("mediano"); else print("chico");
foreach (t in tasas) { print(t); }
switch (suma) {
  case 5: print("cinco");
  case 6: print("seis"); break;
  default: print("otro");
}
try { print(matriz[5][0]); } catch (err) { print(err); }
let signo: string = suma > 0 ? "positivo" : "no positivo";
print(saludo + " " + signo);
