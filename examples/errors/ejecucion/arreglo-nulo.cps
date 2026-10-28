// Una búsqueda que no encuentra nada devuelve null y se indexa sin revisarlo.
function buscar(nombre: string): integer[] {
  if (nombre == "ana") {
    return [9, 8];
  }
  return null;
}

print(buscar("ana")[0]);
let notas: integer[] = buscar("luis");
print(notas[0]);
print("no se imprime");
