// esperado: W503
// Variables que se leen antes de recibir un valor.

let contador: integer;
let mensaje: string;
print(contador + 1);                         // W503

mensaje = "listo";
print(mensaje);                              // válido: ya recibió un valor
