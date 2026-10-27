// esperado: E101 E102 E103 E104 W503
// Errores de nombres y ámbitos en un pequeño inventario.

let stock: integer = 12;
let stock: integer = 3;              // E103: redeclarado en el mismo ámbito

let proveedor: Proveedor;            // E102: la clase no existe

function reponer(cantidad: integer, cantidad: integer) {   // E104
  stock = stock + cantidad;
}

{
  let pedido: integer = 5;
  print(pedido);
}
print(pedido);                       // E101: fuera de su bloque

let pendiente: integer;
print(pendiente);                    // W503: se usa antes de asignarse
