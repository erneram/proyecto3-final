# Arquitectura del compilador de Compiscript

El compilador traduce un programa Compiscript (`.cps`) a ensamblador MIPS32 que
corre en MARS 4.5. Está escrito en TypeScript y se usa de tres formas: como
biblioteca (`compile()` en `src/compile.ts`), desde la CLI (`src/cli.ts`) y desde
la IDE web (`web/`), que ejecuta el mismo código dentro de un Web Worker.

```
fuente .cps
  │  src/frontend/parse.ts      ANTLR (antlr4ng): tokens + árbol de análisis, errores en español
  ▼
árbol de análisis (CST)
  │  src/frontend/build.ts      CST → AST tipado (uniones discriminadas por `kind`)
  ▼
AST
  │  src/check/checker.ts       ámbitos, símbolos, tipos, capturas, diagnósticos
  ▼
AST verificado + CheckResult
  │  src/ir/frames.ts           dónde vive cada variable (pila, datos, entorno en heap)
  │  src/ir/lower.ts            AST → código de tres direcciones, una IrFunction por función
  ▼
IrModule (cuádruplos)
  │  src/ir/cfg.ts              bloques básicos y grafo de flujo
  │  src/backend/isel.ts        selección de instrucciones por bloque
  │  src/backend/regs.ts        asignación de registros (getReg)
  │  src/backend/runtime.ts     rutinas de apoyo (cadenas, errores, excepciones)
  │  src/backend/peephole.ts    mejoras locales sobre el texto
  ▼
ensamblador MIPS (.asm) → MARS 4.5
```

## Etapas y compuerta entre fases

`compile(source, upTo)` corre las etapas `parse`, `check`, `ir` y `asm` en orden
y se detiene en la primera que produzca errores (las advertencias no detienen):

| Etapa | Corre si | Si hay errores |
|---|---|---|
| léxico + sintáctico | siempre | no se revisa la semántica |
| semántico | 0 errores léxicos y sintácticos | no se genera código intermedio |
| código intermedio y MIPS | 0 errores semánticos | — |

El resultado (`Compilation`) junta los tokens, todos los diagnósticos en orden de
etapa, el AST, el resultado del chequeo, el `IrModule`, el ensamblador y, si la
compilación se detuvo, la etapa y el motivo. La CLI y la IDE solo presentan ese
objeto; no repiten lógica del compilador.

Cada diagnóstico (`src/diagnostic.ts`) tiene fase, severidad, línea y columna
(desde 1), mensaje en español y, para los semánticos, un código. Cada fase
reporta como máximo 100 diagnósticos; el último avisa del recorte.

## Frontend

**Gramática.** `grammar/Compis.g4` define el lenguaje. El parser se genera con
`antlr-ng` (`npm run gen`, que también corre en `npm install`) dentro de
`src/frontend/gen/`, que no se versiona. El runtime es `antlr4ng`, puro
TypeScript, así que no hace falta Java para compilar.

**Errores.** `src/frontend/errors.ts` reemplaza los listeners de ANTLR. Los
mensajes nunca muestran el texto original en inglés: se traducen según el caso
(falta un token, sobra un token, alternativa inválida). Un `;` faltante se ubica
justo después del token anterior. Los errores léxicos consecutivos se unen en
uno, y se callan los errores sintácticos en cascada cerca de un error léxico.

**AST.** `src/frontend/ast.ts` define los nodos como uniones discriminadas por
`kind`; `build.ts` los construye desde el CST. Todas las fases posteriores son
funciones con `switch (node.kind)` sobre el AST, no visitantes del CST.
`outline.ts` produce una vista genérica `{label, pos, children}` que la CLI
imprime como texto (`compis tree`) y la IDE muestra como árbol plegable.

## Análisis semántico

`src/check/` tiene cuatro piezas:

- `types.ts`: modelo de tipos (`integer`, `float`, `string`, `boolean`, `null`,
  `void`, arreglos, funciones, instancias de clase, `unknown` y `error`) y la
  regla de asignabilidad: igualdad, `integer → float`, `null` hacia arreglos e
  instancias, arreglos covariantes y subclase hacia superclase. `unknown` y
  `error` absorben: no generan errores en cascada.
