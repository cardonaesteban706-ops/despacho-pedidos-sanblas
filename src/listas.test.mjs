// listas.test.mjs — se corre con `npm test`.
//
// PARA QUÉ SIRVE ESTO: estos helpers son los que deshacen un cambio cuando falla
// la escritura en la base. Antes se deshacía restaurando una FOTO de la lista
// entera, y eso se llevaba por delante cualquier cosa que el usuario hubiera
// hecho durante el `await`. El test que de verdad importa es el último bloque:
// simula esa carrera y comprueba que deshacer "mi" cambio no borra el de nadie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { quitarPorId, reponerPorId, reemplazarPorId } from "./listas.js";

const p = (id, extra = {}) => ({ id, cliente: "C" + id, ...extra });

// ---------------------------------------------------------------------
// quitarPorId
// ---------------------------------------------------------------------

test("quitarPorId acepta un id, un objeto o una lista de cualquiera", () => {
  const lista = [p("a"), p("b"), p("c")];
  assert.deepEqual(quitarPorId(lista, "b").map((x) => x.id), ["a", "c"]);
  assert.deepEqual(quitarPorId(lista, p("b")).map((x) => x.id), ["a", "c"]);
  assert.deepEqual(quitarPorId(lista, ["a", "c"]).map((x) => x.id), ["b"]);
  assert.deepEqual(quitarPorId(lista, [p("a"), p("b")]).map((x) => x.id), ["c"]);
});

test("quitarPorId no altera la lista original", () => {
  const lista = [p("a"), p("b")];
  quitarPorId(lista, "a");
  assert.equal(lista.length, 2, "las listas de React son inmutables");
});

test("quitarPorId aguanta vacíos y ids que no están", () => {
  assert.deepEqual(quitarPorId([], "x"), []);
  assert.deepEqual(quitarPorId(null, "x"), []);
  assert.deepEqual(quitarPorId([p("a")], "zzz").map((x) => x.id), ["a"]);
  assert.deepEqual(quitarPorId([p("a")], []).map((x) => x.id), ["a"]);
  assert.deepEqual(quitarPorId([p("a")], null).map((x) => x.id), ["a"]);
});

// ---------------------------------------------------------------------
// reponerPorId
// ---------------------------------------------------------------------

test("reponerPorId vuelve a meter lo que falta", () => {
  const lista = [p("a")];
  assert.deepEqual(reponerPorId(lista, p("b")).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(reponerPorId(lista, [p("b"), p("c")]).map((x) => x.id), ["a", "b", "c"]);
});

test("reponerPorId NO duplica lo que ya está", () => {
  // Es la guardia contra el doble deshacer: si el usuario reintenta y falla dos
  // veces, el pedido no puede aparecer dos veces en el tablero.
  const lista = [p("a"), p("b")];
  assert.equal(reponerPorId(lista, p("a")).length, 2);
  assert.equal(reponerPorId(reponerPorId(lista, p("c")), p("c")).length, 3);
});

test("reponerPorId devuelve la MISMA referencia si no hay nada que reponer", () => {
  // Devolver un array nuevo haría re-renderizar todas las tarjetas por un
  // cambio que no existe.
  const lista = [p("a")];
  assert.equal(reponerPorId(lista, p("a")), lista);
  assert.equal(reponerPorId(lista, []), lista);
});

test("reponerPorId aguanta vacíos y nulos", () => {
  assert.deepEqual(reponerPorId(null, p("a")).map((x) => x.id), ["a"]);
  assert.deepEqual(reponerPorId([], [null, undefined]).map((x) => x.id), []);
});

// ---------------------------------------------------------------------
// reemplazarPorId
// ---------------------------------------------------------------------

test("reemplazarPorId deja la versión nueva en el sitio del elemento viejo", () => {
  const lista = [p("a"), p("b"), p("c")];
  const out = reemplazarPorId(lista, p("b", { cliente: "NUEVO" }));
  assert.deepEqual(out.map((x) => x.id), ["a", "b", "c"], "no cambia el orden");
  assert.equal(out[1].cliente, "NUEVO");
});

test("reemplazarPorId NO resucita lo que ya no está", () => {
  // Mismo criterio que moverPedidoAEstado ("update, no upsert"): un pedido que
  // otro dispositivo borró no debe reaparecer porque a mí me falló una escritura.
  const lista = [p("a")];
  const out = reemplazarPorId(lista, p("zzz"));
  assert.equal(out, lista, "misma referencia: no pasó nada");
  assert.equal(out.length, 1);
});

test("reemplazarPorId aguanta nulos", () => {
  const lista = [p("a")];
  assert.equal(reemplazarPorId(lista, null), lista);
  assert.deepEqual(reemplazarPorId(null, p("a")), []);
});

// ---------------------------------------------------------------------
// LA CARRERA: el motivo de que este módulo exista
// ---------------------------------------------------------------------

test("CARRERA: deshacer una entrega fallida no borra lo que pasó durante el await", () => {
  // Guion real:
  //   1. Hay 3 pedidos. El despachador entrega el "b".
  //   2. Mientras la base responde (segundos), crea una remisión: entra "rem1".
  //   3. La escritura de la entrega falla y hay que devolver "b" a despacho.
  //
  // Con la foto vieja, el revert dejaba la lista como en el paso 1 y la remisión
  // recién creada DESAPARECÍA de la pantalla, aunque sí se había guardado.
  const pedidoEntregado = p("b");
  const inicial = [p("a"), pedidoEntregado, p("c")];

  const trasEntregar = quitarPorId(inicial, "b");            // 1-2: cambio optimista
  const durante = [...trasEntregar, p("rem1")];              //  3: llega la remisión

  // Lo que hacía el código viejo:
  const conFoto = inicial;
  assert.ok(!conFoto.some((x) => x.id === "rem1"), "la foto vieja se come la remisión");

  // Lo que hace ahora:
  const revertido = reponerPorId(durante, pedidoEntregado);
  assert.deepEqual(revertido.map((x) => x.id).sort(), ["a", "b", "c", "rem1"]);
});

test("CARRERA: deshacer no resucita un pedido borrado durante el await", () => {
  // El reverso: si durante el await el usuario borra "a", el revert de MI
  // entrega no puede traerlo de vuelta. Solo repone lo mío.
  const pedidoEntregado = p("b");
  const trasEntregar = quitarPorId([p("a"), pedidoEntregado], "b");
  const durante = quitarPorId(trasEntregar, "a");            // el usuario borra "a"

  const revertido = reponerPorId(durante, pedidoEntregado);
  assert.deepEqual(revertido.map((x) => x.id), ["b"], "vuelve b, NO vuelve a");
});

test("CARRERA: el historial se limpia quitando, no restaurando la foto", () => {
  // Al fallar la entrega hay que sacar el pedido del historial. Si en ese rato
  // se entregó otro pedido, restaurar la foto lo borraría del historial aunque
  // sí se hubiera guardado.
  const historialInicial = [p("viejo1")];
  const conMiEntrega = [p("b"), ...historialInicial];
  const durante = [p("otro"), ...conMiEntrega];              // otro pedido se entregó

  const revertido = quitarPorId(durante, "b");
  assert.deepEqual(revertido.map((x) => x.id), ["otro", "viejo1"], "el otro sobrevive");
});
