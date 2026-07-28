// pdfArchivo.js
//
// Abrir y descargar el PDF guardado de un pedido. Vivían sueltos en
// DespachoPedidos.jsx y los usan tanto el monolito como PdfModal, así que al
// mudar el modal había que compartirlos o duplicarlos. Duplicarlos es
// exactamente cómo nacieron las siete copias de la regla del saldo.

// Convierte la URL "data:" del PDF guardado en un Blob (archivo real). Los
// navegadores de celular bloquean descargar/abrir directamente desde "data:",
// así que todo lo que sea abrir, descargar o compartir pasa por aquí.
export function dataUrlABlob(dataUrl) {
  const [cabecera, base64] = String(dataUrl).split(",");
  const mime = (cabecera.match(/data:([^;]+)/) || [])[1] || "application/pdf";
  const binario = atob(base64 || "");
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function abrirPdf(dataUrl) {
  try {
    const url = URL.createObjectURL(dataUrlABlob(dataUrl));
    window.open(url, "_blank", "noopener");
    // No se revoca de inmediato: la pestaña nueva todavía lo está cargando.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    window.open(dataUrl, "_blank", "noopener");
  }
}

// Descarga el PDF. En celular usa el menú nativo de compartir (permite
// "Guardar en Archivos", mandarlo por WhatsApp, etc.); en computador hace la
// descarga normal.
export async function descargarPdf(dataUrl, fileName) {
  const nombre = fileName || "documento.pdf";
  try {
    const blob = dataUrlABlob(dataUrl);
    const archivo = new File([blob], nombre, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [archivo] }) && navigator.share) {
      await navigator.share({ files: [archivo], title: nombre });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    // Si el usuario cancela el menú de compartir no es un error real.
    if (e && e.name === "AbortError") return;
    abrirPdf(dataUrl);
  }
}
