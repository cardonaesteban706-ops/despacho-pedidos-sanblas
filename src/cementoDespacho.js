// cementoDespacho.js
//
// Conexión entre Despacho y el saldo del cemento (Bodega). Lógica pura, sin
// React ni Supabase, para probarla con `npm test` (cementoDespacho.test.mjs).
//
// Cuando en Despacho sale material de un pedido —"Entregado", un viaje
// juntado, el descuento en el mostrador, "Material entregado", corregir el
// saldo— y alguna línea es de un cemento al que se le lleva saldo, se descuenta
// solo en Bodega > Cemento > Saldo, con el nombre del cliente y la factura.
//
// CÓMO NO CONTAR DOS VECES: cada línea guarda en `cantidadEntregada` lo que ha
// salido DIRECTO de ese pedido (sin lo remisionado, que sale con su propia
// remisión). Se compara ese número antes y después del cambio, y solo la
// DIFERENCIA va al cemento. Así una factura con remisiones, entregas parciales
// o descuentos en el mostrador suma exactamente lo que salió, una sola vez.

import { normalizarTexto } from "./constants.js";
import { marcadoAManoDe } from "./saldo.js";

// La marca (y si es blanco) de un nombre de cemento. En las facturas el cemento
// siempre trae su marca: "CEMENTO GRIS KOLCEM", "CEMENTO GRIS 50 KG ECOCEM
// ULTRACEM", "CEMENTO ESTRUCTURAL ULTRACEM". El orden importa: "ECOCEM
// ULTRACEM" es Ecocem, y un Ultracem "estructural" no es el gris.
const MARCAS = [
  ["estructural", ["estructural", "estructura"]],
  ["ecocem", ["ecocem"]],
  ["kolcem", ["kolcem", "kolem"]],
  ["ultracem", ["ultracem"]],
  ["argos", ["argos"]],
];

export function marcaCemento(descripcion) {
  const d = normalizarTexto(descripcion);
  if (!d.includes("cemento") && !MARCAS.some(([, claves]) => claves.some((k) => d.includes(k)))) return null;
  const hallada = MARCAS.find(([, claves]) => claves.some((k) => d.includes(k)));
  if (!hallada) return null;
  return (d.includes("blanco") ? "blanco-" : "") + hallada[0];
}

function limpio(s) {
  return normalizarTexto(s).replace(/\s+/g, " ").trim();
}

// A qué tipo de cemento (de los que se les lleva saldo) corresponde una línea
// de factura. Primero el nombre exacto; si no, la marca, siempre que haya UN
// solo tipo activo con esa marca (si hay dos, no se adivina).
export function tipoDeProducto(descripcion, tipos) {
  const activos = (tipos || []).filter((t) => t.activo !== false);
  const d = limpio(descripcion);
  if (!d) return null;
  const exacto = activos.find((t) => limpio(t.nombre) === d);
  if (exacto) return exacto;
  const marca = marcaCemento(descripcion);
  if (!marca) return null;
  const conMarca = activos.filter((t) => marcaCemento(t.nombre) === marca);
  return conMarca.length === 1 ? conMarca[0] : null;
}

// Bultos que han salido directo de un pedido, por tipo de cemento.
export function entregadoPorTipo(pedido, tipos) {
  const out = new Map();
  for (const prod of (pedido && pedido.productos) || []) {
    const t = tipoDeProducto(prod && prod.descripcion, tipos);
    if (!t) continue;
    out.set(t.id, (out.get(t.id) || 0) + marcadoAManoDe(prod));
  }
  for (const [k, v] of out) out.set(k, Math.round(v));
  return out;
}

// ¿El pedido tiene alguna línea de cemento con saldo? (para no consultar la
// base en cada entrega que no tiene cemento).
export function tieneCemento(pedido, tipos) {
  return ((pedido && pedido.productos) || []).some((p) => tipoDeProducto(p && p.descripcion, tipos));
}

// "Factura 18574" / "Cotización 552" / "Remisión REM-0012".
export function referenciaDePedido(p) {
  if (!p) return "";
  const num = p.numeroFactura || "s/n";
  if (p.remisionDe || p.tipoDocumento === "remision") return `Remisión ${num}`;
  return `${p.tipoDocumento === "cotizacion" ? "Cotización" : "Factura"} ${num}`;
}

// Qué movimientos crear y cuáles borrar por un cambio en un pedido.
//
//   antes, despues   el pedido antes y después del cambio
//   tipos            tipos de cemento
//   movsPedido       movimientos que ya existen de ESTE pedido (origen despacho)
//   hoy              "YYYY-MM-DD"
//
// Salió más (diferencia > 0): una salida por la diferencia, hoy.
// Se devolvió (diferencia < 0, p. ej. "Devolver a despacho"): se borran las
// salidas de hoy de ese pedido y tipo; si con eso sobra, se vuelve a crear la
// parte que sí salió; si no alcanza (lo devuelto salió otro día), una entrada.
export function planCemento({ antes, despues, tipos, movsPedido = [], hoy, ahora = new Date(), nuevoId }) {
  const crear = [];
  const borrar = [];
  const a = entregadoPorTipo(antes, tipos);
  const d = entregadoPorTipo(despues, tipos);
  const ids = new Set([...a.keys(), ...d.keys()]);
  const base = (tipoId, clase, cantidad) => ({
    id: nuevoId(),
    fecha: hoy,
    tipoId,
    clase,
    cantidad,
    creadoEn: ahora.toISOString(),
    cliente: String((despues && despues.cliente) || (antes && antes.cliente) || "").trim(),
    pedidoId: (despues && despues.id) || (antes && antes.id) || null,
    referencia: referenciaDePedido(despues || antes),
    origen: "despacho",
  });
  for (const tipoId of ids) {
    const delta = (d.get(tipoId) || 0) - (a.get(tipoId) || 0);
    if (delta > 0) {
      crear.push(base(tipoId, "salida", delta));
    } else if (delta < 0) {
      const deHoy = (movsPedido || []).filter((m) => m.tipoId === tipoId && m.fecha === hoy && m.clase === "salida");
      const sumaHoy = deHoy.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
      for (const m of deHoy) borrar.push(m.id);
      const resto = sumaHoy + delta; // delta es negativo
      if (resto > 0) crear.push(base(tipoId, "salida", resto));
      if (resto < 0) crear.push({ ...base(tipoId, "entrada", -resto), referencia: `Devuelto · ${referenciaDePedido(despues || antes)}` });
    }
  }
  return { crear, borrar };
}
