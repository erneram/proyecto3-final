// El recorrido no revisa el final de la lista y accede a un nodo null.
class Nodo {
  let valor: integer;
  let siguiente: Nodo;
  function constructor(valor: integer) {
    this.valor = valor;
    this.siguiente = null;
  }
}

let lista: Nodo = new Nodo(1);
lista.siguiente = new Nodo(2);
let actual: Nodo = lista;
while (true) {
  print(actual.valor);
  actual = actual.siguiente;
}
