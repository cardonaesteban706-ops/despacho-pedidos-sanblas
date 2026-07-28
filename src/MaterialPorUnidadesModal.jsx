import { useState } from "react";
import ModalOverlay from "./ModalOverlay.jsx";
import { formatCantidad } from "./constants.js";
import {
  parseCantidad,
  cantidadNum,
  topeEditableDe,
  valorInicialMaterialDe,
  aplicarEntregadoDirecto,
} from "./saldo.js";

// Solo se usa en la pestaña "Pendientes": lista producto por producto cuántas
// unidades se entregaron (de las que trae la factura), por si no se entregó
// todo. Guarda cantidadEntregada en cada producto. La nota de material
// pendiente NO se crea aquí: se genera sola al pasar el pedido a despacho.
function MaterialPorUnidadesModal({ pedido, onClose, onGuardar }) {
  // Este modal declara lo que salió DIRECTO contra la factura (a mano, sin
  // remisión). Por eso trabaja contra el TOPE EDITABLE (= facturado − lo que ya
  // salió remisionado), no contra lo facturado.
  //
  // Antes usaba lo facturado como default y como techo, ignorando
  // cantidadRestante: en una factura de 100 con remisión de 40, proponía 100 y
  // dejaba guardar 100 aunque solo quedaran 60. Eso dejaba el par
  // (cantidadEntregada, cantidadRestante) contradictorio: el modal decía
  // "Completo", "Por entregar" decía "quedan 60", y al archivarse la factura el
  // Panel sumaba 100 encima de los 40 ya contados por la remisión (7.000 kg
  // donde salieron 5.000).
  const [items, setItems] = useState(() =>
    (pedido.productos || []).map((p) => ({
      ...p,
      // Sin remisiones: arranca en todo lo facturado (el caso normal es "salí
      // con todo" y solo se baja lo que faltó). Con remisiones: arranca en 0,
      // porque lo remisionado ya se contó aparte.
      entregadas: valorInicialMaterialDe(p),
    }))
  );

  const setEntregadas = (idx, valor) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const tope = topeEditableDe(it);
        let n = valor;
        if (isNaN(n) || n < 0) n = 0;
        if (n > tope) n = tope;
        return { ...it, entregadas: n };
      })
    );
  };

  return (
    <ModalOverlay onClose={onClose} maxWidth={460}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Material entregado</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 12 }}>
        {pedido.cliente} · marca cuántas unidades de cada material se entregaron.
      </div>

      {items.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: "8px 4px" }}>
          Este pedido no tiene productos detallados.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {items.map((it, idx) => {
          const facturado = cantidadNum(it.cantidad);
          const tope = topeEditableDe(it);
          // Lo que salió por remisiones: no es editable acá y se muestra para
          // que el despachador entienda por qué el tope no es lo facturado.
          const remisionado = Math.max(0, facturado - tope);
          const falta = tope - it.entregadas;
          const completo = falta <= 0;
          return (
            <div
              key={idx}
              style={{
                border: completo ? "0.5px solid var(--color-border-success)" : "0.5px solid var(--color-border-warning)",
                borderRadius: "var(--border-radius-md)",
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <b style={{ fontWeight: 500 }}>{formatCantidad(facturado)} {it.unidad}</b> — {it.descripcion}
              </div>
              {remisionado > 0 && (
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
                  <i className="ti ti-arrows-split" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                  Ya salieron {formatCantidad(remisionado)} por remisión · acá solo se marca lo que queda ({formatCantidad(tope)})
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Entregadas:</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={tope}
                  value={it.entregadas}
                  onChange={(e) => setEntregadas(idx, parseCantidad(e.target.value))}
                  style={{ width: 80 }}
                />
                <button onClick={() => setEntregadas(idx, tope)} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>
                  Todo
                </button>
                <button onClick={() => setEntregadas(idx, 0)} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>
                  Nada
                </button>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    fontWeight: 500,
                    color: completo ? "var(--color-text-success)" : "var(--color-text-warning)",
                  }}
                >
                  {completo ? "Completo" : `Faltan ${formatCantidad(falta)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          // aplicarEntregadoDirecto deja el par (cantidadEntregada,
          // cantidadRestante) coherente. A una factura SIN remisiones no le
          // inventa cantidadRestante: sigue con la forma de dato de siempre.
          onClick={() => onGuardar(items.map(({ entregadas, ...rest }) => aplicarEntregadoDirecto(rest, entregadas)))}
          style={{ fontSize: 13, fontWeight: 500, background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)" }}
        >
          Guardar
        </button>
      </div>
    </ModalOverlay>
  );
}

export default MaterialPorUnidadesModal;
