// cemento.test.mjs — se corre con `npm test`.
//
// Lo que importa del Conteo de cemento: que la diferencia se calcule contra el
// conteo anterior REAL (el lunes contra el sábado), que un campo vacío no se
// guarde como 0, y que el historial y las sugerencias salgan bien.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  idConteo,
  tiposActivos,
  leerBultos,
  conteosDelDia,
  anteriorA,
  diferencia,
  etiquetaDia,
  fechaLarga,
  ultimoGuardado,
  historial,
  serieDias,
  sugerenciasTipos,
  armarConteos,
} from "./cemento.js";

const HOY = "2026-10-15"; // jueves
const tipos = [
  { id: "g", nombre: "CEMENTO GRIS KOLCEM", orden: 1, activo: true },
  { id: "e", nombre: "CEMENTO ESTRUCTURAL ULTRACEM", orden: 2, activo: true },
  { id: "viejo", nombre: "Cemento que ya no se vende", orden: 0, activo: false },
];
const c = (fecha, tipoId, bultos, contadoEn = `${fecha}T12:00:00.000Z`) => ({ id: idConteo(fecha, tipoId), fecha, tipoId, bultos, contadoEn });

test("tiposActivos deja fuera los quitados y respeta el orden", () => {
  assert.deepEqual(tiposActivos(tipos).map((t) => t.id), ["g", "e"]);
});

test("leerBultos entiende el punto de miles y distingue vacío de 0", () => {
  assert.equal(leerBultos("1.250"), 1250);
  assert.equal(leerBultos("0"), 0);
  assert.equal(leerBultos(""), null);
  assert.equal(leerBultos(null), null);
  assert.equal(leerBultos("abc"), null);
});

test("anteriorA: el conteo previo real, aunque no sea ayer", () => {
  const conteos = [c("2026-10-10", "g", 500), c("2026-10-12", "g", 420), c("2026-10-15", "g", 398), c("2026-10-14", "e", 186)];
  assert.equal(anteriorA(conteos, "g", HOY).bultos, 420, "el 13 y el 14 no se contó el gris: compara con el 12");
  assert.equal(anteriorA(conteos, "e", HOY).bultos, 186);
  assert.equal(anteriorA(conteos, "g", "2026-10-10"), null);
});

test("diferencia: sube, baja, igual, o nada si falta un número", () => {
  assert.deepEqual(diferencia(398, 412), { n: 14, sentido: "baja" });
  assert.deepEqual(diferencia(310, 186), { n: 124, sentido: "sube" });
  assert.deepEqual(diferencia(22, 22), { n: 0, sentido: "igual" });
  assert.equal(diferencia(null, 22), null);
  assert.equal(diferencia(22, undefined), null);
});

test("etiquetaDia y fechaLarga", () => {
  assert.equal(etiquetaDia("2026-10-15", HOY), "Hoy");
  assert.equal(etiquetaDia("2026-10-14", HOY), "Ayer");
  assert.equal(etiquetaDia("2026-10-12", HOY), "lun 12");
  assert.equal(etiquetaDia("2026-10-02", HOY), "2 oct");
  assert.equal(fechaLarga(HOY), "jue 15 oct");
});

test("conteosDelDia y ultimoGuardado", () => {
  const conteos = [c(HOY, "g", 398, "2026-10-15T12:10:00.000Z"), c(HOY, "e", 310, "2026-10-15T12:12:00.000Z"), c("2026-10-14", "g", 412)];
  const hoy = conteosDelDia(conteos, HOY);
  assert.equal(hoy.size, 2);
  assert.equal(hoy.get("e").bultos, 310);
  assert.equal(ultimoGuardado(hoy), "2026-10-15T12:12:00.000Z");
  assert.equal(ultimoGuardado(new Map()), null);
});

test("historial: días con conteo de los últimos 30, el más reciente arriba", () => {
  const conteos = [c(HOY, "g", 398), c("2026-10-14", "g", 412), c("2026-10-14", "e", 186), c("2026-09-01", "g", 900)];
  const filas = historial(conteos, tiposActivos(tipos), HOY);
  assert.deepEqual(filas.map((f) => f.etiqueta), ["Hoy", "Ayer"], "el 1 de septiembre queda fuera de los 30 días");
  assert.deepEqual(filas[0].valores, { g: 398, e: null });
  assert.deepEqual(filas[1].valores, { g: 412, e: 186 });
});

test("serieDias: 30 puntos, null donde no se contó", () => {
  const s = serieDias([c(HOY, "g", 398), c("2026-10-13", "g", 430)], "g", HOY);
  assert.equal(s.length, 30);
  assert.equal(s[29].fecha, HOY);
  assert.equal(s[29].bultos, 398);
  assert.equal(s[28].bultos, null);
  assert.equal(s[27].bultos, 430);
});

test("sugerenciasTipos: cementos de World Office, más vendidos primero, sin los ya agregados", () => {
  const wo = [
    { descripcion: "CEMENTO GRIS KOLCEM", veces: 116 },
    { descripcion: "CEMENTO GRIS 50 KG ECOCEM ULTRACEM", veces: 133 },
    { descripcion: "VARILLA 3/8 X 6Mts 9.5", veces: 119 },
    { descripcion: "CEMENTO BLANCO X 20KG ARGOS", veces: 8 },
  ];
  assert.deepEqual(sugerenciasTipos(wo, tipos), ["CEMENTO GRIS 50 KG ECOCEM ULTRACEM", "CEMENTO BLANCO X 20KG ARGOS"]);
});

test("armarConteos: solo los tipos con número, un vacío no es 0", () => {
  const ahora = new Date("2026-10-15T12:00:00.000Z");
  const r = armarConteos({ g: "1.250", e: "", viejo: "5" }, tipos, HOY, ahora);
  assert.deepEqual(r, [{ id: "2026-10-15_g", fecha: HOY, tipoId: "g", bultos: 1250, contadoEn: ahora.toISOString() }]);
  assert.equal(armarConteos({ g: "0" }, tipos, HOY, ahora)[0].bultos, 0, "un 0 escrito sí se guarda");
});

test("colorSugerido: el color del bulto según la marca", async () => {
  const { colorSugerido, colorDeTipo, COLORES_BULTO } = await import("./cemento.js");
  const hex = (id) => COLORES_BULTO.find((c) => c.id === id).hex;
  assert.equal(colorSugerido("CEMENTO GRIS KOLCEM"), hex("naranja"));
  assert.equal(colorSugerido("CEMENTO ECOCEM"), hex("verde"));
  assert.equal(colorSugerido("CEMENTO GRIS 50 KG ECOCEM ULTRACEM"), hex("verde"), "Ecocem gana aunque diga Ultracem");
  assert.equal(colorSugerido("CEMENTO GRIS 50 Kg ULTRACEM"), hex("azul"));
  assert.equal(colorSugerido("CEMENTO ESTRUCTURAL ULTRACEM"), hex("rojo"), "estructural gana a Ultracem");
  assert.equal(colorSugerido("Cemento raro", [hex("naranja")]), hex("verde"), "sin marca: el primero libre");
  assert.equal(colorDeTipo({ nombre: "CEMENTO GRIS KOLCEM", color: "#123456" }), "#123456", "si ya tiene color, se respeta");
  assert.equal(colorDeTipo({ nombre: "CEMENTO GRIS KOLCEM", color: null }), hex("naranja"));
});
