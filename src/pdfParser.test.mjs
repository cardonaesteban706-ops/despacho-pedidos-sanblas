// pdfParser.test.mjs — se corre con `npm test` (usa el runner de Node, sin
// instalar nada).
//
// PARA QUÉ SIRVE ESTO: los parsers son heurísticas de regex sobre el PDF que
// genera World Office. Si algún día cambian el layout de la factura —una columna
// nueva, otro orden, otro nombre de encabezado— los parsers empiezan a leer mal
// o a no leer, y eso termina en un camión que sale incompleto. Estos tests
// congelan cómo se ve HOY una factura y una cotización reales, así que el día
// que algo cambie, sale acá en medio segundo en vez de en la bodega.
//
// Si un test falla después de tocar un parser: NO borres el test. Revisa si
// rompiste un caso que ya funcionaba.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparEnFilas,
  detectTipoDocumento,
  fechaDocumentoDe,
  parseFactura,
  parseCotizacion,
  parseDocumento,
} from "./pdfParser.js";

// ---------------------------------------------------------------------
// Muestras.
//
// IMPORTANTE: la estructura de FACTURA está copiada de una FECV real de 2
// páginas de World Office (los datos del cliente son inventados, la forma no).
// Eso incluye detalles que una muestra inventada no adivina y que son justo los
// que rompen parsers:
//
//   - el encabezado dice "U Medida", no "Unidad";
//   - el pie dice "TOTAL ITÉM" (tilde en la É) y viene FUSIONADO en una sola
//     fila con "CANT. SUBTOTAL DESCUENTO IVA RETEFUENTE TOTAL FACTURA";
//   - los totales van en la fila siguiente, precedidos de texto:
//     "Total líneas o ítems: 25 94 413.529 0 76.671 0 490.200";
//   - las cantidades vienen con coma decimal ("2,00") y la unidad con punto
//     ("Und.");
//   - la fila de vendedor viene fusionada con las dos fechas;
//   - la página 2 REPITE los bloques de dirección y de vendedor antes de su
//     propio encabezado de tabla.
//
// Si algún día World Office cambia el formato, estos tests lo cantan.
// ---------------------------------------------------------------------

const FACTURA = [
  "FERROMATERIALES SAN BLAS S.A.S. NIT 900.123.456-7",
  "FACTURA ELECTRONICA DE VENTA",
  "FECV No. 62781",
  "CLIENTE CLIENTE DE PRUEBA UNO",
  "DIRECCIÓN CIUDAD TELÉFONO",
  "VILLA VALENTINA Morroa 3105551234",
  "FECHA FACTURA FECHA VENCIMIENTO VENDEDOR FORMA DE PAGO",
  "23/07/2026 23/07/2026 BERTHA MARGARITA BUELVAS GARCIA Contado",
  'Código Descripción Cantidad U Medida Valor Unitario IVA Valor IVA Total',
  '1 TUB061 SIFON SANITARIO 2" 2,00 Und. 3.782 19% 718 7.563',
  '2 TUB027 CODO SANITARIO 2" CXC 6,00 Und. 2.521 19% 479 15.126',
  "3 LAD01 LADRILLO TOLETE 1.500,00 Und. 900 19% 171 1.350.000",
  "4 CER22 CERAMICA SANTA MARTA 12,50 M2 35.000 19% 6.650 437.500",
  "5 PIN01 PINTURA BLANCA 5,00 Gal. 95.000 19% 18.050 475.000",
  "6 ARE02 ARENA DE RIO 8,00 M3 40.000 0% 0 320.000",
  "7 INGFLE TRANSPORTE DE CARGA CLIENTE 1,00 Und. 10.000 0% 0 10.000",
  "TOTAL ITÉM CANT. SUBTOTAL DESCUENTO IVA RETEFUENTE TOTAL FACTURA",
  "Total líneas o ítems: 7 34 413.529 0 76.671 0 490.200",
  "VALOR EN LETRA CUATROCIENTOS NOVENTA MIL DOSCIENTOS PESOS M/CTE",
];

const COTIZACION = [
  "FERROMATERIALES SAN BLAS S.A.S.",
  "COTIZACION No. 8891",
  "FECHA PEDIDO",
  "13-jul.-26",
  ", CLIENTE ALFONSO EDUARDO CARDENAS MEZA",
  "DIRECCION CIUDAD TELEFONO",
  "VEREDA LAS PALMAS MORROA 3115559876",
  "VENDEDOR FORMA DE PAGO",
  "CARLOS ANDRES RUIZ Credito",
  "CODIGO DESCRIPCION CANT UND VR UNITARIO IVA TOTAL",
  "BLQ12 BLOQUE No 4 500 Und 1.400 19% 833.000",
  "PEG25 PEGACOR GRIS 25 KG 30 Bulto 22.000 19% 785.400",
  "TUB05 TUBO PRESION 1/2 LINEA AZUL CELTA 6 Und 8.500 19% 60.690",
  "CANT SUBTOTAL",
  "TOTAL PEDIDO",
  "1.679.090",
];

