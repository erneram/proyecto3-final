// esperado: E202 E203 E204
// Asignaciones a constantes, métodos y valores que no son destinos.

const IVA: float = 0.12;
IVA = 0.15;                                  // E203

class Cuenta {
  const banco: string = "Central";
  let saldo: float = 0.0;
  function depositar(monto: float) {
    this.saldo = this.saldo + monto;
  }
}

let cuenta: Cuenta = new Cuenta();
cuenta.banco = "Norte";                      // E203
cuenta.depositar = 5;                        // E203
cuenta.saldo = "mucho";                      // E202

function saldoInicial(): float {
  return 100.0;
}
saldoInicial() = 50.0;                       // E204
new Cuenta() = cuenta;                       // E204
