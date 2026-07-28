// pdfParser.js
//
// Parseo de facturas y cotizaciones de World Office. Módulo PURO: no importa
// pdf.js, ni React, ni Supabase.
//
// Que sea puro es el punto. Esto es la parte MÁS FRÁGIL del proyecto —
// heurísticas de regex sobre el PDF de un tercero que puede cambiar el layout
// sin avisar— y es el punto exacto donde un fallo se convierte en un camión que
// sale incompleto. Sin dependencias, se puede testear con `npm test` en medio
// segundo y sin navegador (ver pdfParser.test.mjs).
//
// La lectura del PDF en sí (que sí necesita pdf.js) vive en pdfExtract.js.

import { parseCantidad } from "./saldo.js";
import { normalizarTexto } from "./constants.js";

// Encabezado y pie de la tabla de productos, comparados SIN TILDES.
//
// Antes se buscaba el pie con /TOTAL IT[ÉE]M/i, que contempla la tilde en la É
// pero no en la Í — y el documento dice "TOTAL ÍTEM". En JavaScript la bandera
// /i no ignora tildes: "Í" no coincide con "I". Resultado: el pie NUNCA se
// encontraba, el tramo de la tabla se extendía hasta el final del documento, y
// en una factura de VARIAS PÁGINAS los productos de la página 2 se leían DOS
// VECES (una en el tramo desbordado de la página 1, otra en su propio tramo).
// Material duplicado en el camión y kilos duplicados en el Panel.
//
// Normalizar en vez de enumerar variantes cubre "ÍTEM", "ITÉM", "ITEM", "Ítem"
// y cualquier combinación que decida escribir el generador del PDF.
const esPieTablaFactura = (l) => /total\s*item/.test(normalizarTexto(l));

// Grupos de rótulos de columna. Cada grupo es UNA columna con sus sinónimos: lo
// que importa es cuántas columnas distintas se reconocen, no cuántas palabras.
const COLUMNAS_TABLA = [
  /\b(codigo|referencia|ref)\b/,
  /\b(descripcion|detalle|producto|articulo|item)\b/,
  /\b(cantidad|cant)\b/,
  /\b(unidad|und|u\s*medida|medida)\b/,
  /\b(valor|vr|precio)\b/,
  /\biva\b/,
  /\b(total|subtotal|importe)\b/,
];

// ¿Esta línea es el encabezado de la tabla de productos?
//
// Antes se exigía literalmente que empezara con "codigo descripcion". Eso ató el
// parser a UN juego de rótulos: con "Item Referencia Detalle Cant..." no se
// encontraba el tramo de la tabla y se perdía el documento COMPLETO —cero
// productos y cero líneas ignoradas, sin nada que mostrarle al usuario—.
//
// Ahora se cuentan columnas reconocidas. Las dos guardias no son opcionales:
//
//   - SIN DÍGITOS: un encabezado nunca trae cantidades ni precios. Es lo que
//     impide que una línea de producto se tome por encabezado.
//   - NO ES EL PIE: "TOTAL ITÉM CANT. SUBTOTAL DESCUENTO IVA RETEFUENTE TOTAL
//     FACTURA" reconoce cuatro columnas y no tiene dígitos, así que pasaría el
//     filtro. Si se aceptara, se abriría un tramo de más y los productos se
//     leerían DOS VECES: material duplicado en el camión y kilos duplicados en
//     el Panel. Ese bug ya ocurrió una vez por otra vía (ver el comentario del
//     pie más abajo) y no puede volver.
const esEncabezadoTabla = (l) => {
  const n = normalizarTexto(l);
  if (/^codigo\s+descripcion/.test(n)) return true; // el formato de siempre
  if (/\d/.test(n)) return false;
  if (esPieTablaFactura(l) || /^cant\s+subtotal/.test(n)) return false;
  return COLUMNAS_TABLA.filter((re) => re.test(n)).length >= 3;
};

// ¿Esta línea PARECE una línea de producto de factura (N° de ítem + código),
// aunque el parser no haya podido leerla? Es el filtro de rescate: lo que caiga
// acá se le muestra al usuario en vez de desaparecer.
//
// Acepta las mismas formas de código que el regex de producto. Cuando eran
// distintos (el rescate exigía [A-Z0-9] puro), un código con guion fallaba en
// los dos y se perdía sin rastro: la peor combinación posible.
const esPosibleLineaProductoFactura = (l) => /^\d{1,4}\s+[A-Z0-9][A-Z0-9.\-]{1,11}\s+\S/i.test(l);

