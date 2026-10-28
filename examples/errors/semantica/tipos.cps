// esperado: E201 E202 E205 E206 E208 E215
// Errores de tipos en el cálculo de una factura.

let subtotal: float = 120.5;
let cliente: string = 42;                    // E201
let cantidad: integer = 3;
cantidad = "tres";                           // E202

let total = subtotal + "impuesto";           // E205
let resto = subtotal % 2;                    // E205
let negado = -"precio";                      // E206
let valido = !cantidad;                      // E206

let etiqueta = cantidad > 2 ? "mayorista" : 0;   // E208

function registrar() {
  print("registrado");
}
let resultado = registrar();                 // E215