// ---------------------------------------------------------------------

test("agruparEnFilas junta por posición vertical, no por orden del stream", () => {
  // Fragmentos desordenados como llegan del stream, de dos filas visuales.
  const items = [
    { text: "Total", x: 400, y: 500 },
    { text: "1", x: 10, y: 500 },
    { text: "CEMENTO", x: 100, y: 500 },
    { text: "2", x: 10, y: 480 },
    { text: "TEJA", x: 100, y: 480 },
  ];
  assert.deepEqual(agruparEnFilas(items), ["1 CEMENTO Total", "2 TEJA"]);
});

test("agruparEnFilas encadena filas con Y que se desplaza de a poco", () => {
  // 100, 102, 104: el primero y el último distan 4 (más que la tolerancia de 2),
  // pero son la MISMA fila visual. Encadenando contra el último, quedan juntos.
  const items = [
    { text: "A", x: 10, y: 100 },
    { text: "B", x: 20, y: 102 },
    { text: "C", x: 30, y: 104 },
  ];
  // Una sola fila, y dentro de la fila el orden lo da la X (izquierda a
  // derecha), no la Y.
  assert.deepEqual(agruparEnFilas(items), ["A B C"]);
});

test("el pie de la tabla se reconoce con tilde o sin tilde", () => {
  // El documento real dice "TOTAL ITÉM" (tilde en la É) y el regex anterior
  // /TOTAL IT[ÉE]M/i lo cubría, así que ESTO NO ERA UN BUG EN PRODUCCIÓN.
  // Pero era suerte: bastaba con que World Office escribiera "ÍTEM" o "ITEM"
  // para que el pie no se encontrara, el tramo de la tabla se desbordara hasta
  // el final del documento y en una factura de 2 páginas los productos de la
  // página 2 se leyeran DOS VECES (material duplicado en el camión). Ahora se
  // compara sin tildes, así que cualquier escritura funciona. Este test fija
  // esa garantía.
  for (const pie of ["TOTAL ITEM 2", "TOTAL ÍTEM 2", "TOTAL ITÉM 2", "Total Ítem 2"]) {
    const dosPaginas = [
      "Código Descripción Cantidad Unidad Vr IVA ValorIVA Total",
      "1 CEM50 CEMENTO 100 Und 28.000 19% 5.320 2.800.000",
      pie,
      "Página 1 de 2",
      "Código Descripción Cantidad Unidad Vr IVA ValorIVA Total",
      "2 VAR38 VARILLA 48 Und 18.500 19% 3.515 888.000",
      pie,
    ];
    const r = parseFactura(dosPaginas);
    assert.equal(r.productos.length, 2, `con el pie escrito "${pie}" deben salir 2 productos, no repetidos`);
    assert.deepEqual(r.productos.map((p) => p.codigo), ["CEM50", "VAR38"], `pie "${pie}"`);
  }
});

test("detectTipoDocumento distingue factura de cotización", () => {
  assert.equal(detectTipoDocumento(FACTURA), "factura");
  assert.equal(detectTipoDocumento(COTIZACION), "cotizacion");
});

test("una FACTURA que menciona una cotización sigue siendo factura", () => {
  // En ferretería es normal que la factura referencie la cotización aprobada.
  // Antes esto se leía con el parser de cotizaciones: 0 productos, total nulo,
  // y sin disparar la alarma de "líneas no leídas". Se perdía en silencio.
  const conReferencia = [
    ...FACTURA,
    "OBSERVACIONES: Se despacha segun COTIZACION No. 8891 aprobada por el cliente",
  ];
  assert.equal(detectTipoDocumento(conReferencia), "factura");
  const r = parseDocumento(conReferencia);
  assert.equal(r.tipo, "factura");
  assert.equal(r.numeroFactura, "62781");
  assert.equal(r.productos.length, 7);
});

test("fechaDocumentoDe lee la fecha de la factura y la de la cotización", () => {
  assert.equal(fechaDocumentoDe(FACTURA.join(" | ")), "23/07/2026");
  // Cotización: formato "13-jul.-26" -> DD/MM/AAAA.
  assert.equal(fechaDocumentoDe(COTIZACION.join(" | ")), "13/07/2026");
});

