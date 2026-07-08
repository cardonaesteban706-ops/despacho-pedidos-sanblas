# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

Aplicación interna (en español) para Ferromateriales San Blas que gestiona el despacho de pedidos y el seguimiento de cotizaciones. Sube facturas/cotizaciones en PDF, extrae automáticamente los datos (cliente, teléfono, dirección, vendedor, total, productos), y organiza los pedidos por vehículo de despacho (camión, motocarro, tractor) y por fecha.

## Comandos

```bash
npm install       # instalar dependencias
npm run dev       # servidor de desarrollo (Vite)
npm run build     # build de producción
npm run preview   # sirve el build de producción localmente
```

No hay suite de tests ni linter configurados en este proyecto.

## Arquitectura

Es una app de una sola página, casi monolítica: casi toda la lógica vive en **`src/DespachoPedidos.jsx`** (~2500 líneas), un único componente React montado en `src/main.jsx`. No hay router ni state management externo (Redux/Zustand); todo es `useState`/`useEffect`/`useCallback` local a `DespachoPedidos`.

`src/DespachoPedidos.jsx` se organiza en tres capas, en este orden dentro del archivo:

1. **Helpers puros de arriba del archivo** (fechas, formato de moneda, `uid()`).
2. **Extracción y parseo de PDF** (`extractPdfLines`, `detectTipoDocumento`, `parseFactura`, `parseCotizacion`, `parseDocumento`): pdf.js se carga dinámicamente desde CDN (ver `useEffect` que inyecta el `<script>` de cdnjs en `window.pdfjsLib`, no es una dependencia de npm). `extractPdfLines` reconstruye las filas del PDF agrupando fragmentos de texto por posición Y (no por orden de aparición en el stream), porque el layout real de la factura no coincide con el orden del texto crudo. Los parsers (`parseFactura` para Factura Electrónica de Venta formato World Office/FECV, `parseCotizacion` para cotizaciones) son heurísticas basadas en regex sobre ese texto reconstruido — son frágiles ante cambios de formato del PDF de origen.
3. **El componente `DespachoPedidos`**: estado de pedidos activos, historial, cotizaciones, y todos los modales/tarjetas como componentes auxiliares al final del archivo (`ExtractReviewCard`, `PedidoCard`, `PdfCanvasViewer`, `EditModal`, `CotizacionCard`, etc.).

### Persistencia (Supabase)

`src/supabaseClient.js` es la única puerta a la base de datos. Dos tablas: `pedidos` (con columna `estado`: `"activo"` o `"entregado"`, que separa despacho e historial) y `cotizaciones` (con `estado`: `pendiente`/`aceptada`/`rechazada`). La convención es snake_case en la base de datos y camelCase en el componente React; las funciones `filaAPedido`/`pedidoAFila` y `filaACotizacion`/`cotizacionAFila` hacen esa conversión en los dos sentidos. El patrón de guardado es "cargar todo al inicio, actualizar con `upsert` fila por fila cuando algo cambia" (no hay suscripciones realtime de Supabase). Las credenciales de Supabase (URL + anon key pública) están hardcodeadas en ese archivo — es intencional (anon key pública de un proyecto de uso interno), no un secreto filtrado.

### Ver documento y lista de productos

`PdfModal` muestra el PDF original (la factura/cotización de World Office) renderizado en canvas con PDF.js, no en un `iframe`, por restricciones de visor nativo. La lista de productos de un pedido se despliega **dentro de la propia tarjeta** (`PedidoCard`), no en un modal aparte: existía un `GuiaCargaModal` imprimible que se eliminó por redundante (duplicaba la información de la factura).

### Despliegue

Configurado para Vercel (`vercel.json` con rewrite de SPA a `/index.html`). No hay backend propio: Vite sirve el frontend estático y Supabase actúa como backend.
