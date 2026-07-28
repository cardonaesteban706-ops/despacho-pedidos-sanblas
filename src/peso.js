// peso.js
//
// Cuántos kilos pesa lo que sale de la bodega. Vivía en DespachoPedidos.jsx, y
// sacarlo tiene dos motivos: PedidoCard y GrupoCard lo necesitan para mostrar
// la carga (no podían mudarse sin él), y es lógica PURA —sin React, sin
// Supabase—, así que por fin se puede probar con `npm test`.
//
// De acá salen dos números distintos que conviene no confundir:
//   - cargaDePedido      : kilos que YA salieron. Es el número del Panel.
//   - cargaPorEntregar   : kilos que TODAVÍA hay que subir al vehículo. Es el
//                          de la tarjeta, y el que se compara contra la
//                          capacidad del camión.
// La diferencia está en qué cantidad multiplica cada uno (ver saldo.js).

import { normalizarTexto } from "./constants.js";
import { entregadoParaPanelDe, saldoDe } from "./saldo.js";

// Peso (en kg) de UNA unidad de material tal como sale en la factura —un bulto,
// una varilla, un bloque…—, según fichas técnicas colombianas. La "carga" del
// día son los kilos movidos = peso × cantidad, sumados. Ajusta los kg o agrega
// categorías cuando haga falta. El ORDEN importa: se usa la primera categoría
// cuya palabra clave aparezca en la descripción, así que las más específicas
// (bloque, ladrillo, pegante) van antes que las genéricas (cemento).
export const PESO_POR_DEFECTO = 1; // material desconocido: cuenta 1 kg (no lo dejamos en 0)
export const CATEGORIAS_PESO = [
  { nombre: "Pegante / mortero seco", kg: 25, claves: ["pegante", "pegacor", "mega pega", "megapega", "mortero seco", "concreto seco"] },
  { nombre: "Bloque", kg: 12, claves: ["bloque", "bloquelon", "adoquin"] },
  { nombre: "Ladrillo", kg: 3, claves: ["ladrillo", "tolete", "adobe", "farol"] },
  // Cubiertas / tejas. Van ANTES de "Varilla / hierro" a propósito: si una hoja
  // de zinc viene descrita como "corrugada", esa palabra (clave de hierro) le
  // ganaría y la clasificaría mal. Los pesos son estimados de ficha técnica —
  // ajústalos si quieres afinar el Panel. El ORDEN dentro del bloque también
  // importa: las específicas (eternit, arquitectónica, zinc) antes que la
  // genérica "teja".
  { nombre: "Teja fibrocemento (Eternit / Ruralit)", kg: 22, claves: ["eternit", "ruralit", "fibrocemento", "fibrocement"] },
  { nombre: "Teja arquitectónica metálica", kg: 12, claves: ["arquitectonic"] },
  { nombre: "Zinc / hoja de zinc", kg: 5, claves: ["zinc"] },
  { nombre: "Metaldeck / steel deck", kg: 20, claves: ["metaldeck", "metal deck", "steeldeck", "steel deck"] },
  { nombre: "Teja (otra)", kg: 10, claves: ["teja"] },
  // Malla electrosoldada: dos cuadrículas distintas, cada una con su propio peso
  // por lámina. Van ANTES de "Varilla / hierro" a propósito, por el mismo motivo
  // que las tejas: "Varilla" tiene la clave "corrugad", y una MALLA CORRUGADA
  // caía ahí — encima con el cálculo del acero por diámetro, que con el "4mm" de
  // la malla daba ~0,6 kg en vez de 45.
  //
  // La clave es una LISTA = deben aparecer TODAS (ver coincideClave). Antes eran
  // frases exactas y la misma malla escrita en otro orden no coincidía con
  // ninguna: contaba 1 kg en vez de 45. Se pide "malla" Y la cuadrícula, porque
  // exigir solo la cuadrícula haría que una baldosa de 15x15 pesara 45 kg.
  { nombre: "Malla electrosoldada 15x15", kg: 45, claves: [["malla", "15x15"], ["malla", "15 x 15"]] },
  { nombre: "Malla electrosoldada 25x25", kg: 28, claves: [["malla", "25x25"], ["malla", "25 x 25"]] },
  { nombre: "Varilla / hierro", kg: 5, claves: ["varilla", "hierro", "figurado", "estribo", "fleje", "corrugad"] },
  // Alambre negro es para amarre (no es varilla), clave específica para no
  // mezclarlo con alambre galvanizado u otros que pesan distinto.
  { nombre: "Alambre negro (amarre)", kg: 1, claves: ["alambre negro"] },
  { nombre: "Cerámica / piso", kg: 20, claves: ["ceramica", "porcelanato", "baldosa", "enchape"] },
  // Estas dos son de línea SANTA MARTA / MANAURE, que se venden por M² (no por
  // caja) — por eso llevan su propio peso por m², distinto del genérico de
  // arriba. Van con nombre propio para que el Panel diga cuál es cuál.
  { nombre: "Cerámica Santa Marta (por m²)", kg: 18, claves: ["santa marta"] },
  { nombre: "Piso Manaure (por m²)", kg: 18, claves: ["manaure"] },
  { nombre: "Placa yesocartón (drywall)", kg: 22, claves: ["yesocarton", "yeso carton", "drywall", "dry wall"] },
  { nombre: "Arena / gravilla / áridos", kg: 40, claves: ["arena", "gravilla", "triturado", "recebo", "balastro", "arenilla"] },
  // Tubo galvanizado ANTES de "Tubería PVC" para que "tubería galvanizada" no
  // caiga como PVC. Claves específicas ("tubo/tubería galvaniz") para no atrapar
  // otros galvanizados (puntilla, malla, alambre) que no pesan lo mismo.
  { nombre: "Tubo galvanizado", kg: 8, claves: ["tubo galvaniz", "tuberia galvaniz"] },
  // Tubo estructural rectangular (cerrajería/estructuras), NEGRO — no es el
  // mismo producto que "tubo galvanizado". Se diferencia por calibre: el
  // calibre 16 es más grueso (más pesado) que el calibre 18.
  { nombre: "Tubo rectangular estructural (cal. 16)", kg: 19, claves: ["cal16"] },
  { nombre: "Tubo rectangular estructural (cal. 18)", kg: 13, claves: ["cal18"] },
  // Tubo presión y sanitario son PVC pero de línea distinta a "Tubería PVC"
  // genérica de abajo — claves específicas para que no se mezclen entre sí.
  { nombre: "Tubo PVC presión", kg: 2, claves: ["tubo presion"] },
  { nombre: "Tubo sanitario PVC", kg: 8, claves: ["tubo sanitario"] },
  { nombre: "Tubería PVC", kg: 3, claves: ["tuberia", "novafort"] },
  // Tanques de agua, por capacidad — el peso es del tanque VACÍO.
  { nombre: "Tanque de agua 500L", kg: 16, claves: ["tanque 500"] },
  { nombre: "Tanque de agua 1000L", kg: 28, claves: ["tanque 1000", "tanque 1.000", "tanque 1,000"] },
  { nombre: "Tanque de agua 2000L", kg: 48, claves: ["tanque 2000", "tanque 2.000", "tanque 2,000"] },
  { nombre: "Accesorios / menores", kg: 0.2, claves: ["codo", "adaptador", "registro", "tornillo", "puntilla", "silicona", "sifon", "abrazadera", "reduccion"] },
  // Boquilla (lechada de cerámica) siempre viene por bulto de 2kg, y acronal
  // (adhesivo acrílico para pintura/impermeabilización) por kg.
  { nombre: "Boquilla (lechada cerámica)", kg: 2, claves: ["boquilla"] },
  { nombre: "Acronal (adhesivo acrílico)", kg: 1, claves: ["acronal"] },
  { nombre: "Cemento", kg: 50, claves: ["cemento"] },
];





