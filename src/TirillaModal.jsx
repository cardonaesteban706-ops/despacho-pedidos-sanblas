import ModalOverlay from "./ModalOverlay.jsx";
import { VEHICULOS, MARCA, todayStr, nowTimeStr } from "./constants.js";

// Estilos de la tirilla térmica. Estaban dentro de CARD_CSS, en el mismo bloque
// que los estilos de PedidoCard, y se inyectaban siempre aunque no hubiera
// ninguna tirilla abierta. Ahora viajan con el modal: se montan cuando el modal
// se monta, que es exactamente cuando se puede imprimir.
//
// Esto importa por el @media print: la regla esconde TODA la página
// (body * { visibility: hidden }) y deja visible solo #tirilla-print. Mientras
// vivió en el CSS global estuvo cargada de forma permanente; si algún día
// alguien imprime otra pantalla, ahora ya no hay nada que la esconda.
const TIRILLA_CSS = `
/* Tirilla térmica de 58 mm. Todo el tamaño interno va en "em" y se controla
   con el font-size del contenedor: en pantalla se ve en px (vista previa) y al
   imprimir se cambia a milímetros, que es lo único que la impresora respeta.
   Con px la tirilla salía mucho más angosta y con letra más pequeña que las
   del sistema de facturación. */
.tr{background:#fff;color:#000;font-family:ui-monospace,'Courier New',monospace;
  font-size:13px;line-height:1.35;width:300px;padding:10px 9px 14px;font-weight:600;
  border:0.5px solid var(--color-border-tertiary);}
.tr-tit{font-size:1.15em;font-weight:800;text-align:center;line-height:1.2;}
.tr-sub{font-size:0.82em;text-align:center;line-height:1.3;}
.tr-enc{font-size:1em;font-weight:800;text-align:center;letter-spacing:0.04em;}
.tr-num{font-size:1.5em;font-weight:800;text-align:center;margin:1px 0;}
.tr-sep{border-top:1.5px dashed #000;margin:0.45em 0;}
.tr-solid{border-top:1.5px solid #000;margin:0.2em 0 0.35em;}
.tr-row{display:flex;gap:0.35em;line-height:1.35;}
.tr-lab{width:4.6em;flex-shrink:0;font-weight:700;}
.tr-item{display:flex;gap:0.35em;margin-bottom:0.25em;line-height:1.3;}
.tr-qty{width:4.6em;flex-shrink:0;font-weight:800;}
.tr-desc{flex:1;word-break:break-word;}
.tr-tot{display:flex;justify-content:space-between;font-weight:800;}
.tr-firma{margin-top:2em;border-top:1.5px solid #000;padding-top:0.25em;
  text-align:center;font-size:0.82em;}
.tr-nota{text-align:center;font-size:0.75em;line-height:1.3;}

/* Al imprimir se oculta toda la página y solo queda la tirilla.
   - Papel: Gprinter 80 mm (72 mm imprimibles) x 297 mm de largo de página. El
     tamaño @page va IGUAL al del driver: así la tirilla sale en UNA sola hoja y
     la cuchilla la corta una vez (antes, con 58mm/auto, no cuadraba con el papel
     y salían varios pedazos).
   - Contenido a 72 mm centrado en los 80 (4 mm de margen a cada lado, que es el
     área que la Gprinter no imprime).
   - print-color-adjust:exact + font-weight 700 = negro sólido, no gris.
   - font-size en mm = tamaño físico de la letra, más grande que en 58mm porque
     ahora hay ancho de sobra y se pidió más legible. */
@media print{
  html,body{margin:0 !important;padding:0 !important;}
  body *{visibility:hidden !important;}
  #tirilla-print,#tirilla-print *{visibility:visible !important;color:#000 !important;
    -webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
  #tirilla-print{position:fixed !important;left:4mm !important;top:0 !important;
    width:72mm !important;font-size:2.9mm !important;font-weight:700 !important;
    margin:0 !important;padding:0 !important;border:none !important;box-shadow:none !important;}
  #tirilla-print .tr-tit,#tirilla-print .tr-enc,#tirilla-print .tr-num,
  #tirilla-print .tr-qty,#tirilla-print .tr-tot{font-weight:800 !important;}
  @page{size:80mm 297mm;margin:0;}
}
`;

