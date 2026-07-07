# Despacho de Pedidos — Ferromateriales San Blas

Aplicación interna para gestionar el despacho de pedidos y el seguimiento de cotizaciones de Ferromateriales San Blas.

## Qué hace

- Sube facturas y cotizaciones en PDF y extrae automáticamente cliente, teléfono, dirección, vendedor, total y productos.
- Organiza los pedidos por vehículo de despacho (camión, motocarro, tractor) y por fecha, con reordenamiento por arrastrar y soltar.
- Guarda un historial de pedidos entregados y permite buscarlos por cliente, número de factura o fecha.
- Gestiona cotizaciones por estado (pendiente / aceptada / rechazada) y avisa cuando hay un seguimiento próximo.
- Genera una guía de carga interna (no reemplaza la factura) para que el despachador sepa qué subir al vehículo.

## Stack

- [React 18](https://react.dev/) + [Vite 5](https://vitejs.dev/)
- [Supabase](https://supabase.com/) como base de datos
- [pdf.js](https://mozilla.github.io/pdf.js/) para leer el contenido de los PDF en el navegador
- Iconos [Tabler](https://tabler.io/icons)

## Desarrollo local

```bash
npm install
npm run dev
```

Para generar el build de producción:

```bash
npm run build
npm run preview
```

## Despliegue

El proyecto está configurado para desplegarse en [Vercel](https://vercel.com/) (ver `vercel.json`).
