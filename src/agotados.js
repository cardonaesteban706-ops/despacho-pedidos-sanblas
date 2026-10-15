// agotados.js
//
// Lógica pura del módulo de Agotados (Bodega): qué se ve en "Reportar",
// cómo se ordena "Compras" y qué sale en "Por proveedor". Sin React ni
// Supabase, para poder probarla con `npm test` (agotados.test.mjs).
//
// Un reporte es una fila de la tabla `agotados` (sql/agotados.sql) en camelCase:
//   { id, producto, quedan, pedir, nota, reportadoEn,
//     proveedores: [], estado: "reportado" | "pedido" | "llego",
//     proveedorPedido, pedidoEn, llegoEn }
// No se guarda quién reporta ni quién pide: basta con cuándo.
// `quedan` = unidades que quedan en bodega: 0 es Agotado, > 0 es Pocas unidades.

import { normalizarTexto, esLineaFlete } from "./constants.js";

export const ESTADOS_AGOTADO = ["reportado", "pedido", "llego"];

export function esAgotado(r) {
  return !r || !(Number(r.quedan) > 0);
}

export function estaAbierto(r) {
  return r && r.estado !== "llego";
}

function mismoProducto(a, b) {
  return normalizarTexto(a).replace(/\s+/g, " ").trim() === normalizarTexto(b).replace(/\s+/g, " ").trim();
}