- `scope.ts`: `Scope` (ámbitos anidados con su mapa de símbolos) y `SymbolTable`,
  que asigna ids deterministas a ámbitos y símbolos. Cada `Sym` registra sus usos
  y si está **capturado**, es decir, si lo usa una función distinta de la que lo
  declara. Las globales y las clases nunca se marcan como capturadas.
- `codes.ts`: catálogo de diagnósticos con código propio:

  | Rango | Tema |
  |---|---|
  | `E101`–`E105` | nombres y ámbitos (no declarado, tipo inexistente, redeclaración, parámetro o miembro repetido) |
  | `E201`–`E215` | tipos (inicialización, asignación, operadores, condiciones, índices, arreglos, `switch`) |
  | `E301`–`E306` | funciones (argumentos, invocación, `return`) |
  | `E401`–`E407` | clases (miembros, `this`, herencia, redefinición) |
  | `E501`–`E502` | flujo (`break` y `continue` fuera de lugar) |
  | `W501`–`W503` | advertencias (código inalcanzable, retorno no garantizado, uso antes de asignar) |

- `checker.ts`: una sola pasada sobre el AST. Al entrar a cada lista de
  sentencias primero declara sus clases (con el enlace al padre y la detección de
  ciclos de herencia), sus miembros y sus funciones; así se pueden usar antes de
  su declaración. Las variables no se adelantan. Después recorre las sentencias
  calculando el tipo de cada expresión. El retorno de una función sin tipo
  declarado es el tipo común de sus `return` (ninguno da `void`).

El resultado (`CheckResult`) guarda la tabla de símbolos, el tipo de cada
expresión, el símbolo de cada nombre, el ámbito de cada nodo y el miembro
resuelto de cada acceso `obj.nombre`. La generación de código consulta estos
mapas en lugar de volver a resolver nombres.

## Código intermedio

### Representación

`src/ir/ir.ts` define un `IrModule`: clases (disposición de campos y vtable),
globales y una lista de `IrFunction`. Cada función, método y función anidada es
una `IrFunction` aparte con su etiqueta; el código global es `main`. El cuerpo es
una lista de cuádruplos con operandos tipados:

- temporales virtuales `t0, t1, …`, ilimitados y nuevos en cada uso;
- slots (parámetros y locales en la pila de la función);
- globales (segmento de datos);
- constantes enteras (también `true`/`false` como 1/0 y `null` como 0),
  flotantes y cadenas.

Las operaciones distinguen enteros de flotantes (`add` / `fadd`, `lt` / `flt`),
y la conversión es explícita (`itof`). Las cadenas usan `concat` y `streq`. Hay
operaciones de alto nivel para lo que el backend resuelve con el runtime:
`newarr`, `aget`/`aset`/`alen` con verificación de límites y de null, `newobj`,
`getf`/`setf`, `closure`, `callc` (llamada a clausura), `callm` (llamada por
vtable), `try`/`endtry`/`caught`.

Ejemplo (`compis tac`):

```
func f(n)  ; f_f
    t0 = n <= 1
    ifnot t0 goto L0
    return 1
L0:
    t1 = n - 1
    ...
```

`src/ir/cfg.ts` parte cada función en bloques básicos. Un bloque empieza en una
etiqueta o después de un salto, un `return` o un `try`; un `try` tiene además
una arista hacia su `catch`. `compis tac --cfg` imprime los bloques con sus
predecesores y sucesores.

### Dónde vive cada variable

`src/ir/frames.ts` decide el lugar de cada símbolo:

- **global**: variables del nivel superior, en el segmento de datos;
- **slot**: parámetros y locales no capturados, en la pila;
- **entorno**: variables capturadas por funciones anidadas. Cada función que
  declara alguna crea al entrar un *registro de entorno* en el heap. La palabra 0
  enlaza al entorno de la función que la encierra, y el resto son las variables
  capturadas. Una función anidada sigue esa cadena de enlaces para llegar a la
  variable de un ancestro;
