// pdfExtract.js
//
// Lo único que toca pdf.js. Está separado de pdfParser.js para que el parseo
// —la parte frágil— se pueda testear en Node sin bundler ni navegador.
//
// pdf.js ahora es dependencia de npm (pdfjs-dist), no un <script> inyectado
// desde cdnjs en tiempo de ejecución. Antes, si cdnjs no respondía, NO se podía
// subir ninguna factura: la función central de la app dependía de que un CDN
// ajeno estuviera arriba, y encima el script se cargaba sin verificación de
// integridad (si alguna vez sirvieran un archivo alterado, corría con acceso a
// todo). Ahora el código viaja en el bundle, servido desde el mismo dominio.

import * as pdfjsNS from "pdfjs-dist/build/pdf.js";
// pdf.js v3 solo publica UMD. Según cómo lo envuelva el bundler, la API queda en
// la raíz del namespace o bajo .default; se resuelve una sola vez acá.
const pdfjsLib = pdfjsNS.getDocument ? pdfjsNS : pdfjsNS.default;

// El worker se importa como URL de asset: Vite lo copia al build y lo sirve
// desde el mismo dominio. Sin worker, pdf.js corre en el hilo principal y
// congela la interfaz mientras lee un PDF grande.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

import { agruparEnFilas } from "./pdfParser.js";

// Reconstruye las filas de texto de TODAS las páginas del PDF. Las facturas con
// muchos ítems continúan la tabla de productos (y traen el total) en la página 2
// o siguientes.
export async function extractPdfLines(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    // pdf.js usa eval() para compilar fuentes y patrones al RENDERIZAR. Acá solo
    // se extrae texto, así que no hace falta: apagarlo quita esa vía de
    // ejecución de código sobre un archivo que viene de afuera.
    isEvalSupported: false,
  }).promise;

  const allLines = [];
  for (let num = 1; num <= pdf.numPages; num++) {
    const page = await pdf.getPage(num);
    const content = await page.getTextContent();

    const items = content.items
      .filter((it) => it.str && it.str.trim().length > 0)
      .map((it) => ({ text: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }));

    // La agrupación es POR PÁGINA a propósito: la coordenada Y se reinicia en
    // cada página, así que agrupar mezclando páginas fusionaría filas que no van
    // juntas.
    allLines.push(...agruparEnFilas(items));
  }
  return allLines;
}
