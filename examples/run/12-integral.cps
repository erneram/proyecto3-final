// Programa que combina clases, arreglos, clausuras y excepciones.
class Pila {
  let elementos: integer[];
  let tope: integer = 0;
  function constructor(capacidad: integer) {
    let espacio: integer[] = [0, 0, 0, 0];
    this.elementos = espacio;
  }
  function apilar(v: integer) {
    this.elementos[this.tope] = v;
    this.tope = this.tope + 1;
  }
  function desapilar(): integer {
    this.tope = this.tope - 1;
    return this.elementos[this.tope];
  }
}

function aplicarATodos(xs: integer[], f: integer) {
  let i = 0;
  function transformar(v: integer): integer {
    return v * f + i;
  }
  while (i < 3) {
    xs[i] = transformar(xs[i]);
    i = i + 1;
  }
}

let pila = new Pila(4);
pila.apilar(2);
pila.apilar(6);
pila.apilar(12);
let valores = [pila.desapilar(), pila.desapilar(), pila.desapilar()];
aplicarATodos(valores, 1);
foreach (v in valores) { print(v); }

let llenos = 0;
try {
  while (true) {
    pila.apilar(llenos);
    llenos = llenos + 1;
  }
} catch (e) {
  print(llenos);
  print(e);
}