// Una clave puede ser:
//   - un TEXTO      -> basta con que aparezca ("bloque").
//   - una LISTA     -> deben aparecer TODAS, en cualquier orden ["malla","15x15"].
//
// La lista existe por la malla electrosoldada. Sus claves eran frases exactas
// ("malla elect 4mm 15x15"), así que la misma malla escrita con las palabras en
// otro orden no coincidía con ninguna y caía en "desconocido": 1 kg en vez de
// 45. Lo que identifica el material son DOS cosas —que sea malla y de qué
// cuadrícula—, y eso es una Y lógica, no una frase.
const coincideClave = (d, k) => (Array.isArray(k) ? k.every((x) => d.includes(x)) : d.includes(k));

export function categoriaDeProducto(descripcion) {
  const d = normalizarTexto(descripcion);
  for (const cat of CATEGORIAS_PESO) {
    if (cat.claves.some((k) => coincideClave(d, k))) return cat;
  }
  return null;
}



// Cantidad que de verdad se entregó de una línea: si el despachador marcó
// "Material entregado" (cantidadEntregada), esa es la verdad; si no, se asume
// que se entregó todo lo facturado. El Panel usa SIEMPRE esta cantidad — contar
// lo facturado inflaba los kilos cuando la entrega fue incompleta, y contaba
// doble a las facturas madre archivadas (su material ya salió vía remisiones).
// Al cerrar un pedido (botón "Entregado") se deja registrado que salió TODO lo
// facturado. Sin esto, un pedido entregado en dos viajes conservaba el
// cantidadEntregada del primer viaje (ej. 570 de 900) y el Panel contaba ese
// número el día del cierre, perdiendo el resto para siempre. Las facturas
// madre (las que llevan saldo de remisiones) NO se tocan: su material ya se
// contó al salir cada remisión.
//
// cerrarEntregaCompleta era la SÉPTIMA copia de la regla del saldo, y la única
// que quedó fuera de saldo.js. Ahí se había desviado: pisaba lo marcado a mano
// en vez de sumárselo. Se movió a saldo.js, con test (ver saldo.test.mjs).

