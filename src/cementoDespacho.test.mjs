// cementoDespacho.test.mjs — se corre con `npm test`.
//
// Lo que no se puede romper: que cada bulto de cemento que sale por Despacho se
// descuente UNA sola vez del saldo de Bodega, venga por "Entregado", por una
// remisión, por el mostrador o por "Material entregado", y que "Devolver a
// despacho" lo deshaga.

import { test } from "node:test";
import assert from "node:assert/strict";
import { marcaCemento, tipoDeProducto, entregadoPorTipo, tieneCemento, referenciaDePedido, planCemento } from "./cementoDespacho.js";
import { cerrarEntregaCompleta, sumarEntregadoDirecto } from "./saldo.js";

const HOY = "2026-10-22";
const AHORA = new Date("2026-10-22T15:00:00.000Z");
const tipos = [
  { id: "kol", nombre: "CEMENTO GRIS KOLCEM", activo: true },
  { id: "eco", nombre: "CEMENTO ECOCEM", activo: true },
  { id: "ult", nombre: "CEMENTO GRIS 50 Kg ULTRACEM", activo: true },
  { id: "est", nombre: "CEMENTO ESTRUCTURAL ULTRACEM", activo: true },
  { id: "viejo", nombre: "CEMENTO GRIS 50 KG ECOCEM ULTRACEM", activo: false },
];
let n = 0;
const nuevoId = () => `m${++n}`;

test("marcaCemento: la marca manda, en el orden correcto", () => {
  assert.equal(marcaCemento("CEMENTO GRIS 50 KG ECOCEM ULTRACEM"), "ecocem");
  assert.equal(marcaCemento("CEMENTO ESTRUCTURAL ULTRACEM"), "estructural");
  assert.equal(marcaCemento("cemento kolcem"), "kolcem");
  assert.equal(marcaCemento("CEMENTO KOLEM"), "kolcem", "con la letra que se comen al escribir a mano");
  assert.equal(marcaCemento("CEMENTO ULTRACEM X 50KG"), "ultracem");
  assert.equal(marcaCemento("CEMENTO BLANCO X 20KG ARGOS"), "blanco-argos");
  assert.equal(marcaCemento("bolsa cemento"), null);
  assert.equal(marcaCemento("VARILLA 3/8"), null);
});

test("tipoDeProducto: los nombres de las facturas caen en el tipo correcto", () => {
  assert.equal(tipoDeProducto("CEMENTO GRIS KOLCEM", tipos).id, "kol");
  assert.equal(tipoDeProducto("CEMENTO GRIS 50 KG ECOCEM ULTRACEM", tipos).id, "eco", "el tipo viejo está quitado: va a Ecocem");
  assert.equal(tipoDeProducto("CEMENTO GRIS 50 Kg ULTRACEM", tipos).id, "ult");
  assert.equal(tipoDeProducto("CEMENTO ESTRUCTURAL ULTRACEM", tipos).id, "est");
  assert.equal(tipoDeProducto("cemento estructural", tipos).id, "est");
  assert.equal(tipoDeProducto("CEMENTO BLANCO X 20KG ARGOS", tipos), null, "el blanco no lleva saldo");
  assert.equal(tipoDeProducto("bolsa cemento", tipos), null);
  const dosUltracem = [...tipos, { id: "ult2", nombre: "CEMENTO ULTRACEM X 25", activo: true }];
  assert.equal(tipoDeProducto("CEMENTO ULTRACEM X 50KG", dosUltracem), null, "si hay dos con la misma marca no se adivina");
});

const factura = (productos, extra = {}) => ({ id: "f1", numeroFactura: "18574", tipoDocumento: "factura", cliente: "CESAR TULIO GUERRA GARCIA", productos, ...extra });

test("Entregado: descuenta lo que faltaba por salir, con cliente y factura", () => {
  const antes = factura([
    { descripcion: "CEMENTO GRIS KOLCEM", cantidad: "20" },
    { descripcion: "VARILLA 3/8 X 6Mts 9.5", cantidad: "10" },
  ]);
  const despues = { ...antes, productos: cerrarEntregaCompleta(antes.productos) };
  const { crear, borrar } = planCemento({ antes, despues, tipos, hoy: HOY, ahora: AHORA, nuevoId });
  assert.deepEqual(borrar, []);
  assert.equal(crear.length, 1);
  assert.equal(crear[0].tipoId, "kol");
  assert.equal(crear[0].clase, "salida");
  assert.equal(crear[0].cantidad, 20);
  assert.equal(crear[0].cliente, "CESAR TULIO GUERRA GARCIA");
  assert.equal(crear[0].referencia, "Factura 18574");
  assert.equal(crear[0].pedidoId, "f1");
  assert.equal(crear[0].origen, "despacho");
  assert.equal(crear[0].fecha, HOY);
});

test("Mostrador y luego Entregado: cada bulto una sola vez", () => {
  const p0 = factura([{ descripcion: "CEMENTO ESTRUCTURAL ULTRACEM", cantidad: "30" }]);
  // El cliente se lleva 5 en el mostrador.
  const p1 = { ...p0, productos: p0.productos.map((p) => sumarEntregadoDirecto(p, 5)) };
  const paso1 = planCemento({ antes: p0, despues: p1, tipos, hoy: HOY, ahora: AHORA, nuevoId });
  assert.equal(paso1.crear[0].cantidad, 5);
  // Después se entrega el resto.
  const p2 = { ...p1, productos: cerrarEntregaCompleta(p1.productos) };
  const paso2 = planCemento({ antes: p1, despues: p2, tipos, hoy: HOY, ahora: AHORA, nuevoId });
  assert.equal(paso2.crear[0].cantidad, 25, "5 + 25 = 30, ni uno de más");
});