// Reconstruye filas reales a partir de los fragmentos de texto del PDF,
// agrupándolos por su posición vertical (Y) y no por su orden de aparición en el
// stream, que no coincide con el layout visual.
//
// Se ordena por Y y se agrupa encadenando contra el ÚLTIMO fragmento agregado
// (no contra un ancla fija): fragmentos de una misma fila visual con Y = 100,
// 102, 104 quedan juntos aunque el primero y el último disten más que la
// tolerancia. Antes el resultado dependía del orden del stream y podía partir la
// fila de un producto en dos líneas, que el regex descartaba en silencio.
//
// Recibe {text, x, y} y devuelve líneas de texto, así que se testea sin un PDF.
export function agruparEnFilas(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows = [];
  let current = null;
  sorted.forEach((it) => {
    if (!current || Math.abs(current.lastY - it.y) > 2) {
      current = { lastY: it.y, items: [] };
      rows.push(current);
    }
    current.lastY = it.y;
    current.items.push(it);
  });
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows
    .map((r) => r.items.map((it) => it.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Fecha del documento (la que trae impresa la factura o cotización), en
// formato DD/MM/AAAA. Es distinta del día en que se sube el PDF a la app: una
// factura de obra puede subirse semanas después. Se usa para saber hace cuánto
// se generó y marcarla como estancada.
export function fechaDocumentoDe(text) {
  // Factura: "FECHA FACTURA" y debajo 23/07/2026.
  const m1 = text.match(/FECHA\s+FACTURA[\s\S]{0,120}?(\d{2}\/\d{2}\/\d{4})/i);
  if (m1) return m1[1];
  // Cotización: "FECHA PEDIDO" y debajo 13-jul.-26.
  const meses = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
  const m2 = text.match(/FECHA\s+PEDIDO[\s\S]{0,120}?(\d{1,2})[-\/\s]([a-zA-Z]{3})\.?[-\/\s](\d{2,4})/i);
  if (m2) {
    const mes = meses[m2[2].toLowerCase()];
    if (mes) {
      const anio = m2[3].length === 2 ? `20${m2[3]}` : m2[3];
      return `${m2[1].padStart(2, "0")}/${mes}/${anio}`;
    }
  }
  // Último recurso: no hay etiqueta reconocible, así que se juntan TODAS las
  // fechas DD/MM/AAAA del documento y se toma la MÁS ANTIGUA.
  //
  // Antes se tomaba la primera que apareciera. El problema: la factura trae
  // "FECHA FACTURA" y "FECHA VENCIMIENTO" pegadas, y la fecha de expedición
  // SIEMPRE es anterior o igual al vencimiento — pero el orden en que salen del
  // PDF depende de la reconstrucción por coordenadas, no está garantizado. Si
  // salía primero el vencimiento, la app creía que la factura era de un mes
  // después y no la marcaba "Estancada" cuando debía.
  const todas = text.match(/\d{2}\/\d{2}\/\d{4}/g);
  if (!todas || todas.length === 0) return null;
  let masAntigua = null;
  let claveMin = null;
  for (const f of todas) {
    const [d, mm, a] = f.split("/");
    // Clave AAAAMMDD para comparar sin construir objetos Date (que dependerían
    // de la zona horaria).
    const clave = `${a}${mm}${d}`;
    if (claveMin === null || clave < claveMin) {
      claveMin = clave;
      masAntigua = f;
    }
  }
  return masAntigua;
}

// Decide qué parser usar. El orden importa y NO es intercambiable.
//
// Antes bastaba con que apareciera "COTIZACION No" en cualquier parte del texto
// para tratar el documento como cotización. Pero en ferretería es normal que la
// FACTURA referencie la cotización aprobada ("OBSERVACIONES: se despacha según
// COTIZACION No. 8891"), y esa factura entraba por parseCotizacion: 0 productos,
// total nulo y número mal leído. Peor: como parseCotizacion tampoco encontraba
// su encabezado de tabla, lineasIgnoradas quedaba vacío y la alarma roja de
// "líneas no leídas" NO se disparaba. Se perdía en silencio.
//
// Ahora manda la marca propia de la factura electrónica, que una cotización no
// puede tener. Solo si no está se considera cotización. Un documento normal
// (solo uno de los dos marcadores) se clasifica igual que antes.
// ...pero la marca de factura tampoco puede ganar SIEMPRE, y ese era el hueco
// que quedaba: muchas cotizaciones traen en el pie legal una nota del tipo
// "este documento no constituye FACTURA ELECTRÓNICA DE VENTA". Con eso la
// cotización se iba por parseFactura, que no entiende sus columnas, y volvía a
// pasar exactamente lo mismo: 0 productos y 0 líneas ignoradas, en silencio.
//
// Cuando aparecen las DOS marcas desempata el pie de la tabla, que sí es propio
// de cada formato y no se cita de pasada: "TOTAL PEDIDO" solo lo imprime una
// cotización; "TOTAL FACTURA" / "TOTAL ÍTEM", solo una factura. Un documento
// normal (una sola marca) se clasifica igual que siempre.
export function detectTipoDocumento(lines) {
  const text = lines.join(" ");
  const marcaFactura = /FECV\s*No/i.test(text) || /FACTURA\s+ELECTR[ÓO]NICA/i.test(text);
  const marcaCotizacion = /COTIZACION\s+No/i.test(text);
  if (marcaFactura && marcaCotizacion) {
    const pieFactura = /TOTAL\s+FACTURA/i.test(text) || lines.some(esPieTablaFactura);
    if (/TOTAL\s+PEDIDO/i.test(text) && !pieFactura) return "cotizacion";
    return "factura";
  }
  if (marcaFactura) return "factura";
  if (marcaCotizacion) return "cotizacion";
  return "factura";
}

// Parser para Factura Electrónica de Venta (formato World Office / FECV).
export function parseFactura(lines) {
  const text = lines.join(" | ");
  const result = {
    tipo: "factura",
    numeroFactura: null,
    cliente: null,
    telefono: null,
    telefonoContacto: null,
    direccion: null,
    vendedor: null,
    total: null,
    productos: [],
    // Líneas que parecían producto pero el lector no pudo interpretar. Se le
    // muestran al usuario para que no confíe en una lista incompleta.
    lineasIgnoradas: [],
  };

  const fecvMatch = text.match(/FECV\s*No\.?\s*(\d+)/i);
  if (fecvMatch) result.numeroFactura = fecvMatch[1];
  result.fechaDocumento = fechaDocumentoDe(text);

  const clienteLine = lines.find((l) => /^CLIENTE\b/i.test(l));
  if (clienteLine) {
    let rest = clienteLine.replace(/^CLIENTE\s*/i, "");
    const cut = rest.search(/\bPOR CONCEPTO\b/i);
    if (cut !== -1) rest = rest.slice(0, cut);
    result.cliente = rest.trim();
  }

  const headerIdx = lines.findIndex((l) => /DIRECCI[ÓO]N/i.test(l) && /CIUDAD/i.test(l) && /TEL[ÉE]FONO/i.test(l));
  if (headerIdx !== -1 && lines[headerIdx + 1]) {
    const dataLine = lines[headerIdx + 1];
    const telMatch = dataLine.match(/\b3\d{9}\b/);
    if (telMatch) result.telefono = telMatch[0];
    let rest = dataLine;
    if (telMatch) rest = rest.slice(0, dataLine.lastIndexOf(telMatch[0])).trim();
    const words = rest.split(/\s+/);
    if (words.length > 1) {
      words.pop(); // última palabra = ciudad
      result.direccion = words.join(" ").trim();
    } else {
      result.direccion = rest;
    }
  }

  const vendHeaderIdx = lines.findIndex((l) => /VENDEDOR/i.test(l) && /FORMA DE PAGO/i.test(l));
  if (vendHeaderIdx !== -1) {
    for (let j = vendHeaderIdx; j < Math.min(vendHeaderIdx + 2, lines.length); j++) {
      // En la línea del encabezado se quita el texto de las columnas: si la
      // agrupación por Y fusionó encabezado y datos en una sola línea, el
      // regex capturaba "VENDEDOR FORMA DE PAGO JUAN PEREZ" como nombre.
      const linea = j === vendHeaderIdx ? lines[j].replace(/^.*FORMA DE PAGO\s*/i, "") : lines[j];
      const m = linea.match(/(?:\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+)?([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+?)\s+(Contado|Cr[ée]dito)\b/i);
      if (m && m[1].trim().length >= 4) {
        result.vendedor = m[1].trim();
        break;
      }
    }
  }

  const totalHeaderIdx = lines.findIndex((l) => /TOTAL FACTURA/i.test(l));
  if (totalHeaderIdx !== -1) {
    for (let j = totalHeaderIdx + 1; j < Math.min(totalHeaderIdx + 3, lines.length); j++) {
      const nums = lines[j].match(/[\d.,]+/g);
      if (nums && nums.length >= 3) {
        const last = nums[nums.length - 1].replace(/\./g, "");
        const parsed = parseInt(last, 10);
        if (!isNaN(parsed) && parsed > 0) {
          result.total = parsed;
          break;
        }
      }
    }
  }

  // Una factura puede venir en VARIAS páginas, y cada página repite el
  // encabezado de la tabla y su pie "TOTAL ÍTEM". Antes se buscaba solo la
  // PRIMERA aparición de cada uno, así que en una factura de 2 páginas se leía
  // la página 1 y los ítems de la 2 se perdían en silencio. Ahora se recorren
  // todos los tramos (encabezado → pie) del documento.
  const tramos = [];
  lines.forEach((l, i) => {
    if (esEncabezadoTabla(l)) {
      const fin = lines.findIndex((x, j) => j > i && esPieTablaFactura(x));
      tramos.push([i, fin === -1 ? lines.length : fin]);
    }
  });
  for (const [tableHeaderIdx, tableEndIdx] of tramos) {
    // La cantidad acepta separador de miles ("1.500", "1.500,00"): un pedido
    // de 1.500 ladrillos es normal en ferretería, y sin esa alternativa el
    // regex no matcheaba y la línea del producto se descartaba en silencio.
    // El N° de ítem acepta hasta 4 dígitos: con 3 (el límite anterior), una
    // factura de 1.000+ líneas perdía todo de la 1.000 en adelante, y encima
    // el filtro de rescate de abajo usaba el mismo límite, así que esas líneas
    // tampoco entraban a lineasIgnoradas — se perdían sin avisar. La UNIDAD se
    // lee genérica (cualquier palabra corta + dígito opcional para m2/m3) en
    // vez de una lista fija: cualquier unidad no listada descartaba la línea
    // COMPLETA en silencio.
    // El CÓDIGO admite guion y punto ("TUB-061", "CER.22"): con [A-Z0-9] puro
    // esas líneas no matcheaban NI acá NI en el filtro de rescate de abajo, así
    // que el material se perdía sin dejar rastro. La CANTIDAD llega a 6 dígitos
    // por lo mismo: 123456 unidades sin separador de miles se descartaba.
    const productLineRegex = /^(\d{1,4})\s+([A-Z0-9][A-Z0-9.\-]{1,11})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{1,12}\d?\.?)\s+([\d.,]+)\s+(\d{1,2}%)\s+([\d.,]+)\s+([\d.,]+)\s*$/i;
    let pending = null;
    for (let i = tableHeaderIdx + 1; i < tableEndIdx; i++) {
      const line = lines[i].trim();
      const m = line.match(productLineRegex);
      if (m) {
        // En la factura (FECV), "Valor IVA" viene por unidad, no por línea.
        // El "Total" de la columna NO incluye IVA (es cantidad x valor unitario).
        // Para mostrar el precio con IVA incluido: total_linea_sin_iva + (valor_iva_unitario x cantidad).
        const cantLinea = parseCantidad(m[4]);
        const valorIvaUnitario = parseInt(m[8].replace(/\./g, ""), 10) || 0;
        const totalSinIva = parseInt(m[9].replace(/\./g, ""), 10) || 0;
        const ivaLinea = Math.round(valorIvaUnitario * cantLinea);
        const totalConIva = totalSinIva + ivaLinea;

        result.productos.push({
          codigo: m[2],
          descripcion: m[3].trim(),
          cantidad: m[4],
          unidad: m[5],
          total: String(totalConIva),
        });
        pending = result.productos[result.productos.length - 1];
      } else if (
        pending &&
        line.length > 0 &&
        line.length < 30 &&
        !/^\d/.test(line) &&
        // Con PDFs de varias páginas, entre el final de una página y el inicio
        // de la otra aparecen pies/encabezados repetidos ("Página 1 de 2",
        // "Código Descripción...", NIT, etc.) que no son continuación de nada.
        // "Observaciones", "Son:", "VALOR EN LETRA"... son rótulos del documento,
        // no continuación de nada. Terminaban DENTRO del nombre del material
        // ("LADRILLO TOLETE Observaciones") y eso se imprime en la tirilla que
        // firma el cliente.
        !/p[áa]gina|c[óo]digo|descripci[óo]n|nit\b|fecv|cliente|tel[ée]fono/i.test(line) &&
        !/^(observaci|son:|valor en letra|total|subtotal|direcci|vendedor|forma de pago|ciudad)/i.test(line)
      ) {
        // Continuación de una descripción larga partida en 2 líneas (ej: "3H", "ATLANTIS")
        pending.descripcion = pending.descripcion + " " + line;
      } else if (esPosibleLineaProductoFactura(line)) {
        // Parece línea de producto (N° ítem + código) pero no se pudo leer.
        result.lineasIgnoradas.push(line);
      }
    }
  }

  // ÚLTIMA RED. Todo lo de arriba ocurre DENTRO de un tramo encontrado: si no se
  // reconoció ningún encabezado de tabla, no hay tramo, no se recorre nada y
  // lineasIgnoradas queda vacío. Ese era el silencio más peligroso — el
  // documento entero desaparecía sin una sola señal.
  //
  // Acá se barre el documento completo y se registra lo que parezca producto.
  // No se intenta parsearlo (sin encabezado no se sabe qué columna es cuál):
  // la gracia es que el usuario VEA que había material y que no se leyó.
  if (tramos.length === 0) {
    for (const l of lines) {
      const line = l.trim();
      if (esPosibleLineaProductoFactura(line)) result.lineasIgnoradas.push(line);
    }
  }

  return result;
}

// Parser para Cotización (mismo proveedor, formato de columnas distinto: sin
// columna de "Valor IVA" en pesos, y el bloque de cliente/dirección/vendedor
// está ordenado de forma distinta a la factura).
export function parseCotizacion(lines) {
  const text = lines.join(" | ");
  const result = {
    tipo: "cotizacion",
    numeroFactura: null,
    cliente: null,
    telefono: null,
    telefonoContacto: null,
    direccion: null,
    vendedor: null,
    total: null,
    productos: [],
    // Líneas que parecían producto pero el lector no pudo interpretar. Se le
    // muestran al usuario para que no confíe en una lista incompleta.
    lineasIgnoradas: [],
  };

  const numMatch = text.match(/COTIZACION No\.?\s*(\d+)/i);
  if (numMatch) result.numeroFactura = numMatch[1];
  result.fechaDocumento = fechaDocumentoDe(text);

  // Anclado al inicio de línea, igual que el replace de abajo: sin ancla,
  // una línea anterior con "CLIENTE" en el medio (p. ej. un encabezado
  // fusionado) se elegía y quedaba entera como nombre del cliente.
  const clienteLine = lines.find((l) => /^,?\s*CLIENTE\b/i.test(l));
  if (clienteLine) {
    let rest = clienteLine.replace(/^,?\s*CLIENTE\s*/i, "");
    const cut = rest.search(/\bP[áa]gina\b/i);
    if (cut !== -1) rest = rest.slice(0, cut);
    result.cliente = rest.trim();
  }

  const headerIdx = lines.findIndex((l) => /DIRECCION/i.test(l) && /CIUDAD/i.test(l) && /TELEFONO/i.test(l));
  if (headerIdx !== -1) {
    for (let j = headerIdx + 1; j < Math.min(headerIdx + 4, lines.length); j++) {
      const l = lines[j];
      if (/No informada/i.test(l) || /\d{6,10}/.test(l)) {
        const nums = l.match(/\d{6,10}/g);
        if (nums) result.telefono = nums[nums.length - 1];
        let rest = l.replace(/\d{6,10}\s*$/, "").trim();
        const words = rest.split(/\s+/);
        if (words.length > 1 && !/No informada/i.test(rest)) {
          words.pop();
          result.direccion = words.join(" ").trim();
        } else {
          result.direccion = rest;
        }
        break;
      }
    }
  }

  // Cuando el teléfono oficial no está registrado, a veces el asesor anota un
  // celular de contacto real en la línea de "información extra" bajo el
  // encabezado VENDEDOR/FORMA DE PAGO.
  if (!result.telefono || result.telefono === "111111111") {
    const celLine = lines.find((l) => /\bcel\b/i.test(l) && /\b3\d{9}\b/.test(l));
    if (celLine) {
      const celMatch = celLine.match(/\b3\d{9}\b/);
      if (celMatch) result.telefonoContacto = celMatch[0];
    }
  }

  const vendHeaderIdx = lines.findIndex((l) => /VENDEDOR/i.test(l) && /FORMA DE PAGO/i.test(l));
  if (vendHeaderIdx !== -1) {
    for (let j = vendHeaderIdx + 1; j < Math.min(vendHeaderIdx + 3, lines.length); j++) {
      const m = lines[j].match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+?)\s+(Contado|Cr[ée]dito)\b/i);
      if (m) {
        result.vendedor = m[1].trim();
        break;
      }
    }
  }

  const totalHeaderIdx = lines.findIndex((l) => /TOTAL PEDIDO/i.test(l));
  if (totalHeaderIdx !== -1 && lines[totalHeaderIdx + 1]) {
    const nums = lines[totalHeaderIdx + 1].match(/[\d.,]+/g);
    if (nums && nums.length) {
      const last = nums[nums.length - 1].replace(/\./g, "");
      const parsed = parseInt(last, 10);
      if (!isNaN(parsed) && parsed > 0) result.total = parsed;
    }
  }

  // Igual que en la factura: se recorren TODOS los tramos (una cotización de
  // varias páginas repite el encabezado y el pie en cada una).
  // Mismo cuidado con las tildes que en la factura: el encabezado y el pie se
  // comparan normalizados, no letra por letra.
  const tramos = [];
  lines.forEach((l, i) => {
    if (esEncabezadoTabla(l)) {
      const fin = lines.findIndex((x, j) => j > i && /^cant\s+subtotal/.test(normalizarTexto(x)));
      tramos.push([i, fin === -1 ? lines.length : fin]);
    }
  });
  for (const [tableHeaderIdx, tableEndIdx] of tramos) {
    // Igual que en la factura: la cantidad acepta separador de miles.
    // La UNIDAD se lee genérica (cualquier palabra corta, con dígito opcional
    // para m2/m3). Antes era una lista fija y cualquier unidad que no estuviera
    // ahí hacía que la línea COMPLETA se descartara en silencio: "galon" fue el
    // caso real (la lista tenía "Gal." y se atoraba con el "on"). Perder una
    // línea sin avisar es peligroso — por eso además contamos las descartadas.
    // Mismo criterio que en la factura: el código admite guion y punto, y la
    // cantidad llega a 6 dígitos.
    const productLineRegex = /^([A-Z0-9][A-Z0-9.\-]{1,11})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?)\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{1,12}\d?\.?)\s+([\d.,]+)\s+(\d{1,2}%)\s+([\d.,]+)\s*$/i;
    for (let i = tableHeaderIdx + 1; i < tableEndIdx; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(productLineRegex);
      if (m) {
        result.productos.push({
          codigo: m[1],
          descripcion: m[2].trim(),
          cantidad: m[3],
          unidad: m[4],
          total: m[7].replace(/\./g, ""),
        });
      } else if (/^[A-Z0-9][A-Z0-9.\-]{1,11}\s+\S.*\d[\d.,]*\s*$/i.test(line) && /\d{1,2}%/.test(line)) {
        // Parece una línea de producto (empieza con código, termina en número y
        // trae el % de IVA) pero no se pudo leer: la registramos para avisarle
        // al usuario en vez de perderla en silencio. El filtro es estricto a
        // propósito para no marcar encabezados o pies de página.
        result.lineasIgnoradas.push(line);
      }
    }
  }

  return result;
}

export function parseDocumento(lines) {
  const tipo = detectTipoDocumento(lines);
  return tipo === "cotizacion" ? parseCotizacion(lines) : parseFactura(lines);
}
