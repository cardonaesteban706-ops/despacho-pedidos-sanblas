// extractRevision.test.mjs — se corre con `npm test`.
//
// PARA QUÉ SIRVE ESTO: dos cosas que hasta ahora se validaban a mano.
//
// 1) LA MATRIZ documento × flujo. La regla del proyecto es que el flujo lo
//    decide POR DÓNDE se subió el PDF (`seguimiento`), no el formato del
//    documento (`data.tipo`, que solo cambia etiquetas). Son dos booleanos
//    parecidos que salen del mismo objeto, y cruzarlos manda una cotización al
//    tablero de despacho o le pide vehículo a un seguimiento.
//
// 2) LAS GUARDAS DE GUARDADO. Son lo único que impide guardar un pedido sin
//    material o repetir una factura. Cada una nació de un problema real, y una
//    guarda que deja de saltar no se nota hasta que el camión sale vacío.

import { test } from "node:test";
import assert from "node:assert/strict";
import { revisarExtraccion, motivoBloqueo } from "./extractRevision.js";

// Documento completo y bien leído: el caso normal, que no debe estorbar.
const completo = (extra = {}) => ({
  tipo: "factura",
  cliente: "CLIENTE UNO",
  numeroFactura: "62781",
  telefono: "3105551234",
  vendedor: "BERTHA BUELVAS",
  total: 490200,
  productos: [{ descripcion: "LADRILLO", cantidad: "100" }],
  lineasIgnoradas: [],
  vehiculo: "camion",
  ...extra,
});

// ---------------------------------------------------------------------
// LA MATRIZ: documento (factura/cotización) × flujo (despacho/seguimiento)
// ---------------------------------------------------------------------

test("MATRIZ: el flujo lo decide por dónde se subió, no el formato del documento", () => {
  const casos = [
    // [tipo del PDF,  subido por,     layout esperado,  etiqueta esperada]
    ["factura", false, false, false],
    ["cotizacion", false, false, true],
    ["factura", true, true, false],
    ["cotizacion", true, true, true],
  ];
  for (const [tipo, seguimiento, layoutCotizacion, etiquetaCotizacion] of casos) {
    const r = revisarExtraccion(completo({ tipo }), seguimiento);
    assert.equal(r.esCotizacion, layoutCotizacion, `layout de ${tipo} vía ${seguimiento ? "seguimiento" : "despacho"}`);
    assert.equal(r.tipoCotizacion, etiquetaCotizacion, `etiqueta de ${tipo}`);
  }
});

test("MATRIZ: una cotización subida por Despacho entra en modo despacho", () => {
  // Es el caso que la regla protege: el vendedor sube una cotización al tablero
  // de despachos porque el cliente ya dijo que sí. Debe pedir vehículo.
  const r = revisarExtraccion(completo({ tipo: "cotizacion" }), false);
  assert.equal(r.esCotizacion, false, "layout de despacho");
  assert.equal(r.tipoCotizacion, true, "pero la etiqueta dice Cotización");
  assert.equal(
    motivoBloqueo(completo({ tipo: "cotizacion", vehiculo: "" }), { seguimiento: false }),
    "Selecciona un vehículo antes de guardar"
  );
});

test("MATRIZ: una factura subida por Cotizaciones NO pide vehículo", () => {
  // El reverso: alguien sube una factura al tablero de seguimiento. Ahí no se
  // despacha nada, así que exigir vehículo dejaría la tarjeta atascada.
  const r = revisarExtraccion(completo({ tipo: "factura" }), true);
  assert.equal(r.esCotizacion, true);
  assert.equal(r.tipoCotizacion, false);
  assert.equal(motivoBloqueo(completo({ tipo: "factura", vehiculo: "" }), { seguimiento: true }), null);
});

test("la etiqueta del número cambia con el FORMATO, no con el flujo", () => {
  assert.ok(revisarExtraccion({ tipo: "cotizacion" }, false).missing.includes("número"));
  assert.ok(revisarExtraccion({ tipo: "factura" }, true).missing.includes("N° documento"));
});

// ---------------------------------------------------------------------
// missing: qué no se pudo leer
// ---------------------------------------------------------------------

test("missing enumera solo lo que falta, y en un documento completo va vacío", () => {
  assert.deepEqual(revisarExtraccion(completo(), false).missing, []);
  const r = revisarExtraccion({ tipo: "factura" }, false);
  assert.deepEqual(r.missing, ["cliente", "N° documento", "teléfono", "vendedor", "total"]);
});

test("un total de 0 cuenta como faltante", () => {
  // Una factura de $0 no existe: si el parser devuelve 0 es que no lo leyó.
  assert.ok(revisarExtraccion(completo({ total: 0 }), false).missing.includes("total"));
});

