// esperado: E102 E201 E207 E209 E302 E402
// Un inventario con errores de varias categorías.

class Producto {
  let nombre: string;
  let existencias: integer;
  function constructor(nombre: string, existencias: integer) {
    this.nombre = nombre;
    this.existencias = existencias;
  }
}

function reponer(p: Producto, cantidad: integer) {
  p.existencias = p.existencias + cantidad;
}

let catalogo: Producto[] = [new Producto("tornillo", 40), new Producto("tuerca", 0)];
let proveedor: Proveedor = null;                    // E102
let disponible: boolean = catalogo[0].existencias;  // E201
if (catalogo[1].existencias) {                      // E207
  print("hay tuercas");
}
let primero = catalogo["0"];                        // E209
reponer(catalogo[1], "diez");                       // E302
print(catalogo[0].precio);                          // E402
