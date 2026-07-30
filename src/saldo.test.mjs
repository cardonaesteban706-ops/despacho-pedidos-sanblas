// saldo.test.mjs — se corre con `npm test` (runner de Node, sin instalar nada).
//
// PARA QUÉ SIRVE ESTO: saldo.js es la FUENTE DE VERDAD de "cuánto falta por
// entregar de esta línea". De él dependen los kilos del Panel, el "Quedan X de
// Y" de Por entregar, el tope del modal de material y lo que se ofrece para
// remisionar. La regla estuvo copiada SIETE veces en el proyecto y cada copia
// que se desviaba produjo un bug de material. Ahora está en un solo archivo,
// pero hasta hoy no tenía ni un test: nada impedía que la próxima "mejora"
// volviera a desviarla en silencio.
//
// El invariante que gobierna todo el archivo, y que estos tests vigilan:
//
//     cantidad = cantidadRestante + cantidadEntregada + Σ remisiones hijas
//
// Si un test falla después de tocar saldo.js: NO lo borres. Revisa si rompiste
// un caso que ya funcionaba.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCantidad,
  cantidadNum,
  facturadoDe,
  saldoDe,
  entregadoParaPanelDe,
  marcadoAManoDe,
  topeEditableDe,
  valorInicialMaterialDe,
  aplicarEntregadoDirecto,
  sumarEntregadoDirecto,
  cerrarEntregaCompleta,
} from "./saldo.js";

// ---------------------------------------------------------------------
// Las cuatro formas de dato que conviven en la base (ver cabecera de saldo.js).
// Todas salen de una factura de 100 unidades, para poder compararlas de frente.
// ---------------------------------------------------------------------
const FORMA_A = { cantidad: "100" };                                        // nunca tocada
const FORMA_B = { cantidad: "100", cantidadEntregada: 30 };                 // marcado a mano
const FORMA_C = { cantidad: "100", cantidadRestante: 60 };                  // remisión de 40
const FORMA_BC = { cantidad: "100", cantidadRestante: 40, cantidadEntregada: 20 }; // remisión de 40 + 20 a mano

// ---------------------------------------------------------------------
// saldoDe — lo que todavía falta sacar de la bodega
// ---------------------------------------------------------------------

test("saldoDe resuelve las cuatro formas de dato", () => {
  assert.equal(saldoDe(FORMA_A), 100, "sin tocar: falta todo");
  assert.equal(saldoDe(FORMA_B), 70, "facturado menos lo marcado a mano");
  assert.equal(saldoDe(FORMA_C), 60, "manda el saldo que dejaron las remisiones");
  assert.equal(saldoDe(FORMA_BC), 40, "cantidadRestante manda aunque haya marcado a mano");
});

test("saldoDe acota a [0, facturado]: un dato viejo inconsistente no rompe la pantalla", () => {
  // Estos estados NO deberían existir, pero hay filas viejas en la base que no
  // se migran. Si el saldo se saliera del rango, el modal de remisión ofrecería
  // material que no existe (o escondería el que sí).
  assert.equal(saldoDe({ cantidad: "100", cantidadRestante: 999 }), 100, "nunca más que lo facturado");
  assert.equal(saldoDe({ cantidad: "100", cantidadRestante: -5 }), 0, "nunca negativo");
  assert.equal(saldoDe({ cantidad: "100", cantidadEntregada: 999 }), 0, "entregado de más no da saldo negativo");
  assert.equal(saldoDe(null), 0);
  assert.equal(saldoDe(undefined), 0);
  assert.equal(saldoDe({}), 0);
});

test("saldoDe distingue 0 de 'no marcado' (0 es un dato, no un vacío)", () => {
  // Si el chequeo fuera `if (p.cantidadRestante)` en vez de `!== undefined`,
  // una línea con saldo CERO caería al fallback y volvería a mostrar 100.
  assert.equal(saldoDe({ cantidad: "100", cantidadRestante: 0 }), 0);
  assert.equal(saldoDe({ cantidad: "100", cantidadEntregada: 0 }), 100);
});

// ---------------------------------------------------------------------
// entregadoParaPanelDe — la asimetría deliberada
// ---------------------------------------------------------------------

test("entregadoParaPanelDe: una línea sin tocar cuenta como entregada COMPLETA", () => {
  // Esto NO es `facturado - saldo`, y la diferencia es a propósito: el historial
  // viejo (de antes del marcado por unidades) no tiene cantidadEntregada. Si el
  // Panel lo derivara del saldo, esas filas caerían a cero y el Panel se
  // vaciaría retroactivamente. Quien "arregle" esta asimetría rompe el historial.
  assert.equal(entregadoParaPanelDe(FORMA_A), 100);
  assert.equal(entregadoParaPanelDe(FORMA_B), 30);
  assert.equal(entregadoParaPanelDe(FORMA_BC), 20, "solo lo que salió DIRECTO; lo remisionado ya lo contó su remisión");
  assert.equal(entregadoParaPanelDe({ cantidad: "100", cantidadEntregada: 0 }), 0, "cero marcado es cero, no fallback");
});

