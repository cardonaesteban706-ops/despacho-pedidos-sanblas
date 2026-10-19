// cemento.js
//
// Lógica pura del Conteo de cemento (Bodega). Sin React ni Supabase, para
// probarla con `npm test` (cemento.test.mjs).
//
//   tipo   = { id, nombre, orden, activo }                (tabla tipos_cemento)
//   conteo = { id, fecha: "YYYY-MM-DD", tipoId, bultos, contadoEn }  (conteos_cemento)
//
// Las fechas van en ISO de día local (todayISO de constants.js): el conteo es
// "el de hoy en la bodega", no un instante.

import { normalizarTexto, addDaysISO } from "./constants.js";

// Un registro por tipo y día: corregir el conteo de hoy reescribe el mismo.
export function idConteo(fecha, tipoId) {
  return `${fecha}_${tipoId}`;
}

export function tiposActivos(tipos) {
  return (tipos || []).filter((t) => t.activo !== false).sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre)));
}

// "1.250" (con punto de miles, como se escribe en Colombia) -> 1250.
// Vacío o sin dígitos -> null (ese tipo no se contó).
export function leerBultos(texto) {
  const solo = String(texto === null || texto === undefined ? "" : texto).replace(/\D/g, "");
  return solo === "" ? null : parseInt(solo, 10);
}

// tipoId -> conteo de esa fecha.
export function conteosDelDia(conteos, fecha) {
  const m = new Map();
  for (const c of conteos || []) if (c.fecha === fecha) m.set(c.tipoId, c);
  return m;
}

// El conteo más reciente de ese tipo ANTES de `fecha`. No siempre es ayer: el
// domingo no se cuenta, así que el lunes se compara con el sábado.
export function anteriorA(conteos, tipoId, fecha) {
  let mejor = null;
  for (const c of conteos || []) {
    if (c.tipoId === tipoId && c.fecha < fecha && (!mejor || c.fecha > mejor.fecha)) mejor = c;
  }
  return mejor;
}

