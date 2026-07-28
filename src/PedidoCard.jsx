import { useState, useRef } from "react";
import { VEHICULOS, MARCA, formatCOP, formatCantidad, formatFechaCorta } from "./constants.js";
import { cantidadNum, faltantesDeProductos } from "./saldo.js";
import { cargaPorEntregar } from "./peso.js";

// Estilos de la tarjeta. Se inyectan UNA sola vez desde el componente
// principal (no por tarjeta): con 50 pedidos en pantalla, una etiqueta de
// estilos por tarjeta serían 50 copias idénticas en el DOM.
const CARD_CSS = `
/* Sin overflow:hidden — recortaba el menú cuando la tarjeta era más corta
   que el desplegable. La franja de color es un border, no un hijo, así que
   no necesita recorte para respetar las esquinas redondeadas. */
.pc-card{display:flex;background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);
  border-radius:var(--border-radius-md);margin-bottom:8px;position:relative;}
/* Con el menú abierto la tarjeta se pone por encima de las de abajo, si no
   el desplegable queda tapado por la tarjeta siguiente. */
.pc-card.pc-abierta{z-index:40;}
.pc-body{flex:1;min-width:0;padding:11px 12px;}
.pc-rail{display:flex;flex-direction:column;justify-content:space-between;gap:8px;width:112px;flex-shrink:0;
  border-left:0.5px solid var(--color-border-tertiary);padding:10px;position:relative;}
.pc-menu-btn{width:100%;min-height:38px;font-size:12.5px;padding:8px 6px;background:transparent;
  color:var(--color-text-secondary);border:0.5px solid var(--color-border-tertiary);
  border-radius:var(--border-radius-md);cursor:pointer;}
.pc-menu-btn:hover{background:var(--color-background-secondary);}
.pc-primary{border:none;color:#fff;font-weight:500;font-size:12.5px;border-radius:var(--border-radius-md);
  padding:10px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;line-height:1.15;
  min-height:56px;}
.pc-pop{position:absolute;top:50px;right:0;background:var(--color-background-primary);
  border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);
  box-shadow:0 8px 24px rgba(4,44,83,.16);padding:6px;width:212px;z-index:30;}
.pc-item{display:flex;align-items:center;gap:10px;padding:10px;border-radius:var(--border-radius-sm);
  font-size:13px;color:var(--color-text-primary);cursor:pointer;background:none;border:none;width:100%;
  text-align:left;min-height:42px;}
.pc-item:hover{background:var(--color-background-secondary);}
.pc-item.danger{color:var(--color-text-danger);}
/* Si la tarjeta está al final de la pantalla, el menú se abre hacia arriba
   para no quedar cortado por el borde inferior. */
.pc-pop.pc-arriba{top:auto;bottom:50px;}

/* Columnas angostas: el riel se pasa abajo como fila para que el nombre del
   cliente y el total no queden espichados. */
@media (max-width:1100px){
  .pc-card{flex-direction:column;}
  .pc-rail{width:auto;flex-direction:row;border-left:none;border-top:0.5px solid var(--color-border-tertiary);}
  .pc-menu-btn{width:auto;flex:1;}
  .pc-primary{flex:2;flex-direction:row;justify-content:center;min-height:44px;}
  .pc-pop{top:auto;bottom:52px;left:10px;right:auto;}
}
`;