test("marcadoAManoDe no tiene fallback: sin marcar es 0", () => {
  assert.equal(marcadoAManoDe(FORMA_A), 0);
  assert.equal(marcadoAManoDe(FORMA_C), 0, "lo remisionado no es marcado a mano");
  assert.equal(marcadoAManoDe(FORMA_B), 30);
  assert.equal(marcadoAManoDe(null), 0);
});

// ---------------------------------------------------------------------
// topeEditableDe — el techo del modal "Material entregado"
// ---------------------------------------------------------------------

test("topeEditableDe nunca deja marcar material que ya salió por remisión", () => {
  // El caso C es el fix: el tope era 100 y por ahí entraba el doble conteo del
  // Panel (7.000 kg donde salieron 5.000).
  assert.equal(topeEditableDe(FORMA_A), 100);
  assert.equal(topeEditableDe(FORMA_B), 100);
  assert.equal(topeEditableDe(FORMA_C), 60, "40 ya salieron remisionados: no se pueden volver a entregar");
  assert.equal(topeEditableDe(FORMA_BC), 60);
});

test("topeEditableDe equivale a facturado menos lo remisionado", () => {
  for (const p of [FORMA_A, FORMA_B, FORMA_C, FORMA_BC]) {
    assert.ok(topeEditableDe(p) <= facturadoDe(p), "el tope nunca supera lo facturado");
  }
});

// ---------------------------------------------------------------------
// valorInicialMaterialDe — con qué número abre el input
// ---------------------------------------------------------------------

test("valorInicialMaterialDe arranca en CERO salvo que ya se hubiera marcado", () => {
  // Se marca desde abajo lo que SÍ salió, en vez de bajar desde "todo
  // entregado": evita dejar marcado de más sin querer. El caso "salió completo"
  // lo resuelve el botón "Entregado", no este modal.
  assert.equal(valorInicialMaterialDe(FORMA_A), 0);
  assert.equal(valorInicialMaterialDe(FORMA_C), 0, "con remisiones también arranca en 0");
  assert.equal(valorInicialMaterialDe(FORMA_B), 30, "lo ya marcado se puede corregir");
  assert.equal(valorInicialMaterialDe(FORMA_BC), 20);
});

// ---------------------------------------------------------------------
// aplicarEntregadoDirecto — deja el par (entregada, restante) coherente
// ---------------------------------------------------------------------

// Comprueba el invariante del archivo sobre una línea concreta.
function assertInvariante(prod, remisionado, mensaje) {
  const suma = cantidadNum(prod.cantidadRestante ?? saldoDe(prod)) + marcadoAManoDe(prod) + remisionado;
  assert.equal(suma, facturadoDe(prod), mensaje);
}

test("aplicarEntregadoDirecto mantiene el invariante en las cuatro formas", () => {
  assertInvariante(aplicarEntregadoDirecto(FORMA_A, 40), 0, "forma A");
  assertInvariante(aplicarEntregadoDirecto(FORMA_B, 40), 0, "forma B");
  assertInvariante(aplicarEntregadoDirecto(FORMA_C, 25), 40, "forma C");
  assertInvariante(aplicarEntregadoDirecto(FORMA_BC, 25), 40, "forma B+C");
});

test("aplicarEntregadoDirecto NO le inventa cantidadRestante a una factura sin remisiones", () => {
  // Las filas viejas se comportan con la forma B. Inventarles el campo las
  // metería en la rama de remisiones, donde no pintan nada.
  const r = aplicarEntregadoDirecto(FORMA_A, 40);
  assert.equal("cantidadRestante" in r, false);
  assert.equal(r.cantidadEntregada, 40);
  assert.equal(saldoDe(r), 60);
});

test("aplicarEntregadoDirecto recorta al tope y al piso", () => {
  assert.equal(aplicarEntregadoDirecto(FORMA_C, 100).cantidadEntregada, 60, "no deja marcar lo ya remisionado");
  assert.equal(aplicarEntregadoDirecto(FORMA_C, 100).cantidadRestante, 0);
  assert.equal(aplicarEntregadoDirecto(FORMA_A, -5).cantidadEntregada, 0);
});

// ---------------------------------------------------------------------
// sumarEntregadoDirecto — "Descontar material" (incremento, no total)
// ---------------------------------------------------------------------

