# Tanda 2 — cómo desplegar

**El orden importa.** El paso 0 es bloqueante: si lo saltas, el paso 1 falla.
Tiempo total: unos 10 minutos.

---

## Paso 0 — Arreglar el número de remisión repetido ⚠️ BLOQUEANTE

El diagnóstico encontró que **ya tienes dos remisiones con el mismo número**.
Eso confirma que el bug del correlativo no era teórico: hay dos tirillas
circulando con el mismo `REM-`.

Hay que resolverlo antes del paso 1, porque el índice único que crea ese SQL
**falla si ya existe un duplicado**.

> Supabase → SQL Editor → pega el **PASO 1** de `sql/arreglar-remision-repetida.sql`
> → Run

Mira las dos filas y decide cuál renumerar:

- Si una está en `estado = 'activo'` (sin entregar), renumera esa: su tirilla
  probablemente no ha salido.
- Si las dos ya están entregadas, renumera la **más reciente** y anota a mano el
  número nuevo en tu copia física. La vieja se queda como está para que cuadre
  con el papel que el cliente tiene.

Luego descomenta el **PASO 2** del mismo archivo, pega el `id` de la fila elegida
y córrelo. El **PASO 3** debe dar `0`.

---

## Paso 1 — Correr el SQL de la tanda

> Supabase → SQL Editor → New query → pega **todo**
> `sql/tanda2-historial-remisiones.sql` → Run

Hace cuatro cosas: agrega `remision_de_id`, enlaza las 16 remisiones que ya
existen con su factura madre, crea el índice único de remisiones, y agrega dos
índices para las consultas nuevas.

Al final muestra una comprobación. Debe salir todo en `true`, y
`remisiones_enlazadas` en **16**.

---

## Paso 2 — Desplegar

```powershell
git add -A; if ($?) { git commit -m "Tanda 2: historial acotado, remisiones por id, lector de PDF sin CDN y tests" }; if ($?) { git push }
```

> En PowerShell **no funciona `&&`**. Se usa `;` con `if ($?)`, que además solo
> sigue al comando siguiente si el anterior salió bien.

Si desplegás antes de correr el paso 1, la app muestra un aviso amarillo que dice
exactamente qué SQL falta y sigue funcionando — pero crear remisiones va a fallar
hasta que lo corras.

---

## Paso 3 — Smoke test (3 cosas, 2 minutos)

Esto solo lo puedes hacer tú: requiere estar autenticado, y yo ya no tengo acceso
a la base (RLS la cerró, que es lo que queríamos).

1. **Buscar en el historial.** Pestaña Historial → busca un cliente de una
   entrega vieja. Debe encontrarlo aunque sea de hace meses. Arriba debe decir
   *"N resultados en todo el historial"*.
2. **Crear una remisión.** Debe salir con el número correcto (el siguiente al más
   alto que exista, no uno repetido).
3. **Subir un PDF.** El botón ya no pasa por "Preparando lector de PDF...":
   pdf.js viaja en el bundle. Debe leer igual que antes.

---

# Qué cambió

## El lector de PDF ya no depende de internet ajeno

`pdfjs-dist` es dependencia de npm. Antes se inyectaba un `<script>` desde
cdnjs en tiempo de ejecución: si ese CDN no respondía, **no se podía subir
ninguna factura** — la función central de la app dependía de que un servidor
ajeno estuviera arriba, y el script se cargaba sin verificación de integridad.
Ahora viaja en el bundle, servido desde tu dominio, y con `eval` desactivado
(no se necesita para extraer texto).

## Tests de los parsers — `npm test`

**29 tests, medio segundo, sin navegador.** Córrelos antes de cada despliegue.

Los parsers son heurísticas de regex sobre el PDF de World Office: si algún día
cambian el formato, esto te avisa ahí en vez de en la bodega.

Los fixtures están copiados de **tu factura real de 2 páginas** (datos de cliente
inventados, estructura auténtica), así que los tests conocen detalles que una
muestra inventada no adivina: que el encabezado dice "U Medida" y no "Unidad",
que el pie dice "TOTAL ITÉM" fusionado con las columnas de totales, que las
cantidades traen coma decimal, y que la página 2 repite los bloques de cabecera.

**Verificado con tu PDF real: 25 productos, ninguno perdido, ninguno duplicado.**
Ese pendiente del 8 de julio queda cerrado.

## Historial acotado, buscador contra el servidor

`cargarHistorial()` traía **todo** sin paginar. PostgREST corta en 1.000 filas y
devuelve `200` con menos filas de las que hay — **sin avisar**. Vas en 159, así
que no dolía; al pasar de 1.000 el Panel habría empezado a mostrar menos kilos de
los reales sin dar un solo error.

- Todas las listas se piden **por tandas** hasta agotar: el techo silencioso ya
  no existe.
- El historial se precarga a **90 días**. Hoy eso no recorta nada (tus 159
  entregas son todas recientes) — es seguro contra el futuro.
