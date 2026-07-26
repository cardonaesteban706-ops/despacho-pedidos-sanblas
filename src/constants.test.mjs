// constants.test.mjs — `npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { compararOrden, normalizarTexto, esLineaFlete, formatCOP, addDaysISO, etiquetaFecha } from "./constants.js";

test("compararOrden respeta el orden que armó el despachador", () => {
  const lista = [{ id: "c", orden: 3 }, { id: "a", orden: 1 }, { id: "b", orden: 2 }];
  assert.deepEqual([...lista].sort(compararOrden).map((p) => p.id), ["a", "b", "c"]);
});

test("compararOrden desempata igual siempre cuando dos pedidos comparten orden", () => {
  // Pasa de verdad: `orden` se calcula como "máximo de la columna + 1" sobre el
  // estado de CADA dispositivo, así que dos personas agregando a la vez producen
  // el mismo número. Antes el resultado dependía del orden en que la base
  // devolviera las filas y las tarjetas se intercambiaban entre recargas.
  const a = { id: "zzz", orden: 5 };
  const b = { id: "aaa", orden: 5 };
  const unaVez = [a, b].sort(compararOrden).map((p) => p.id);
  const otraVez = [b, a].sort(compararOrden).map((p) => p.id);
  assert.deepEqual(unaVez, otraVez, "el mismo empate debe resolverse igual sin importar el orden de entrada");
  assert.deepEqual(unaVez, ["aaa", "zzz"]);
});

test("compararOrden aguanta pedidos sin orden", () => {
  const lista = [{ id: "b", orden: 2 }, { id: "a" }, { id: "c", orden: 1 }];
  assert.deepEqual([...lista].sort(compararOrden).map((p) => p.id), ["a", "c", "b"]);
});

test("normalizarTexto quita tildes y baja a minúsculas", () => {
  // De esta función dependen los pesos del Panel, la detección de fletes y los
  // buscadores. El rango de diacríticos se construye desde los códigos justamente
  // para que no se corrompa en silencio al pasar por un editor.
  assert.equal(normalizarTexto("CERÁMICA"), "ceramica");
  assert.equal(normalizarTexto("Cerámica Santa Marta"), "ceramica santa marta");

  // La Ñ también pierde la tilde: en NFD es "n" + tilde combinable, y la función
  // quita TODOS los diacríticos. Es lo que se quiere para comparar: así "PEÑA"
  // encuentra "pena" y "TEFLON PEQUEÑO" se halla escribiendo "pequeno".
  // Se fija en un test porque a primera vista parece un error y no lo es.
  assert.equal(normalizarTexto("TEFLON PEQUEÑO"), "teflon pequeno");
  assert.equal(normalizarTexto("PEÑA"), "pena");
  assert.equal(normalizarTexto(""), "");
  assert.equal(normalizarTexto(null), "");
});

test("esLineaFlete distingue el flete del material", () => {
  for (const d of ["TRANSPORTE DE CARGA DE CLIENTE", "TRANSPORTE CARGA", "ACARREO", "FLETE", "Carga de material"]) {
    assert.equal(esLineaFlete(d), true, d);
  }
  for (const d of ["CEMENTO GRIS 50 KG", "TEJA ETERNIT", "VARILLA 3/8", ""]) {
    assert.equal(esLineaFlete(d), false, d);
  }
});

test("formatCOP usa el formato colombiano", () => {
  assert.equal(formatCOP(1234567), "1.234.567");
  assert.equal(formatCOP(0), "0");
  assert.equal(formatCOP(null), "-");
  assert.equal(formatCOP(NaN), "-");
});

test("addDaysISO no se corre por zona horaria ni por fin de mes", () => {
  assert.equal(addDaysISO("2026-07-26", 1), "2026-07-27");
  assert.equal(addDaysISO("2026-07-31", 1), "2026-08-01");
  assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysISO("2026-07-01", -1), "2026-06-30");
  // Año bisiesto.
  assert.equal(addDaysISO("2028-02-28", 1), "2028-02-29");
});

test("etiquetaFecha dice Hoy y Mañana", () => {
  assert.equal(etiquetaFecha("2026-07-26", "2026-07-26"), "Hoy");
  assert.equal(etiquetaFecha("2026-07-27", "2026-07-26"), "Mañana");
  assert.match(etiquetaFecha("2026-07-30", "2026-07-26"), /30\/07/);
});
