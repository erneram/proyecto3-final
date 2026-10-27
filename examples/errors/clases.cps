// esperado: E105 E203 E301 E401 E402 E403 E404 E405 E406 E407
// Errores de clases en un zoológico.

class Animal {
  let nombre: string;
  const patas: integer = 4;
  function constructor(nombre: string) { this.nombre = nombre; }
  function sonido(veces: integer): string { return "..."; }
}

class Perro : Animal {
  function sonido(): string { return "guau"; }   // E407: cambia la firma
}

class Ave : Animal {
  let alas: integer = 2;
  function alas() { }                            // E105
}

class Dragon : Mitologico { }                    // E405
class Huevo : Gallina { }                        // E406 (ciclo Huevo -> Gallina -> Huevo)
class Gallina : Huevo { }

let firulais = new Perro("Firulais");
print(firulais.edad);                            // E402
firulais.patas = 3;                              // E203
let gato = new Animal();                         // E301
let unicornio = new Unicornio();                 // E401
let numero = 5;
print(numero.valor);                             // E403
print(this);                                     // E404
