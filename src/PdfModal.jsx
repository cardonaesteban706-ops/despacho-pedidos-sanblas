import { useState, useEffect, useRef } from "react";
import ModalOverlay from "./ModalOverlay.jsx";
import { pdfjsLib } from "./pdfExtract.js";
import { abrirPdf, descargarPdf } from "./pdfArchivo.js";

// Renderiza el PDF como imagen usando PDF.js + canvas, en vez de un iframe.
// Esto evita los bloqueos de visor nativo que impedían ver el PDF dentro
// del artifact.
function PdfCanvasViewer({ dataUrl }) {
  const containerRef = useRef(null);
  const pdfRef = useRef(null);
  const canvasRefs = useRef([]);
  const [status, setStatus] = useState("loading");
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);

  // Fase 1: cargar el documento (una sola vez por PDF) y saber cuántas
  // páginas tiene. La página real se dibuja en la Fase 2, cuando ya existen
  // los <canvas> en el DOM.
  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    async function load() {
      // pdf.js viene importado (antes se leía de window.pdfjsLib, que existía
      // solo porque el <script> del CDN la dejaba como variable global).
      if (!pdfjsLib || !pdfjsLib.getDocument) {
        setStatus("error");
        return;
      }
      try {
        const base64 = dataUrl.split(",")[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) setStatus("error");
      }
    }
    load();
    return () => {
      cancelled = true;
      pdfRef.current = null;
      // Libera el documento y su memoria en el worker de pdf.js. Sin esto,
      // cada apertura del modal dejaba un documento vivo y la pestaña
      // acumulaba memoria durante toda la jornada.
      if (loadingTask) loadingTask.destroy().catch(() => {});
    };
  }, [dataUrl]);

  // Fase 2: dibujar cada página ajustada al ancho del modal (no a una escala
  // fija, que en computador se veía pequeña) y a la densidad real de píxeles
  // de la pantalla, para que el texto salga nítido y no pixelado. El zoom
  // multiplica ese ajuste.
  useEffect(() => {
    if (status !== "ready" || !pdfRef.current || !numPages) return;
    let cancelled = false;
    const tasks = [];
    (async () => {
      const pdf = pdfRef.current;
      const contenedor = containerRef.current;
      const anchoDisponible = contenedor ? contenedor.clientWidth - 4 : 800;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= numPages; n++) {
        if (cancelled) return;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const escalaCss = ((anchoDisponible / base.width) || 1) * zoom;
        const viewport = page.getViewport({ scale: escalaCss * dpr });
        const canvas = canvasRefs.current[n - 1];
        if (!canvas) continue;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = base.width * escalaCss + "px";
        canvas.style.height = base.height * escalaCss + "px";
        const task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
        tasks.push(task);
        try {
          await task.promise;
        } catch (e) {
          /* render cancelado al re-dibujar: normal */
        }
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel && t.cancel());
    };
  }, [status, numPages, zoom]);

  return (
    <div>
      {status === "ready" && numPages > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            {numPages === 1 ? "1 página" : `${numPages} páginas`}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
              aria-label="Alejar"
              style={{ padding: "8px 12px", minWidth: 40, minHeight: 40, fontSize: 14 }}
            >
              <i className="ti ti-minus" style={{ fontSize: 13 }} aria-hidden="true"></i>
            </button>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", minWidth: 42, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
              aria-label="Acercar"
              style={{ padding: "8px 12px", minWidth: 40, minHeight: 40, fontSize: 14 }}
            >
              <i className="ti ti-plus" style={{ fontSize: 13 }} aria-hidden="true"></i>
            </button>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          maxHeight: "72vh",
          overflow: "auto",
          overscrollBehavior: "contain",
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-md)",
          padding: 8,
          textAlign: "center",
        }}
      >
        {status === "loading" && (
          <div style={{ padding: "3rem 0", textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>Cargando documento...</div>
        )}
        {status === "error" && (
          <div style={{ padding: "2rem 1rem", textAlign: "center", fontSize: 13, color: "var(--color-text-warning)" }}>
            No se pudo mostrar el documento aquí. Usa "Descargar PDF" abajo para abrirlo.
          </div>
        )}
        {status === "ready" &&
          Array.from({ length: numPages }).map((_, i) => (
            <canvas
              key={i}
              ref={(el) => (canvasRefs.current[i] = el)}
              style={{
                display: "block",
                margin: i > 0 ? "10px auto 0" : "0 auto",
                boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                background: "white",
              }}
            />
          ))}
      </div>
    </div>
  );
}

// Overlay de modal verdadero: position:fixed cubre toda la ventana visible
// (sin esto, el "fondo oscuro" solo ocupaba el alto del contenido y el click
// afuera o el modal mismo podían quedar fuera de la vista, dando la sensación
// de que "no cierra"). Cierra con click fuera, botón X, o tecla Esc.

// El PDF ya no viene en la carga inicial (pesa demasiado): si el pedido no lo
// trae en memoria pero tiene_pdf es true, lo pedimos aquí con fetchPdf al abrir
// el visor. Estados: "cargando" | "listo" | "vacio" | "error".
function PdfModal({ pedido, fetchPdf, onClose }) {
  const [dataUrl, setDataUrl] = useState(pedido.pdfDataUrl || null);
  const [estado, setEstado] = useState(
    pedido.pdfDataUrl ? "listo" : pedido.tienePdf ? "cargando" : "vacio"
  );

  useEffect(() => {
    // Si ya lo tenemos (pedido recién subido) o no hay PDF, no cargamos nada.
    if (pedido.pdfDataUrl || !pedido.tienePdf || !fetchPdf) return;
    let activo = true;
    setEstado("cargando");
    fetchPdf(pedido.id)
      .then((url) => {
        if (!activo) return;
        if (url) {
          setDataUrl(url);
          setEstado("listo");
        } else {
          setEstado("vacio");
        }
      })
      .catch(() => {
        if (activo) setEstado("error");
      });
    return () => {
      activo = false;
    };
  }, [pedido.id, pedido.pdfDataUrl, pedido.tienePdf, fetchPdf]);

  return (
    <ModalOverlay onClose={onClose} maxWidth={860}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pedido.fileName || "Documento"}
        </span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40, flexShrink: 0, marginLeft: 8 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      {estado === "listo" && dataUrl && <PdfCanvasViewer dataUrl={dataUrl} />}
      {estado === "cargando" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "2rem 0", textAlign: "center" }}>
          Cargando documento…
        </div>
      )}
      {estado === "vacio" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "2rem 0", textAlign: "center" }}>
          No hay documento adjunto para este pedido
        </div>
      )}
      {estado === "error" && (
        <div style={{ fontSize: 13, color: "var(--color-text-warning)", padding: "2rem 0", textAlign: "center" }}>
          No se pudo cargar el documento. Revisa tu conexión e inténtalo de nuevo.
        </div>
      )}
      {estado === "listo" && dataUrl && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {/* En celular NO se puede descargar desde una URL "data:" (Chrome y
              Safari lo bloquean por seguridad): por eso el PDF se convierte a
              un archivo real (blob) antes de abrirlo o compartirlo. */}
          <button onClick={() => abrirPdf(dataUrl)} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
            <i className="ti ti-external-link" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Abrir en otra pestaña
          </button>
          <button onClick={() => descargarPdf(dataUrl, pedido.fileName)} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40, fontWeight: 500 }}>
            <i className="ti ti-download" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Descargar / compartir
          </button>
        </div>
      )}
    </ModalOverlay>
  );
}

export default PdfModal;