test("missing NUNCA menciona los productos: para eso está la alarma aparte", () => {
  // Es justo el hueco que dejaba pasar el pedido vacío en silencio.
  const r = revisarExtraccion(completo({ productos: [] }), false);
  assert.ok(!r.missing.some((m) => /producto/i.test(m)));
  assert.equal(r.alarmaSinProductos, true, "lo cubre alarmaSinProductos, no missing");
});

// ---------------------------------------------------------------------
// La alarma de "cero productos"
// ---------------------------------------------------------------------

test("cero productos dispara la alarma y bloquea el guardado", () => {
  const vacio = completo({ productos: [] });
  assert.equal(revisarExtraccion(vacio, false).alarmaSinProductos, true);
  assert.equal(
    motivoBloqueo(vacio, { seguimiento: false }),
    "No se leyó ningún material: confirma que lo revisarás en el PDF"
  );
  // Con la casilla marcada sí deja pasar: es un aviso, no un muro.
  assert.equal(motivoBloqueo(vacio, { seguimiento: false, ack: true }), null);
});

test("si además hay líneas ignoradas, NO se duplica la alarma", () => {
  // Las dos alarmas comparten casilla; mostrar dos casillas sería confuso.
  // Manda la de líneas ignoradas, que además enseña qué se perdió.
  const r = revisarExtraccion(completo({ productos: [], lineasIgnoradas: ["1 LAD01 ..."] }), false);
  assert.equal(r.sinProductos, true);
  assert.equal(r.hayIgnoradas, true);
  assert.equal(r.alarmaSinProductos, false, "solo se muestra una");
});

test("la alarma de cero productos también aplica en seguimiento", () => {
  // Una cotización de la que no se leyó nada es igual de inútil.
  const vacio = completo({ tipo: "cotizacion", productos: [] });
  assert.equal(revisarExtraccion(vacio, true).alarmaSinProductos, true);
  assert.match(motivoBloqueo(vacio, { seguimiento: true }), /No se leyó ningún material/);
});

// ---------------------------------------------------------------------
// Guardas de guardado: orden y casos
// ---------------------------------------------------------------------

test("un documento completo no estorba: cero clics de más", () => {
  assert.equal(motivoBloqueo(completo(), { seguimiento: false }), null);
});

test("el vehículo no se exige si el pedido va sin fecha definida", () => {
  // Pendientes y "Por viaje" no ocupan columna de tablero.
  assert.equal(motivoBloqueo(completo({ vehiculo: "", sinFechaDefinida: true }), { seguimiento: false }), null);
});

test("un cliente en blanco no pasa como nombre", () => {
  assert.match(motivoBloqueo(completo({ cliente: "   " }), {}), /nombre del cliente/);
  assert.match(motivoBloqueo(completo({ cliente: "" }), {}), /nombre del cliente/);
});

test("las líneas ignoradas exigen confirmación", () => {
  const con = completo({ lineasIgnoradas: ["1 LAD01 LADRILLO ..."] });
  assert.match(motivoBloqueo(con, {}), /material que no se pudo leer/);
  assert.equal(motivoBloqueo(con, { ack: true }), null);
});

test("un duplicado exige SU PROPIA confirmación, aparte de la del material", () => {
  // Son dos riesgos distintos y pueden coincidir: marcar uno no puede tapar el
  // otro. Con las dos alarmas activas hacen falta las dos casillas.
  const dup = completo({ lineasIgnoradas: ["1 LAD01 ..."] });
  const opts = { duplicado: { numero: "62781" } };
  assert.match(motivoBloqueo(dup, opts), /no se pudo leer/, "primero el material");
  assert.match(motivoBloqueo(dup, { ...opts, ack: true }), /ya existe/, "después el duplicado");
  assert.equal(motivoBloqueo(dup, { ...opts, ack: true, ackDup: true }), null);
});

test("el orden de las guardas señala primero lo que hay que ARREGLAR", () => {
  // Un documento al que le falta todo debe pedir el vehículo antes que las
  // confirmaciones: no tiene sentido hacer marcar casillas y después decir
  // "ah, y además elige vehículo".
  const roto = completo({ vehiculo: "", cliente: "", productos: [] });
  assert.match(motivoBloqueo(roto, { seguimiento: false }), /vehículo/);
  assert.match(motivoBloqueo({ ...roto, vehiculo: "camion" }, {}), /cliente/);
});

test("no explota con data nula o vacía", () => {
  for (const d of [null, undefined, {}]) {
    const r = revisarExtraccion(d, false);
    assert.ok(Array.isArray(r.missing));
    assert.equal(r.sinProductos, true);
    assert.ok(motivoBloqueo(d, {}), "algo debe bloquear: no hay ni cliente");
  }
});