- **etiqueta**: funciones globales, que se llaman directo por su nombre.

Una **clausura** es un par `{código, entorno}` en el heap. Dos funciones
hermanas que capturan la misma variable comparten el mismo entorno, y cada
llamada a la función externa crea un entorno nuevo; por eso las instancias de
una clausura son independientes.

### Traducción

`src/ir/lower.ts` recorre el AST verificado:

- **Condiciones** como código de saltos: `&&` y `||` evalúan el lado derecho
  solo si hace falta.
- **Conversión integer → float** en asignaciones, argumentos, retornos, campos,
  elementos de arreglos y ramas de un ternario mixto. Los literales de arreglo y
  los ternarios se construyen directamente con el tipo de destino.
- **`switch`**: compara en orden, con caída entre casos y `break` hacia el final.
- **`foreach`**: evalúa el arreglo una sola vez y recorre por índice.
- **Clases**: la disposición de la padre es prefijo de la de la hija, en campos
  y en vtable, y un método redefinido ocupa la misma entrada. `new` reserva el
  objeto, corre los inicializadores de campos desde la clase más antigua hacia
  la más nueva y llama al constructor propio o heredado por la vtable.
- **`try`/`catch`**: activa un manejador, genera el cuerpo, lo desactiva y salta
  al final. El `catch` recibe el mensaje del error en su variable. Un `break`,
  `continue` o `return` que sale de un `try` desactiva antes los manejadores que
  deja atrás.

## Backend MIPS

### Memoria

| Estructura | Disposición |
|---|---|
| Marco de función | `0($fp)…` slots, luego un lugar por temporal, luego un registro de manejador por cada `try`; `size-8($fp)` = `$fp` anterior, `size-4($fp)` = `$ra` |
| Arreglo | palabra 0 = longitud, elemento `i` en `4 + 4i` |
| Objeto | palabra 0 = vtable, palabra 1 = entorno donde se declaró la clase, campos desde el byte 8 |
| Clausura | palabra 0 = dirección del código, palabra 1 = entorno |
| Entorno | palabra 0 = entorno padre, luego las variables capturadas |
| Manejador | `[anterior, dirección del catch, $sp, $fp]`; `__handler` apunta al último |

El heap se obtiene con `sbrk` (syscall 9), que entrega memoria en ceros. Los
flotantes son de precisión simple y ocupan una palabra como cualquier valor.

### Convención de llamada

- Los primeros cuatro argumentos van en `$a0–$a3`; un flotante viaja como bits
  crudos (`mfc1`). Los siguientes van en la pila y el llamado los lee en
  `size + 4(i-4)($fp)`.
- El resultado vuelve en `$v0`, o en `$f0` si es flotante.
- El entorno de una clausura llega en `$v1`, y el prólogo lo guarda en su slot.
  En un método el objeto es el primer argumento (`$a0`) y su entorno sale de la
  palabra 1 del objeto.
- `callm` lee la vtable de la palabra 0 del objeto y salta a la entrada del
  método: despacho dinámico.

### Selección de instrucciones y registros

`isel.ts` traduce cada bloque básico. `regs.ts` implementa el `getReg` del libro
del dragón con descriptores de registro (qué variables tiene cada registro) y de
dirección (dónde está hoy cada variable y si su copia en memoria está al día).
Reparte `$t0–$t7` para palabras y los pares `$f2–$f18` sin `$f12` (argumento
de syscall) para flotantes; `$t8` y `$t9` quedan para uso interno. Al empezar un bloque nada está en registros; las
copias `x = y` solo agregan un nombre al registro.

Al vaciar los registros se escriben en memoria solo los valores modificados,
según el momento:

| Momento | Se guarda |
|---|---|
| fin de bloque, o antes de una operación que puede fallar | todo menos los temporales que mueren en el bloque |
| antes de una llamada | todo |
| al retornar | solo globales |

Así un `catch` siempre encuentra en memoria los valores correctos.

### Runtime

