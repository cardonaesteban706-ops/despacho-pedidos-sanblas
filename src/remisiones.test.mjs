// remisiones.test.mjs — `npm test`
//
// Cubre los dos bugs que estas reglas tenían: el enlace madre-remisión por
// número (que se rompía al corregir el número y cruzaba las facturas "s/n") y el
// correlativo REM calculado sobre una lista incompleta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { esRemisionDe, remisionesDe, maxRemisionDeNumeros, formatearNumeroRemision } from "./remisiones.js";

const madre = { id: "m1", numeroFactura: "17195" };
const otraMadre = { id: "m2", numeroFactura: "17196" };

test("enlaza por id", () => {
  assert.equal(esRemisionDe({ remisionDeId: "m1", remisionDe: "17195" }, madre), true);
  assert.equal(esRemisionDe({ remisionDeId: "m2", remisionDe: "17196" }, madre), false);
});

test("el id MANDA sobre el número", () => {
  // Esto es lo que arregla el caso de "corregí el número de la factura":
  // aunque el número guardado en la remisión ya no coincida, el id sí.
  const hija = { remisionDeId: "m1", remisionDe: "NUMERO-VIEJO" };
  assert.equal(esRemisionDe(hija, madre), true);
  // Y al revés: un número que coincide no basta si el id apunta a otra factura.
  const confundida = { remisionDeId: "m2", remisionDe: "17195" };
  assert.equal(esRemisionDe(confundida, madre), false);
});

test("respaldo por número para las remisiones viejas sin id", () => {
  assert.equal(esRemisionDe({ remisionDe: "17195" }, madre), true);
  assert.equal(esRemisionDe({ remisionDe: "17196" }, madre), false);
});

test('"s/n" NUNCA enlaza: era el cruce de material entre clientes', () => {
  // Todas las facturas sin número guardaban "s/n", así que con el enlace por
  // número TODAS compartían sus remisiones. Material de un cliente contado
  // contra la factura de otro.
  const sinNumeroA = { id: "a", numeroFactura: "" };
  const sinNumeroB = { id: "b", numeroFactura: "" };
  const hijaDeA = { remisionDe: "s/n" };
  assert.equal(esRemisionDe(hijaDeA, sinNumeroA), false);
  assert.equal(esRemisionDe(hijaDeA, sinNumeroB), false);
  // Con id sí enlaza bien, incluso sin número de factura.
  const hijaConId = { remisionDeId: "a", remisionDe: "s/n" };
  assert.equal(esRemisionDe(hijaConId, sinNumeroA), true);
  assert.equal(esRemisionDe(hijaConId, sinNumeroB), false);
});

test("una factura sin número no absorbe remisiones ajenas", () => {
  const sinNumero = { id: "x", numeroFactura: null };
  assert.equal(esRemisionDe({ remisionDe: "17195" }, sinNumero), false);
});

test("no explota con datos faltantes", () => {
  assert.equal(esRemisionDe(null, madre), false);
  assert.equal(esRemisionDe({}, madre), false);
  assert.equal(esRemisionDe({ remisionDe: "17195" }, null), false);
});

test("remisionesDe filtra la lista completa", () => {
  const pedidos = [
    { id: "h1", remisionDeId: "m1" },
    { id: "h2", remisionDe: "17195" },
    { id: "h3", remisionDeId: "m2" },
    { id: "h4", remisionDe: "s/n" },
    { id: "h5" },
    otraMadre,
  ];
  assert.deepEqual(remisionesDe(madre, pedidos).map((h) => h.id), ["h1", "h2"]);
  assert.deepEqual(remisionesDe(otraMadre, pedidos).map((h) => h.id), ["h3"]);
  assert.deepEqual(remisionesDe(madre, []), []);
});

test("maxRemisionDeNumeros compara numéricamente, no por texto", () => {
  assert.equal(maxRemisionDeNumeros(["REM-0001", "REM-0007", "REM-0003"]), 7);
  // El caso que rompe el orden alfabético: por texto, "REM-9999" > "REM-10000".
  assert.equal(maxRemisionDeNumeros(["REM-9999", "REM-10000"]), 10000);
  // Ignora lo que no sea una remisión (facturas normales, basura).
  assert.equal(maxRemisionDeNumeros(["17195", "REM-0002", "", null, "REM-abc"]), 2);
  assert.equal(maxRemisionDeNumeros([]), 0);
  assert.equal(maxRemisionDeNumeros(null), 0);
  // Sin importar mayúsculas ni espacios.
  assert.equal(maxRemisionDeNumeros([" rem-0042 "]), 42);
});

test("formatearNumeroRemision rellena a 4 dígitos y sigue creciendo", () => {
  assert.equal(formatearNumeroRemision(1), "REM-0001");
  assert.equal(formatearNumeroRemision(42), "REM-0042");
  assert.equal(formatearNumeroRemision(9999), "REM-9999");
  assert.equal(formatearNumeroRemision(10000), "REM-10000");
});

test("el correlativo nunca reutiliza un número ya usado", () => {
  // Simula el bug: la pantalla solo tiene cargados los últimos 90 días, pero en
  // la base hay remisiones más viejas con números más altos.
  const enPantalla = ["REM-0003", "REM-0004"];
  const enLaBase = ["REM-0001", "REM-0002", "REM-0003", "REM-0004", "REM-0087"];
  const soloPantalla = maxRemisionDeNumeros(enPantalla);
  const conLaBase = Math.max(maxRemisionDeNumeros(enLaBase), soloPantalla);
  assert.equal(formatearNumeroRemision(soloPantalla + 1), "REM-0005", "lo que hacía antes: recicla");
  assert.equal(formatearNumeroRemision(conLaBase + 1), "REM-0088", "lo que hace ahora");
});
