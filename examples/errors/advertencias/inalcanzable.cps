// esperado: W501
// Compila y se ejecuta, pero hay instrucciones que nunca corren.

function signo(n: integer): string {
  if (n < 0) {
    return "negativo";
    print("después del return");             // W501
  }
  return "no negativo";
}

let i: integer = 0;
while (true) {
  i = i + 1;
  if (i == 3) {
    break;
    i = 0;                                   // W501
  }
}
print(signo(-4));
print(i);