`runtime.ts` contiene rutinas escritas a mano que solo usan `$a*`, `$v*`, `$t8` y
`$t9`, de modo que los registros del asignador sobreviven a una llamada a ellas.
`emit.ts` solo incluye las que el programa usa: concatenación (`__concat`),
igualdad de cadenas (`__streq`) y los errores en tiempo de ejecución:

- `Runtime error: array index out of bounds`
- `Runtime error: null array`
- `Runtime error: null reference`
- `Runtime error: division by zero`

Cada error llama a `__raise`, que saca el manejador de la cima, restaura `$sp` y
`$fp` y salta al `catch` con el mensaje en `$v0`. Si no hay manejador, imprime el
mensaje y termina con `syscall 17` y código de salida 1. Los errores se pueden
capturar también desde una función llamada dentro del `try`.

### Peephole

`peephole.ts` reescribe el texto ensamblador hasta que ninguna regla cambie
nada. Elimina `move` de un registro a sí mismo y saltos a la línea siguiente.
Encadena saltos hacia saltos. Reemplaza un `lw` que lee lo que un `sw` acaba de
guardar por una copia (lo mismo con `swc1`/`lwc1`). Borra el código inalcanzable
después de `j`/`jr` hasta la siguiente etiqueta.

## Herramientas

- **CLI** (`npm run compis -- <comando> archivo.cps`): `tokens`, `tree`, `check`
  (con tabla de símbolos), `tac` (`--cfg`), `asm` (`-o salida.asm`) y `run`.
- **MARS** (`scripts/mars.ts`): `npm run mars:setup` descarga `Mars4_5.jar`
  v4.5.1 a `tools/` y verifica su sha256. `run` lo ejecuta con
  `java -jar tools/Mars4_5.jar nc ae1 se1 1000000 archivo.asm`; si se alcanza el
  límite de un millón de instrucciones, lo informa.
- **IDE** (`web/`): Vite, React 19 y Tailwind 4, con componentes de The GridCN
  y el tema Tron (primario `#00D4FF`). El editor es CodeMirror 6 con resaltado
  de Compiscript. Cada cambio se compila en un Web Worker 300 ms después de la
  última tecla, y las respuestas de versiones viejas se descartan. Si compila,
  el mismo worker ejecuta el programa con el intérprete del código intermedio
  (`src/ir/interp.ts`), con un límite de un millón de pasos. La consola bajo
  el editor muestra las últimas mil líneas impresas y el código de salida; un
  error en ejecución sin capturar aparece también en el panel de problemas. Los paneles
  muestran problemas (también marcados en el editor), tokens, AST, ámbitos,
  símbolos, TAC, CFG y MIPS. Se puede abrir un `.cps` desde un archivo, descargar el `.asm` y cargar cualquier
  programa de `examples/` desde un panel lateral (⌘K).

## Pruebas

`npm test` corre `node --test` con `tsx` sobre `test/*.test.ts`:

- frontend, tipos, ámbitos, catálogo y checker con programas pequeños, más
  `examples/errors/{lexico,sintaxis,semantica,advertencias}/*` y `examples/lang/*`;
- código intermedio: frames, traducción, CFG, y un intérprete del IR
  (`src/ir/interp.ts`, con flotantes de 32 bits como MARS) que ejecuta
  programas y compara su salida;
- backend: asignador, peephole y suites que ensamblan y ejecutan en MARS,
  comparando con el intérprete;
- **golden**: cada `examples/run/NN-*.cps` y `examples/errors/ejecucion/*.cps`
  se ejecuta en MARS y su salida debe ser idéntica a su `.out`; los errores sin
  capturar deben terminar con código 1.

Sin Java o sin el jar, las pruebas de MARS se omiten. Con `REQUIRE_MARS=1`
(así corre la CI) son obligatorias. La CI (`.github/workflows/ci.yml`) usa
Node 22 y Java 17, descarga MARS, revisa tipos, corre todas las pruebas y
compila la IDE.

## Limitaciones conocidas

- Un parámetro sin tipo que recibe un flotante se trata como palabra.
- Asignar un `integer[]` a una variable `float[]` no convierte sus elementos;
  solo se convierten los literales.
- En general, un valor de tipo `unknown` se maneja como palabra en el backend.
