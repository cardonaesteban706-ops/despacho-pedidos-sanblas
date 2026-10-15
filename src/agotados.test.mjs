// agotados.test.mjs — se corre con `npm test`.
//
// Lo que de verdad importa del módulo de Agotados: que Compras salga en el
// orden correcto (agotados primero, luego de menos a más), que reportar dos
// veces el mismo producto no lo duplique, y que "Por proveedor" muestre lo que
// se le puede pedir a quien llegó o llamó.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esAgotado,
  horaCorta,
  cuandoCorto,
  reportesDeHoy,
  reporteAbiertoDe,
  ultimaCantidadPedir,
  catalogoProductos,
  buscarEnCatalogo,
  ordenarParaCompras,
  filtrarCompras,
  proveedoresConocidos,
  alternarProveedor,
  cambiarEstado,
  vistaProveedor,
  resumenProveedores,
} from "./agotados.js";

// Fechas en hora LOCAL para que el test no dependa de la zona del equipo.
const AHORA = new Date(2026, 9, 15, 11, 0); // jue 15 oct 2026, 11:00 a. m.
const en = (dia, h, m = 0) => new Date(2026, 9, dia, h, m).toISOString();

const r = (id, producto, quedan, extra = {}) => ({
  id,
  producto,
  quedan,
  pedir: null,
  reportadoEn: en(15, 8),
  proveedores: [],
  estado: "reportado",
  ...extra,
});

test("0 es Agotado y cualquier número mayor es Pocas unidades", () => {
  assert.equal(esAgotado({ quedan: 0 }), true);
  assert.equal(esAgotado({ quedan: null }), true);
  assert.equal(esAgotado({ quedan: 3 }), false);
});

test("horaCorta escribe la hora como en Colombia", () => {
  assert.equal(horaCorta(en(15, 8, 5)), "8:05 a. m.");
  assert.equal(horaCorta(en(15, 12, 0)), "12:00 p. m.");
  assert.equal(horaCorta(en(15, 0, 30)), "12:30 a. m.");
  assert.equal(horaCorta(en(15, 16, 10)), "4:10 p. m.");
});

test("cuandoCorto dice hoy, ayer, el día de la semana o la fecha", () => {
  assert.equal(cuandoCorto(en(15, 8, 15), AHORA), "hoy 8:15 a. m.");
  assert.equal(cuandoCorto(en(14, 16, 10), AHORA), "ayer 4:10 p. m.");
  assert.equal(cuandoCorto(en(13, 9), AHORA), "mar 13");
  assert.equal(cuandoCorto(en(2, 9), AHORA), "2 oct");
});

test("reportesDeHoy deja solo los de hoy, el más reciente arriba", () => {
  const lista = [r("a", "Tubo", 0, { reportadoEn: en(15, 8) }), r("b", "Varilla", 0, { reportadoEn: en(14, 17) }), r("c", "Estuco", 3, { reportadoEn: en(15, 9) })];
  assert.deepEqual(reportesDeHoy(lista, AHORA).map((x) => x.id), ["c", "a"]);
});

test("reporteAbiertoDe encuentra el mismo producto aunque cambien tildes y mayúsculas", () => {
  const lista = [r("a", "Cerámica piso 45x45 Terracota", 10), r("b", "Estuco plástico", 0, { estado: "llego" })];
  assert.equal(reporteAbiertoDe(lista, "CERAMICA  piso 45x45 terracota").id, "a");
  assert.equal(reporteAbiertoDe(lista, "Estuco plástico"), null, "uno que ya llegó no cuenta: se crea un reporte nuevo");
  assert.equal(reporteAbiertoDe(lista, "  "), null);
});

test("ultimaCantidadPedir sugiere lo último que se pidió de ese producto", () => {
  const lista = [
    r("a", "Tubo PVC 1/2", 0, { pedir: 30, reportadoEn: en(1, 8), estado: "llego" }),
    r("b", "tubo pvc 1/2", 0, { pedir: 40, reportadoEn: en(10, 8), estado: "llego" }),
    r("c", "Tubo PVC 1/2", 0, { pedir: null, reportadoEn: en(12, 8), estado: "llego" }),
  ];
  assert.equal(ultimaCantidadPedir(lista, "Tubo PVC 1/2"), 40);
  assert.equal(ultimaCantidadPedir(lista, "Varilla"), null);
});

test("catalogoProductos: primero World Office por lo más vendido, sin fletes ni repetidos", () => {
  const wo = [
    { descripcion: "TUBO PVC 1/2", veces: 3 },
    { descripcion: "TRANSPORTE DE CARGA CLIENTE", veces: 289 },
    { descripcion: "CEMENTO GRIS KOLCEM", veces: 116 },
  ];
  const reportes = [r("a", "Tubo PVC 1/2", 0), r("b", "Producto escrito a mano", 0)];
  assert.deepEqual(catalogoProductos(reportes, wo), ["CEMENTO GRIS KOLCEM", "TUBO PVC 1/2", "Producto escrito a mano"]);
});

test("buscarEnCatalogo busca por palabras sueltas y pone primero lo que empieza igual", () => {
  const cat = ["Tornillo drywall 6x1", "Tornillo drywall 6x1 1/4", "Tornillo lámina 8x1/2", "Clavo con tornillo"];
  assert.deepEqual(buscarEnCatalogo(cat, "torn dry"), ["Tornillo drywall 6x1", "Tornillo drywall 6x1 1/4"]);
  assert.equal(buscarEnCatalogo(cat, "tornillo")[3], "Clavo con tornillo");
  assert.deepEqual(buscarEnCatalogo(cat, "lamina"), ["Tornillo lámina 8x1/2"]);
  assert.deepEqual(buscarEnCatalogo(cat, ""), []);
});

