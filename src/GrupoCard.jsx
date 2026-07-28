import { useState } from "react";
import { VEHICULOS, MARCA, formatCOP } from "./constants.js";
import { cargaPorEntregar } from "./peso.js";

// Tarjeta de un "viaje juntado": varias facturas que van juntas. Se muestra
// como una sola tarjeta con el detalle de cada factura adentro, se arrastra en
// bloque y se entrega de una. Ver handlers de juntar/entregarGrupo arriba.
function GrupoCard({ miembros, isDragging, onDragStart, onDragEnd, onDragOverItem, onDropItem, onEntregarGrupo, onSeparar, onVerPdf }) {
  const [confirmSeparar, setConfirmSeparar] = useState(false);
  const total = miembros.reduce((s, m) => s + (Number(m.total) || 0), 0);
  const clientesUnicos = Array.from(new Set(miembros.map((m) => (m.cliente || "").trim()).filter(Boolean)));
  const titulo = clientesUnicos.length === 1 ? clientesUnicos[0] : `${miembros.length} pedidos en un viaje`;
  const conPendiente = miembros.filter((m) => m.entregaPendiente);
  // Peso del viaje completo: la suma de lo que falta por entregar de cada
  // factura del grupo. Es el número que dice si el viaje cabe o no.
  const cargaGrupo = miembros.reduce((sum, m) => sum + cargaPorEntregar(m), 0);
  const vehGrupo = VEHICULOS.find((v) => v.id === (miembros[0] && miembros[0].vehiculo));
  const capGrupo = vehGrupo && vehGrupo.capacidadKg;
  const excedeGrupo = !!capGrupo && cargaGrupo > capGrupo;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverItem}
      onDrop={onDropItem}
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-info)",
        borderLeft: "3px solid var(--color-border-info)",
        borderRadius: "var(--border-radius-md)",
        padding: "10px 12px",
        marginBottom: 8,
        cursor: "grab",
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--color-background-info)",
            color: "var(--color-text-info)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <i className="ti ti-layers-intersect" style={{ fontSize: 15 }} aria-hidden="true"></i>
        </span>
        <span style={{ fontWeight: 500, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {titulo}
        </span>
        {total ? <span style={{ fontSize: 14, fontWeight: 500, color: MARCA.azulOscuro, flexShrink: 0 }}>${formatCOP(total)}</span> : null}
        <i className="ti ti-grip-vertical" style={{ fontSize: 14, color: "var(--color-text-tertiary)", flexShrink: 0 }} aria-hidden="true"></i>
      </div>

      <div style={{ paddingLeft: 36, marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: "var(--color-text-info)", fontWeight: 500 }}>
          <i className="ti ti-layers-intersect" style={{ fontSize: 11, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
          Viaje juntado · {miembros.length} facturas
        </span>
        {cargaGrupo > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 500, marginLeft: 8, color: excedeGrupo ? "var(--color-text-danger)" : "var(--color-text-secondary)" }}>
            <i className="ti ti-weight" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 3 }} aria-hidden="true"></i>
            {formatCOP(Math.round(cargaGrupo))} kg
            {excedeGrupo ? " · no cabe en un viaje" : ""}
          </span>
        )}
      </div>

      {/* Al juntar pedidos se perdía de vista el material pendiente de cada
          factura: aquí se avisa arriba y además en cada línea de abajo. */}
      {conPendiente.length > 0 && (
        <div
          style={{
            marginLeft: 36,
            marginBottom: 9,
            padding: "7px 10px",
            borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-danger)",
            border: "0.5px solid var(--color-border-danger)",
            color: "var(--color-text-danger)",
            fontSize: 12,
          }}
        >
          <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          {conPendiente.length === 1
            ? "1 factura de este viaje debe material"
            : `${conPendiente.length} facturas de este viaje deben material`}
        </div>
      )}

      {/* Detalle de cada factura del viaje. */}
      <div style={{ paddingLeft: 36, display: "flex", flexDirection: "column", gap: 8, marginBottom: 9 }}>
        {miembros.map((m) => {
          const prods = m.productos || [];
          const resumen = prods.length === 0 ? "" : prods.length === 1 ? `${prods[0].cantidad} ${prods[0].unidad} — ${prods[0].descripcion}` : `${prods[0].descripcion} +${prods.length - 1} más`;
          return (
            <div key={m.id} style={{ borderLeft: "2px solid var(--color-border-tertiary)", paddingLeft: 8 }}>
              <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 500 }}>{m.cliente || "Sin nombre"}</span>
                {m.numeroFactura && <span style={{ color: "var(--color-text-tertiary)" }}>· {m.remisionDe ? `${m.numeroFactura} (rem.)` : `Fact. ${m.numeroFactura}`}</span>}
                {(m.tienePdf || m.pdfDataUrl) && (
                  <button
                    onClick={() => onVerPdf(m)}
                    style={{ fontSize: 11, padding: "3px 8px", minHeight: 30, border: "0.5px solid var(--color-border-tertiary)", background: "transparent" }}
                  >
                    <i className="ti ti-file-text" style={{ fontSize: 12, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
                    PDF
                  </button>
                )}
              </div>
              {resumen && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{resumen}</div>}
              {m.entregaPendiente && (
                <div style={{ fontSize: 11.5, color: "var(--color-text-danger)", marginTop: 3, fontWeight: 500 }}>
                  <i className="ti ti-alert-triangle" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 3 }} aria-hidden="true"></i>
                  Debe material{m.notaPendiente && m.notaPendiente.trim() ? `: ${m.notaPendiente}` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 36, flexWrap: "wrap" }}>
        {confirmSeparar ? (
          <button
            onClick={onSeparar}
            style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40, fontWeight: 500, background: "var(--color-background-warning)", color: "var(--color-text-warning)", border: "0.5px solid var(--color-border-warning)" }}
          >
            <i className="ti ti-arrows-split" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Toca otra vez para separar
          </button>
        ) : (
          <button
            onClick={() => setConfirmSeparar(true)}
            style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40, background: "transparent", color: "var(--color-text-primary)", border: "0.5px solid var(--color-border-tertiary)" }}
          >
            <i className="ti ti-unlink" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Separar
          </button>
        )}
        <button
          onClick={onEntregarGrupo}
          style={{
            marginLeft: "auto",
            border: "none",
            background: "#639922",
            color: "white",
            fontWeight: 500,
            fontSize: 13,
            borderRadius: "var(--border-radius-md)",
            padding: "9px 14px",
            minHeight: 40,
          }}
        >
          <i className="ti ti-check" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Entregar todo
        </button>
      </div>
    </div>
  );
}

export default GrupoCard;
