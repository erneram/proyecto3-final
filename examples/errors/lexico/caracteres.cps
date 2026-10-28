// esperado: 5:24 5:29 6:20 8:1 9:13 10:22
// Caracteres que no pertenecen al lenguaje. Los contiguos se reportan juntos.

let precio: float = 19.99;
let descuento: float = `0.15`;
let total = precio $ descuento;
let cupon: string = "AHORRA";
#etiqueta = cupon;
print(total @@ 2);
let ok = precio > 10 ~ true;