test("sumarEntregadoDirecto acumula en vez de reemplazar", () => {
  // Es la diferencia con aplicarEntregadoDirecto: acá el despachador dice
  // cuánto se llevó AHORA, no cuánto lleva en total.
  let p = sumarEntregadoDirecto(FORMA_A, 4);
  assert.equal(p.cantidadEntregada, 4);
  p = sumarEntregadoDirecto(p, 3);
  assert.equal(p.cantidadEntregada, 7, "dos descuentos seguidos se suman");
  assert.equal(saldoDe(p), 93);
});

test("sumarEntregadoDirecto respeta lo que ya salió por remisión", () => {
  const p = sumarEntregadoDirecto(FORMA_BC, 10);
  assert.equal(p.cantidadEntregada, 30, "20 que ya estaban + 10 de ahora");
  assert.equal(p.cantidadRestante, 30);
  assertInvariante(p, 40, "el material remisionado sigue contado aparte");
});

test("sumarEntregadoDirecto no deja descontar más de lo que hay en bodega", () => {
  const p = sumarEntregadoDirecto(FORMA_C, 999);
  assert.equal(p.cantidadEntregada, 60);
  assert.equal(p.cantidadRestante, 0);
});

// ---------------------------------------------------------------------
// cerrarEntregaCompleta — el botón "Entregado"
// ---------------------------------------------------------------------

test("cerrarEntregaCompleta: una línea sin tocar sale completa", () => {
  const [r] = cerrarEntregaCompleta([FORMA_A]);
  assert.equal(cantidadNum(r.cantidadEntregada), 100);
});

test("cerrarEntregaCompleta: una entrega parcial se completa al cerrar", () => {
  // Sin esto, un pedido entregado en dos viajes conservaba el cantidadEntregada
  // del primer viaje y el Panel perdía el resto para siempre.
  const [r] = cerrarEntregaCompleta([FORMA_B]);
  assert.equal(cantidadNum(r.cantidadEntregada), 100);
});

test("cerrarEntregaCompleta: la madre con remisiones solo aporta el saldo que quedaba", () => {
  // Los 40 remisionados ya los contó su remisión el día que salió. Contarlos
  // otra vez acá era el doble conteo del Panel.
  const [r] = cerrarEntregaCompleta([FORMA_C]);
  assert.equal(r.cantidadEntregada, 60);
  assert.equal(r.cantidadRestante, 0, "el saldo queda en cero para que no vuelva a contarse");
});

test("cerrarEntregaCompleta SUMA lo marcado a mano en vez de pisarlo", () => {
  // EL BUG: factura de 100, remisión de 40, luego "Material entregado" 20, y al
  // final el botón "Entregado". Salieron directo 20 (mostrador) + 40 (el saldo
  // que quedaba) = 60. La versión vieja asignaba cantidadEntregada = 40 y los
  // 20 del mostrador desaparecían de los kilos del Panel.
  const [r] = cerrarEntregaCompleta([FORMA_BC]);
  assert.equal(r.cantidadEntregada, 60, "20 marcados a mano + 40 de saldo");
  assert.equal(r.cantidadRestante, 0);
  assert.equal(entregadoParaPanelDe(r), 60, "el Panel cuenta los 60 que de verdad salieron");
});

test("cerrarEntregaCompleta nunca cuenta más de lo facturado", () => {
  // Blindaje contra filas inconsistentes: si entregada + restante se pasaran de
  // lo facturado, el Panel inflaría kilos que nunca salieron.
  for (const p of [FORMA_A, FORMA_B, FORMA_C, FORMA_BC]) {
    const [r] = cerrarEntregaCompleta([p]);
    assert.ok(cantidadNum(r.cantidadEntregada) <= facturadoDe(r), "no infla el Panel");
  }
  const [raro] = cerrarEntregaCompleta([{ cantidad: "100", cantidadRestante: 999, cantidadEntregada: 50 }]);
  assert.ok(raro.cantidadEntregada <= 100);
});

test("cerrarEntregaCompleta aguanta listas vacías o nulas", () => {
  assert.deepEqual(cerrarEntregaCompleta([]), []);
  assert.deepEqual(cerrarEntregaCompleta(null), []);
  assert.deepEqual(cerrarEntregaCompleta(undefined), []);
});

// ---------------------------------------------------------------------
// El ciclo completo: lo que salió de la bodega debe cuadrar con lo facturado
// ---------------------------------------------------------------------

