import { useState } from "react";
import ModalOverlay from "./ModalOverlay.jsx";

// Al rechazar una cotización se pregunta POR QUÉ, con motivos de un clic. No es
// burocracia: es lo único que convierte el tablero de cotizaciones en
// información de venta ("se están perdiendo por precio" vs "no contestan").
// Por eso los motivos son botones y no un campo de texto libre — escribir a
// mano sería trabajo administrativo y nadie lo haría.
const MOTIVOS_RECHAZO = [
  "Precio muy alto",
  "Compró con la competencia",
  "No respondió / se enfrió",
  "Cambio de planes del cliente",
];

function MotivoRechazoModal({ cotizacion, onClose, onConfirm }) {
  const [seleccionado, setSeleccionado] = useState(null);
  const [otroTexto, setOtroTexto] = useState("");

  const puedeConfirmar = seleccionado && (seleccionado !== "Otro" || otroTexto.trim());

  return (
    <ModalOverlay onClose={onClose} maxWidth={400}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>¿Por qué se rechazó?</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
        Cotización de {cotizacion.cliente}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {MOTIVOS_RECHAZO.map((m) => (
          <button
            key={m}
            onClick={() => setSeleccionado(m)}
            aria-pressed={seleccionado === m}
            style={{
              textAlign: "left",
              fontSize: 13,
              padding: "8px 10px",
              border: seleccionado === m ? "2px solid var(--color-border-danger)" : "0.5px solid var(--color-border-tertiary)",
              background: seleccionado === m ? "var(--color-background-danger)" : "var(--color-background-primary)",
              color: seleccionado === m ? "var(--color-text-danger)" : "var(--color-text-primary)",
              borderRadius: "var(--border-radius-md)",
            }}
          >
            {m}
          </button>
        ))}
        <button
          onClick={() => setSeleccionado("Otro")}
          aria-pressed={seleccionado === "Otro"}
          style={{
            textAlign: "left",
            fontSize: 13,
            padding: "8px 10px",
            border: seleccionado === "Otro" ? "2px solid var(--color-border-danger)" : "0.5px solid var(--color-border-tertiary)",
            background: seleccionado === "Otro" ? "var(--color-background-danger)" : "var(--color-background-primary)",
            color: seleccionado === "Otro" ? "var(--color-text-danger)" : "var(--color-text-primary)",
            borderRadius: "var(--border-radius-md)",
          }}
        >
          Otro
        </button>
        {seleccionado === "Otro" && (
          <input
            type="text"
            placeholder="Escribe el motivo..."
            value={otroTexto}
            onChange={(e) => setOtroTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && otroTexto.trim()) onConfirm(otroTexto.trim());
            }}
            style={{ width: "100%" }}
            autoFocus={window.matchMedia("(pointer: fine)").matches}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          disabled={!puedeConfirmar}
          onClick={() => onConfirm(seleccionado === "Otro" ? otroTexto.trim() : seleccionado)}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: "var(--color-background-danger)",
            color: "var(--color-text-danger)",
            border: "0.5px solid var(--color-border-danger)",
            opacity: puedeConfirmar ? 1 : 0.5,
          }}
        >
          <i className="ti ti-x" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Rechazar cotización
        </button>
      </div>
    </ModalOverlay>
  );
}

export default MotivoRechazoModal;
