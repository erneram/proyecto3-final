// Clases con constructor, campos y métodos.
class Punto {
  let x: float;
  let y: float;
  function constructor(x: float, y: float) {
    this.x = x;
    this.y = y;
  }
  function trasladar(dx: float, dy: float) {
    this.x = this.x + dx;
    this.y = this.y + dy;
  }
  function normaCuadrada(): float {
    return this.x * this.x + this.y * this.y;
  }
}

class Cuenta {
  let saldo: integer = 0;
  let activa: boolean = true;
  function depositar(monto: integer): integer {
    this.saldo = this.saldo + monto;
    return this.saldo;
  }
}

let p = new Punto(3, 4);
print(p.normaCuadrada());
p.trasladar(1, -1);
print(p.x);
print(p.y);

let c = new Cuenta();
c.depositar(50);
print(c.depositar(25));
print(c.activa);
