import { useState } from "react";
import { MARCA, formatCOP } from "./constants.js";

export const ESTADOS_COTIZACION_BADGE = {
  pendiente: { label: "Pendiente", bg: "var(--color-background-warning)", text: "var(--color-text-warning)" },
  aceptada: { label: "Aceptada", bg: "var(--color-background-success)", text: "var(--color-text-success)" },
  rechazada: { label: "Rechazada", bg: "var(--color-background-danger)", text: "var(--color-text-danger)" },
};

export const ESTADOS_COTIZACION_BADGE_KEYS = ["pendiente", "aceptada", "rechazada"];

function CotizacionCard({ cotizacion, hoyIso, onDelete, onEdit, onVerPdf, onCambiarEstado, onPasarADespacho, yaEnDespacho = false }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const badge = ESTADOS_COTIZACION_BADGE[cotizacion.estado || "pendiente"];
  const iniciales = (cotizacion.cliente || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-md)",
        padding: "10px 12px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: badge.bg,
            color: badge.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {iniciales}
        </span>
        <span style={{ fontWeight: 500, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cotizacion.cliente}
        </span>
        {cotizacion.total ? (
          <span style={{ fontSize: 14, fontWeight: 500, color: MARCA.azulOscuro, flexShrink: 0 }}>${formatCOP(cotizacion.total)}</span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7, paddingLeft: 36, flexWrap: "wrap" }}>
        {cotizacion.numeroFactura && (
          <span style={{ fontSize: 12, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)", borderRadius: "var(--border-radius-sm)", padding: "2px 7px" }}>
            Cotización {cotizacion.numeroFactura}
          </span>
        )}
        {cotizacion.fecha && <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{cotizacion.fecha}</span>}
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: "var(--border-radius-sm)",
            background: badge.bg,
            color: badge.text,
            marginLeft: "auto",
          }}
        >
          {badge.label}
        </span>
      </div>

      {cotizacion.productos && cotizacion.productos.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 7, paddingLeft: 36 }}>
          {cotizacion.productos.length === 1
            ? cotizacion.productos[0].descripcion
            : `${cotizacion.productos[0].descripcion} +${cotizacion.productos.length - 1} más`}
        </div>
      )}

      {cotizacion.fechaSeguimiento &&
        (() => {
          const vencido = (cotizacion.estado || "pendiente") === "pendiente" && cotizacion.fechaSeguimiento < hoyIso;
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12.5,
                color: vencido ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                fontWeight: vencido ? 500 : 400,
                marginBottom: 7,
                paddingLeft: 36,
              }}
            >
              <i
                className={vencido ? "ti ti-alert-triangle" : "ti ti-bell"}
                style={{ fontSize: 13, color: vencido ? "var(--color-text-danger)" : MARCA.azulMedio }}
                aria-hidden="true"
              ></i>
              {vencido ? "Seguimiento vencido: " : "Seguimiento: "}
              {cotizacion.fechaSeguimiento}
            </div>
          );
        })()}

      {cotizacion.estado === "rechazada" && cotizacion.motivoRechazo && (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-danger)",
            marginBottom: 8,
            marginLeft: 36,
            padding: "6px 8px",
            background: "var(--color-background-danger)",
            borderRadius: "var(--border-radius-sm)",
          }}
        >
          <i className="ti ti-info-circle" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Motivo: {cotizacion.motivoRechazo}
        </div>
      )}

      {cotizacion.notas && cotizacion.notas.trim() && (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            marginBottom: 8,
            marginLeft: 36,
            padding: "6px 8px",
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-sm)",
          }}
        >
          <i className="ti ti-note" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          {cotizacion.notas}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 36, flexWrap: "wrap" }}>
        {(cotizacion.tienePdf || cotizacion.pdfDataUrl) && (
          <button onClick={onVerPdf} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
            <i className="ti ti-file-text" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Ver documento
          </button>
        )}
        <button
          onClick={onEdit}
          style={{
            fontSize: 12.5,
            padding: "9px 12px",
            minHeight: 40,
            background: MARCA.azulClaro,
            color: MARCA.azulOscuro,
            border: `0.5px solid ${MARCA.azulMedio}`,
          }}
        >
          <i className="ti ti-edit" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Editar
        </button>

        {/* Ya pasó a despacho: no se ofrece volver a mandarla (evita duplicar
            el pedido) y se deja claro que la venta está andando. */}
        {yaEnDespacho && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12.5,
              fontWeight: 500,
              color: "var(--color-text-success)",
              background: "var(--color-background-success)",
              border: "0.5px solid var(--color-border-success)",
              borderRadius: "var(--border-radius-md)",
              padding: "9px 12px",
              minHeight: 40,
            }}
          >
            <i className="ti ti-truck-delivery" style={{ fontSize: 14 }} aria-hidden="true"></i>
            Ya está en despacho
          </span>
        )}

        {cotizacion.estado === "pendiente" && (
          <>
            {/* Antes este botón solo pintaba la tarjeta de verde. Ahora además
                arma el pedido con el PDF que ya está guardado: se elige vehículo
                y fecha, y listo. No hay que volver a subir nada. */}
            <button
              onClick={onPasarADespacho}
              style={{
                flex: 1,
                minWidth: 90,
                minHeight: 40,
                border: "none",
                background: "#639922",
                color: "white",
                fontWeight: 500,
                fontSize: 13,
                borderRadius: "var(--border-radius-md)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <i className="ti ti-truck-delivery" style={{ fontSize: 14 }} aria-hidden="true"></i>
              Aceptar y despachar
            </button>
            <button
              onClick={() => onCambiarEstado("rechazada")}
              style={{
                flex: 1,
                minWidth: 90,
                minHeight: 40,
                border: "none",
                background: "#A32D2D",
                color: "white",
                fontWeight: 500,
                fontSize: 13,
                borderRadius: "var(--border-radius-md)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
              Rechazar
            </button>
          </>
        )}

        {/* Rescate: una cotización aceptada que nunca llegó a despacho (o una
            FACTURA que se subió por error en este tablero) se manda al flujo de
            despacho desde acá, sin borrarla ni volver a subir el PDF. */}
        {cotizacion.estado !== "pendiente" && !yaEnDespacho && (
          <button
            onClick={onPasarADespacho}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              background: MARCA.azulClaro,
              color: MARCA.azulOscuro,
              border: `0.5px solid ${MARCA.azulMedio}`,
              fontWeight: 500,
            }}
          >
            <i className="ti ti-truck-delivery" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Pasar a despacho
          </button>
        )}

        {cotizacion.estado !== "pendiente" && (
          <button onClick={() => onCambiarEstado("pendiente")} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
            <i className="ti ti-clock" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Volver a pendiente
          </button>
        )}

        {confirmDelete ? (
          <button
            onClick={onDelete}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              background: "var(--color-background-danger)",
              color: "var(--color-text-danger)",
              border: "0.5px solid var(--color-border-danger)",
              fontWeight: 500,
            }}
          >
            <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Toca otra vez para eliminar
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              background: "var(--color-background-danger)",
              color: "var(--color-text-danger)",
              border: "0.5px solid var(--color-border-danger)",
            }}
          >
            <i className="ti ti-trash" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Eliminar
          </button>
        )}
      </div>
    </div>
  );
}

export default CotizacionCard;