// Diferencia contra el conteo anterior: { n, sentido: "sube" | "baja" | "igual" }.
// null si falta alguno de los dos (no hay con qué comparar).
export function diferencia(actual, anterior) {
  if (actual === null || actual === undefined || anterior === null || anterior === undefined) return null;
  const d = Number(actual) - Number(anterior);
  return { n: Math.abs(d), sentido: d > 0 ? "sube" : d < 0 ? "baja" : "igual" };
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaLocal(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// "Hoy" / "Ayer" / "mar 13" (última semana) / "2 oct".
export function etiquetaDia(fecha, hoy) {
  if (fecha === hoy) return "Hoy";
  if (fecha === addDaysISO(hoy, -1)) return "Ayer";
  const d = fechaLocal(fecha);
  if (fecha >= addDaysISO(hoy, -6)) return `${DIAS[d.getDay()]} ${d.getDate()}`;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

// Título de la pantalla: "jue 15 oct".
export function fechaLarga(fecha) {
  const d = fechaLocal(fecha);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

// La hora del último guardado de ese día (para "Guardado a las 7:12 a. m.").
export function ultimoGuardado(conteosHoy) {
  let max = null;
  for (const c of conteosHoy.values ? conteosHoy.values() : conteosHoy || []) {
    if (c.contadoEn && (!max || c.contadoEn > max)) max = c.contadoEn;
  }
  return max;
}

// Filas para la tabla del historial: los días con conteo dentro de los últimos
// `dias` días, el más reciente arriba. valores: tipoId -> bultos (o null).
export function historial(conteos, tipos, hoy, dias = 30) {
  const desde = addDaysISO(hoy, -(dias - 1));
  const porFecha = new Map();
  for (const c of conteos || []) {
    if (c.fecha < desde || c.fecha > hoy) continue;
    if (!porFecha.has(c.fecha)) porFecha.set(c.fecha, {});
    porFecha.get(c.fecha)[c.tipoId] = c.bultos;
  }
  return [...porFecha.keys()]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((fecha) => ({
      fecha,
      etiqueta: etiquetaDia(fecha, hoy),
      valores: Object.fromEntries((tipos || []).map((t) => [t.id, porFecha.get(fecha)[t.id] ?? null])),
    }));
}

// Para la gráfica: los `dias` días completos (de más viejo a hoy), con null
// donde ese tipo no se contó ese día (la gráfica lo salta, no inventa un 0).
export function serieDias(conteos, tipoId, hoy, dias = 30) {
  const porFecha = new Map();
  for (const c of conteos || []) if (c.tipoId === tipoId) porFecha.set(c.fecha, c.bultos);
  const out = [];
  for (let i = dias - 1; i >= 0; i--) {
    const fecha = addDaysISO(hoy, -i);
    out.push({ fecha, bultos: porFecha.has(fecha) ? porFecha.get(fecha) : null });
  }
  return out;
}

// Tipos sugeridos al agregar: los cementos tal como salen en World Office
// (catálogo del lector de PDF), el más vendido primero, sin los que ya están.
export function sugerenciasTipos(catalogoWO, tipos, max = 6) {
  const ya = new Set((tipos || []).filter((t) => t.activo !== false).map((t) => normalizarTexto(t.nombre).trim()));
  return [...(catalogoWO || [])]
    .filter((p) => normalizarTexto(p.descripcion).includes("cemento") && !ya.has(normalizarTexto(p.descripcion).trim()))
    .sort((a, b) => (Number(b.veces) || 0) - (Number(a.veces) || 0))
    .slice(0, max)
    .map((p) => p.descripcion);
}

// Los registros a guardar a partir de lo escrito en pantalla. Solo los tipos
// con número: uno vacío no se contó (no es un 0).
export function armarConteos(valores, tipos, fecha, ahora = new Date()) {
  const iso = ahora.toISOString();
  return tiposActivos(tipos)
    .map((t) => ({ t, bultos: leerBultos(valores[t.id]) }))
    .filter((x) => x.bultos !== null)
    .map(({ t, bultos }) => ({ id: idConteo(fecha, t.id), fecha, tipoId: t.id, bultos, contadoEn: iso }));
}

// ---------------------------------------------------------------------
// Color del bulto
// ---------------------------------------------------------------------

// Cada tipo lleva el color característico de su bulto, para reconocerlo de un
// vistazo en la lista y en la gráfica (revisado en las fotos de los empaques):
//   Kolcem: bulto naranja · Ecocem: franja verde · Ultracem uso general: "U"
//   azul y franja gris · Ultracem estructural: franja roja vino.
export const COLORES_BULTO = [
  { id: "naranja", nombre: "Naranja", hex: "#E5761E" },
  { id: "verde", nombre: "Verde", hex: "#3D9A3F" },
  { id: "azul", nombre: "Azul", hex: "#2340A8" },
  { id: "rojo", nombre: "Rojo vino", hex: "#A32630" },
  { id: "amarillo", nombre: "Amarillo", hex: "#E3B505" },
  { id: "gris", nombre: "Gris", hex: "#6B7280" },
  { id: "cafe", nombre: "Café", hex: "#8A5A2B" },
  { id: "morado", nombre: "Morado", hex: "#6B3FA0" },
];

// Por marca y uso, en este orden: "ECOCEM ULTRACEM" es Ecocem (verde) y un
// Ultracem "estructural" es rojo aunque diga Ultracem.
const COLOR_POR_CLAVE = [
  ["ecocem", "verde"],
  ["kolcem", "naranja"],
  ["estructural", "rojo"],
  ["ultracem", "azul"],
  ["argos", "amarillo"],
  ["blanco", "gris"],
];

// Color sugerido para un tipo nuevo: el de su marca si se reconoce; si no, el
// primero de la paleta que no esté usado (para que no se confunda con otro).
export function colorSugerido(nombre, usados = []) {
  const n = normalizarTexto(nombre);
  const porMarca = COLOR_POR_CLAVE.find(([k]) => n.includes(k));
  const hexDe = (id) => COLORES_BULTO.find((c) => c.id === id).hex;
  if (porMarca) return hexDe(porMarca[1]);
  const ocupados = new Set((usados || []).map((h) => String(h || "").toLowerCase()));
  const libre = COLORES_BULTO.find((c) => !ocupados.has(c.hex.toLowerCase()));
  return (libre || COLORES_BULTO[0]).hex;
}

// El color con que se pinta un tipo: el suyo, o uno sugerido si no tiene.
export function colorDeTipo(tipo, tipos = []) {
  if (tipo && /^#[0-9a-f]{6}$/i.test(tipo.color || "")) return tipo.color;
  return colorSugerido(tipo ? tipo.nombre : "", (tipos || []).map((t) => t.color));
}

// ---------------------------------------------------------------------
// Saldo del día y cuadre
// ---------------------------------------------------------------------
//
// movimiento = { id, fecha: "YYYY-MM-DD", tipoId, clase: "salida" | "entrada",
//                cantidad, creadoEn }       (tabla movimientos_cemento)
//
// Así trabaja la bodega: en la mañana se cuenta, durante el día se va restando
// lo que sale (y sumando si entra cemento), y al día siguiente se vuelve a
// contar para ver si cuadra con lo que se llevaba anotado.
//
// Regla: los movimientos de un día van DESPUÉS del conteo de ese día (primero
// se cuenta, después se resta).

// Entradas − salidas de un tipo entre `desde` (incluido) y `hasta` (excluido).
export function netoMovimientos(movimientos, tipoId, desde, hasta) {
  let neto = 0;
  for (const m of movimientos || []) {
    if (m.tipoId !== tipoId || m.fecha < desde || m.fecha >= hasta) continue;
    neto += m.clase === "entrada" ? Number(m.cantidad) || 0 : -(Number(m.cantidad) || 0);
  }
  return neto;
}

// Lo que se debería encontrar al contar en `fecha`: el último conteo anterior,
// menos lo que salió y más lo que entró desde ese conteo hasta el día antes.
// { esperado, desde: conteo base } o null si nunca se ha contado ese tipo.
export function saldoEsperado(conteos, movimientos, tipoId, fecha) {
  const base = anteriorA(conteos, tipoId, fecha);
  if (!base) return null;
  return { esperado: base.bultos + netoMovimientos(movimientos, tipoId, base.fecha, fecha), desde: base };
}

// Salidas y entradas de un tipo en un día, y la lista (lo más reciente arriba).
export function movimientosDelDia(movimientos, tipoId, fecha) {
  const lista = (movimientos || []).filter((m) => m.tipoId === tipoId && m.fecha === fecha).sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
  let salidas = 0;
  let entradas = 0;
  for (const m of lista) {
    if (m.clase === "entrada") entradas += Number(m.cantidad) || 0;
    else salidas += Number(m.cantidad) || 0;
  }
  return { salidas, entradas, lista };
}

// El saldo de ahora: el conteo de hoy (o, si hoy no se ha contado, lo que se
// esperaba encontrar) menos lo que ha salido hoy y más lo que ha entrado.
// { saldo, base, contadoHoy, salidas, entradas } o null si no hay de dónde partir.
export function saldoActual(conteos, movimientos, tipoId, hoy) {
  const deHoy = (conteos || []).find((c) => c.tipoId === tipoId && c.fecha === hoy);
  const esp = deHoy ? null : saldoEsperado(conteos, movimientos, tipoId, hoy);
  if (!deHoy && !esp) return null;
  const base = deHoy ? deHoy.bultos : esp.esperado;
  const { salidas, entradas } = movimientosDelDia(movimientos, tipoId, hoy);
  return { saldo: base - salidas + entradas, base, contadoHoy: !!deHoy, salidas, entradas };
}

// Lo contado contra lo esperado: { estado: "cuadra" | "faltan" | "sobran", n }.
export function cuadre(contado, esperado) {
  if (contado === null || contado === undefined || esperado === null || esperado === undefined) return null;
  const d = Number(contado) - Number(esperado);
  return d === 0 ? { estado: "cuadra", n: 0 } : d < 0 ? { estado: "faltan", n: -d } : { estado: "sobran", n: d };
}

// Un movimiento listo para guardar. Cantidad inválida o 0 -> null.
export function armarMovimiento({ id, tipoId, clase = "salida", cantidad, fecha, ahora = new Date() }) {
  const n = leerBultos(cantidad);
  if (!n) return null;
  return { id, fecha, tipoId, clase: clase === "entrada" ? "entrada" : "salida", cantidad: n, creadoEn: ahora.toISOString() };
}
