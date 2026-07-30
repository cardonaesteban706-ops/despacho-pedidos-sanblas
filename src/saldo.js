import { formatCantidad } from "./constants.js";

// saldo.js
//
// FUENTE ÚNICA DE VERDAD del saldo de una línea de producto.
//
// Por qué existe este archivo: la regla "cuánto falta por entregar de esta
// línea" estaba escrita SEIS veces en el proyecto (disponibleDe,
// cantidadPorEntregarDe, faltantesDeProductos, el `dispo` de RemisionModal, el
// `dispo` de DescontarMaterialModal y el `enrich` de PorEntregar). Cada vez que
// una de esas copias se desviaba de las otras aparecía un bug de saldo: el
// Panel inflaba kilos, la tarjeta mostraba "Completo" mientras "Por entregar"
// decía "quedan 60", o el modal de remisión ofrecía material que ya salió.
// Ahora la regla vive AQUÍ y nada más. Si hay que cambiarla, se cambia en un
// solo lugar.
//
// ---------------------------------------------------------------------
// LAS TRES FORMAS DE DATO QUE CONVIVEN (todas se siguen leyendo igual)
// ---------------------------------------------------------------------
// Una línea de producto puede venir de tres épocas distintas de la app, y las
// filas viejas de la base de datos NO se migran: se leen tal como están.
//
//   A) { cantidad }
//      Línea nunca tocada. No se ha entregado nada... o es una fila vieja del
//      historial de antes de que existiera el marcado por unidades, en la que
//      se asume que salió todo. Ver entregadoParaPanelDe() abajo: esa
//      distinción es la razón de que "saldo" y "entregado" NO sean dos caras
//      de la misma moneda.
//
//   B) { cantidad, cantidadEntregada }
//      Sistema de "Material entregado" (marcado a mano). Salió
//      cantidadEntregada, falta el resto.
//
//   C) { cantidad, cantidadRestante }
//      Sistema de remisiones. Falta cantidadRestante; el resto ya salió
//      repartido en remisiones hijas.
//
//   B+C) { cantidad, cantidadEntregada, cantidadRestante }
//      Las dos cosas a la vez: una factura con remisiones a la que además se
//      le marcó material entregado directo (en el mostrador, sin remisión).
//      Es un estado LEGÍTIMO, y el invariante que lo gobierna es:
//
//          cantidad = cantidadRestante        (lo que falta)
//                   + cantidadEntregada       (lo que salió directo)
//                   + Σ remisiones hijas      (lo que salió remisionado)
//
//      cantidadRestante siempre manda para el saldo. cantidadEntregada cuenta
//      SOLO lo que salió directo contra esta fila: el material de las
//      remisiones ya lo contó el Panel el día que salió cada remisión, y
//      volver a sumarlo aquí era el doble conteo.
// ---------------------------------------------------------------------

// Convierte una cantidad en formato colombiano a número. "1.500" y "1.500,25"
// usan punto de miles y coma decimal (grupos de 3 dígitos); "2.5" o "2,5" usan
// el separador como decimal.
export function parseCantidad(s) {
  const str = String(s ?? "").trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(str)) {
    return parseFloat(str.replace(/\./g, "").replace(",", ".")) || 0;
  }
  return parseFloat(str.replace(",", ".")) || 0;
}

// Cantidad como número. Los productos ya vienen parseados, pero si acaso llega
// un string lo normalizamos con la misma lógica colombiana.
export function cantidadNum(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  return parseCantidad(v);
}

// Lo FACTURADO en la línea (el número que trae el PDF). Es el techo de todo.
export function facturadoDe(prod) {
  return cantidadNum(prod && prod.cantidad);
}

// Lo que TODAVÍA falta por sacar de la bodega para esta línea.
// Es la única función que decide esto en toda la app.
export function saldoDe(prod) {
  if (!prod) return 0;
  const total = facturadoDe(prod);
  // 1) Si la factura tiene remisiones, manda el saldo que dejaron.
  if (prod.cantidadRestante !== undefined && prod.cantidadRestante !== null) {
    // Se acota a [0, facturado] a propósito: un dato viejo inconsistente no
    // debe poder producir un saldo negativo ni mayor que lo facturado.
    return Math.min(total, Math.max(0, cantidadNum(prod.cantidadRestante)));
  }
  // 2) Si no, es lo facturado menos lo que se marcó a mano como entregado.
  if (prod.cantidadEntregada !== undefined && prod.cantidadEntregada !== null) {
    return Math.max(0, total - cantidadNum(prod.cantidadEntregada));
  }
  // 3) Línea sin tocar: falta todo.
  return total;
}

