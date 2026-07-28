import { useState, useRef } from "react";
// Antes esto importaba desde DespachoPedidos.jsx, que a su vez importa este
// archivo: una importación circular. Ahora todo sale de constants.js y la
// cadena va en una sola dirección.
import { formatCOP, esLineaFlete, todayISO, addDaysISO, VEHICULOS, DESTINOS } from "./constants.js";
// Estado derivado y guardas de guardado. Separados para poder probar la matriz
// documento (factura/cotización) × flujo (despacho/seguimiento).
import { revisarExtraccion, motivoBloqueo } from "./extractRevision.js";

/**
 * ExtractReviewCard — formulario de confirmación tras subir el PDF.
 *
 * MISMA interfaz que los componentes originales:
 *   props: { data, onChange, onConfirm, onCancel }
 *   - controlado: toda edición se propaga con onChange({ ...data, campo: valor })
 *   - onConfirm() / onCancel() sin argumentos
 *
 * Sirve para factura y cotización: el modo se decide con data.tipo === "cotizacion".
 * Reemplaza tanto a ExtractReviewCard como a ExtractReviewCardCotizacion; los dos
 * export del final conservan los nombres antiguos para no tocar los sitios de uso.
 *
 * `ack` (revisión de líneas no leídas), `verTodos` y `aviso` son estado de UI local,
 * no forman parte de `data`.
 */
