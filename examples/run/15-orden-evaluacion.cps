let x = 1;

function incrementar(): integer {
  x = x + 1;
  return x;
}

function mostrar(primero: integer, segundo: integer) {
  print(primero);
  print(segundo);
}

print(x + incrementar());
print(x);

x = 1;
mostrar(x, x = 2);

let valores = [10, 20];
let indice = 0;
valores[indice] = indice = 1;
print(valores[0]);
print(valores[1]);

let n = 2;
print(n + 1);
print(n + 2);
