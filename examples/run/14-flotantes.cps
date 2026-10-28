// Conversión de integer a float en llamadas, campos, arreglos, clausuras y retornos.
class Medida {
  let valor: float;
  let veces: integer = 2;
  function constructor(v: float) { this.valor = v; }
  function escalar(k: float): float { return this.valor * k; }
}

function promedio(a: float, b: integer, c: float, d: integer, e: float): float {
  return (a + b + c + d + e) / 5;
}

function desplazar(base: float) {
  function mas(k: integer): float { return base + k; }
  return mas;
}

function primeros(): float[] {
  return [1, 2.5];
}

let m = new Medida(3);
print(m.escalar(2));
print(m.valor + m.veces);
m.valor = m.veces;
print(m.valor);

let tabla: float[] = [1, 2, 3];
tabla[1] = m.veces;
print(tabla[1] + tabla[2]);
let rejilla: float[][] = [[1], [2, 3]];
print(rejilla[1][0] / 4);
print(primeros()[0]);

print(promedio(1, 2, 3, 4, 5));
let mover = desplazar(1.5);
print(mover(2));
print(m.veces > 1 ? 7 : 0.5);

print(1 / 3.0);
print(0.1 + 0.2);
print(100000000.0);
print(0.001);
print(-0.5 * 3);
