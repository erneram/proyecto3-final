// esperado: E207 E213 E214 E501 E502 W501
// Errores de flujo de control en un semáforo.

let luz: string = "verde";
let segundos: integer = 30;

if (segundos) {                      // E207
  print("esperando");
}

while (segundos > 0) {
  segundos = segundos - 1;
  break;
  print("nunca");                    // W501
}

switch ([1, 2]) {                    // E213
  case 1: print("uno");
}

switch (luz) {
  case 1: print("¿número?");         // E214
  default: print(luz);
}

break;                               // E501
continue;                            // E502
