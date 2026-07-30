import { useState } from "react";
import ModalOverlay from "./ModalOverlay.jsx";
import { formatCantidad } from "./constants.js";
import { parseCantidad, saldoDe } from "./saldo.js";

// Descontar del saldo de una factura madre el material que el cliente ya se
// llevó directo (mostrador), sin generar una remisión. Mismo estilo que
// RemisionModal pero sin fecha ni vehículo: aquí nada sale a despacho.
function DescontarMaterialModal({ pedido, onClose, onDescontar }) {
  const productos = pedido.productos || [];
  // Copia 6 de 6 -> saldo.js.
  const dispo = saldoDe;

  // Se guarda lo TECLEADO (texto), no el número ya recortado.
  //
  // Antes el estado eran números que arrancaban en 0, y eso dejaba un "0" fijo
  // en la casilla que no se podía borrar: al intentarlo, el campo quedaba vacío,
  // se leía como 0 y React volvía a pintar el 0. Escribir encima de ese cero es
  // justo como se teclea de más o de menos sin darse cuenta — y acá cada unidad
  // mal tecleada es material que se descuadra.
  //
  // Con texto: la casilla arranca VACÍA (con "0" de placeholder gris), se puede
  // borrar, y el recorte al máximo se calcula aparte para poder AVISAR cuando
  // pasa, en vez de recortar en silencio.
  const [textos, setTextos] = useState(() => productos.map(() => ""));

  const setTexto = (idx, valor) => setTextos((prev) => prev.map((t, i) => (i === idx ? valor : t)));

  // Lo que de verdad se va a descontar de cada línea, ya acotado a lo disponible.
  const cantidades = textos.map((t, i) => {
    const max = dispo(productos[i]);
    const n = parseCantidad(t);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min(max, n);
  });
  // Líneas donde se tecleó más de lo que hay en bodega: se avisa, no se calla.
  const excedidas = textos.map((t, i) => parseCantidad(t) > dispo(productos[i]));

  const total = cantidades.reduce((s, c) => s + c, 0);

  return (
    <ModalOverlay onClose={onClose} maxWidth={460}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Descontar material entregado</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 12 }}>
        {pedido.cliente}
        {pedido.numeroFactura ? ` · Factura ${pedido.numeroFactura}` : ""} — marca lo que el cliente ya se llevó directo. Baja del saldo sin crear remisión.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {productos.map((p, idx) => {
          const disponible = dispo(p);
          const agotado = disponible <= 0;
          return (
            <div key={idx} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", padding: "8px 10px", opacity: agotado ? 0.5 : 1 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <b style={{ fontWeight: 500 }}>{p.descripcion}</b>
                <span style={{ color: "var(--color-text-tertiary)" }}> · quedan {formatCantidad(disponible)} {p.unidad}</span>
              </div>
              {agotado ? (
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Ya se entregó completo.</div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Ya se llevó:</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={disponible}
                      value={textos[idx]}
                      onChange={(e) => setTexto(idx, e.target.value)}
                      placeholder="0"
                      style={{ width: 90 }}
                    />
                    <button onClick={() => setTexto(idx, String(disponible))} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>Todo</button>
                    <button onClick={() => setTexto(idx, "")} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>Nada</button>
                  </div>
                  {excedidas[idx] && (
                    <div style={{ fontSize: 12, color: "var(--color-text-warning)", fontWeight: 500, marginTop: 5 }}>
                      <i className="ti ti-alert-triangle" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                      Solo quedan {formatCantidad(disponible)}: se descontarán {formatCantidad(disponible)}, no {formatCantidad(parseCantidad(textos[idx]))}.
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginRight: "auto" }}>
          {total > 0 ? `${formatCantidad(total)} unidades se descuentan` : "Nada marcado aún"}
        </span>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => total > 0 && onDescontar(cantidades)}
          disabled={total <= 0}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: total > 0 ? "#639922" : "var(--color-background-secondary)",
            color: total > 0 ? "white" : "var(--color-text-tertiary)",
            border: "none",
            borderRadius: "var(--border-radius-md)",
            padding: "9px 14px",
            minHeight: 40,
            cursor: total > 0 ? "pointer" : "not-allowed",
          }}
        >
          <i className="ti ti-check" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Descontar
        </button>
      </div>
    </ModalOverlay>
  );
}

export default DescontarMaterialModal;
