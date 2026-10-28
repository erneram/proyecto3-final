// Funciones anidadas que capturan variables de la función que las contiene.
function crearContador(inicio: integer) {
  let valor = inicio;
  function siguiente(): integer {
    valor = valor + 1;
    return valor;
  }
  return siguiente;
}

let a = crearContador(0);
let b = crearContador(100);
print(a());
print(a());
print(b());
print(a());

function acumular(): float {
  let total = 0.5;
  function sumar(x: float) {
    total = total + x;
  }
  sumar(1);
  sumar(2.25);
  return total;
}
print(acumular());

function exterior(): integer {
  let base = 10;
  function medio(): integer {
    function interior(n: integer): integer {
      if (n == 0) { return base; }
      return interior(n - 1) + 1;
    }
    return interior(3);
  }
  base = 20;
  return medio();
}
print(exterior());