function ms(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

// ---------------------------------------------------------------------
// Fechas (hora local del dispositivo, que es la de Colombia)
// ---------------------------------------------------------------------

export function mismoDia(iso, ahora = new Date()) {
  const d = new Date(iso);
  return d.getFullYear() === ahora.getFullYear() && d.getMonth() === ahora.getMonth() && d.getDate() === ahora.getDate();
}

// "8:15 a. m." — así se escribe la hora en Colombia. Se arma a mano porque
// toLocaleTimeString cambia de formato entre navegadores ("a.m.", "a. m.", "AM").
export function horaCorta(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "hoy 8:15 a. m." / "ayer 4:10 p. m." / "lun 13" / "13 oct" (más de una semana).
export function cuandoCorto(iso, ahora = new Date()) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  if (mismoDia(d, ahora)) return "hoy " + horaCorta(d);
  const ayer = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 1);
  if (mismoDia(d, ayer)) return "ayer " + horaCorta(d);
  const dias = (new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000;
  if (dias < 7) return `${DIAS[d.getDay()]} ${d.getDate()}`;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

// ---------------------------------------------------------------------
// Reportar
// ---------------------------------------------------------------------

// Lo reportado hoy, lo más reciente arriba.
export function reportesDeHoy(lista, ahora = new Date()) {
  return (lista || []).filter((r) => mismoDia(r.reportadoEn, ahora)).sort((a, b) => ms(b.reportadoEn) - ms(a.reportadoEn));
}

// Si el producto ya tiene un reporte abierto, se ACTUALIZA ese en vez de crear
// otro: en el Excel salía el mismo producto tres veces el mismo día.
export function reporteAbiertoDe(lista, producto) {
  if (!String(producto || "").trim()) return null;
  return (lista || []).find((r) => estaAbierto(r) && mismoProducto(r.producto, producto)) || null;
}

// La cantidad a pedir viene sugerida: la última que se pidió de ese producto.
export function ultimaCantidadPedir(lista, producto) {
  const previos = (lista || [])
    .filter((r) => mismoProducto(r.producto, producto) && Number(r.pedir) > 0)
    .sort((a, b) => ms(b.reportadoEn) - ms(a.reportadoEn));
  return previos.length ? Number(previos[0].pedir) : null;
}

// Nombres de producto para autocompletar. Primero los de World Office: los que
// leyó el lector de PDF en facturas y cotizaciones (vista catalogo_productos,
// sql/catalogo-productos.sql), el más vendido arriba. Los nombres escritos a
// mano en las remisiones manuales NO entran. Al final, los productos que ya se
// reportaron aquí con un nombre que no está en World Office.
export function catalogoProductos(reportes, productosWO) {
  const vistos = new Map();
  const agregar = (nombre) => {
    const limpio = String(nombre || "").replace(/\s+/g, " ").trim();
    if (limpio.length < 3 || esLineaFlete(limpio)) return;
    const clave = normalizarTexto(limpio);
    if (!vistos.has(clave)) vistos.set(clave, limpio);
  };
  const wo = [...(productosWO || [])].sort((a, b) => (Number(b.veces) || 0) - (Number(a.veces) || 0));
  for (const p of wo) agregar(p.descripcion);
  for (const r of reportes || []) agregar(r.producto);
  return [...vistos.values()];
}

// Busca por palabras sueltas, sin tildes ni mayúsculas: "torn dry" encuentra
// "Tornillo drywall 6x1". Primero los que EMPIEZAN por lo escrito; entre
// iguales se respeta el orden del catálogo (lo más vendido primero).
export function buscarEnCatalogo(catalogo, texto, max = 6) {
  const palabras = normalizarTexto(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  const inicio = normalizarTexto(texto).trim();
  return (catalogo || [])
    .map((nombre, i) => ({ nombre, i, n: normalizarTexto(nombre) }))
    .filter((x) => palabras.every((p) => x.n.includes(p)))
    .sort((a, b) => (a.n.startsWith(inicio) ? 0 : 1) - (b.n.startsWith(inicio) ? 0 : 1) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.nombre);
}

// ---------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------

// Primero los agotados (el más viejo arriba: lleva más tiempo sin haber),
// luego los de pocas unidades de menos a más.
export function ordenarParaCompras(lista) {
  return [...(lista || [])].sort((a, b) => {
    const qa = Math.max(0, Number(a.quedan) || 0);
    const qb = Math.max(0, Number(b.quedan) || 0);
    return qa - qb || ms(a.reportadoEn) - ms(b.reportadoEn);
  });
}

// Filtros de la vista Compras. "llego" solo muestra lo de los últimos 7 días.
export function filtrarCompras(lista, filtro, ahora = new Date()) {
  const base = lista || [];
  if (filtro === "pedido") return ordenarParaCompras(base.filter((r) => r.estado === "pedido"));
  if (filtro === "llego") {
    const desde = ahora.getTime() - 7 * 86400000;
    return base.filter((r) => r.estado === "llego" && ms(r.llegoEn || r.reportadoEn) >= desde).sort((a, b) => ms(b.llegoEn) - ms(a.llegoEn));
  }
  return ordenarParaCompras(base.filter(estaAbierto));
}

// Proveedores ya usados, el más usado primero (para autocompletar y fichas).
export function proveedoresConocidos(lista) {
  const cuenta = new Map();
  for (const r of lista || []) {
    for (const p of [...(r.proveedores || []), r.proveedorPedido].filter(Boolean)) {
      const clave = normalizarTexto(p).trim();
      const actual = cuenta.get(clave) || { nombre: p.trim(), n: 0 };
      actual.n += 1;
      cuenta.set(clave, actual);
    }
  }
  return [...cuenta.values()].sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre)).map((x) => x.nombre);
}

// A quién se le ha comprado ESTE producto antes (sale arriba al asignar).
export function proveedoresDelProducto(lista, producto) {
  const usados = (lista || []).filter((r) => mismoProducto(r.producto, producto) && r.proveedorPedido).map((r) => r.proveedorPedido);
  return [...new Set(usados)];
}

// Agrega o quita un proveedor de la lista de un reporte, sin duplicar por
// mayúsculas o tildes.
export function alternarProveedor(proveedores, nombre) {
  const limpio = String(nombre || "").trim();
  if (!limpio) return proveedores || [];
  const base = proveedores || [];
  const esta = base.some((p) => mismoProducto(p, limpio));
  return esta ? base.filter((p) => !mismoProducto(p, limpio)) : [...base, limpio];
}

// Pasos Reportado -> Pedido -> Llegó. Se puede volver atrás tocando el paso
// anterior (un toque equivocado no deja el producto perdido).
export function cambiarEstado(r, estado, { proveedor = null, ahora = new Date() } = {}) {
  const iso = ahora.toISOString();
  if (estado === "pedido") {
    const prov = proveedor || r.proveedorPedido || (r.proveedores && r.proveedores.length === 1 ? r.proveedores[0] : null);
    return {
      ...r,
      estado: "pedido",
      proveedorPedido: prov,
      proveedores: prov ? alternarSiFalta(r.proveedores, prov) : r.proveedores || [],
      pedidoEn: r.estado === "pedido" && r.pedidoEn ? r.pedidoEn : iso,
      llegoEn: null,
    };
  }
  if (estado === "llego") return { ...r, estado: "llego", llegoEn: iso };
  return { ...r, estado: "reportado", proveedorPedido: null, pedidoEn: null, llegoEn: null };
}

function alternarSiFalta(proveedores, nombre) {
  const base = proveedores || [];
  return base.some((p) => mismoProducto(p, nombre)) ? base : [...base, nombre];
}

// ---------------------------------------------------------------------
// Por proveedor
// ---------------------------------------------------------------------

function tieneProveedor(r, proveedor) {
  return (r.proveedores || []).some((p) => mismoProducto(p, proveedor));
}

// Lo que se le puede pedir a un proveedor (reportes sin pedir que lo tienen
// asignado) y lo que ya se le pidió y no ha llegado.
export function vistaProveedor(lista, proveedor) {
  const abiertos = (lista || []).filter(estaAbierto);
  return {
    porPedir: ordenarParaCompras(abiertos.filter((r) => r.estado === "reportado" && tieneProveedor(r, proveedor))),
    yaPedido: ordenarParaCompras(abiertos.filter((r) => r.estado === "pedido" && mismoProducto(r.proveedorPedido || "", proveedor))),
  };
}

// Fichas de proveedor con cuántos productos se le pueden pedir. Los que no
// tienen nada pendiente no salen.
export function resumenProveedores(lista) {
  const nombres = proveedoresConocidos((lista || []).filter(estaAbierto));
  return nombres
    .map((nombre) => {
      const v = vistaProveedor(lista, nombre);
      return { nombre, porPedir: v.porPedir.length, yaPedido: v.yaPedido.length };
    })
    .filter((x) => x.porPedir + x.yaPedido > 0)
    .sort((a, b) => b.porPedir - a.porPedir || b.yaPedido - a.yaPedido || a.nombre.localeCompare(b.nombre));
}
