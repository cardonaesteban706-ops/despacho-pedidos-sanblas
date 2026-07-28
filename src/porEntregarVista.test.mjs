// porEntregarVista.test.mjs — se corre con `npm test`.
//
// PARA QUÉ SIRVE ESTO: "Por entregar" es la pantalla que el mostrador mira para
// saber qué facturas quedaron a medias. Dos cosas de acá deciden si alguien va a
// atender una factura olvidada:
//
//   - el "Quedan X de Y" de cada línea, que debe coincidir EXACTAMENTE con lo
//     que dice la tarjeta y el modal de remisión (los tres leen saldo.js; si
//     esta pantalla se desviara, nadie sabría a cuál creerle);
//   - la etiqueta de estancamiento ("Estancada · 70d sin mover"), que es la que
//     hace que una venta a medias vuelva a pedir atención.
//
// Un umbral cambiado sin querer no rompe nada visiblemente: simplemente las
// facturas dejan de avisar, y eso no se nota hasta que el cliente reclama.

import { test } from "node:test";
import assert from "node:assert/strict";
import { enrich, parseFecha, fmtPesos } from "./porEntregarVista.js";

const factura = (extra = {}) => ({
  cliente: "CLIENTE UNO",
  numeroFactura: "62781",
  total: 490200,
  productos: [],
  porcentajeEntregado: 0,
  numeroRemisiones: 0,
  diasSinMovimiento: 0,
  ...extra,
});

// ---------------------------------------------------------------------
// "Quedan X de Y": las tres formas de dato de saldo.js
// ---------------------------------------------------------------------

test('"Quedan X de Y" usa el saldo real en las tres formas de dato', () => {
  const r = enrich(factura({
    productos: [
      { descripcion: "LADRILLO", cantidad: "100", unidad: "Und" },                        // A: sin tocar
      { descripcion: "CEMENTO", cantidad: "100", unidad: "Bulto", cantidadEntregada: 30 }, // B: marcado a mano
      { descripcion: "ARENA", cantidad: "100", unidad: "M3", cantidadRestante: 60 },       // C: con remisiones
    ],
  }));
  assert.equal(r.productos[0].label, "Quedan 100 de 100 Und");
  assert.equal(r.productos[1].label, "Quedan 70 de 100 Bulto");
  assert.equal(r.productos[2].label, "Quedan 60 de 100 M3");
});

test("una línea sin saldo dice Completo, no 'Quedan 0'", () => {
  const r = enrich(factura({
    productos: [{ descripcion: "CEMENTO", cantidad: "10", unidad: "Bulto", cantidadRestante: 0 }],
  }));
  assert.equal(r.productos[0].label, "Completo · 10 Bulto");
  assert.equal(r.productos[0].done, true);
});

test("las cantidades se muestran en formato colombiano", () => {
  // 1.500 ladrillos, no 1,5. Si se colara un Number() crudo, la pantalla diría
  // "Quedan 1,5 de 1,5" en un pedido de mil quinientos.
  const r = enrich(factura({
    productos: [{ descripcion: "LADRILLO", cantidad: "1.500", unidad: "Und", cantidadRestante: "1.200,5" }],
  }));
  assert.equal(r.productos[0].label, "Quedan 1.200,5 de 1.500 Und");
});

test("pendN y su resumen cuentan solo las líneas que faltan", () => {
  const r = enrich(factura({
    productos: [
      { descripcion: "A", cantidad: "10", cantidadRestante: 0 },
      { descripcion: "B", cantidad: "10", cantidadRestante: 4 },
      { descripcion: "C", cantidad: "10", cantidadRestante: 2 },
    ],
  }));
  assert.equal(r.pendN, 2);
  assert.equal(r.pendResumen, "2 productos por entregar");

  const todo = enrich(factura({ productos: [{ descripcion: "A", cantidad: "10", cantidadRestante: 0 }] }));
  assert.equal(todo.pendResumen, "Todo entregado");

  const una = enrich(factura({ productos: [{ descripcion: "A", cantidad: "10", cantidadRestante: 5 }] }));
  assert.equal(una.pendResumen, "1 producto por entregar", "singular, sin la 's'");
});

