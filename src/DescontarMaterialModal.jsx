import { useState } from "react";
import ModalOverlay from "./ModalOverlay.jsx";
import { formatCantidad } from "./constants.js";
import { parseCantidad, saldoDe, topeEditableDe, marcadoAManoDe } from "./saldo.js";

// Descontar del saldo de una factura madre el material que el cliente ya se
// llevó directo (mostrador), sin generar una remisión. Mismo estilo que
// RemisionModal pero sin fecha ni vehículo: aquí nada sale a despacho.
//
// Tiene DOS modos, y el segundo es la marcha atrás que no existía:
//
//   "descontar" — lo de siempre: cuánto se llevó AHORA. Resta del saldo.
//   "corregir"  — cuánto QUEDA de verdad en bodega. Fija el saldo en ese número.
//
// El modo corregir existe porque un número mal tecleado no tenía arreglo: el
// modal solo sabía restar, así que enderezarlo obligaba a calcular la diferencia
// de cabeza, y si el error había sido descontar de MÁS no había forma de
// devolver el material al saldo. Corregir se dice como lo ve el despachador:
// "el sistema dice 51 y en bodega hay 50".
function DescontarMaterialModal({ pedido, onClose, onDescontar, onCorregir }) {
  const productos = pedido.productos || [];
  // Copia 6 de 6 -> saldo.js.
  const dispo = saldoDe;
  const [modo, setModo] = useState("descontar");
  const corrigiendo = modo === "corregir";

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

  // Al cambiar de modo se limpian las casillas: los números significan cosas
  // distintas en cada uno y arrastrarlos sería justo el error que esto arregla.
  const cambiarModo = (m) => {
    setModo(m);
    setTextos(productos.map(() => ""));
  };

  // En "descontar", el techo es lo que queda en bodega. En "corregir" es el tope
  // editable: se puede subir el saldo (devolver material) pero nunca por encima
  // de lo que no salió por remisión.
  const techoDe = (p) => (corrigiendo ? topeEditableDe(p) : dispo(p));

  // Lo que de verdad se va a aplicar en cada línea, ya acotado.
  const cantidades = textos.map((t, i) => {
    const n = parseCantidad(t);
    if (!isFinite(n) || n < 0) return corrigiendo ? null : 0;
    // En corregir, una casilla vacía significa "esta línea no se toca".
    if (textos[i].trim() === "") return corrigiendo ? null : 0;
    if (!corrigiendo && n <= 0) return 0;
    return Math.min(techoDe(productos[i]), n);
  });
  // Líneas donde se tecleó más del techo: se avisa, no se calla.
  const excedidas = textos.map((t, i) => t.trim() !== "" && parseCantidad(t) > techoDe(productos[i]));

  const total = corrigiendo
    ? cantidades.filter((c) => c !== null).length
    : cantidades.reduce((s, c) => s + c, 0);

  return (
    <ModalOverlay onClose={onClose} maxWidth={460}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>
          {corrigiendo ? "Corregir el saldo" : "Descontar material entregado"}
        </span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 10 }}>
        {pedido.cliente}
        {pedido.numeroFactura ? ` · Factura ${pedido.numeroFactura}` : ""}
        {corrigiendo
          ? " — escribe cuánto QUEDA de verdad en bodega. Sirve para enderezar un descuento mal tecleado."
          : " — marca lo que el cliente ya se llevó directo. Baja del saldo sin crear remisión."}
      </div>

      {/* Cambiar de modo. Va arriba, discreto, y no estorba en el uso normal:
          el modo "descontar" es el que se usa a diario. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[
          { id: "descontar", label: "Se llevó material", icon: "ti-minus" },
          { id: "corregir", label: "Corregir saldo", icon: "ti-pencil" },
        ].map((m) => {
          const activo = modo === m.id;
          return (
            <button
              key={m.id}
              onClick={() => cambiarModo(m.id)}
              aria-pressed={activo}
              style={{
                flex: 1,
                fontSize: 12.5,
                fontWeight: activo ? 500 : 400,
                minHeight: 38,
                padding: "8px 10px",
                borderRadius: "var(--border-radius-md)",
                cursor: "pointer",
                background: activo ? "var(--color-background-info)" : "transparent",
                color: activo ? "var(--color-text-info)" : "var(--color-text-secondary)",
                border: activo ? "0.5px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
              }}
            >
              <i className={`ti ${m.icon}`} style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
              {m.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {productos.map((p, idx) => {
          const disponible = dispo(p);
          const tope = topeEditableDe(p);
          const yaDescontado = marcadoAManoDe(p);
          // En "descontar" no tiene sentido una línea sin saldo. En "corregir" sí:
          // justamente puede haber quedado en cero por error y hay que subirla.
          const agotado = !corrigiendo && disponible <= 0;
          return (
            <div key={idx} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", padding: "8px 10px", opacity: agotado ? 0.5 : 1 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <b style={{ fontWeight: 500 }}>{p.descripcion}</b>
                <span style={{ color: "var(--color-text-tertiary)" }}> · quedan {formatCantidad(disponible)} {p.unidad}</span>
                {corrigiendo && yaDescontado > 0 && (
                  <span style={{ color: "var(--color-text-tertiary)" }}> · ya se descontaron {formatCantidad(yaDescontado)}</span>
                )}
              </div>
              {agotado ? (
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Ya se entregó completo.</div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {corrigiendo ? "Quedan de verdad:" : "Ya se llevó:"}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={corrigiendo ? tope : disponible}
                      value={textos[idx]}
                      onChange={(e) => setTexto(idx, e.target.value)}
                      placeholder={corrigiendo ? formatCantidad(disponible) : "0"}
                      style={{ width: 90 }}
                    />
                    {corrigiendo ? (
                      <button onClick={() => setTexto(idx, "")} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>
                        No tocar
                      </button>
                    ) : (
                      <>
                        <button onClick={() => setTexto(idx, String(disponible))} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>Todo</button>
                        <button onClick={() => setTexto(idx, "")} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>Nada</button>
                      </>
                    )}
                  </div>
                  {excedidas[idx] && (
                    <div style={{ fontSize: 12, color: "var(--color-text-warning)", fontWeight: 500, marginTop: 5 }}>
                      <i className="ti ti-alert-triangle" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                      {corrigiendo
                        ? `Sin contar lo remisionado, el máximo es ${formatCantidad(tope)}: quedará en ${formatCantidad(tope)}.`
                        : `Solo quedan ${formatCantidad(disponible)}: se descontarán ${formatCantidad(disponible)}, no ${formatCantidad(parseCantidad(textos[idx]))}.`}
                    </div>
                  )}
                  {corrigiendo && cantidades[idx] !== null && cantidades[idx] !== disponible && (
                    <div style={{ fontSize: 12, color: "var(--color-text-info)", fontWeight: 500, marginTop: 5 }}>
                      <i className="ti ti-arrow-right" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                      {formatCantidad(disponible)} → {formatCantidad(cantidades[idx])}
                      {cantidades[idx] > disponible
                        ? ` (se devuelven ${formatCantidad(cantidades[idx] - disponible)} al saldo)`
                        : ` (se descuentan ${formatCantidad(disponible - cantidades[idx])} más)`}
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
          {total <= 0
            ? "Nada marcado aún"
            : corrigiendo
            ? `${total} ${total === 1 ? "línea se corrige" : "líneas se corrigen"}`
            : `${formatCantidad(total)} unidades se descuentan`}
        </span>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => total > 0 && (corrigiendo ? onCorregir(cantidades) : onDescontar(cantidades))}
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
          {corrigiendo ? "Corregir" : "Descontar"}
        </button>
      </div>
    </ModalOverlay>
  );
}

export default DescontarMaterialModal;
