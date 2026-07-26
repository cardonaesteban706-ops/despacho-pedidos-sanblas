// constants.js
//
// Constantes y helpers puros compartidos. Existe por una razón concreta:
// ExtractReviewCard.jsx importaba VEHICULOS, DESTINOS, formatCOP, esLineaFlete,
// todayISO y addDaysISO desde DespachoPedidos.jsx, que a su vez importa
// ExtractReviewCard.jsx — una IMPORTACIÓN CIRCULAR.
//
// Hoy no explotaba porque esas referencias solo se usan DENTRO del cuerpo del
// componente, nunca en el nivel superior del módulo. Pero el día que alguien
// escribiera `const X = VEHICULOS[0]` arriba del archivo, reventaría con un
// error de "no inicializado" (TDZ) — y podía reventar solo en el build de
// producción y no en desarrollo, que es la peor variante posible.
//
// Con este módulo la cadena queda en una sola dirección:
//   constants.js  <-  DespachoPedidos.jsx
//   constants.js  <-  ExtractReviewCard.jsx
// Nadie importa hacia atrás.

// capacidadKg: carga máxima del vehículo, para avisar cuando un pedido (o el
// total de una columna) no cabe en un solo viaje. null = sin límite definido.
export const VEHICULOS = [
  { id: "camion", label: "Camión", icon: "ti-truck", bg: "#E6F1FB", border: "#378ADD", text: "#0C447C", capacidadKg: 3000 },
  { id: "motocarro", label: "Motocarro", icon: "ti-moped", bg: "#FAEEDA", border: "#BA7517", text: "#633806", capacidadKg: null },
  { id: "tractor", label: "Tractor", icon: "ti-tractor", bg: "#EAF3DE", border: "#639922", text: "#27500A", capacidadKg: null },
];

// Destinos frecuentes para marcar la zona del pedido al montarlo. "Otro" abre
// un campo de texto para escribir cualquier otro lugar a mano.
export const DESTINOS = ["Corozal", "Morroa"];

// Colores de identidad de marca SANBLAS (tomados del logo: azul oscuro
// institucional + celeste claro de fondo). Se usan en el header, la
// pestaña activa y el botón principal de subir documento.
export const MARCA = {
  azulOscuro: "#0C447C",
  azulMedio: "#378ADD",
  azulClaro: "#E6F1FB",
  azulMuyOscuro: "#042C53",
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatCOP(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);
}

export function formatCantidad(n) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(n);
}

// Quita tildes y pasa a minúsculas para comparar sin importar cómo venga escrito
// en la factura ("CERÁMICA", "Ceramica", "cerámica" → "ceramica").
// U+0300 a U+036F es el bloque de tildes y diacríticos combinables que deja
// normalize("NFD") cuando separa "á" en "a" + tilde.
//
// El rango se construye desde los códigos en vez de escribirlo dentro del
// regex. Escrito como /[<tilde>-<tilde>]/ son caracteres INVISIBLES en el
// editor: no se ven, no se pueden revisar en un diff, y cualquier paso por un
// editor o consola con otro encoding los corrompe en silencio. Y de esta
// función dependen la detección de categorías de peso del Panel, la de líneas
// de flete y los buscadores — si se rompe, se rompe callada.
const DIACRITICOS = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

export function normalizarTexto(s) {
  return (s || "").normalize("NFD").replace(DIACRITICOS, "").toLowerCase();
}

// Detecta la línea de "Transporte de carga de cliente" (el flete que se cobra
// aparte en la factura, agregado a mano desde World Office). No es material —
// no tiene peso — así que se excluye del sistema de categorías de peso y del
// "Sin categorizar", y se cuenta aparte en pesos ($), no en kilos.
export function esLineaFlete(descripcion) {
  const d = normalizarTexto(descripcion);
  return (
    d.includes("transporte de carga") ||
    d.includes("transporte carga") ||
    d.includes("carga de material") ||
    d.includes("carga material") ||
    d.includes("acarreo") ||
    /\bflete\b/.test(d)
  );
}

// --- Fechas ---

export function todayStr() {
  const d = new Date();
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Fecha de despacho: usamos formato ISO (YYYY-MM-DD) internamente porque es
// fácil de comparar y ordenar; el formato bonito (es-CO) es solo para mostrar.
export function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatFechaCorta(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  return `${dias[dt.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export function etiquetaFecha(iso, hoyIso) {
  if (iso === hoyIso) return "Hoy";
  if (iso === addDaysISO(hoyIso, 1)) return "Mañana";
  return formatFechaCorta(iso);
}

// Compara dos pedidos por su posición en la columna del tablero.
//
// El desempate por `id` no es decorativo: `orden` se calcula como "el máximo de
// la columna + 1" sobre el estado que tiene CADA dispositivo en memoria, así que
// dos personas agregando pedidos al mismo vehículo y día a la vez producen el
// MISMO número de orden. Cuando eso pasa, `a.orden - b.orden` devuelve 0 y el
// resultado dependía del orden en que la base hubiera devuelto las filas — que
// no está garantizado. Efecto visible: las dos tarjetas se intercambiaban de
// posición entre recargas.
//
// Con el desempate, un empate de `orden` se resuelve siempre igual. No evita el
// empate (eso pediría generar el orden en el servidor), pero sí que la pantalla
// deje de moverse sola, que es el síntoma que se ve.
export function compararOrden(a, b) {
  const d = (a.orden || 0) - (b.orden || 0);
  if (d !== 0) return d;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

export function nowTimeStr() {
  const d = new Date();
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}