// Copia 1 de 6 -> saldo.js. Ojo: para el Panel, una línea NUNCA tocada cuenta
// como entregada completa (así el historial viejo no se vacía retroactivamente).
// Esa asimetría está explicada en entregadoParaPanelDe().
export const cantidadEntregadaDe = entregadoParaPanelDe;

// Kilos de una línea de producto: peso unitario de su categoría × cantidad
// realmente entregada. (Solo se usa en el Panel, sobre el historial.)
// Peso de UNA unidad del producto, en kilos. Se resuelve en tres pasos, del
// más exacto al más aproximado:
//   1) el peso escrito en la propia descripción ("50 KG", "42,5 KG", "X 2 Kg").
//      Es el caso más común y el más confiable: el mismo cemento viene en
//      bultos de 50 y de 42,5, así que una tabla fija se quedaba corta.
//   2) varilla: se calcula el peso real del acero con su diámetro y su largo,
//      así no hay que mantener una lista de calibres.
//   3) si no, el peso por categoría de CATEGORIAS_PESO (aproximado).
export function pesoUnitarioDe(prod) {
  const desc = normalizarTexto(prod && prod.descripcion);

  // 1) Kilos escritos en la descripción.
  const mKg = desc.match(/(\d+(?:[.,]\d+)?)\s*(?:kgs?|kilos?)\b/);
  if (mKg) {
    const n = parseFloat(mKg[1].replace(",", "."));
    if (n > 0 && n < 2000) return n;
  }

  const cat = categoriaDeProducto(prod && prod.descripcion);

  // 2) Varilla por diámetro. El acero pesa 0,006165 kg por metro y por mm² de
  //    diámetro (densidad 7850 kg/m³), fórmula estándar de la industria.
  //    Solo se aplica si la categoría resuelta es varilla/hierro, para que un
  //    "MALLA ELECT 4mm" no se confunda con una varilla de 4 mm.
  if (cat && cat.nombre === "Varilla / hierro") {
    let diametro = null;
    const mMm = desc.match(/(\d+(?:[.,]\d+)?)\s*mm\b/);
    if (mMm) diametro = parseFloat(mMm[1].replace(",", "."));
    else {
      // Algunas vienen sin la palabra "mm" ("VARILLA 3/8 X 6Mts 7.0"): se toma
      // el último número suelto si cae en un rango plausible de diámetro.
      const sueltos = desc.match(/(\d+(?:[.,]\d+)?)(?!\s*(?:m|mt|mts|metros|kg|"|''))/g);
      if (sueltos && sueltos.length) {
        const ultimo = parseFloat(sueltos[sueltos.length - 1].replace(",", "."));
        if (ultimo >= 3 && ultimo <= 40) diametro = ultimo;
      }
    }
    if (diametro) {
      const mLargo = desc.match(/x\s*(\d+(?:[.,]\d+)?)\s*m(?:t|ts|etros)?\b/);
      const largo = mLargo ? parseFloat(mLargo[1].replace(",", ".")) : 6; // 6 m es el estándar
      const kg = 0.006165 * diametro * diametro * largo;
      if (kg > 0 && kg < 500) return kg;
    }
  }

  // 3) Aproximado por categoría.
  return cat ? cat.kg : PESO_POR_DEFECTO;
}

export function pesoDeProducto(prod) {
  return pesoUnitarioDe(prod) * cantidadEntregadaDe(prod);
}

// Kilos totales de un pedido: suma de todas sus líneas.
export function cargaDePedido(pedido) {
  const items = pedido && pedido.productos ? pedido.productos : [];
  return items.reduce((sum, p) => sum + pesoDeProducto(p), 0);
}

// Copia 2 de 6 -> saldo.js.
const cantidadPorEntregarDe = saldoDe;

// Kilos de lo que TODAVÍA hay que subir al vehículo. Es el número de la
// tarjeta y el que se compara contra la capacidad del camión: si ya salieron
// remisiones, ese peso ya no cuenta porque ese material no está en la bodega.
export function cargaPorEntregar(pedido) {
  const items = pedido && pedido.productos ? pedido.productos : [];
  return items.reduce((sum, p) => sum + pesoUnitarioDe(p) * cantidadPorEntregarDe(p), 0);
}