test("fechaDocumentoDe: sin etiqueta, toma la fecha MÁS ANTIGUA", () => {
  // La expedición siempre es anterior o igual al vencimiento, pero el orden en
  // que salen del PDF depende de la reconstrucción por coordenadas. Antes se
  // tomaba la primera que apareciera: si salía primero el vencimiento, la app
  // creía que la factura era de un mes después y no la marcaba "Estancada".
  assert.equal(fechaDocumentoDe("algo 23/08/2026 y antes 23/07/2026"), "23/07/2026");
  assert.equal(fechaDocumentoDe("algo 23/07/2026 y luego 23/08/2026"), "23/07/2026");
  // Cruzando año, para confirmar que compara por fecha y no por texto.
  assert.equal(fechaDocumentoDe("01/02/2027 | 31/12/2026"), "31/12/2026");
  assert.equal(fechaDocumentoDe("sin fechas aqui"), null);
  // Con la etiqueta presente, manda la etiqueta y no la más antigua.
  assert.equal(
    fechaDocumentoDe("01/01/2020 | FECHA FACTURA FECHA VENCIMIENTO | 23/07/2026 23/08/2026"),
    "23/07/2026"
  );
});

test("parseFactura saca los datos de cabecera", () => {
  const r = parseFactura(FACTURA);
  assert.equal(r.numeroFactura, "62781");
  assert.equal(r.cliente, "CLIENTE DE PRUEBA UNO");
  assert.equal(r.telefono, "3105551234");
  assert.equal(r.direccion, "VILLA VALENTINA");
  assert.equal(r.vendedor, "BERTHA MARGARITA BUELVAS GARCIA");
  assert.equal(r.total, 490200);
  assert.equal(r.fechaDocumento, "23/07/2026");
});

test("parseFactura lee TODAS las líneas de producto, sin descartar ninguna", () => {
  const r = parseFactura(FACTURA);
  assert.equal(r.productos.length, 7, "deben salir las 7 líneas");
  assert.deepEqual(
    r.productos.map((p) => p.codigo),
    ["TUB061", "TUB027", "LAD01", "CER22", "PIN01", "ARE02", "INGFLE"]
  );
  assert.equal(r.lineasIgnoradas.length, 0, "no debe descartar nada");
});

test("parseFactura respeta los formatos numéricos colombianos", () => {
  const r = parseFactura(FACTURA);
  const porCodigo = Object.fromEntries(r.productos.map((p) => [p.codigo, p]));
  // Miles con punto: 1.500 ladrillos (no 1,5).
  assert.equal(porCodigo.LAD01.cantidad, "1.500,00");
  // Decimal con coma: 12,50 m2.
  assert.equal(porCodigo.CER22.cantidad, "12,50");
  // Unidad con punto ("Gal.") no rompe la línea.
  assert.equal(porCodigo.PIN01.unidad, "Gal.");
  assert.equal(porCodigo.ARE02.unidad, "M3");
});

test("parseFactura suma el IVA por unidad al total de la línea", () => {
  // En la FECV el "Valor IVA" es POR UNIDAD y el "Total" de la columna va SIN
  // IVA. El precio que se muestra debe traer el IVA incluido:
  //   total_con_iva = total_sin_iva + (iva_unitario x cantidad)
  const r = parseFactura(FACTURA);
  const porCodigo = Object.fromEntries(r.productos.map((p) => [p.codigo, p]));
  // Sifón (línea real de la factura): 7.563 + (718 x 2) = 8.999
  assert.equal(porCodigo.TUB061.total, "8999");
  // Ladrillo, con cantidad en miles: 1.350.000 + (171 x 1500) = 1.606.500
  assert.equal(porCodigo.LAD01.total, "1606500");
  // Cerámica con cantidad decimal: 437.500 + round(6.650 x 12,5) = 520.625
  assert.equal(porCodigo.CER22.total, "520625");
  // IVA 0%: el total no cambia.
  assert.equal(porCodigo.ARE02.total, "320000");
});

test("parseFactura avisa de las líneas que no pudo leer, en vez de perderlas", () => {
  // Línea de producto a la que le falta una columna: no se puede interpretar,
  // pero DEBE quedar reportada. Perder material sin avisar es lo peligroso.
  // Se inserta justo ANTES del pie de la tabla, buscándolo en vez de usar un
  // índice fijo: con un número mágico, el test se desalinea solo en cuanto
  // alguien toca el fixture y deja de probar lo que dice probar.
  const iPie = FACTURA.findIndex((l) => /TOTAL IT/i.test(l));
  const conLineaMala = [
    ...FACTURA.slice(0, iPie),
    "8 XXX99 PRODUCTO RARO SIN COLUMNAS",
    ...FACTURA.slice(iPie),
  ];
  const r = parseFactura(conLineaMala);
  assert.equal(r.lineasIgnoradas.length, 1);
  assert.match(r.lineasIgnoradas[0], /XXX99/);
});