test("ordenarParaCompras: agotados primero (el más viejo arriba), luego de menos a más", () => {
  const lista = [
    r("pocas14", "Cerámica", 14),
    r("agot-tarde", "Varilla", 0, { reportadoEn: en(15, 9) }),
    r("pocas3", "Estuco", 3),
    r("agot-temprano", "Tubo", 0, { reportadoEn: en(14, 16) }),
  ];
  assert.deepEqual(ordenarParaCompras(lista).map((x) => x.id), ["agot-temprano", "agot-tarde", "pocas3", "pocas14"]);
});

test("filtrarCompras separa abiertos, pedidos y lo que llegó esta semana", () => {
  const lista = [
    r("a", "Tubo", 0),
    r("b", "Varilla", 0, { estado: "pedido" }),
    r("c", "Estuco", 3, { estado: "llego", llegoEn: en(14, 10) }),
    r("d", "Viejo", 3, { estado: "llego", llegoEn: en(1, 10) }),
  ];
  assert.deepEqual(filtrarCompras(lista, "abiertos", AHORA).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(filtrarCompras(lista, "pedido", AHORA).map((x) => x.id), ["b"]);
  assert.deepEqual(filtrarCompras(lista, "llego", AHORA).map((x) => x.id), ["c"]);
});

test("proveedoresConocidos cuenta sin duplicar por mayúsculas, el más usado primero", () => {
  const lista = [r("a", "Tubo", 0, { proveedores: ["PAVCO", "Mayorista Costa"] }), r("b", "Codo", 2, { proveedores: ["pavco"], proveedorPedido: "PAVCO" })];
  assert.deepEqual(proveedoresConocidos(lista), ["PAVCO", "Mayorista Costa"]);
});

test("alternarProveedor agrega y quita sin duplicar", () => {
  assert.deepEqual(alternarProveedor(["Diaco"], "Corona"), ["Diaco", "Corona"]);
  assert.deepEqual(alternarProveedor(["Diaco", "Corona"], "corona"), ["Diaco"]);
  assert.deepEqual(alternarProveedor(["Diaco"], "  "), ["Diaco"]);
});

test("cambiarEstado: Pedido guarda a quién se le pidió y cuándo; volver atrás lo limpia", () => {
  const base = r("a", "Tubo", 0, { proveedores: ["PAVCO"] });
  const pedido = cambiarEstado(base, "pedido", { ahora: AHORA });
  assert.equal(pedido.estado, "pedido");
  assert.equal(pedido.proveedorPedido, "PAVCO", "con un solo proveedor no hay que preguntar");
  assert.equal(pedido.pedidoEn, AHORA.toISOString());

  const aOtro = cambiarEstado(base, "pedido", { proveedor: "Mayorista Costa", ahora: AHORA });
  assert.deepEqual(aOtro.proveedores, ["PAVCO", "Mayorista Costa"], "el proveedor al que se pidió queda asignado");

  const llego = cambiarEstado(pedido, "llego", { ahora: AHORA });
  assert.equal(llego.estado, "llego");
  assert.equal(llego.proveedorPedido, "PAVCO", "llegar no borra a quién se le pidió");

  const atras = cambiarEstado(llego, "reportado");
  assert.equal(atras.estado, "reportado");
  assert.equal(atras.proveedorPedido, null);
  assert.equal(atras.llegoEn, null);
});

test("vistaProveedor: lo que se le puede pedir y lo que ya se le pidió", () => {
  const lista = [
    r("tubo", "Tubo PVC", 0, { proveedores: ["PAVCO", "Mayorista Costa"] }),
    r("sanit", "Tubo sanitario", 2, { proveedores: ["pavco"] }),
    r("codo", "Codo", 8, { proveedores: ["PAVCO"], estado: "pedido", proveedorPedido: "PAVCO" }),
    r("codo2", "Adaptador", 8, { proveedores: ["PAVCO"], estado: "pedido", proveedorPedido: "Mayorista Costa" }),
    r("varilla", "Varilla", 0, { proveedores: ["Diaco"] }),
    r("viejo", "Unión", 0, { proveedores: ["PAVCO"], estado: "llego" }),
  ];
  const v = vistaProveedor(lista, "PAVCO");
  assert.deepEqual(v.porPedir.map((x) => x.id), ["tubo", "sanit"]);
  assert.deepEqual(v.yaPedido.map((x) => x.id), ["codo"]);
});

test("resumenProveedores: fichas con lo pendiente, los que tienen más por pedir primero", () => {
  const lista = [
    r("a", "Tubo", 0, { proveedores: ["PAVCO"] }),
    r("b", "Sanitario", 2, { proveedores: ["PAVCO"] }),
    r("c", "Varilla", 0, { proveedores: ["Diaco"] }),
    r("d", "Codo", 0, { proveedores: ["Corona"], estado: "llego" }),
  ];
  assert.deepEqual(resumenProveedores(lista), [
    { nombre: "PAVCO", porPedir: 2, yaPedido: 0 },
    { nombre: "Diaco", porPedir: 1, yaPedido: 0 },
  ]);
});