export default function ExtractReviewCard({ data, onChange, onConfirm, onCancel, seguimiento = false, duplicado = null }) {
  // `seguimiento` decide el LAYOUT: true = interfaz de seguimiento de cotizaciones
  // (solo datos + fecha de seguimiento); false = interfaz de despacho (vehículo,
  // fecha de entrega, destino). Es INDEPENDIENTE del formato del PDF: una
  // cotización subida desde el tablero de despachos entra en modo despacho.
  // `tipoCotizacion` es el FORMATO del documento leído (factura vs cotización).
  // Solo afecta etiquetas ("N° cotización", badge), nunca el layout.
  //
  // El cálculo vive en extractRevision.js para poder probar la matriz
  // documento × flujo, que es donde se cruzan estos dos booleanos parecidos.
  const { esCotizacion, tipoCotizacion, missing, lineasIgnoradas, hayIgnoradas, alarmaSinProductos } =
    revisarExtraccion(data, seguimiento);
  const [aviso, setAviso] = useState("");
  const [ack, setAck] = useState(false);
  // Confirmación aparte para el caso "este número ya existe". Va separada de
  // `ack` (líneas no leídas) porque son dos riesgos distintos y pueden coincidir.
  const [ackDup, setAckDup] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [otroDestino, setOtroDestino] = useState(
    !!data.destino && !DESTINOS.includes(data.destino)
  );
  const confirmadoRef = useRef(false);

  const set = (patch) => {
    setAviso("");
    onChange({ ...data, ...patch });
  };

  const today = todayISO();
  const esViaje = data.fechaDespacho === "viaje";
  const esPendiente = !!data.sinFechaDefinida && !esViaje;
  const fechaSel =
    data.fechaDespacho && data.fechaDespacho !== "pendiente" && data.fechaDespacho !== "viaje"
      ? data.fechaDespacho
      : today;
  const esHoy = !esPendiente && !esViaje && fechaSel === today;
  const esProgramado = !esPendiente && !esViaje && fechaSel !== today;
  const enEspera = !!data.sinFechaDefinida;

  const productos = data.productos || [];
  const mostrarVerTodos = productos.length > 8;
  const shown = !mostrarVerTodos || verTodos ? productos : productos.slice(0, 6);

  const presetSel = DESTINOS.includes(data.destino) && !otroDestino;
  const otroActivo = otroDestino || (!!data.destino && !DESTINOS.includes(data.destino));

  // ---- estilos ----
  const opt = (active, bg, border, text) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    padding: "8px 10px",
    fontSize: 13.5,
    cursor: "pointer",
    borderRadius: "var(--border-radius-md)",
    fontWeight: active ? 600 : 500,
    border: active ? `2px solid ${border}` : "0.5px solid var(--color-border-tertiary)",
    background: active ? bg : "var(--color-background-primary)",
    color: active ? text : "var(--color-text-primary)",
  });
  const info = (a) => opt(a, "var(--color-background-info)", "var(--color-border-info)", "var(--color-text-info)");
  const warn = (a) => opt(a, "var(--color-background-warning)", "var(--color-border-warning)", "var(--color-text-warning)");
  const okc = (a) => opt(a, "var(--color-background-success)", "var(--color-border-success)", "var(--color-text-success)");
  const inputStyle = (bad) => ({
    width: "100%",
    minHeight: 44,
    padding: "10px 12px",
    fontSize: 14,
    background: "var(--color-background-primary)",
    borderRadius: "var(--border-radius-md)",
    border: bad ? "1px solid var(--color-border-warning)" : "0.5px solid var(--color-border-tertiary)",
  });
  const secTitle = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".07em",
    textTransform: "uppercase",
    color: "var(--color-text-tertiary)",
    marginBottom: 10,
  };

  const handleConfirm = () => {
    if (confirmadoRef.current) return; // evita doble clic mientras la tarjeta se cierra
    // Las guardas (y su orden) viven en extractRevision.js, con test.
    const bloqueo = motivoBloqueo(data, { seguimiento, ack, ackDup, duplicado });
    if (bloqueo) {
      setAviso(bloqueo);
      return;
    }
    setAviso("");
    confirmadoRef.current = true;
    onConfirm();
  };

  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-lg)",
        boxShadow: "0 1px 3px rgba(4,44,83,.05)",
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      {/* Encabezado */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: "#E6F1FB", color: "#0C447C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-file-text" style={{ fontSize: 19 }} aria-hidden="true"></i>
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.2 }}>
            {esCotizacion ? "Revisa los datos de la cotización" : "Revisa los datos extraídos"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginTop: 2 }}>
            {esCotizacion ? "Confírmalos y define el seguimiento" : "Confírmalos y decide cómo se despacha"}
          </div>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, padding: "4px 11px", borderRadius: 20, background: "#E6F1FB", color: "#0C447C", flexShrink: 0 }}>
          {tipoCotizacion ? "Cotización" : "Factura"}
        </span>
      </div>

      {/* Aviso de documento repetido + confirmación obligatoria. Previene el
          despacho doble de la misma factura, sin bloquear los casos legítimos. */}
      {duplicado && (
        <div style={{ margin: "16px 20px 0", border: "1px solid var(--color-border-warning)", background: "var(--color-background-warning)", borderRadius: "var(--border-radius-md)", padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-copy" style={{ fontSize: 20, color: "var(--color-text-warning)" }} aria-hidden="true"></i>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text-warning)" }}>
              Este documento ya está cargado
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-warning)", margin: "8px 0 10px" }}>
            El N° <b>{duplicado.numero}</b>
            {duplicado.cliente ? <> de <b>{duplicado.cliente}</b></> : null} {duplicado.donde}. Si lo
            guardas otra vez quedan <b>dos pedidos iguales</b> y se puede despachar doble.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 600, color: "var(--color-text-warning)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={ackDup}
              onChange={(e) => {
                setAckDup(e.target.checked);
                setAviso("");
              }}
              style={{ width: 18, height: 18, accentColor: "#b45309", cursor: "pointer" }}
            />
            Sé que está repetido, guardarlo igual
          </label>
        </div>
      )}

      {/* Aviso de que no se leyó NI UN material. Antes este caso pasaba callado. */}
      {alarmaSinProductos && (
        <div style={{ margin: "16px 20px 0", border: "1px solid var(--color-border-danger)", background: "var(--color-background-danger)", borderRadius: "var(--border-radius-md)", padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 20, color: "var(--color-text-danger)" }} aria-hidden="true"></i>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text-danger)" }}>
              No se leyó ningún material
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-danger)", margin: "8px 0 10px" }}>
            El documento se abrió, pero el lector <b>no reconoció la tabla de productos</b>. Suele pasar cuando el
            formato del PDF cambió. Los demás datos ({tipoCotizacion ? "cliente, número, total" : "cliente, factura, total"})
            pueden estar bien, pero <b>este pedido quedará sin materiales</b>. Abre el PDF y agrégalos a mano antes de despachar.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 600, color: "var(--color-text-danger)", cursor: "pointer" }}>
            <input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setAviso(""); }} style={{ width: 18, height: 18, accentColor: "#dc2626", cursor: "pointer" }} />
            Lo revisaré: entiendo que el pedido va sin materiales
          </label>
        </div>
      )}

      {/* Aviso destacado de líneas no leídas + confirmación obligatoria */}
      {hayIgnoradas && (
        <div style={{ margin: "16px 20px 0", border: "1px solid var(--color-border-danger)", background: "var(--color-background-danger)", borderRadius: "var(--border-radius-md)", padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 20, color: "var(--color-text-danger)" }} aria-hidden="true"></i>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text-danger)" }}>
              Ojo: {lineasIgnoradas.length} {lineasIgnoradas.length === 1 ? "línea no se pudo leer" : "líneas no se pudieron leer"}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-danger)", margin: "8px 0 10px" }}>
            Estos materiales <b>no quedarán en el pedido</b>. Si no los agregas a mano, el camión saldrá incompleto. Revisa el PDF antes de despachar.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "#fff", border: "0.5px dashed var(--color-border-danger)", borderRadius: 6, padding: "8px 10px" }}>
            {lineasIgnoradas.slice(0, 6).map((l, i) => (
              <div key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "#7A1F1F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</div>
            ))}
            {lineasIgnoradas.length > 6 && (
              <div style={{ fontSize: 11.5, color: "#7A1F1F" }}>…y {lineasIgnoradas.length - 6} más.</div>
            )}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 13.5, fontWeight: 600, color: "var(--color-text-danger)", cursor: "pointer" }}>
            <input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setAviso(""); }} style={{ width: 18, height: 18, accentColor: "#dc2626", cursor: "pointer" }} />
            Lo revisaré: entiendo que puede faltar material
          </label>
        </div>
      )}

      {/* Cuerpo */}
      <div style={{ padding: "18px 20px 8px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: esCotizacion ? "minmax(0,1fr)" : "minmax(0,1.12fr) minmax(340px,1fr)",
            gap: 22,
            alignItems: "start",
            maxWidth: esCotizacion ? 640 : "none",
          }}
        >
          {/* Columna izquierda: lo leído */}
          <div>
            <div style={secTitle}>Lo que se leyó del documento</div>

            {missing.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--color-text-warning)", background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", borderRadius: 6, padding: "8px 11px", marginBottom: 12 }}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 14 }} aria-hidden="true"></i>
                <span>No se detectó: {missing.join(", ")}. Complétalo a mano.</span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "block", gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", gap: 5, alignItems: "center", marginBottom: 5 }}>
                  Cliente <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--color-text-danger)" }}>· obligatorio</span>
                </span>
                <input type="text" autoComplete="off" value={data.cliente || ""} onChange={(e) => set({ cliente: e.target.value })} style={inputStyle(!data.cliente)} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>{tipoCotizacion ? "N° cotización" : "N° documento"}</span>
                <input type="text" inputMode="numeric" spellCheck={false} autoComplete="off" value={data.numeroFactura || ""} onChange={(e) => set({ numeroFactura: e.target.value })} style={inputStyle(!data.numeroFactura)} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Teléfono</span>
                <input type="tel" autoComplete="off" value={data.telefono || ""} onChange={(e) => set({ telefono: e.target.value })} style={inputStyle(!data.telefono)} />
              </label>
              <label style={{ display: "block", gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Vendedor</span>
                <input type="text" autoComplete="off" value={data.vendedor || ""} onChange={(e) => set({ vendedor: e.target.value })} style={inputStyle(!data.vendedor)} />
              </label>
            </div>

            {/* Contacto alterno (respeta el caso especial del original) */}
            {data.telefonoContacto && data.telefono === "111111111" && (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 10 }}>
                <i className="ti ti-phone" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                Cliente sin teléfono registrado, pero hay un celular de contacto anotado: {data.telefonoContacto}
              </div>
            )}

            {/* Productos */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <span style={{ ...secTitle, marginBottom: 0 }}>Productos ({productos.length})</span>
                <div style={{ textAlign: "right", lineHeight: 1.1 }}>
                  <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary)" }}>Total · IVA incluido</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0C447C" }}>{data.total ? `$${formatCOP(data.total)}` : "No detectado"}</div>
                </div>
              </div>
              {productos.length > 0 ? (
                <>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Precio con IVA incluido · solo lectura</div>
                  <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden" }}>
                    {shown.map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "8px 11px", borderTop: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none", background: i % 2 ? "#fbfcfe" : "#fff" }}>
                        <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, color: "var(--color-text-primary)", flexShrink: 0 }}>{p.cantidad} {p.unidad}</span>
                          <span style={{ color: "var(--color-text-secondary)" }}>{p.descripcion}</span>
                          {esLineaFlete(p.descripcion) && (
                            <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--color-text-tertiary)", background: "var(--color-background-secondary)", borderRadius: 20, padding: "1px 8px", flexShrink: 0 }}>flete · no es material</span>
                          )}
                        </span>
                        <span style={{ color: "var(--color-text-secondary)", flexShrink: 0 }}>${formatCOP(parseInt(p.total))}</span>
                      </div>
                    ))}
                  </div>
                  {mostrarVerTodos && (
                    <button onClick={() => setVerTodos((v) => !v)} style={{ marginTop: 8, width: "100%", minHeight: 40, fontSize: 13, fontWeight: 600, color: "#0C447C", background: "#F4F6F9", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>
                      {verTodos ? "Ver menos" : `Ver los ${productos.length} productos (+${productos.length - shown.length} ocultos)`}
                    </button>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--color-text-warning)", background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", borderRadius: 6, padding: "10px 12px" }}>
                  No se detectaron productos en la tabla. Puedes seguir igual; el PDF queda adjunto como respaldo.
                </div>
              )}
            </div>
          </div>

          {/* Columna derecha: despacho (factura) o seguimiento (cotización) */}
          <div>
            {!esCotizacion ? (
              <>
                <div style={secTitle}>Cómo se despacha</div>

                <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>¿Cuándo se entrega?</div>

                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 6 }}>Se despacha</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <button onClick={() => set({ sinFechaDefinida: false, fechaDespacho: today })} aria-pressed={esHoy} style={info(esHoy)}>
                      <i className="ti ti-calendar-check" style={{ fontSize: 16 }} aria-hidden="true"></i>Hoy
                    </button>
                    <button onClick={() => set({ sinFechaDefinida: false, fechaDespacho: addDaysISO(today, 1) })} aria-pressed={esProgramado} style={info(esProgramado)}>
                      <i className="ti ti-calendar" style={{ fontSize: 16 }} aria-hidden="true"></i>Otro día
                    </button>
                  </div>

                  {esProgramado && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                        {Array.from({ length: 7 }, (_, i) => addDaysISO(today, i + 1)).map((iso) => {
                          const [yy, mm, dd] = iso.split("-").map(Number);
                          const fo = new Date(yy, mm - 1, dd);
                          const etiqueta = iso === addDaysISO(today, 1) ? "Mañana" : fo.toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "");
                          const mes = fo.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
                          const sel = fechaSel === iso;
                          const c = sel ? "var(--color-text-info)" : "var(--color-text-tertiary)";
                          return (
                            <button key={iso} onClick={() => set({ fechaDespacho: iso })} aria-pressed={sel} style={{ flexShrink: 0, minWidth: 64, padding: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, cursor: "pointer", borderRadius: "var(--border-radius-md)", border: sel ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)", background: sel ? "var(--color-background-info)" : "#fff", color: sel ? "var(--color-text-info)" : "var(--color-text-primary)" }}>
                              <span style={{ fontSize: 11, textTransform: "capitalize", color: c }}>{etiqueta}</span>
                              <span style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{dd}</span>
                              <span style={{ fontSize: 10, textTransform: "capitalize", color: c }}>{mes}</span>
                            </button>
                          );
                        })}
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "var(--color-text-tertiary)" }}>
                        u otra fecha
                        <input type="date" value={fechaSel} min={today} onChange={(e) => set({ fechaDespacho: e.target.value || today })} style={{ flex: 1, minHeight: 38 }} />
                      </label>
                    </div>
                  )}

                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 6 }}>Queda en espera</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => set({ sinFechaDefinida: true, fechaDespacho: "pendiente", vehiculo: null })} aria-pressed={esPendiente} style={warn(esPendiente)}>
                      <i className="ti ti-clock-pause" style={{ fontSize: 16 }} aria-hidden="true"></i>Por entregar
                    </button>
                    <button onClick={() => set({ sinFechaDefinida: true, fechaDespacho: "viaje", vehiculo: null })} aria-pressed={esViaje} style={warn(esViaje)}>
                      <i className="ti ti-route" style={{ fontSize: 16 }} aria-hidden="true"></i>Por viaje
                    </button>
                  </div>
                </div>

                {enEspera ? (
                  <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "11px 13px", marginBottom: 12 }}>
                    <i className="ti ti-info-circle" style={{ fontSize: 16, color: "var(--color-text-tertiary)", flexShrink: 0, marginTop: 1 }} aria-hidden="true"></i>
                    <span>
                      {esViaje
                        ? 'Sin vehículo por ahora — va a la pestaña "Por viaje". Se le asigna vehículo cuando salga un viaje a esa zona.'
                        : 'Sin vehículo por ahora — va a "Por entregar" hasta que sepas cuándo y en qué vehículo sale.'}
                    </span>
                  </div>
                ) : (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
                      Vehículo <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--color-text-danger)" }}>· obligatorio</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                      {VEHICULOS.map((v) => {
                        const active = data.vehiculo === v.id;
                        return (
                          <button key={v.id} onClick={() => set({ vehiculo: v.id })} aria-pressed={active} style={opt(active, v.bg, v.border, v.text)}>
                            <i className={`ti ${v.icon}`} style={{ fontSize: 18 }} aria-hidden="true"></i>{v.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Estado de pago */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Estado de pago</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => set({ estadoPago: "pagado" })} aria-pressed={data.estadoPago === "pagado"} style={okc(data.estadoPago === "pagado")}>
                      <i className="ti ti-check" style={{ fontSize: 16 }} aria-hidden="true"></i>Ya pagado
                    </button>
                    <button onClick={() => set({ estadoPago: "pendiente" })} aria-pressed={data.estadoPago === "pendiente"} style={warn(data.estadoPago === "pendiente")}>
                      <i className="ti ti-cash" style={{ fontSize: 16 }} aria-hidden="true"></i>Paga al recibir
                    </button>
                  </div>
                </div>

                {/* Destino (opcional) */}
                <div>
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 8 }}>
                    ¿Para dónde va? <span style={{ color: "var(--color-text-tertiary)" }}>(opcional)</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {DESTINOS.map((name) => (
                      <button key={name} onClick={() => { setOtroDestino(false); set({ destino: name }); }} aria-pressed={presetSel && data.destino === name} style={info(presetSel && data.destino === name)}>
                        {name}
                      </button>
                    ))}
                    <button onClick={() => { setOtroDestino(true); set({ destino: DESTINOS.includes(data.destino) ? "" : data.destino }); }} aria-pressed={otroActivo} style={info(otroActivo)}>
                      Otro
                    </button>
                  </div>
                  {otroActivo && (
                    <input type="text" autoComplete="off" placeholder="Escribe el lugar" value={DESTINOS.includes(data.destino) ? "" : data.destino || ""} onChange={(e) => set({ destino: e.target.value })} style={{ width: "100%", marginTop: 8, minHeight: 44, padding: "10px 12px", fontSize: 14, border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)" }} />
                  )}
                </div>
              </>
            ) : (
              <>
                <div style={secTitle}>Seguimiento</div>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: "var(--color-text-secondary)", background: "var(--color-background-info)", borderRadius: "var(--border-radius-md)", padding: "12px 14px", marginBottom: 14 }}>
                  <i className="ti ti-clock" style={{ fontSize: 17, color: "var(--color-text-info)", flexShrink: 0, marginTop: 1 }} aria-hidden="true"></i>
                  <span>Esta cotización empieza en estado <b>Pendiente</b>. Después la marcas como Aceptada o Rechazada.</span>
                </div>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>
                    Fecha de seguimiento <span style={{ color: "var(--color-text-tertiary)" }}>(opcional)</span>
                  </span>
                  <input type="date" value={data.fechaSeguimiento || ""} onChange={(e) => set({ fechaSeguimiento: e.target.value })} style={{ width: "100%", minHeight: 44, padding: "10px 12px", fontSize: 14, border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)" }} />
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 6 }}>Para recordarte cuándo llamar al cliente y dar seguimiento.</span>
                </label>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Pie */}
      <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", position: "sticky", bottom: 0, background: "var(--color-background-primary)" }}>
        {aviso && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, color: "var(--color-text-danger)" }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 15 }} aria-hidden="true"></i>{aviso}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ minHeight: 44, padding: "0 18px", fontSize: 14, fontWeight: 500, color: "var(--color-text-secondary)", background: "#fff", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>
            Cancelar
          </button>
          <button onClick={handleConfirm} style={{ minHeight: 44, padding: "0 22px", fontSize: 14, fontWeight: 600, color: "#fff", background: "#0C447C", border: "none", borderRadius: "var(--border-radius-md)", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
            <i className="ti ti-check" style={{ fontSize: 17 }} aria-hidden="true"></i>
            {esCotizacion ? "Agregar cotización" : "Agregar pedido"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Interfaz de SEGUIMIENTO de cotizaciones (tablero de cotizaciones): mismo
// componente en modo seguimiento (sin vehículo ni fecha de entrega). El
// tablero de DESPACHOS usa el export por defecto (modo despacho) aunque el
// PDF sea una cotización, porque ahí también se despachan cotizaciones.
export function ExtractReviewCardCotizacion(props) {
  return <ExtractReviewCard {...props} seguimiento={true} />;
}