// ---------------------------------------------------------------------
// Estancamiento: el aviso que rescata ventas a medias
// ---------------------------------------------------------------------

test("los umbrales de estancamiento son 30 y 60 días", () => {
  assert.match(enrich(factura({ diasSinMovimiento: 60 })).mov, /^Estancada/);
  assert.match(enrich(factura({ diasSinMovimiento: 90 })).mov, /^Estancada/);
  assert.match(enrich(factura({ diasSinMovimiento: 30 })).mov, /^Quieta/);
  assert.match(enrich(factura({ diasSinMovimiento: 59 })).mov, /^Quieta/);
  // Justo por debajo de cada umbral NO debe saltar la etiqueta.
  assert.doesNotMatch(enrich(factura({ diasSinMovimiento: 29 })).mov, /Quieta|Estancada/);
});

test("una factura sin remisiones dice 'Subida hace', no 'Movió hace'", () => {
  // Distinguir las dos es lo que separa "nadie la ha tocado" de "se movió y
  // quedó a medias": son dos conversaciones distintas con el cliente.
  assert.equal(enrich(factura({ diasSinMovimiento: 5, numeroRemisiones: 0 })).mov, "Subida hace 5d");
  assert.equal(enrich(factura({ diasSinMovimiento: 5, numeroRemisiones: 2 })).mov, "Movió hace 5d");
  assert.equal(enrich(factura({ numeroRemisiones: 0 })).remisionesLabel, "Sin remisiones");
  assert.equal(enrich(factura({ numeroRemisiones: 3 })).remisionesLabel, "3 remisiones");
});

test("el porcentaje se acota a [0, 100] aunque llegue un dato raro", () => {
  assert.equal(enrich(factura({ porcentajeEntregado: 150 })).pct, 100);
  assert.equal(enrich(factura({ porcentajeEntregado: -20 })).pct, 0);
  assert.equal(enrich(factura({ porcentajeEntregado: undefined })).pct, 0);
});

test("las etiquetas de estado salen solo en los extremos", () => {
  assert.equal(enrich(factura({ porcentajeEntregado: 0 })).estadoTag, "Sin remisionar");
  assert.equal(enrich(factura({ porcentajeEntregado: 90 })).estadoTag, "Casi lista");
  assert.equal(enrich(factura({ porcentajeEntregado: 50 })).estadoTag, null, "a medias no lleva etiqueta");
});

test("el estado de pago se traduce a algo que se entiende de un vistazo", () => {
  assert.equal(enrich(factura({ estadoPago: "pagado" })).pagoLabel, "Pagado");
  assert.equal(enrich(factura({ estadoPago: "pendiente" })).pagoLabel, "Paga al recibir");
  assert.equal(enrich(factura({})).pagoLabel, "Paga al recibir", "sin dato se asume por cobrar");
});

test("enrich no explota con una factura sin productos ni datos", () => {
  const r = enrich({ cliente: "X" });
  assert.deepEqual(r.productos, []);
  assert.equal(r.pendN, 0);
  assert.equal(r.dias, 0);
  assert.ok(r.mov, "siempre hay etiqueta de movimiento");
});

// ---------------------------------------------------------------------
// Orden por fecha
// ---------------------------------------------------------------------

test("parseFecha ordena por fecha real, no por texto", () => {
  // Las fechas llegan como "DD/MM/YYYY". Ordenar ese texto pondría el 02/01
  // antes que el 15/12 del año anterior.
  assert.ok(parseFecha("15/12/2025") < parseFecha("02/01/2026"));
  assert.ok(parseFecha("01/02/2026") > parseFecha("28/01/2026"));
  const iguales = parseFecha("23/07/2026") === parseFecha("23/07/2026");
  assert.ok(iguales, "la misma fecha da el mismo valor");
});

test("fmtPesos usa el formato colombiano y aguanta el vacío", () => {
  assert.equal(fmtPesos(1500000), "$1.500.000");
  assert.equal(fmtPesos(0), "$0");
  assert.equal(fmtPesos(null), "$0");
  assert.equal(fmtPesos(undefined), "$0");
});