test("parseFactura lee facturas de varias páginas", () => {
  // Cada página repite el encabezado de la tabla y su pie "TOTAL ÍTEM", y entre
  // ellas aparecen pies de página que no son productos.
  const dosPaginas = [
    ...FACTURA.slice(0, 19), // hasta TOTAL ÍTEM de la página 1
    "Página 1 de 2",
    "FERROMATERIALES SAN BLAS S.A.S. NIT 900.123.456-7",
    "Código Descripción Cantidad Unidad Vr. Unitario IVA Valor IVA Total",
    "8 VAR38 VARILLA 3/8 X 6Mts 9.5 48 Und 18.500 19% 3.515 888.000",
    "9 ALA01 ALAMBRE NEGRO 8 kg 4.200 19% 798 33.600",
    "TOTAL ÍTEM 9",
    "TOTAL FACTURA",
    "SUBTOTAL IVA TOTAL",
    "7.758.500 678.500 8.437.000",
  ];
  const r = parseFactura(dosPaginas);
  assert.equal(r.productos.length, 9, "las 7 de la página 1 más las 2 de la página 2");
  assert.equal(r.productos[8].codigo, "ALA01");
  assert.equal(r.lineasIgnoradas.length, 0);
});

test("parseFactura no pierde el ítem número 1000 ni más allá", () => {
  // El límite era de 3 dígitos: de la línea 1.000 en adelante no se leía Y
  // TAMPOCO entraba a lineasIgnoradas, porque el filtro de rescate usaba el
  // mismo límite. Se perdía sin avisar.
  const conItemLargo = [
    "Código Descripción Cantidad Unidad Vr. Unitario IVA Valor IVA Total",
    "1000 TOR01 TORNILLO GRANDE 100 Und 500 19% 95 50.000",
    "TOTAL ÍTEM 1000",
  ];
  const r = parseFactura(conItemLargo);
  assert.equal(r.productos.length, 1);
  assert.equal(r.productos[0].codigo, "TOR01");
});

test("parseFactura pega las descripciones partidas en dos líneas", () => {
  const partida = [
    "Código Descripción Cantidad Unidad Vr. Unitario IVA Valor IVA Total",
    "1 TEJA09 TEJA ARQUITECTONICA 6 Und 52.000 19% 9.880 312.000",
    "ATLANTIS 3H",
    "TOTAL ÍTEM 1",
  ];
  const r = parseFactura(partida);
  assert.equal(r.productos.length, 1);
  assert.equal(r.productos[0].descripcion, "TEJA ARQUITECTONICA ATLANTIS 3H");
});

test("parseCotizacion saca los datos de cabecera", () => {
  const r = parseCotizacion(COTIZACION);
  assert.equal(r.numeroFactura, "8891");
  assert.equal(r.cliente, "ALFONSO EDUARDO CARDENAS MEZA");
  assert.equal(r.telefono, "3115559876");
  assert.equal(r.direccion, "VEREDA LAS PALMAS");
  assert.equal(r.vendedor, "CARLOS ANDRES RUIZ");
  assert.equal(r.total, 1679090);
});

test("parseCotizacion lee las líneas de producto", () => {
  const r = parseCotizacion(COTIZACION);
  assert.equal(r.productos.length, 3);
  assert.deepEqual(
    r.productos.map((p) => p.codigo),
    ["BLQ12", "PEG25", "TUB05"]
  );
  // En la cotización el total de la columna YA viene con IVA incluido: se toma
  // tal cual, sin recalcular (confirmado contra un documento real).
  assert.equal(r.productos[0].total, "833000");
  assert.equal(r.productos[0].cantidad, "500");
  assert.equal(r.productos[1].unidad, "Bulto");
  assert.equal(r.lineasIgnoradas.length, 0);
});

test("parseCotizacion toma el celular anotado cuando no hay teléfono registrado", () => {
  const sinTelefono = COTIZACION.map((l) =>
    l === "VEREDA LAS PALMAS MORROA 3115559876" ? "No informada MORROA 111111111" : l
  );
  sinTelefono.splice(9, 0, "cel 3209998877 preguntar por el maestro");
  const r = parseCotizacion(sinTelefono);
  assert.equal(r.telefonoContacto, "3209998877");
});

test("parseDocumento enruta cada documento a su parser", () => {
  assert.equal(parseDocumento(FACTURA).tipo, "factura");
  assert.equal(parseDocumento(COTIZACION).tipo, "cotizacion");
});

test("ningún parser explota con entradas vacías o basura", () => {
  for (const entrada of [[], [""], ["basura sin sentido"], ["   "]]) {
    const f = parseFactura(entrada);
    const c = parseCotizacion(entrada);
    assert.equal(f.productos.length, 0);
    assert.equal(c.productos.length, 0);
    assert.equal(f.total, null);
    assert.equal(c.total, null);
  }
});
