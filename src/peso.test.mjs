// peso.test.mjs — se corre con `npm test`.
//
// PARA QUÉ SIRVE ESTO: de acá salen los kilos del Panel y el número que se
// compara contra la capacidad del camión (3.000 kg). Si el peso se desvía, o
// el dueño lee un resumen falso, o alguien manda a cargar más de lo que aguanta
// el vehículo. Hasta ahora esta lógica vivía enterrada en DespachoPedidos.jsx y
// no se podía probar sin abrir un navegador.
//
// El peso es APROXIMADO a propósito (por eso no se imprime en la tirilla que
// firma el cliente). Lo que estos tests protegen no es la exactitud del kilaje,
// sino las REGLAS: qué gana sobre qué, y que un material desconocido no cuente
// cero.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PESO_POR_DEFECTO,
  categoriaDeProducto,
  pesoUnitarioDe,
  pesoDeProducto,
  cargaDePedido,
  cargaPorEntregar,
} from "./peso.js";

const d = (descripcion, extra = {}) => ({ descripcion, cantidad: "1", ...extra });

// ---------------------------------------------------------------------
// El orden de resolución: descripción > varilla calculada > categoría
// ---------------------------------------------------------------------

test("los kilos ESCRITOS en la descripción mandan sobre la categoría", () => {
  // El mismo cemento viene en bultos de 50 y de 42,5: una tabla fija se queda
  // corta, y por eso lo escrito en la factura gana.
  assert.equal(pesoUnitarioDe(d("CEMENTO GRIS ARGOS 50 KG")), 50);
  assert.equal(pesoUnitarioDe(d("CEMENTO GRIS ARGOS 42,5 KG")), 42.5);
  assert.equal(pesoUnitarioDe(d("cemento blanco 25 kilos")), 25);
});

test("un peso absurdo en la descripción no se cree: cae a la categoría", () => {
  // El filtro (0 < n < 2000) evita que un código o una medida suelta se lea
  // como kilos y mande al Panel un número disparatado.
  const kg = pesoUnitarioDe(d("MATERIAL RARO 99999 KG"));
  assert.ok(kg < 2000, "no puede tomar 99999 como peso unitario");
});

test("la varilla se calcula por diámetro y largo, sin tabla de calibres", () => {
  // Acero: 0,006165 kg por metro y por mm² de diámetro. Varilla de 1/2" (12 mm)
  // por 6 m ≈ 5,3 kg, que es el dato real de ferretería.
  const kg = pesoUnitarioDe(d("VARILLA 1/2 12mm X 6Mts"));
  assert.ok(kg > 5 && kg < 5.7, `esperaba ~5,3 kg y dio ${kg}`);
  // A mayor diámetro, más peso: la fórmula es cuadrática, no lineal.
  assert.ok(pesoUnitarioDe(d("VARILLA 20mm X 6Mts")) > pesoUnitarioDe(d("VARILLA 12mm X 6Mts")));
});

test("una malla de 4mm NO se confunde con una varilla de 4mm", () => {
  // El cálculo del acero solo se aplica si la categoría resuelta es varilla.
  // Sin esa guardia, "MALLA ELECT 4mm 15x15" pesaría gramos en vez de 45 kg.
  assert.equal(categoriaDeProducto("MALLA ELECT 4mm 15x15").nombre, "Malla electrosoldada 15x15");
  assert.ok(pesoUnitarioDe(d("MALLA ELECT 4mm 15x15")) > 20);
});

