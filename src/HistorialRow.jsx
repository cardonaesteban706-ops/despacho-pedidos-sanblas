import { useState } from "react";
import { VEHICULOS, formatCOP } from "./constants.js";

function HistorialRow({ pedido, onVerPdf, onDevolver }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDevolver, setConfirmDevolver] = useState(false);
  const pagado = pedido.estadoPago === "pagado";
  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          font: "inherit",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <i className={`ti ${(VEHICULOS.find((v) => v.id === pedido.vehiculo) || {}).icon || "ti-package"}`} style={{ fontSize: 16, color: "var(--color-text-secondary)" }} aria-hidden="true"></i>
        <span style={{ fontWeight: 500, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pedido.cliente}</span>
        {/* Marca de "quedó debiendo" bien visible: sirve para saber a quién cobrar. */}
        {!pagado && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              background: "var(--color-background-warning)",
              color: "var(--color-text-warning)",
              borderRadius: "var(--border-radius-sm)",
              padding: "1px 7px",
              flexShrink: 0,
            }}
          >
            Debe
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{pedido.fechaEntrega || pedido.fecha}</span>
        <i className={`ti ti-chevron-${expanded ? "up" : "down"}`} style={{ fontSize: 14, color: "var(--color-text-tertiary)", flexShrink: 0 }} aria-hidden="true"></i>
      </button>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 12, color: "var(--color-text-secondary)" }}>
          <div>
            Documento: {pedido.numeroFactura || "-"} (
            {pedido.remisionDe ? `remisión de Factura ${pedido.remisionDe}` : pedido.tipoDocumento === "remision" ? "remisión manual" : pedido.tipoDocumento === "cotizacion" ? "cotización" : "factura"})
          </div>
          <div>Vendedor: {pedido.vendedor || "-"}</div>
          <div>Vehículo: {(VEHICULOS.find((v) => v.id === pedido.vehiculo) || {}).label || "-"}</div>
          {pedido.destino && pedido.destino.trim() && <div>Destino: {pedido.destino}</div>}
          <div>Total: {pedido.total ? `$${formatCOP(pedido.total)}` : "-"}</div>
          <div style={{ color: pagado ? "var(--color-text-success)" : "var(--color-text-warning)", fontWeight: 500 }}>
            Pago: {pagado ? "Pagado" : "Quedó debiendo"}
          </div>
          {pedido.productos && pedido.productos.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {pedido.productos.map((p, i) => (
                <div key={i}>· {p.cantidad} {p.unidad} {p.descripcion}</div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {(pedido.tienePdf || pedido.pdfDataUrl) && (
              <button onClick={onVerPdf} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
                <i className="ti ti-file-text" style={{ fontSize: 12, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
                Ver documento
              </button>
            )}
            {/* Corrige una entrega marcada por error. Doble toque para no
                devolver un pedido sin querer. */}
            {onDevolver &&
              (confirmDevolver ? (
                <button
                  onClick={onDevolver}
                  style={{
                    fontSize: 12.5,
                    padding: "9px 12px",
                    minHeight: 40,
                    fontWeight: 500,
                    background: "var(--color-background-warning)",
                    color: "var(--color-text-warning)",
                    border: "0.5px solid var(--color-border-warning)",
                  }}
                >
                  <i className="ti ti-arrow-back-up" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                  Toca otra vez para devolver
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDevolver(true)}
                  style={{
                    fontSize: 12.5,
                    padding: "9px 12px",
                    minHeight: 40,
                    background: "transparent",
                    color: "var(--color-text-primary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                  }}
                >
                  <i className="ti ti-arrow-back-up" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                  Devolver a despacho
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default HistorialRow;
