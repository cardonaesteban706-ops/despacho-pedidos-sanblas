import { useState } from "react";
import ModalOverlay from "./ModalOverlay.jsx";
import DestinoSelector from "./DestinoSelector.jsx";
import { VEHICULOS, MARCA, addDaysISO, formatCOP } from "./constants.js";
import { cantidadNum } from "./saldo.js";

// Formulario para crear una remisión a mano (sin PDF): pedidos que llegan en
// hoja aparte de remisiones (arena, bloque, etc.), ajenos a World Office. El
// número REM lo pone el componente padre (siguienteNumeroRemision).
function RemisionManualModal({ hoyIso, onClose, onCrear }) {
  const [cliente, setCliente] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [destino, setDestino] = useState("");
  const [estadoPago, setEstadoPago] = useState("pendiente");
  const [productos, setProductos] = useState([{ descripcion: "", cantidad: "", unidad: "", precio: "" }]);
  const [fechaOpcion, setFechaOpcion] = useState("hoy");
  const [fechaOtro, setFechaOtro] = useState(addDaysISO(hoyIso, 1));
  const [vehiculo, setVehiculo] = useState(VEHICULOS[0].id);

  const esConFecha = fechaOpcion === "hoy" || fechaOpcion === "otro";
  const fechaResuelta = fechaOpcion === "hoy" ? hoyIso : fechaOpcion === "otro" ? fechaOtro : fechaOpcion; // "pendiente" | "viaje"

  const setProd = (i, campo, valor) => setProductos((prev) => prev.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  const agregarFila = () => setProductos((prev) => [...prev, { descripcion: "", cantidad: "", unidad: "", precio: "" }]);
  const quitarFila = (i) => setProductos((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  // Mismo cálculo que crearRemisionManual: precio POR UNIDAD x cantidad.
  const totalRemision = productos.reduce(
    (s, p) => s + (parseInt(String(p.precio || "0").replace(/[^\d]/g, ""), 10) || 0) * cantidadNum(p.cantidad),
    0
  );

  const hayMaterial = productos.some((p) => (p.descripcion || "").trim() && cantidadNum(p.cantidad) > 0);
  const puedeCrear = cliente.trim() && hayMaterial && (fechaOpcion !== "otro" || !!fechaOtro);

  const opcionesFecha = [
    { id: "hoy", label: "Hoy" },
    { id: "otro", label: "Otro día" },
    { id: "pendiente", label: "Por entregar" },
    { id: "viaje", label: "Por viaje" },
  ];

  const chipFecha = (activo) => ({
    fontSize: 12.5,
    padding: "8px 12px",
    minHeight: 40,
    fontWeight: activo ? 600 : 400,
    background: activo ? "var(--color-background-info)" : "var(--color-background-primary)",
    color: activo ? "var(--color-text-info)" : "var(--color-text-primary)",
    border: activo ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
  });

  return (
    <ModalOverlay onClose={onClose} maxWidth={500}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Remisión manual</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 14 }}>
        Para pedidos escritos a mano (arena, bloque, etc.). Se le pone un número REM automático.
      </div>

      <label style={{ display: "block", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Cliente</span>
        <input type="text" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre del cliente" style={{ width: "100%" }} />
      </label>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ flex: 1, minWidth: 140 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Teléfono (opcional)</span>
          <input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label style={{ flex: 1, minWidth: 140 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Dirección (opcional)</span>
          <input type="text" value={direccion} onChange={(e) => setDireccion(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>

      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>Material</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
        {productos.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={p.descripcion}
              onChange={(e) => setProd(i, "descripcion", e.target.value)}
              placeholder="Material (arena, bloque...)"
              style={{ flex: 1, minWidth: 0 }}
            />
            <input
              type="number"
              inputMode="decimal"
              value={p.cantidad}
              onChange={(e) => setProd(i, "cantidad", e.target.value)}
              placeholder="Cant."
              style={{ width: 66 }}
            />
            <input
              type="text"
              value={p.unidad}
              onChange={(e) => setProd(i, "unidad", e.target.value)}
              placeholder="und"
              style={{ width: 54 }}
            />
            {/* Precio POR UNIDAD. El total de la línea lo calcula
                crearRemisionManual multiplicándolo por la cantidad: antes este
                campo se guardaba tal cual como total, y 5 bultos a 32.000
                quedaban en 32.000 en vez de 160.000. */}
            <input
              type="number"
              inputMode="numeric"
              value={p.precio}
              onChange={(e) => setProd(i, "precio", e.target.value)}
              placeholder="$ c/u"
              aria-label="Precio por unidad"
              title="Precio de UNA unidad. El total de la línea se calcula solo."
              style={{ width: 78 }}
            />
            <button
              onClick={() => quitarFila(i)}
              aria-label="Quitar material"
              disabled={productos.length === 1}
              style={{ minWidth: 36, minHeight: 36, padding: 0, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", opacity: productos.length === 1 ? 0.4 : 1 }}
            >
              <i className="ti ti-trash" style={{ fontSize: 14 }} aria-hidden="true"></i>
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={agregarFila} style={{ fontSize: 12.5, padding: "8px 12px", minHeight: 38, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
          <i className="ti ti-plus" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Agregar material
        </button>
        {/* Total en vivo (precio x cantidad de cada línea). Se muestra para que
            el precio unitario y el total no se puedan confundir: el error que
            arregla esto era escribir 32.000 en 5 bultos y que la remisión
            quedara en 32.000. */}
        {totalRemision > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 500, color: MARCA.azulOscuro }}>
            Total: ${formatCOP(totalRemision)}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>¿Para cuándo?</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: fechaOpcion === "otro" ? 8 : 14 }}>
        {opcionesFecha.map((o) => (
          <button key={o.id} onClick={() => setFechaOpcion(o.id)} aria-pressed={fechaOpcion === o.id} style={chipFecha(fechaOpcion === o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {fechaOpcion === "otro" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 8 }}>
            {Array.from({ length: 7 }, (_, i) => addDaysISO(hoyIso, i + 1)).map((iso) => {
              const [yy, mm, dd] = iso.split("-").map(Number);
              const fechaObj = new Date(yy, mm - 1, dd);
              const etiqueta = iso === addDaysISO(hoyIso, 1) ? "Mañana" : fechaObj.toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "");
              const mesAbrev = fechaObj.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
              const sel = fechaOtro === iso;
              return (
                <button
                  key={iso}
                  onClick={() => setFechaOtro(iso)}
                  aria-pressed={sel}
                  style={{
                    flexShrink: 0,
                    minWidth: 62,
                    padding: "8px 8px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 1,
                    borderRadius: "var(--border-radius-md)",
                    border: sel ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                    background: sel ? "var(--color-background-info)" : "var(--color-background-primary)",
                    color: sel ? "var(--color-text-info)" : "var(--color-text-primary)",
                  }}
                >
                  <span style={{ fontSize: 11, textTransform: "capitalize", color: sel ? "var(--color-text-info)" : "var(--color-text-tertiary)" }}>{etiqueta}</span>
                  <span style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1 }}>{dd}</span>
                  <span style={{ fontSize: 10, textTransform: "capitalize", color: sel ? "var(--color-text-info)" : "var(--color-text-tertiary)" }}>{mesAbrev}</span>
                </button>
              );
            })}
          </div>
          <input type="date" value={fechaOtro} min={hoyIso} onChange={(e) => setFechaOtro(e.target.value || addDaysISO(hoyIso, 1))} style={{ width: "100%" }} />
        </div>
      )}

      {esConFecha && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>¿En qué vehículo?</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {VEHICULOS.map((v) => (
              <button
                key={v.id}
                onClick={() => setVehiculo(v.id)}
                aria-pressed={vehiculo === v.id}
                style={{
                  fontSize: 12.5,
                  padding: "8px 12px",
                  minHeight: 40,
                  fontWeight: vehiculo === v.id ? 600 : 400,
                  background: vehiculo === v.id ? v.bg : "var(--color-background-primary)",
                  color: vehiculo === v.id ? v.text : "var(--color-text-primary)",
                  border: vehiculo === v.id ? `2px solid ${v.border}` : "0.5px solid var(--color-border-tertiary)",
                }}
              >
                <i className={`ti ${v.icon}`} style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                {v.label}
              </button>
            ))}
          </div>
        </>
      )}

      <DestinoSelector value={destino} onChange={setDestino} />

      <div style={{ fontSize: 12.5, fontWeight: 500, margin: "12px 0 6px" }}>Estado de pago</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setEstadoPago("pagado")}
          aria-pressed={estadoPago === "pagado"}
          style={{ flex: 1, fontSize: 12.5, padding: "8px 0", minHeight: 40, border: estadoPago === "pagado" ? "2px solid var(--color-border-success)" : "0.5px solid var(--color-border-tertiary)", background: estadoPago === "pagado" ? "var(--color-background-success)" : "transparent", color: estadoPago === "pagado" ? "var(--color-text-success)" : "var(--color-text-primary)" }}
        >
          Ya pagado
        </button>
        <button
          onClick={() => setEstadoPago("pendiente")}
          aria-pressed={estadoPago === "pendiente"}
          style={{ flex: 1, fontSize: 12.5, padding: "8px 0", minHeight: 40, border: estadoPago === "pendiente" ? "2px solid var(--color-border-warning)" : "0.5px solid var(--color-border-tertiary)", background: estadoPago === "pendiente" ? "var(--color-background-warning)" : "transparent", color: estadoPago === "pendiente" ? "var(--color-text-warning)" : "var(--color-text-primary)" }}
        >
          Paga al recibir
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => puedeCrear && onCrear({ cliente, telefono, direccion, destino, productos, fechaDespacho: fechaResuelta, vehiculo, estadoPago })}
          disabled={!puedeCrear}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: puedeCrear ? "#639922" : "var(--color-background-secondary)",
            color: puedeCrear ? "white" : "var(--color-text-tertiary)",
            border: "none",
            borderRadius: "var(--border-radius-md)",
            padding: "9px 14px",
            minHeight: 40,
            cursor: puedeCrear ? "pointer" : "not-allowed",
          }}
        >
          <i className="ti ti-pencil-plus" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Crear remisión
        </button>
      </div>
    </ModalOverlay>
  );
}

export default RemisionManualModal;
