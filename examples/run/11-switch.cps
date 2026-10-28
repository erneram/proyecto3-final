// switch con caída entre casos, break y default.
function nombreDia(d: integer): string {
  let r = "";
  switch (d) {
    case 1:
      r = "lunes";
      break;
    case 6:
    case 7:
      r = "fin de semana";
      break;
    default:
      r = "entre semana";
  }
  return r;
}

print(nombreDia(1));
print(nombreDia(3));
print(nombreDia(7));

let color = "verde";
switch (color) {
  case "rojo":
    print("alto");
  case "verde":
    print("siga");
  case "amarillo":
    print("precaución");
    break;
  default:
    print("desconocido");
}
