// try/catch con errores en tiempo de ejecución, también dentro de funciones.
function leer(xs: integer[], i: integer): integer {
  return xs[i];
}

function dividir(a: integer, b: integer): integer {
  return a / b;
}

let datos = [1, 2, 3];
try {
  print(leer(datos, 1));
  print(leer(datos, 5));
  print("no llega");
} catch (e) {
  print("error: " + e);
}

try {
  print(dividir(10, 0));
} catch (e) {
  print(e);
}

let vacio: integer[] = null;
try {
  try {
    print(vacio[0]);
  } catch (interno) {
    print("interno: " + interno);
    print(dividir(1, 0));
  }
} catch (externo) {
  print("externo: " + externo);
}
print("fin");