test("Factura con remisión: lo remisionado sale con la remisión, no con la factura", () => {
  // Factura de 50: 30 se remisionaron (salen con la remisión), quedan 20.
  const madre = factura([{ descripcion: "CEMENTO GRIS KOLCEM", cantidad: "50", cantidadRestante: 20 }]);
  const remision = { id: "r1", numeroFactura: "REM-0012", tipoDocumento: "factura", remisionDe: "18574", cliente: "CESAR", productos: [{ descripcion: "CEMENTO GRIS KOLCEM", cantidad: "30" }] };
  const rem = planCemento({ antes: remision, despues: { ...remision, productos: cerrarEntregaCompleta(remision.productos) }, tipos, hoy: HOY, ahora: AHORA, nuevoId });
  assert.equal(rem.crear[0].cantidad, 30);
  assert.equal(rem.crear[0].referencia, "Remisión REM-0012");
  const fac = planCemento({ antes: madre, despues: { ...madre, productos: cerrarEntregaCompleta(madre.productos) }, tipos, hoy: HOY, ahora: AHORA, nuevoId });
  assert.equal(fac.crear[0].cantidad, 20, "al cerrar la madre solo sale lo que quedaba");
});

test("Devolver a despacho el mismo día: se borra la salida", () => {
  const entregado = factura([{ descripcion: "CEMENTO GRIS KOLCEM", cantidad: "20", cantidadEntregada: 20 }]);
  const devuelto = factura([{ descripcion: "CEMENTO GRIS KOLCEM", cantidad: "20" }]);
  const movsPedido = [{ id: "x1", tipoId: "kol", fecha: HOY, clase: "salida", cantidad: 20 }];
  const { crear, borrar } = planCemento({ antes: entregado, despues: devuelto, tipos, movsPedido, hoy: HOY, ahora: AHORA, nuevoId });
  assert.deepEqual(borrar, ["x1"]);
  assert.deepEqual(crear, []);
});

test("Devolver a despacho otro día: vuelve como entrada", () => {
  const entregado = factura([{ descripcion: "CEMENTO GRIS KOLCEM", cantidad: "20", cantidadEntregada: 20 }]);
  const devuelto = factura([{ descripcion: "CEMENTO GRIS KOLCEM", cantidad: "20" }]);
  const movsPedido = [{ id: "x1", tipoId: "kol", fecha: "2026-10-21", clase: "salida", cantidad: 20 }];
  const { crear, borrar } = planCemento({ antes: entregado, despues: devuelto, tipos, movsPedido, hoy: HOY, ahora: AHORA, nuevoId });
  assert.deepEqual(borrar, []);
  assert.equal(crear[0].clase, "entrada");
  assert.equal(crear[0].cantidad, 20);
  assert.match(crear[0].referencia, /^Devuelto/);
});

test("Corregir a menos el mismo día: se rehace la salida por la parte que sí salió", () => {
  const antes = factura([{ descripcion: "CEMENTO ECOCEM", cantidad: "10", cantidadEntregada: 10 }]);
  const despues = factura([{ descripcion: "CEMENTO ECOCEM", cantidad: "10", cantidadEntregada: 7 }]);
  const movsPedido = [{ id: "x1", tipoId: "eco", fecha: HOY, clase: "salida", cantidad: 10 }];
  const { crear, borrar } = planCemento({ antes, despues, tipos, movsPedido, hoy: HOY, ahora: AHORA, nuevoId });
  assert.deepEqual(borrar, ["x1"]);
  assert.equal(crear.length, 1);
  assert.equal(crear[0].clase, "salida");
  assert.equal(crear[0].cantidad, 7);
});

test("Sin cemento no hay nada que hacer", () => {
  const p = factura([{ descripcion: "VARILLA 3/8", cantidad: "10" }]);
  assert.equal(tieneCemento(p, tipos), false);
  const plan = planCemento({ antes: p, despues: { ...p, productos: cerrarEntregaCompleta(p.productos) }, tipos, hoy: HOY, ahora: AHORA, nuevoId });
  assert.deepEqual(plan, { crear: [], borrar: [] });
});

test("entregadoPorTipo suma varias líneas del mismo cemento", () => {
  const p = factura([
    { descripcion: "CEMENTO GRIS KOLCEM", cantidad: "10", cantidadEntregada: 10 },
    { descripcion: "cemento kolcem", cantidad: "5", cantidadEntregada: 5 },
  ]);
  assert.equal(entregadoPorTipo(p, tipos).get("kol"), 15);
});

test("referenciaDePedido", () => {
  assert.equal(referenciaDePedido({ numeroFactura: "552", tipoDocumento: "cotizacion" }), "Cotización 552");
  assert.equal(referenciaDePedido({ numeroFactura: "REM-0003", tipoDocumento: "remision" }), "Remisión REM-0003");
});
