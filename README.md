# Compiscript

Compilador de Compiscript escrito en TypeScript. Analiza el programa fuente, valida su semántica, genera código de tres direcciones y produce ensamblador MIPS32 que se ejecuta en MARS 4.5. Incluye una CLI y una IDE web con compilación en vivo.

```
function factorial(n: integer): integer {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
}

print(factorial(5));   // 120
```

El lenguaje tiene variables y constantes con tipos (`integer`, `float`, `string`, `boolean`, arreglos y clases), funciones anidadas con clausuras, clases con herencia y despacho dinámico, `if`, `while`, `do-while`, `for`, `foreach`, `switch` y `try/catch`. Los errores en tiempo de ejecución (índice fuera de rango, arreglo o referencia nula, división entre cero) se pueden capturar. `examples/lang/sintaxis.cps` recorre toda la sintaxis.

## Requisitos

- Node.js 22.12 o superior
- Java 17 o superior (solo para ejecutar el ensamblador en MARS)

## Instalación

```bash
npm install          # también genera el parser desde grammar/Compis.g4
npm run mars:setup   # descarga Mars4_5.jar v4.5.1 a tools/ y verifica su sha256
```

## CLI

```bash
npm run compis -- <comando> <archivo.cps> [opciones]
```

| Comando | Qué hace |
|---|---|
| `tokens` | Lista los tokens reconocidos con su posición |
| `tree` | Muestra el árbol sintáctico abstracto |
| `check` | Valida la semántica y muestra la tabla de símbolos |
| `tac` | Muestra el código de tres direcciones; con `--cfg`, agrupado en bloques básicos |
| `asm` | Genera ensamblador MIPS; con `-o salida.asm`, lo escribe en un archivo |
| `run` | Compila y ejecuta el programa en MARS |

```bash
npm run compis -- run examples/run/05-recursion.cps
npm run compis -- tac --cfg examples/run/06-clausuras.cps
npm run compis -- asm examples/run/12-integral.cps -o integral.asm
npm run mars -- integral.asm        # ejecuta un .asm ya generado
```

Los diagnósticos se reportan como `archivo:línea:columna: severidad fase [código]: mensaje`, en español:

```
ejemplo.cps:1:18: error semántico [E201]: 'x' es de tipo 'integer' y no puede iniciar con un valor 'string'.
ejemplo.cps:2:7: error semántico [E101]: 'y' no está declarado en este punto.
```

El comando termina con código 1 si hubo errores. Cada fase corre solo si la anterior terminó sin errores: sin errores léxicos ni sintácticos no hay análisis semántico, y sin errores semánticos no hay código intermedio ni MIPS.

## IDE

```bash
npm install --prefix web
npm run dev          # servidor de desarrollo de Vite
npm run build        # compila la IDE en web/dist
```

La IDE usa React 19, Tailwind 4 y componentes de [The GridCN](https://github.com/educlopez/thegridcn-ui) con el tema Tron (primario `#00D4FF`). El editor es CodeMirror 6 con resaltado de Compiscript. El programa se compila en un Web Worker mientras se escribe, y los errores aparecen subrayados en el editor y en el panel de problemas. Si compila, el worker lo ejecuta con el intérprete del código intermedio, que imprime lo mismo que MARS. La consola bajo el editor muestra la salida y el código de salida; un error en ejecución sin capturar (división entre cero, arreglo nulo…) también aparece en el panel de problemas. Los demás paneles muestran tokens, AST, ámbitos, tabla de símbolos, código de tres direcciones, bloques básicos y MIPS. El divisor entre editor y resultados se arrastra (o se mueve con las flechas) para cambiar sus anchos. `Abrir .cps` carga un programa desde un archivo, el botón `.asm` descarga el ensamblador, y `Ejemplos` (o `⌘K` / `Ctrl+K`) abre un panel lateral con los ejemplos agrupados por tipo y un filtro.

## Ejemplos

`examples/run/` contiene programas ejecutables. Cada `NN-nombre.cps` tiene junto su salida esperada en MARS, `NN-nombre.out`:

| Ejemplo | Cubre |
|---|---|
| `01-aritmetica` | enteros, flotantes, promoción de integer a float |
| `02-cadenas` | concatenación, comparación, secuencias de escape |
| `03-control` | `if/else`, `while`, `do-while`, `for`, `break`/`continue`, operadores lógicos |
| `04-funciones` | tipos, argumentos promovidos, más de cuatro parámetros |
| `05-recursion` | recursión directa y mutua |
| `06-clausuras` | funciones anidadas que capturan variables |
| `07-arreglos` | arreglos, matrices, `foreach`, paso por referencia |
| `08-clases` | constructor, campos, métodos |
| `09-herencia` | herencia, constructor heredado, despacho dinámico |
| `10-excepciones` | `try/catch` con errores en tiempo de ejecución, también dentro de funciones |
| `11-switch` | caída entre casos, `break`, `default` |
| `12-integral` | clases, arreglos, clausuras y excepciones juntos |
| `13-error-sin-capturar` | un error sin `try` imprime su mensaje y termina con código 1 |
| `14-flotantes` | conversión a float en llamadas, campos, arreglos, clausuras y retornos |

`examples/errors/` contiene programas con errores, agrupados por fase. La primera línea de cada uno declara lo que debe reportar el compilador:

| Carpeta | Contiene | `// esperado:` |
|---|---|---|
| `lexico/` | caracteres desconocidos, cadenas sin cerrar, escapes inválidos | posiciones `línea:columna` |
| `sintaxis/` | `;`, llaves y paréntesis faltantes o de más, expresiones incompletas | posiciones `línea:columna` |
| `semantica/` | tipos, nombres, ámbitos, asignaciones, funciones, clases, arreglos y flujo | códigos (`E201 E202 …`) |
| `advertencias/` | código inalcanzable, retornos faltantes, variables sin valor; compilan y se ejecutan | códigos (`W501 …`) |
| `ejecucion/` | división entre cero, índice fuera de rango, arreglo y referencia nulos sin `try` | salida esperada en `.out` |

## Pruebas

```bash
npm run check                 # tipos de TypeScript
npm test                      # todas las pruebas (node --test)
REQUIRE_MARS=1 npm test       # falla si MARS no está disponible en vez de omitir
```

Las pruebas cubren el lexer y el parser, el checker con los ejemplos de error, la traducción a código intermedio (con un intérprete del IR que compara salidas), el asignador de registros, el peephole y la ejecución en MARS. Las pruebas golden ejecutan cada `examples/run/*.cps` y `examples/errors/ejecucion/*.cps` en MARS y comparan su salida con el `.out`. Sin Java o sin el jar, las pruebas de MARS se omiten.

La CI (`.github/workflows/ci.yml`) corre con Node 22 y Java 17. Descarga MARS, revisa los tipos, corre todas las pruebas con `REQUIRE_MARS=1` y compila la IDE.

## Estructura

```
grammar/Compis.g4     gramática ANTLR
src/frontend/         parser, errores en español, AST
src/check/            tipos, ámbitos, catálogo de diagnósticos, checker
src/ir/               ubicación de variables, código de tres direcciones, CFG
src/backend/          selección de instrucciones, registros, runtime, peephole
src/compile.ts        pipeline con compuerta entre fases
src/cli.ts            CLI
scripts/mars.ts       descarga y ejecución de MARS
web/                  IDE
test/                 pruebas
examples/             programas de ejemplo
docs/arquitectura.md  diseño del compilador
```

El diseño de cada etapa (representación intermedia, disposición de memoria, convención de llamada, clausuras, objetos y excepciones) está en [docs/arquitectura.md](docs/arquitectura.md).