function PedidoCard({ pedido, posicion, esSecundario, isDragging, onDragStart, onDragEnd, onDragOverItem, onDropItem, onDelete, onEntregado, onEdit, onVerPdf, onNotaPendiente, atrasadoDesde, onMoverAHoy, onProgramar, onMaterialUnidades, onCrearRemision, onDescontarMaterial, onImprimirTirilla }) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Si el menú debe abrirse hacia arriba (no cabe abajo en la pantalla).
  const [menuArriba, setMenuArriba] = useState(false);
  const railRef = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [verProductos, setVerProductos] = useState(false);
  // Si la lista de material pendiente está desplegada completa.
  const [verFaltantes, setVerFaltantes] = useState(false);
  const productos = pedido.productos || [];
  const pagado = pedido.estadoPago === "pagado";
  const pendiente = !!pedido.entregaPendiente;
  const vehiculoPrincipal = VEHICULOS.find((v) => v.id === pedido.vehiculo);
  // Es una factura madre que ya generó remisiones (sus productos llevan saldo
  // restante). Mientras tenga saldo no se entrega entera: solo genera remisiones.
  const esMadreConSaldo = productos.some((p) => p.cantidadRestante !== undefined && p.cantidadRestante !== null);
  // Es una remisión: puede venir de una factura grande (remisionDe) o ser
  // manual (tipoDocumento "remision", sin factura de origen).
  const esRemision = !!pedido.remisionDe || pedido.tipoDocumento === "remision";
  const faltan = faltantesDeProductos(productos);
  // Peso de lo que hay que subir al vehículo, y si por sí solo ya no cabe.
  const carga = cargaPorEntregar(pedido);
  const capacidad = vehiculoPrincipal && vehiculoPrincipal.capacidadKg;
  const excedeCapacidad = !!capacidad && carga > capacidad;

  // Franja de color a la izquierda: el estado del pedido de un vistazo, sin
  // tener que leer las insignias.
  const franja = atrasadoDesde || pendiente
    ? "var(--color-border-danger)"
    : esMadreConSaldo
    ? "var(--color-border-warning)"
    : pagado
    ? "var(--color-border-success)"
    : MARCA.azulMedio;

  const cerrarMenu = () => {
    setMenuAbierto(false);
    setConfirmDelete(false);
  };

  // Acciones secundarias. Solo aparecen las que aplican a esta vista: en el
  // tablero del día no hay "Mover a despacho", y "Crear remisión" ya no llega
  // aquí (vive en la pantalla "Por entregar").
  const acciones = [
    onProgramar && { label: "Mover a despacho", icon: "ti-truck-delivery", fn: onProgramar },
    onCrearRemision && { label: "Crear remisión", icon: "ti-arrows-split", fn: onCrearRemision },
    esMadreConSaldo && onDescontarMaterial && { label: "Descontar material", icon: "ti-checklist", fn: onDescontarMaterial },
    onMaterialUnidades && !esMadreConSaldo && {
      label: faltan.length > 0 ? "Editar material entregado" : "Material entregado",
      icon: "ti-package-import",
      fn: onMaterialUnidades,
      alerta: faltan.length > 0,
    },
    !esSecundario && onNotaPendiente && { label: pendiente ? "Editar pendiente" : "Quedó pendiente", icon: "ti-note", fn: onNotaPendiente },
    esRemision && onImprimirTirilla && { label: "Imprimir tirilla", icon: "ti-printer", fn: onImprimirTirilla },
    (pedido.tienePdf || pedido.pdfDataUrl) && onVerPdf && { label: "Ver documento", icon: "ti-file-text", fn: onVerPdf },
    onEdit && { label: "Editar", icon: "ti-pencil", fn: onEdit },
  ].filter(Boolean);

  return (
    <div
      className={`pc-card${menuAbierto ? " pc-abierta" : ""}`}
      draggable={!esSecundario && !menuAbierto}
      onDragStart={esSecundario ? undefined : onDragStart}
      onDragEnd={esSecundario ? undefined : onDragEnd}
      onDragOver={esSecundario ? undefined : onDragOverItem}
      onDrop={esSecundario ? undefined : onDropItem}
      style={{
        borderLeft: `4px solid ${franja}`,
        cursor: esSecundario ? "default" : "grab",
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div className="pc-body">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: MARCA.azulClaro,
              color: MARCA.azulOscuro,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {posicion !== null ? posicion : <i className="ti ti-help-circle" style={{ fontSize: 13 }} aria-hidden="true"></i>}
          </span>
          <span style={{ fontWeight: 500, fontSize: 14.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pedido.cliente}
          </span>
          {pedido.total ? (
            <span style={{ fontSize: 14.5, fontWeight: 500, color: MARCA.azulOscuro, flexShrink: 0 }}>${formatCOP(pedido.total)}</span>
          ) : null}
          {!esSecundario && (
            <i className="ti ti-grip-vertical" style={{ fontSize: 14, color: "var(--color-text-tertiary)", flexShrink: 0 }} aria-hidden="true"></i>
          )}
        </div>

        {/* Línea de estado: lo más importante primero (atrasado > remisión >
            pago), y al lado el resto de datos en gris. */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7, flexWrap: "wrap" }}>
          {atrasadoDesde ? (
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-danger)" }}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 3 }} aria-hidden="true"></i>
              Atrasado · era para {formatFechaCorta(atrasadoDesde)}
            </span>
          ) : esMadreConSaldo ? (
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-warning)" }}>
              <i className="ti ti-package" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 3 }} aria-hidden="true"></i>
              Factura con remisiones
            </span>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 500, color: pagado ? "var(--color-text-success)" : "var(--color-text-warning)" }}>
              <i className={pagado ? "ti ti-circle-check" : "ti ti-clock"} style={{ fontSize: 12.5, verticalAlign: "-2px", marginRight: 3 }} aria-hidden="true"></i>
              {pagado ? "Pagado" : "Paga al recibir"}
            </span>
          )}
          {esRemision && pedido.numeroFactura && (
            <span style={{ fontSize: 11.5, fontWeight: 500, background: "var(--color-background-info)", color: "var(--color-text-info)", borderRadius: "var(--border-radius-sm)", padding: "2px 7px" }}>
              <i className="ti ti-arrows-split" style={{ fontSize: 11, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
              {pedido.remisionDe ? `${pedido.numeroFactura} · de Factura ${pedido.remisionDe}` : `${pedido.numeroFactura} · manual`}
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[
              !esRemision && pedido.numeroFactura ? `${pedido.tipoDocumento === "cotizacion" ? "Cotización" : "Factura"} ${pedido.numeroFactura}` : null,
              pedido.destino && pedido.destino.trim() ? pedido.destino : null,
              pedido.hora || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {/* Peso del pedido: sirve para saber si cabe en un viaje. Si el
              pedido por sí solo pasa de la capacidad del vehículo, se avisa. */}
          {carga > 0 && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: excedeCapacidad ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              <i className="ti ti-weight" style={{ fontSize: 12.5, verticalAlign: "-2px", marginRight: 3 }} aria-hidden="true"></i>
              {formatCOP(Math.round(carga))} kg
              {excedeCapacidad ? " · no cabe en un viaje" : ""}
            </span>
          )}
        </div>

        {esSecundario && (
          <div style={{ marginBottom: 7 }}>
            <span style={{ fontSize: 11.5, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)", borderRadius: "var(--border-radius-sm)", padding: "2px 7px" }}>
              <i className="ti ti-arrows-split" style={{ fontSize: 11, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
              Parte de este pedido va aquí — el principal está en {vehiculoPrincipal ? vehiculoPrincipal.label : "otro vehículo"}
            </span>
          </div>
        )}

        {productos.length > 0 && (
          <div style={{ marginBottom: pendiente || (atrasadoDesde && onMoverAHoy) ? 8 : 0 }}>
            {productos.length === 1 ? (
              <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
                <b style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {productos[0].cantidad} {productos[0].unidad}
                </b>{" "}
                — {productos[0].descripcion}
                {productos[0].cantidadRestante !== undefined && productos[0].cantidadRestante !== null && (
                  <span style={{ color: "var(--color-text-warning)", fontWeight: 500 }}>
                    {" "}· quedan {formatCantidad(productos[0].cantidadRestante)} de {formatCantidad(cantidadNum(productos[0].cantidad))}
                  </span>
                )}
              </div>
            ) : (
              <>
                <button
                  onClick={() => setVerProductos(!verProductos)}
                  style={{ fontSize: 12.5, padding: "6px 0", minHeight: 34, border: "none", background: "transparent", color: "var(--color-text-secondary)", textAlign: "left", cursor: "pointer" }}
                >
                  {verProductos ? "Ocultar productos" : `${productos[0].descripcion} +${productos.length - 1} más`}
                  <i className={verProductos ? "ti ti-chevron-up" : "ti ti-chevron-down"} style={{ fontSize: 13, verticalAlign: "-2px", marginLeft: 4, color: MARCA.azulMedio }} aria-hidden="true"></i>
                </button>
                {verProductos && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                    {productos.map((p, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
                        <span style={{ fontWeight: 500, color: "var(--color-text-primary)", flexShrink: 0, minWidth: 58 }}>
                          {p.cantidad} {p.unidad}
                        </span>
                        <span style={{ color: "var(--color-text-secondary)" }}>
                          {p.descripcion}
                          {p.cantidadRestante !== undefined && p.cantidadRestante !== null && (
                            <span style={{ color: "var(--color-text-warning)", fontWeight: 500 }}>
                              {" "}· quedan {formatCantidad(p.cantidadRestante)} de {formatCantidad(cantidadNum(p.cantidad))}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Material pendiente. Antes se pintaba la nota completa como un
            párrafo rojo corrido y con 6 materiales era ilegible. Ahora se usa
            la lista estructurada (cantidad · unidad · descripción), una línea
            por material, mostrando 2 y el resto detrás de "+N más". */}
        {pendiente && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--color-text-danger)",
              background: "var(--color-background-danger)",
              borderRadius: "var(--border-radius-sm)",
              padding: "7px 9px",
              marginBottom: atrasadoDesde && onMoverAHoy ? 8 : 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 12.5, flexShrink: 0 }} aria-hidden="true"></i>
              {faltan.length > 0
                ? `Debe ${faltan.length} ${faltan.length === 1 ? "material" : "materiales"}`
                : "Debe material"}
            </div>
            {faltan.length > 0 ? (
              <div style={{ marginTop: 5 }}>
                {(verFaltantes ? faltan : faltan.slice(0, 2)).map((f, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", gap: 6, padding: "2px 0", lineHeight: 1.35 }}
                  >
                    <span style={{ fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap" }}>
                      {formatCantidad(f.faltan)} {f.unidad}
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.descripcion}
                    </span>
                  </div>
                ))}
                {faltan.length > 2 && (
                  <button
                    onClick={() => setVerFaltantes(!verFaltantes)}
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      padding: "4px 0",
                      minHeight: 30,
                      border: "none",
                      background: "transparent",
                      color: "var(--color-text-danger)",
                      cursor: "pointer",
                    }}
                  >
                    {verFaltantes ? "Ver menos" : `+${faltan.length - 2} más`}
                    <i
                      className={verFaltantes ? "ti ti-chevron-up" : "ti ti-chevron-down"}
                      style={{ fontSize: 12, verticalAlign: "-2px", marginLeft: 3 }}
                      aria-hidden="true"
                    ></i>
                  </button>
                )}
              </div>
            ) : (
              pedido.notaPendiente &&
              pedido.notaPendiente.trim() && (
                <div style={{ marginTop: 4, lineHeight: 1.35 }}>{pedido.notaPendiente}</div>
              )
            )}
          </div>
        )}

        {atrasadoDesde && onMoverAHoy && (
          <div>
            <button
              onClick={onMoverAHoy}
              style={{
                fontSize: 12.5,
                padding: "7px 11px",
                minHeight: 36,
                fontWeight: 500,
                background: "var(--color-background-warning)",
                color: "var(--color-text-warning)",
                border: "0.5px solid var(--color-border-warning)",
              }}
            >
              <i className="ti ti-calendar-up" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
              Mover a hoy
            </button>
          </div>
        )}
      </div>

      {/* Riel de acción: el menú arriba y "Entregado" siempre abajo, en el
          mismo sitio en todas las tarjetas. */}
      <div className="pc-rail" ref={railRef}>
        <button
          className="pc-menu-btn"
          onClick={() => {
            if (menuAbierto) {
              cerrarMenu();
              return;
            }
            const r = railRef.current && railRef.current.getBoundingClientRect();
            // ~64px por opción es suficiente margen para el alto del menú.
            setMenuArriba(!!r && window.innerHeight - r.bottom < acciones.length * 44 + 90);
            setMenuAbierto(true);
          }}
          aria-haspopup="true"
          aria-expanded={menuAbierto}
        >
          <i className="ti ti-dots" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Menú
          {faltan.length > 0 && (
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-danger)", marginLeft: 5, verticalAlign: "middle" }}></span>
          )}
        </button>

        {menuAbierto && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={cerrarMenu}></div>
            <div className={`pc-pop${menuArriba ? " pc-arriba" : ""}`}>
              {acciones.map((a) => (
                <button
                  key={a.label}
                  className="pc-item"
                  onClick={() => {
                    a.fn();
                    cerrarMenu();
                  }}
                >
                  <i className={`ti ${a.icon}`} style={{ fontSize: 17, width: 20, color: a.alerta ? "var(--color-text-warning)" : "var(--color-text-tertiary)" }} aria-hidden="true"></i>
                  {a.label}
                </button>
              ))}
              {onDelete && (
                <>
                  <div style={{ height: 1, background: "var(--color-border-tertiary)", margin: "4px 6px" }}></div>
                  {/* Eliminar pide confirmación dentro del propio menú: un clic
                      suelto no puede borrar. Si aun así se va, queda la barra
                      de "Deshacer" del componente principal. */}
                  {confirmDelete ? (
                    <button
                      className="pc-item danger"
                      onClick={() => {
                        onDelete();
                        cerrarMenu();
                      }}
                      style={{ fontWeight: 500, background: "var(--color-background-danger)" }}
                    >
                      <i className="ti ti-trash" style={{ fontSize: 17, width: 20 }} aria-hidden="true"></i>
                      Sí, eliminar
                    </button>
                  ) : (
                    <button className="pc-item danger" onClick={() => setConfirmDelete(true)}>
                      <i className="ti ti-trash" style={{ fontSize: 17, width: 20 }} aria-hidden="true"></i>
                      Eliminar
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* La factura con remisiones también se puede entregar: cuando se
            programa a un día es justamente para llevar lo que quedaba. Al
            entregarla solo se cuenta ese saldo, no la factura completa. */}
        {!esSecundario && (
          <button className="pc-primary" style={{ background: "#639922" }} onClick={onEntregado}>
            <i className="ti ti-check" style={{ fontSize: 22 }} aria-hidden="true"></i>
            Entregado
          </button>
        )}
      </div>
    </div>
  );
}

export { CARD_CSS };
export default PedidoCard;
