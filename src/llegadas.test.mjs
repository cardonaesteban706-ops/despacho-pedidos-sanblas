// llegadas.test.mjs — se corre con `npm test`.
//
// Lo que importa de Llegada de proveedores: la lista por día, los filtros de
// un toque, el autocompletado de proveedores y la conexión con Agotados
// (al llegar un proveedor se ofrecen los productos que se le habían pedido).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorDia,
  filtrarLlegadas,
  proveedoresParaLlegada,
  proveedoresRecientes,
  pedidosPendientesDe,
  armarLlegada,
} from "./llegadas.js";

const AHORA = new Date(2026, 9, 15, 11, 0); // jue 15 oct 2026, 11:00 a. m.
const en = (dia, h, m = 0) => new Date(2026, 9, dia, h, m).toISOString();
const l = (id, proveedor, llegoEn, extra = {}) => ({ id, proveedor, llegoEn, estado: "todo_bien", novedades: [], observacion: "", ...extra });

test("agruparPorDia: Hoy, Ayer y luego la fecha, lo más reciente arriba", () => {
  const lista = [l("a", "Argos", en(15, 8)), l("b", "PAVCO", en(15, 10)), l("c", "Gyplac", en(14, 15)), l("d", "Diaco", en(13, 9))];
  const g = agruparPorDia(lista, AHORA);
  assert.deepEqual(g.map((x) => x.titulo), ["Hoy", "Ayer", "mar 13"]);
  assert.deepEqual(g[0].items.map((x) => x.id), ["b", "a"]);
});

test("filtrarLlegadas: solo con novedad y/o de un proveedor, sin importar mayúsculas", () => {
  const lista = [l("a", "PAVCO", en(15, 8), { estado: "con_novedad" }), l("b", "pavco", en(14, 8)), l("c", "Corona", en(14, 9), { estado: "con_novedad" })];
  assert.deepEqual(filtrarLlegadas(lista, { soloNovedad: true }).map((x) => x.id), ["a", "c"]);
  assert.deepEqual(filtrarLlegadas(lista, { proveedor: "Pavco" }).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(filtrarLlegadas(lista, { soloNovedad: true, proveedor: "PAVCO" }).map((x) => x.id), ["a"]);
  assert.equal(filtrarLlegadas(lista).length, 3);
});

test("proveedoresParaLlegada: primero los que más llegan, luego los de Agotados, sin repetir", () => {
  const llegadas = [l("a", "Argos", en(15, 8)), l("b", "argos", en(14, 8)), l("c", "PAVCO", en(13, 8))];
  const reportes = [{ proveedores: ["Pavco", "Diaco"], estado: "reportado" }];
  assert.deepEqual(proveedoresParaLlegada(llegadas, reportes), ["Argos", "PAVCO", "Diaco"]);
});

test("proveedoresParaLlegada: el catálogo va al final y no repite", () => {
  const llegadas = [l("a", "Copaques", en(15, 8))];
  const catalogo = ["COPAQUES", "MEICO S.A.", "copaques "];
  assert.deepEqual(proveedoresParaLlegada(llegadas, [], catalogo), ["Copaques", "MEICO S.A."]);
});

test("proveedoresRecientes: los últimos distintos que llegaron", () => {
  const llegadas = [l("a", "Argos", en(15, 8)), l("b", "ARGOS", en(15, 7)), l("c", "Gyplac", en(14, 8)), l("d", "Corona", en(13, 8)), l("e", "Diaco", en(12, 8))];
  assert.deepEqual(proveedoresRecientes(llegadas), ["Argos", "Gyplac", "Corona"]);
});

test("pedidosPendientesDe: lo pedido a ese proveedor que no ha llegado", () => {
  const reportes = [
    { id: "tubo", producto: "Tubo", quedan: 0, proveedores: ["PAVCO"], estado: "pedido", proveedorPedido: "PAVCO", reportadoEn: en(14, 8) },
    { id: "codo", producto: "Codo", quedan: 8, proveedores: ["PAVCO"], estado: "pedido", proveedorPedido: "pavco", reportadoEn: en(14, 9) },
    { id: "otro", producto: "Adaptador", quedan: 0, proveedores: ["PAVCO"], estado: "reportado", reportadoEn: en(14, 9) },
    { id: "ya", producto: "Unión", quedan: 0, proveedores: ["PAVCO"], estado: "llego", proveedorPedido: "PAVCO", reportadoEn: en(14, 9) },
    { id: "diaco", producto: "Varilla", quedan: 0, proveedores: ["Diaco"], estado: "pedido", proveedorPedido: "Diaco", reportadoEn: en(14, 9) },
  ];
  assert.deepEqual(pedidosPendientesDe(reportes, "PAVCO").map((r) => r.id), ["tubo", "codo"]);
  assert.deepEqual(pedidosPendientesDe(reportes, "  "), []);
});

test("armarLlegada: sin novedad no guarda fichas ni observación sueltas", () => {
  const base = { id: "x", proveedor: "  PAVCO   Tuberías ", novedades: ["Faltantes"], observacion: "faltaron 6", ahora: AHORA };
  const bien = armarLlegada({ ...base, estado: "todo_bien" });
  assert.equal(bien.proveedor, "PAVCO Tuberías");
  assert.equal(bien.estado, "todo_bien");
  assert.deepEqual(bien.novedades, []);
  assert.equal(bien.observacion, "");
  assert.equal(bien.llegoEn, AHORA.toISOString());

  const mal = armarLlegada({ ...base, estado: "con_novedad" });
  assert.deepEqual(mal.novedades, ["Faltantes"]);
  assert.equal(mal.observacion, "faltaron 6");
  assert.equal(mal.tieneFoto, false);
});