- El **buscador consulta al servidor** y encuentra en todo el historial, sin
  límite de fecha. Antes filtraba un arreglo en memoria, así que solo encontraba
  entre lo cargado: esto además mejora lo que había.

## Numeración de remisiones

Tres capas, porque una sola no alcanzaba:

1. El correlativo se consulta contra **la base**, no contra lo que esté cargado
   en pantalla.
2. **Índice único** sobre los `REM-%`: si dos dispositivos coinciden en el mismo
   segundo, la base rechaza el segundo.
3. **Reintento automático**: al choque, toma el siguiente número, actualiza la
   tirilla y avisa *"quedó como REM-0088"*.

Un caso que se me habría pasado: ordenar por texto no sirve, porque `"REM-9999"`
ordena *después* de `"REM-10000"`. La comparación es numérica y hay un test.

## Remisiones enlazadas por id

Antes se enlazaban por el **número** de la factura, con dos fallas:

- Si corregías el número de la madre en "Editar", sus remisiones quedaban
  huérfanas: el contador volvía a "Sin remisiones" y la factura se marcaba
  "Estancada" aunque se hubiera movido ayer.
- Toda factura sin número guardaba el texto `"s/n"`, así que **todas compartían
  sus remisiones**, cruzando material entre clientes distintos.

El número se sigue guardando porque es lo que va impreso en la tirilla. El enlace
real es el id. La regla vive en `remisiones.js` con 10 tests.

## Menores

- **Ítem de más de 3 dígitos** ya no se pierde en silencio (aplicaba a facturas
  de 1.000+ líneas).
- **El pie de la tabla se reconoce sin importar las tildes.** Tu documento dice
  "TOTAL ITÉM" y el regex anterior lo cubría, así que **esto no era un bug** —
  pero era suerte: bastaba con que World Office escribiera "ÍTEM" o "ITEM" para
  que se rompiera y, en una factura de 2 páginas, los productos de la página 2 se
  leyeran dos veces.
- **Entregar ya no resucita pedidos borrados.** Usaba upsert: si otro dispositivo
  había borrado el pedido, reaparecía en el historial con los datos viejos. Ahora
  es update y avisa si la fila ya no está.
- **Importación circular** entre `DespachoPedidos.jsx` y `ExtractReviewCard.jsx`
  resuelta con `constants.js`. Funcionaba de milagro y podía reventar solo en
  producción.
- El archivo grande bajó **~340 líneas**.

---

# Lo que decidimos NO hacer, y por qué

## PDFs a Supabase Storage — aplazado

En la auditoría lo califiqué **medio-alto** suponiendo 1-3 MB por PDF. Los
números reales dicen otra cosa:

```
peso total de los PDF: 48 MB
tamaño de la tabla:    53 MB   (el 90% son los PDFs)
PDF promedio:         309 kB
límite del plan:      500 MB
```

A tu ritmo son ~200 MB al año: **cerca de dos años de margen**. Y como ya no
cargas `pdf_data_url` en las listas, esos 48 MB no afectan la velocidad de la app.

Contra eso, la migración es el cambio más invasivo de toda la auditoría: mover
159 PDFs guardados, cambiar la ruta de lectura, agregar bucket, políticas y URLs
firmadas. El riesgo es hoy; el beneficio, en dos años.

**Umbral para retomarlo:** cuando `tamano_tabla_pedidos` pase de **250 MB** (la
mitad del límite). Corre `sql/diagnostico.sql` cada tanto para verlo. Si algún
día quieres adelantarlo, la opción de menor riesgo es mandar a Storage solo los
PDFs nuevos y dejar los viejos donde están.

## Otros pendientes

- **17 vulnerabilidades de npm** (`npm audit`). Vienen de
  `@tabler/icons-webfont` → `svgtofont` → `node-gyp` → `tar`: es la cadena que
  genera la fuente de iconos, herramienta de **compilación** que no llega al
  navegador. Ya estaban antes de esta tanda. `pdfjs-dist` no agregó ninguna.
- **`orden` colisiona entre dispositivos**: dos personas agregando pedidos a la
  vez pueden producir el mismo `orden` y la posición baila entre recargas. Es
  cosmético y la solución cuesta más que el síntoma.
- **`fechaDocumentoDe`** como último recurso toma la primera fecha del documento,
  que podría ser la de vencimiento. Ensucia el marcado de "Estancada".
- **El PIN del Panel** sigue siendo `1234` en `constants.js`... perdón, en
  `DespachoPedidos.jsx`. Cámbialo si quieres.

---

# Bonus: cómo auditar tu propia base

`sql/diagnostico.sql` es de solo lectura y no trae ningún dato personal, solo
conteos. Sirve para ver el tamaño de la tabla, si hay números repetidos, y cómo
están las líneas de producto. Córrelo cada par de meses.

Si algo sale raro, pásame la fila y lo miramos.
