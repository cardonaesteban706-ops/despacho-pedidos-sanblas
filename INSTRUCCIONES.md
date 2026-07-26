# Cómo desplegar esta tanda

Cinco pasos. El **orden importa** en los tres primeros.
Tiempo total: unos 10 minutos.

---

## Paso 1 — Poner el repositorio en privado (30 segundos)

Ahora mismo `cardonaesteban706-ops/despacho-pedidos-sanblas` es **público**, y ahí
está la URL de tu proyecto de Supabase junto con la llave. Hay gente que escanea
GitHub buscando exactamente eso.

> GitHub → tu repo → **Settings** → hasta abajo, *Danger Zone* →
> **Change visibility** → **Private**

No pierdes nada: Claude Code lee la carpeta local de tu computador, nunca pasó
por GitHub. Y los agentes en la nube leen repos privados con tu propia cuenta.

---

## Paso 2 — Crear el usuario compartido en Supabase (1 minuto)

> Supabase → tu proyecto → **Authentication** → **Users** → **Add user** →
> **Create new user**

- **Email:** algo de la casa, por ejemplo `despacho@sanblas.com`
  (no tiene que ser un correo que exista de verdad).
- **Password:** una clave que le puedas pasar al personal.
- ✅ **Marca la casilla "Auto Confirm User".** Si no la marcas, Supabase espera
  una confirmación por correo que nunca va a llegar y el login dirá
  "El usuario está sin confirmar".

Ésta es la credencial que van a usar todos. Guárdala donde no se pierda.

---

## Paso 3 — Correr el SQL (1 minuto)

> Supabase → **SQL Editor** → **New query** → pega **todo** el contenido de
> `sql/rls-politicas.sql` → **Run**

Es seguro correrlo varias veces. Hace tres cosas: crea la columna `pedido_id`,
prende Row Level Security en `pedidos` y `cotizaciones`, y deja las políticas
que solo permiten entrar a usuarios autenticados.

Al final te muestra dos tablas de comprobación. Debes ver:
- `rowsecurity = true` en las dos filas.
- Una política por tabla con `roles = {authenticated}`.

> ⚠️ **Desde este momento la app vieja deja de funcionar** (ya no puede leer sin
> login). Sigue de una al paso 4.

---

## Paso 4 — Desplegar (2 minutos)

Con el código de este paquete. **Esta es la línea para PowerShell de Windows**
(la que usas en tu computador):

```powershell
git add -A; if ($?) { git commit -m "Cerrar RLS con login, cotizacion a despacho de un toque y fuente unica de saldo" }; if ($?) { git push }
```

> ⚠️ En PowerShell de Windows **no funciona `&&`** para encadenar comandos: da
> "El token '&&' no es un separador de instrucciones válido". Se usa `;` con
> `if ($?)`, que además solo sigue al siguiente comando si el anterior salió
> bien. Si prefieres ir de a uno y ver cada resultado:
>
> ```powershell
> git add -A
> git commit -m "Cerrar RLS con login, cotizacion a despacho de un toque y fuente unica de saldo"
> git push
> ```

Vercel despliega solo al recibir el push. Si prefieres probarlo antes en tu
máquina:

```powershell
npm install; if ($?) { npm run dev }
```

**Variables de entorno: opcional.** Si no las pones, la app usa los valores que
ya trae `supabaseClient.js` y funciona igual. Sirven para poder rotar la llave
sin tocar el código: en Vercel → Project Settings → Environment Variables →
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver `.env.example`).

---

## Paso 5 — Comprobar que quedó cerrado (1 minuto)