test("la malla se reconoce escriba como se escriba, no en un solo orden", () => {
  // Las claves de la malla eran FRASES exactas ("malla elect 4mm 15x15"), así
  // que la misma malla con las palabras en otro orden caía en "desconocido" y
  // contaba 1 kg en vez de 45: en un pedido de 20 mallas, el Panel reportaba
  // 20 kg donde salieron 900. Ahora la clave exige las dos partes que de verdad
  // identifican el material —"malla" y la cuadrícula— sin importar el orden ni
  // lo que venga en medio.
  for (const desc of [
    "MALLA ELECTROSOLDADA 15X15 4MM",
    "MALLA ELECT 15X15",
    "MALLA ELECT 4mm 15x15",
    "MALLA 15 X 15",
    "malla electrosoldada 4mm 15x15",
  ]) {
    const cat = categoriaDeProducto(desc);
    assert.ok(cat, `"${desc}" quedó sin categoría`);
    assert.equal(cat.nombre, "Malla electrosoldada 15x15", desc);
    assert.equal(pesoUnitarioDe(d(desc)), 45, desc);
  }
  const c25 = categoriaDeProducto("MALLA ELECTROSOLDADA 25X25 4MM");
  assert.equal(c25.nombre, "Malla electrosoldada 25x25");
  assert.equal(c25.kg, 28, "la de 25x25 pesa distinto que la de 15x15");
});

test("una MALLA CORRUGADA es malla, no varilla", () => {
  // "Varilla / hierro" tiene la clave "corrugad" y se evaluaba ANTES que la
  // malla: una malla electrosoldada corrugada caía en varilla y, peor, le
  // aplicaban el cálculo del acero por diámetro (≈0,6 kg por el "4mm"), aún más
  // lejos de los 45 kg reales.
  const cat = categoriaDeProducto("MALLA ELECTROSOLDADA CORRUGADA 4mm 15x15");
  assert.equal(cat.nombre, "Malla electrosoldada 15x15");
  assert.equal(pesoUnitarioDe(d("MALLA ELECTROSOLDADA CORRUGADA 4mm 15x15")), 45);
});

test("la malla no se traga materiales que solo comparten la medida", () => {
  // La clave exige "malla" ADEMÁS de la cuadrícula: sin eso, cualquier cosa de
  // 15x15 (una baldosa, un perfil) pesaría 45 kg en el Panel.
  const baldosa = categoriaDeProducto("BALDOSA GRANITO 15x15");
  assert.ok(!baldosa || !baldosa.nombre.startsWith("Malla"), "una baldosa no es malla");
  // Y una varilla de verdad sigue siendo varilla.
  assert.equal(categoriaDeProducto("VARILLA 1/2 12mm X 6Mts").nombre, "Varilla / hierro");
});

// ---------------------------------------------------------------------
// Categorías: el ORDEN de la tabla es parte de la regla
// ---------------------------------------------------------------------

test("las categorías específicas ganan a las genéricas", () => {
  // "PEGACOR" contiene material de pega, no cemento a granel: si "cemento"
  // ganara, un bulto de pegante de 25 kg contaría como uno de 50.
  assert.equal(categoriaDeProducto("PEGACOR GRIS 25 KG").nombre, "Pegante / mortero seco");
  assert.equal(categoriaDeProducto("BLOQUE No 4").nombre, "Bloque");
  assert.equal(categoriaDeProducto("LADRILLO TOLETE").nombre, "Ladrillo");
});

test("categoriaDeProducto no distingue tildes ni mayúsculas", () => {
  // Las facturas escriben "CERÁMICA", "Ceramica" y "cerámica" indistintamente.
  const a = categoriaDeProducto("CERAMICA SANTA MARTA");
  const b = categoriaDeProducto("cerámica santa marta");
  assert.deepEqual(a, b);
  assert.ok(a, "debe reconocerse la categoría");
});

test("un material desconocido pesa 1 kg, nunca cero", () => {
  // Contar 0 haría desaparecer del Panel material que sí viajó en el camión.
  // (Un tornillo NO sirve de ejemplo: cae en "Accesorios / menores", 0,2 kg.)
  assert.equal(categoriaDeProducto("GUANTE DE CARNAZA"), null);
  assert.equal(pesoUnitarioDe(d("GUANTE DE CARNAZA")), PESO_POR_DEFECTO);
  assert.ok(PESO_POR_DEFECTO > 0);
});

