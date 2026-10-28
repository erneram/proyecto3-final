// esperado: E101 E103
// Cada bloque y cada función abre su propio ámbito.

let total: integer = 0;
for (let i: integer = 0; i < 3; i = i + 1) {
  let parcial: integer = i * 2;
  total = total + parcial;
}
print(parcial);                              // E101: solo existe dentro del for
print(i);                                    // E101

function contador() {
  let cuenta: integer = 0;
  let cuenta: integer = 1;                   // E103
  function sumar() {
    cuenta = cuenta + 1;                     // válido: la clausura la captura
  }
  sumar();
}
print(cuenta);                               // E101

{
  let total: string = "sombra";              // válido: oculta la global en este bloque
  print(total);
}