// Cuánto de esta línea salió DIRECTO (a mano, sin remisión). Es lo que el
// Panel debe contar de esta fila.
//
// OJO — esto NO es `facturado - saldo`, y la diferencia es deliberada:
// una fila sin marcar (forma A) tiene saldo = facturado, pero para el Panel
// cuenta como entregada COMPLETA. Ese fallback es lo que hace que el historial
// viejo (filas de antes del marcado por unidades) siga sumando kilos en el
// Panel en vez de aparecer en cero. Si se derivara del saldo, el Panel se
// vaciaría retroactivamente.
export function entregadoParaPanelDe(prod) {
  if (prod && prod.cantidadEntregada !== undefined && prod.cantidadEntregada !== null) {
    return cantidadNum(prod.cantidadEntregada);
  }
  return facturadoDe(prod);
}

// Lo que se lleva marcado a mano hasta ahora, en crudo y SIN ningún fallback:
// si nadie ha marcado nada, es 0. Se usa para calcular el techo del modal.
export function marcadoAManoDe(prod) {
  if (prod && prod.cantidadEntregada !== undefined && prod.cantidadEntregada !== null) {
    return cantidadNum(prod.cantidadEntregada);
  }
  return 0;
}

// Techo editable en el modal de "Material entregado": lo que queda en bodega
// MÁS lo que ya se había marcado a mano. Nunca incluye lo que salió por
// remisiones — ese material ya no está para volver a entregarlo.
//
// Equivale a: facturado − (lo que salió remisionado).
//
//   forma A  (100)                      -> saldo 100 + mano  0 = 100
//   forma B  (100, entregada 30)        -> saldo  70 + mano 30 = 100
//   forma C  (100, restante 60)         -> saldo  60 + mano  0 =  60  <- el fix
//   forma B+C(100, restante 40, ent 20) -> saldo  40 + mano 20 =  60
//
// En la forma C el tope era 100 y por ahí entraba el doble conteo del Panel.
export function topeEditableDe(prod) {
  return saldoDe(prod) + marcadoAManoDe(prod);
}

// Valor con el que ARRANCA el input del modal de "Material entregado".
// Arranca en CERO: el despachador marca desde abajo lo que SÍ salió (igual que
// "Descontar material"), en vez de bajar desde "todo entregado". Es más claro y
// evita el error de dejar marcado de más sin querer. El caso "salió completo"
// NO pasa por aquí: lo resuelve el botón "Entregado".
//   - ya se marcó antes -> ese valor, para poder corregirlo;
//   - cualquier otro caso (con o sin remisiones) -> 0.
export function valorInicialMaterialDe(prod) {
  if (prod && prod.cantidadEntregada !== undefined && prod.cantidadEntregada !== null) {
    return cantidadNum(prod.cantidadEntregada);
  }
  return 0;
}

// Aplica en una línea el resultado del modal "Material entregado", dejando el
// par (cantidadEntregada, cantidadRestante) COHERENTE — que es justo lo que no
// pasaba antes.
//
//   entregadoDirecto = cuántas unidades salieron directo en total.
//   El saldo nuevo es lo que sobra del tope editable.
//
// Solo se escribe cantidadRestante si la línea YA lo tenía: a una factura sin
// remisiones no le inventamos el campo (se sigue comportando con la forma B,
// que es la que entienden las filas viejas).
export function aplicarEntregadoDirecto(prod, entregadoDirecto) {
  const tope = topeEditableDe(prod);
  const n = Math.min(tope, Math.max(0, cantidadNum(entregadoDirecto)));
  const out = { ...prod, cantidadEntregada: n };
  if (prod && prod.cantidadRestante !== undefined && prod.cantidadRestante !== null) {
    out.cantidadRestante = Math.max(0, tope - n);
  }
  return out;
}