// Tirilla de remisión para impresora térmica de 58 mm. NO es factura de venta
// (no lleva CUFE, QR ni resolución DIAN): es el comprobante interno de que el
// material salió y alguien lo recibió. Por eso lleva firma de quien recibe.
// Sin peso a propósito: el peso de la app es aproximado y no debe imprimirse
// en un papel que el cliente firma.
function TirillaModal({ pedido, onClose }) {
  const productos = pedido.productos || [];
  const veh = VEHICULOS.find((v) => v.id === pedido.vehiculo);
  const tel = pedido.telefono || pedido.telefonoContacto;

  return (
    <ModalOverlay onClose={onClose} maxWidth={360}>
      <style>{TIRILLA_CSS}</style>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Tirilla de remisión</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
        <div id="tirilla-print" className="tr">
          <div className="tr-tit">FERROMATERIALES</div>
          <div className="tr-tit">SAN BLAS S.A.S.</div>
          <div className="tr-sub">NIT 901.577.413-3</div>
          <div className="tr-sub">CL 7 CRA 2-28 AV SAN BLAS</div>
          <div className="tr-sub">CEL 310 590 0475</div>
          <div className="tr-sub">MORROA - SUCRE</div>

          <div className="tr-sep"></div>
          <div className="tr-enc">REMISION DE ENTREGA</div>
          <div className="tr-num">{pedido.numeroFactura || "-"}</div>
          {pedido.remisionDe && <div className="tr-sub">de Factura {pedido.remisionDe}</div>}
          <div className="tr-sep"></div>

          <div className="tr-row"><span className="tr-lab">FECHA</span><span>{todayStr()} {nowTimeStr()}</span></div>
          <div className="tr-row"><span className="tr-lab">CLIENTE</span><span style={{ flex: 1 }}>{pedido.cliente || "-"}</span></div>
          {pedido.direccion && <div className="tr-row"><span className="tr-lab">DIRECC.</span><span style={{ flex: 1 }}>{pedido.direccion}</span></div>}
          {tel && <div className="tr-row"><span className="tr-lab">CEL.</span><span>{tel}</span></div>}
          {pedido.destino && <div className="tr-row"><span className="tr-lab">DESTINO</span><span>{pedido.destino}</span></div>}
          {veh && <div className="tr-row"><span className="tr-lab">VEHIC.</span><span>{veh.label.toUpperCase()}</span></div>}

          <div className="tr-sep"></div>
          <div className="tr-item" style={{ fontWeight: 700 }}>
            <span className="tr-qty">CANT</span>
            <span className="tr-desc">DESCRIPCION</span>
          </div>
          <div className="tr-solid"></div>

          {productos.map((p, i) => (
            <div key={i} className="tr-item">
              <span className="tr-qty">{p.cantidad} {p.unidad}</span>
              <span className="tr-desc">{p.descripcion}</span>
            </div>
          ))}

          <div className="tr-sep"></div>
          <div className="tr-tot">
            <span>TOTAL ITEMS</span>
            <span>{productos.length}</span>
          </div>

          <div className="tr-firma">FIRMA DE QUIEN RECIBE</div>
          <div className="tr-firma" style={{ marginTop: "1.8em" }}>C.C. / NOMBRE</div>

          <div className="tr-sep" style={{ marginTop: "0.8em" }}></div>
          <div className="tr-nota">
            Documento interno de entrega.
            <br />
            NO es factura de venta.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cerrar</button>
        <button
          onClick={() => window.print()}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: MARCA.azulMedio,
            color: "#fff",
            border: "none",
            borderRadius: "var(--border-radius-md)",
            padding: "9px 14px",
            minHeight: 40,
          }}
        >
          <i className="ti ti-printer" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Imprimir
        </button>
      </div>
    </ModalOverlay>
  );
}

export default TirillaModal;
