// if/else, while, do-while, for con break/continue y operadores lógicos.
let n = 10;
let pares = 0;
let impares = 0;
for (let i = 1; i <= n; i = i + 1) {
  if (i % 2 == 0) {
    pares = pares + i;
  } else {
    impares = impares + i;
  }
}
print(pares);
print(impares);

let k = 0;
while (true) {
  k = k + 1;
  if (k == 3) { continue; }
  if (k > 5) { break; }
  print(k);
}

let cuenta = 3;
do {
  print(cuenta);
  cuenta = cuenta - 1;
} while (cuenta > 0);

let x = 7;
print(x > 5 && x < 10);
print(x < 5 || x == 7);
print(!(x == 7));
print(x > 5 ? "grande" : "chico");