test("CICLO: remisión 40 + mostrador 20 + cierre 40 = los 100 facturados", () => {
  // Este es el test que de verdad protege el número del Panel. Recorre la vida
  // real de una factura grande y suma TODO lo que el Panel va a contar.
  const remisionado = 40;                                   // salió y se contó el día de la remisión
  let linea = { cantidad: "100", cantidadRestante: 60 };     // la madre después de esa remisión

  linea = sumarEntregadoDirecto(linea, 20);                  // el cliente se lleva 20 en el mostrador
  assert.equal(saldoDe(linea), 40, "quedan 40 en bodega");

  const [cerrada] = cerrarEntregaCompleta([linea]);          // sale el resto: botón "Entregado"
  const contadoPorElPanel = entregadoParaPanelDe(cerrada) + remisionado;

  assert.equal(contadoPorElPanel, 100, "ni un kilo perdido, ni uno inventado");
  assert.equal(saldoDe(cerrada), 0, "no queda saldo pendiente");
});

test("CICLO: los descuentos con decimales no dejan un saldo fantasma", () => {
  // 100 − 33,33 × 3 debería dar 0,01. En coma flotante daba
  // 0.010000000000005116, un número que la pantalla NO muestra (recorta a 2
  // decimales) pero que sí se guarda: la línea nunca llegaba a cero, la factura
  // no se archivaba sola y aparecía debiendo un material que ya había salido.
  let linea = { cantidad: "100", cantidadRestante: 100 };
  for (let i = 0; i < 3; i++) linea = sumarEntregadoDirecto(linea, 33.33);
  assert.equal(saldoDe(linea), 0.01, "sin basura de coma flotante");

  // Y cuando el reparto sí cuadra, tiene que quedar exactamente en cero.
  let exacta = { cantidad: "10", cantidadRestante: 10 };
  for (let i = 0; i < 3; i++) exacta = sumarEntregadoDirecto(exacta, 3.33);
  exacta = sumarEntregadoDirecto(exacta, 0.01);
  assert.equal(saldoDe(exacta), 0, "la línea queda agotada de verdad");
});

test("CICLO: descontar todo en el mostrador cuenta los 10, no cero", () => {
  // Antes, descontar material no tocaba cantidadEntregada: al archivarse la
  // factura el Panel contaba 0 kilos aunque hubieran salido los 10.
  let linea = { cantidad: "10" };
  linea = sumarEntregadoDirecto(linea, 4);
  linea = sumarEntregadoDirecto(linea, 6);
  assert.equal(saldoDe(linea), 0, "la factura queda agotada y se archiva sola");
  assert.equal(entregadoParaPanelDe(linea), 10, "los 10 que salieron sí se cuentan");
});

// ---------------------------------------------------------------------
// Números colombianos: coma decimal y punto de miles
// ---------------------------------------------------------------------

test("parseCantidad lee el formato colombiano, no el gringo", () => {
  assert.equal(parseCantidad("1.500"), 1500, "punto de miles, NO 1,5");
  assert.equal(parseCantidad("1.500,50"), 1500.5);
  assert.equal(parseCantidad("1.234.567"), 1234567);
  assert.equal(parseCantidad("2,5"), 2.5, "coma decimal");
  assert.equal(parseCantidad("2.5"), 2.5, "sin grupo de 3 dígitos, el punto es decimal");
  assert.equal(parseCantidad("  12  "), 12);
});

test("parseCantidad no devuelve NaN nunca (un NaN en el saldo vacía la pantalla)", () => {
  for (const basura of ["", "   ", "abc", null, undefined, "Und.", "-"]) {
    assert.equal(parseCantidad(basura), 0, `entrada: ${JSON.stringify(basura)}`);
  }
});

test("cantidadNum acepta números ya parseados y rechaza los rotos", () => {
  assert.equal(cantidadNum(12.5), 12.5);
  assert.equal(cantidadNum(0), 0);
  assert.equal(cantidadNum(NaN), 0);
  assert.equal(cantidadNum(Infinity), 0, "un infinito en los kilos rompe el Panel entero");
  assert.equal(cantidadNum("1.500"), 1500);
});

test("todo el saldo funciona con cantidades en formato colombiano", () => {
  // Las cantidades vienen del PDF como TEXTO ("1.500,00"): si en algún punto se
  // colara un Number() crudo, 1.500 se leería como 1,5 y el camión saldría con
  // mil unidades de menos.
  const grande = { cantidad: "1.500,50", cantidadEntregada: "1.200" };
  assert.equal(facturadoDe(grande), 1500.5);
  assert.equal(saldoDe(grande), 300.5);
  assert.equal(topeEditableDe(grande), 1500.5);
  assert.equal(entregadoParaPanelDe(grande), 1200);

  const conRemision = { cantidad: "1.500", cantidadRestante: "900,25" };
  assert.equal(saldoDe(conRemision), 900.25);
  assert.equal(topeEditableDe(conRemision), 900.25);

  const sumado = sumarEntregadoDirecto({ cantidad: "1.500" }, "2,5");
  assert.equal(sumado.cantidadEntregada, 2.5);
  assert.equal(saldoDe(sumado), 1497.5);
});