// Igual que aplicarEntregadoDirecto, pero recibe un INCREMENTO en vez del total.
//
// Existe porque son dos preguntas distintas y confundirlas costaba material:
//   - "Material entregado" pregunta el TOTAL que lleva salido    -> aplicarEntregadoDirecto
//   - "Descontar material" pregunta cuánto se llevó AHORA MISMO  -> esta
//
// Al sumar sobre lo ya marcado, el par (cantidadEntregada, cantidadRestante)
// queda coherente aunque se descuente varias veces seguidas.
export function sumarEntregadoDirecto(prod, usadoAhora) {
  return aplicarEntregadoDirecto(prod, marcadoAManoDe(prod) + Math.max(0, cantidadNum(usadoAhora)));
}

// Cierra una línea como "salió todo lo que faltaba" (botón "Entregado").
//
// Vivía suelta en DespachoPedidos.jsx: era la SÉPTIMA copia de la regla del
// saldo y la única que quedó fuera de este archivo. Ahora está acá, con test.
export function cerrarEntregaCompleta(productos) {
  return (productos || []).map((p) => {
    // Factura con remisiones: lo que sale HOY es solo el saldo que quedaba
    // (lo demás ya se contó al entregar cada remisión). Se deja el saldo en
    // cero para que no vuelva a contarse.
    if (p.cantidadRestante !== undefined && p.cantidadRestante !== null) {
      // topeEditableDe = saldo + lo marcado a mano, o sea TODO lo que salió
      // directo contra esta fila (sin lo remisionado, que ya se contó aparte).
      //
      // Antes acá iba `cantidadRestante` a secas, y eso PISABA lo marcado a
      // mano en vez de sumárselo: en una factura de 100 con remisión de 40 y 20
      // entregados en el mostrador, al cerrar quedaba cantidadEntregada = 40 y
      // los 20 del mostrador desaparecían de los kilos del Panel para siempre.
      //
      // El Math.min es para las filas viejas inconsistentes (un cantidadRestante
      // mayor que lo facturado): sin él, el Panel inflaba kilos que nunca
      // salieron. Es el mismo blindaje que ya tiene saldoDe.
      return {
        ...p,
        cantidadEntregada: Math.min(facturadoDe(p), topeEditableDe(p)),
        cantidadRestante: 0,
      };
    }
    return { ...p, cantidadEntregada: p.cantidad };
  });
}

// ---------------------------------------------------------------------
// Faltantes: qué material quedó debiendo un pedido.
// ---------------------------------------------------------------------
// Vivían en DespachoPedidos.jsx. Son reglas de saldo puras y ya leían de
// acá, así que su sitio es este archivo: PedidoCard las necesita para
// pintar el aviso rojo, y dejarlas en el monolito lo habría amarrado.

// Seguimiento de material por unidades: un producto "tocado" tiene el campo
// cantidadEntregada. Devuelve los productos donde se entregaron MENOS unidades
// que las de la factura (con cuántas faltan). Un pedido sin ningún producto
// tocado devuelve lista vacía y se comporta como siempre.
export function faltantesDeProductos(productos) {
  return (productos || [])
    .map((p) => ({
      ...p,
      // Copia 3 de 6 -> saldo.js. OJO a la diferencia con saldoDe puro: una
      // línea sin tocar NO cuenta como faltante (faltan: 0). El aviso rojo de
      // "debe material" solo se prende con lo que alguien declaró faltando, no
      // con un pedido que nadie ha marcado todavía.
      faltan:
        (p.cantidadRestante !== undefined && p.cantidadRestante !== null) ||
        (p.cantidadEntregada !== undefined && p.cantidadEntregada !== null)
          ? saldoDe(p)
          : 0,
    }))
    .filter((p) => p.faltan > 0);
}

// Nota de texto (mismo formato de siempre: "2 tejas; 1 bulto cemento") armada
// a partir de los faltantes por unidades. Se usa al pasar un pedido de
// "Pendientes" a despacho, para no tener que reescribir la nota a mano.
export function notaDesdeFaltantes(productos) {
  const faltan = faltantesDeProductos(productos);
  if (faltan.length === 0) return "";
  return faltan.map((p) => `${formatCantidad(p.faltan)} ${p.unidad || ""} ${p.descripcion || ""}`.replace(/\s+/g, " ").trim()).join("; ");
}