Pega esto en una terminal. Antes daba `200`; ahora debe dar **`401`**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://algzltupasibksbnmlrg.supabase.co/rest/v1/pedidos?select=id&limit=1" -H "apikey: sb_publishable_qyROZeNMERQlLjHQqYJC0g_nIeW5i7c"
```

- **401** → cerrado. Listo.
- **200** → algo quedó mal en el paso 3. Avísame.

---

# Smoke test de 3 clics

No creé pedidos ni cotizaciones de prueba en tu base de producción (tiene 175
pedidos reales y no me pareció correcto ensuciarla). Estas tres cosas conviene
que las toques tú una vez, y quedas tranquilo:

1. **Entrar.** Abre la app, escribe la credencial del paso 2. Después dale
   **F5**: debe entrar directo, sin volver a pedir nada. Ese es todo el punto.
2. **Cotización → despacho.** Pestaña Cotizaciones → en una cotización pendiente
   toca **"Aceptar y despachar"**. Debe abrirse la tarjeta de revisión ya llena
   (cliente, productos, total) sin que subas ningún PDF. Eliges vehículo y fecha,
   guardas, y el pedido aparece en el tablero. La cotización queda verde con el
   sello **"Ya está en despacho"**.
3. **Factura repetida.** Sube una factura que ya tengas cargada. Debe salir el
   aviso amarillo *"Este documento ya está cargado"* con la casilla de
   confirmación. Marca la casilla y guarda para comprobar que no bloquea.

---

# Qué cambió, en una página

### Seguridad
- `sql/rls-politicas.sql` **(nuevo)** — prende RLS y deja fuera al visitante
  anónimo. Antes cualquiera podía leer los 175 pedidos con teléfonos,
  direcciones y los PDF de las facturas, y borrarlos todos.
- `src/Login.jsx`, `src/App.jsx` **(nuevos)** — entrada con la cuenta de la casa.
  Se pide **una vez por dispositivo**: la sesión queda guardada y el token se
  renueva solo. Al recargar no parpadea la pantalla de login (se resuelve la
  sesión antes de dibujar).
- `src/supabaseClient.js` — URL y llave por variable de entorno con respaldo a
  los valores actuales, más las funciones de sesión.
- **El PIN del Panel se quedó como estaba.** Con cuenta compartida sí tiene
  sentido: es lo único que separa al personal de los números. Sigue siendo
  `1234` en `DespachoPedidos.jsx`; cámbialo si quieres.

### Cotización que se acepta y no llega a despacho
- El botón verde ahora dice **"Aceptar y despachar"**: arma el pedido con el PDF
  que ya está en la base de datos, sin volver a subir nada. Antes solo pintaba la
  tarjeta de verde y ahí moría — la venta se cerraba y el material no salía.
- Botón **"Pasar a despacho"** en las que ya están aceptadas o rechazadas. Sirve
  de rescate para una **factura subida por error** en el tablero de cotizaciones,
  que antes quedaba secuestrada sin forma de moverla.
- Sello **"Ya está en despacho"** para no despacharla dos veces. Si el pedido se
  borra, la cotización se puede volver a mandar (no queda trabada).

### Saldos, remisiones y material entregado
- `src/saldo.js` **(nuevo)** — la regla del saldo, escrita **una vez**. Estaba
  copiada en siete lugares y cada desvío entre copias era un bug: el Panel
  inflando kilos, la tarjeta diciendo "Completo" mientras "Por entregar" decía
  "quedan 60", el modal de remisión ofreciendo material que ya salió.
- **El bug que arregla:** en una factura de 100 con remisión de 40, el modal de
  "Material entregado" proponía 100 y dejaba guardar 100, aunque solo quedaran
  60. Al archivarse la factura el Panel contaba 5.000 kg encima de los 2.000 ya
  contados por la remisión: **7.000 kg donde salieron 5.000, un 40% inflado.**
  Ahora el modal trabaja contra el saldo real, topa ahí, y muestra
  *"Ya salieron 40 por remisión"* para que se entienda por qué.
- **Nada que recapturar:** las 175 filas existentes se siguen leyendo igual, en
  cualquiera de sus tres formas. No hay migración de datos.

### Lector de PDF
- Una factura que **menciona** una cotización ("se despacha según COTIZACION
  No. 8891") se leía con el parser de cotizaciones: 0 productos, total nulo, y
  la alarma roja de "líneas no leídas" tampoco se disparaba — se perdía en
  silencio. Ahora manda la marca `FECV`, que una cotización no puede tener.
- Aviso de **documento repetido** al guardar: dice dónde está el otro
  ("Camión, mañana" o "historial"). Es aviso, no bloqueo.

---

# Lo que NO toqué, y por qué

Está en la auditoría con detalle. Lo importante que sigue pendiente:

- **El techo de 1.000 filas de PostgREST.** `cargarHistorial()` trae todo el
  historial sin paginar. Vas en 175. Al pasar de 1.000, el Panel empieza a
  mostrar menos kilos de los reales **sin dar ningún error**, y los números de
  remisión `REM-XXXX` se pueden reciclar. Es la bomba de tiempo peor puesta del
  proyecto porque el síntoma no se parece a la causa. Verifica tu límite en
  Supabase → Settings → API. **Es lo que yo haría en la próxima tanda.**
- **PDFs en base64 dentro de Postgres.** Deberían estar en Supabase Storage. Es
  el refactor más grande y cada mes que pasa es más caro.
- **`remisionDe` enlaza por número de factura, no por id.** Si corriges el número
  de una factura madre en "Editar", sus remisiones quedan huérfanas y la factura
  aparece como "Estancada" aunque se haya movido ayer.
- **`REM-XXXX` sin restricción de unicidad** en la base de datos: dos personas
  creando remisión al mismo tiempo pueden sacar el mismo número.
- **pdf.js desde CDN sin verificación de integridad.** Si cdnjs no responde, no
  se puede subir ninguna factura. Debería ser dependencia de npm.
- **El IVA de las cotizaciones quedó descartado**: me confirmaste que el precio
  que sale ya viene con IVA incluido. No lo toqué.