test("no explota con descripciones vacías o ausentes", () => {
  for (const p of [null, undefined, {}, { descripcion: "" }, { descripcion: null }]) {
    const kg = pesoUnitarioDe(p);
    assert.ok(Number.isFinite(kg) && kg > 0, `entrada ${JSON.stringify(p)} dio ${kg}`);
  }
});

// ---------------------------------------------------------------------
// Los DOS números que no hay que confundir
// ---------------------------------------------------------------------

test("pesoDeProducto cuenta lo ENTREGADO; una línea sin tocar cuenta completa", () => {
  // Es la asimetría de entregadoParaPanelDe: el historial viejo no tiene
  // cantidadEntregada y debe seguir sumando kilos, no vaciarse.
  assert.equal(pesoDeProducto({ descripcion: "CEMENTO 50 KG", cantidad: "10" }), 500);
  assert.equal(pesoDeProducto({ descripcion: "CEMENTO 50 KG", cantidad: "10", cantidadEntregada: 4 }), 200);
});

test("cargaPorEntregar cuenta lo que FALTA, no lo que ya salió", () => {
  // Es el número de la tarjeta: si ya salieron remisiones, ese peso no cuenta
  // porque ese material ya no está en la bodega para subirlo al camión.
  const pedido = { productos: [{ descripcion: "CEMENTO 50 KG", cantidad: "10", cantidadRestante: 4 }] };
  assert.equal(cargaPorEntregar(pedido), 200, "solo los 4 que faltan");
});

test("cargaDePedido: sin cantidadEntregada cuenta COMPLETO, aunque haya saldo", () => {
  // Podría parecer un error —la línea tiene saldo 4 de 10 y aun así cuenta 10—
  // pero es la asimetría deliberada de entregadoParaPanelDe: el historial viejo
  // no tiene cantidadEntregada y debe seguir sumando kilos.
  //
  // No infla el Panel porque una madre nunca llega al historial sin fijar
  // cantidadEntregada: se la ponen crearRemision (rama madreAgotada),
  // descontarMaterialMadre y cerrarEntregaCompleta. Este caso solo existe en
  // pedidos ACTIVOS, que el Panel no cuenta.
  const conSaldo = { productos: [{ descripcion: "CEMENTO 50 KG", cantidad: "10", cantidadRestante: 4 }] };
  assert.equal(cargaDePedido(conSaldo), 500, "cae al facturado: 10 x 50");

  // Ya archivada, con el dato fijado, cuenta lo que de verdad salió directo.
  const archivada = { productos: [{ descripcion: "CEMENTO 50 KG", cantidad: "10", cantidadRestante: 0, cantidadEntregada: 4 }] };
  assert.equal(cargaDePedido(archivada), 200);
});

test("los dos números coinciden cuando no se ha entregado nada", () => {
  const pedido = { productos: [{ descripcion: "CEMENTO 50 KG", cantidad: "10" }] };
  assert.equal(cargaDePedido(pedido), 500);
  assert.equal(cargaPorEntregar(pedido), 500);
});

test("la carga suma todas las líneas y aguanta un pedido vacío", () => {
  const pedido = {
    productos: [
      { descripcion: "CEMENTO 50 KG", cantidad: "2" },   // 100
      { descripcion: "BLOQUE No 4", cantidad: "10" },    // 120
    ],
  };
  assert.equal(cargaDePedido(pedido), 220);
  for (const vacio of [null, undefined, {}, { productos: [] }]) {
    assert.equal(cargaDePedido(vacio), 0);
    assert.equal(cargaPorEntregar(vacio), 0);
  }
});

test("las cantidades en formato colombiano se leen bien", () => {
  // "1.500" son mil quinientos ladrillos, no uno y medio. Con Number() crudo
  // el camión saldría con mil unidades de menos en el cálculo de carga.
  const pedido = { productos: [{ descripcion: "LADRILLO TOLETE", cantidad: "1.500" }] };
  assert.equal(cargaDePedido(pedido), 1500 * 3, "ladrillo = 3 kg");
});
