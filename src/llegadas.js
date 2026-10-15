// llegadas.js
//
// Lógica pura del módulo Llegada de proveedores (Bodega). Sin React ni
// Supabase, para probarla con `npm test` (llegadas.test.mjs).
//
// Una llegada es una fila de la tabla `llegadas` (sql/llegadas.sql) en camelCase:
//   { id, proveedor, llegoEn, estado: "todo_bien" | "con_novedad",
//     novedades: [], observacion, tieneFoto }

import { normalizarTexto } from "./constants.js";
import { mismoDia, cuandoCorto, proveedoresConocidos, vistaProveedor } from "./agotados.js";

// Fichas rápidas para "¿Qué pasó?": se toca en vez de escribir.
export const TIPOS_NOVEDAD = ["Faltantes", "Averías", "Producto equivocado", "Sin remisión"];

function ms(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function clave(nombre) {
  return normalizarTexto(nombre).replace(/\s+/g, " ").trim();
}

export function conNovedad(l) {
  return l && l.estado === "con_novedad";
}

// Lista de llegadas agrupada por día, lo más reciente arriba:
// [{ titulo: "Hoy" | "Ayer" | "mar 13" | "2 oct", items: [...] }]
export function agruparPorDia(lista, ahora = new Date()) {
  const ayer = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 1);
  const grupos = [];
  for (const l of [...(lista || [])].sort((a, b) => ms(b.llegoEn) - ms(a.llegoEn))) {
    const titulo = mismoDia(l.llegoEn, ahora) ? "Hoy" : mismoDia(l.llegoEn, ayer) ? "Ayer" : cuandoCorto(l.llegoEn, ahora);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.titulo === titulo) ultimo.items.push(l);
    else grupos.push({ titulo, items: [l] });
  }
  return grupos;
}

// Filtros de un toque: solo las que llegaron con novedad, y/o de un proveedor.
export function filtrarLlegadas(lista, { soloNovedad = false, proveedor = "" } = {}) {
  return (lista || []).filter((l) => (!soloNovedad || conNovedad(l)) && (!proveedor || clave(l.proveedor) === clave(proveedor)));
}

// Proveedores para autocompletar: primero los que más han llegado, luego los
// que solo están asignados a productos en Agotados. Sin repetir por
// mayúsculas o tildes.
export function proveedoresParaLlegada(llegadas, reportes) {
  const cuenta = new Map();
  for (const l of llegadas || []) {
    const k = clave(l.proveedor);
    if (!k) continue;
    const actual = cuenta.get(k) || { nombre: String(l.proveedor).trim(), n: 0, ultima: 0 };
    actual.n += 1;
    actual.ultima = Math.max(actual.ultima, ms(l.llegoEn));
    cuenta.set(k, actual);
  }
  const deLlegadas = [...cuenta.values()].sort((a, b) => b.n - a.n || b.ultima - a.ultima).map((x) => x.nombre);
  const vistos = new Set(deLlegadas.map(clave));
  const deAgotados = proveedoresConocidos(reportes).filter((p) => !vistos.has(clave(p)));
  return [...deLlegadas, ...deAgotados];
}

// Las 3 fichas de "Recientes": los últimos proveedores que llegaron.
export function proveedoresRecientes(llegadas, n = 3) {
  const vistos = new Set();
  const out = [];
  for (const l of [...(llegadas || [])].sort((a, b) => ms(b.llegoEn) - ms(a.llegoEn))) {
    const k = clave(l.proveedor);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(String(l.proveedor).trim());
    if (out.length >= n) break;
  }
  return out;
}

// Conexión con Agotados: lo que estaba PEDIDO a este proveedor y no ha
// llegado. Es lo que se ofrece marcar como "Llegó" al registrar su llegada.
export function pedidosPendientesDe(reportes, proveedor) {
  if (!clave(proveedor)) return [];
  return vistaProveedor(reportes, proveedor).yaPedido;
}

// Datos listos para guardar a partir del formulario. Si no hay novedad, se
// limpian las fichas y la observación (no quedan restos de un toque anterior).
export function armarLlegada({ id, proveedor, estado, novedades = [], observacion = "", foto = null, ahora = new Date() }) {
  const novedad = estado === "con_novedad";
  return {
    id,
    proveedor: String(proveedor || "").replace(/\s+/g, " ").trim(),
    llegoEn: ahora.toISOString(),
    estado: novedad ? "con_novedad" : "todo_bien",
    novedades: novedad ? novedades : [],
    observacion: novedad ? String(observacion || "").trim() : "",
    foto,
    tieneFoto: !!foto,
  };
}
