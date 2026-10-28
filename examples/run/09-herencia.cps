// Herencia, constructor heredado y despacho dinámico.
class Figura {
  let nombre: string;
  function constructor(nombre: string) {
    this.nombre = nombre;
  }
  function area(): float {
    return 0;
  }
  function describir() {
    print(this.nombre);
    print(this.area());
  }
}

class Rectangulo : Figura {
  let ancho: float = 2;
  let alto: float = 3;
  function area(): float {
    return this.ancho * this.alto;
  }
}

class Cuadrado : Rectangulo {
  function area(): float {
    return this.ancho * this.ancho;
  }
}

let figuras: Figura[] = [new Figura("figura"), new Rectangulo("rectangulo"), new Cuadrado("cuadrado")];
foreach (f in figuras) { f.describir(); }
