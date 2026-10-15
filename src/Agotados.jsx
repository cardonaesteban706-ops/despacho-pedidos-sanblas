import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cargarAgotados, cargarCatalogoProductos, guardarAgotado, guardarAgotados, eliminarAgotado } from "./supabaseClient";
import { categoriaDeProducto } from "./peso.js";
import { uid, formatCantidad, MARCA } from "./constants.js";
import { quitarPorId, reponerPorId, reemplazarPorId } from "./listas.js";
import ModalOverlay from "./ModalOverlay.jsx";
import {
  esAgotado,
  cuandoCorto,
  horaCorta,
  reportesDeHoy,
  reporteAbiertoDe,
  ultimaCantidadPedir,
  catalogoProductos,
  buscarEnCatalogo,
  filtrarCompras,
  proveedoresConocidos,
  proveedoresDelProducto,
  alternarProveedor,
  cambiarEstado,
  vistaProveedor,
  resumenProveedores,
  estaAbierto,
} from "./agotados.js";

// Módulo de Agotados (Bodega). Reemplaza el Excel diario de productos agotados
// o que se están acabando: queda en la app cuándo se reportó cada uno.
//
//   Reportar      -> la empleada de bodega: producto, cuántas quedan, cuánto pedir.
//   Compras       -> el encargado: todo lo abierto, agotados primero, proveedores
//                    por producto y el paso Reportado -> Pedido -> Llegó.
//   Por proveedor -> llegó o llamó un vendedor: qué se le puede pedir a él.
//
// Diseño: sistema "San Blas Bodega" (mínimos toques). La lógica pura vive en
// agotados.js; aquí solo hay pantalla y guardado. No se pide quién reporta:
// basta con la fecha y hora de cada reporte.

function useAncho(minPx) {
  const consulta = `(min-width: ${minPx}px)`;
  const [ok, setOk] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia(consulta).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(consulta);
    const cambio = () => setOk(mq.matches);
    mq.addEventListener("change", cambio);
    return () => mq.removeEventListener("change", cambio);
  }, [consulta]);
  return ok;
}

// Colores de estado del sistema de diseño (mismos de constants.js: cotización
// rechazada / pendiente / aceptada). Fondo + texto + borde, siempre con palabra.
const AG_CSS = `
.ag { --ag-rojo-bg:#FBE6E6; --ag-rojo:#7A1F1F; --ag-rojo-borde:#CC3333;
      --ag-amar-bg:#FAEEDA; --ag-amar:#633806; --ag-amar-borde:#BA7517;
      --ag-verde-bg:#EAF3DE; --ag-verde:#27500A; --ag-verde-borde:#639922;
      --ag-azul:${MARCA.azulOscuro}; --ag-azul-claro:${MARCA.azulClaro}; --ag-azul-medio:${MARCA.azulMedio};
      max-width: 1180px; margin: 0 auto; padding-bottom: 96px; }
.ag-seg { display:flex; background:var(--color-background-secondary); border-radius:var(--border-radius-md); padding:3px; gap:2px; }
.ag-seg button { flex:1; min-height:40px; border:0; background:none; border-radius:6px; font-size:14px; color:var(--color-text-secondary); white-space:nowrap; display:flex; align-items:center; justify-content:center; gap:6px; }
.ag-seg button[aria-pressed=true] { background:var(--color-background-primary); color:var(--color-text-primary); font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.08); }
.ag-link { border:0; background:none; color:var(--color-text-info); font-size:13px; padding:4px 2px; min-height:auto; }
.ag-label { display:block; font-size:12px; font-weight:500; color:var(--color-text-secondary); margin:16px 0 6px; }
.ag-field { width:100%; min-height:48px; padding:0 12px; border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); background:var(--color-background-primary); font-size:16px; }
.ag-field:focus { border:2px solid var(--color-border-info); outline:none; padding:0 11px; }
.ag-sug { margin-top:4px; background:var(--color-background-primary); border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); overflow:hidden; box-shadow:0 6px 16px rgba(4,44,83,.10); }
.ag-sug button { display:flex; width:100%; align-items:center; justify-content:space-between; gap:8px; min-height:46px; padding:0 12px; border:0; border-top:0.5px solid var(--color-border-tertiary); background:none; text-align:left; font-size:14px; border-radius:0; }
.ag-sug button:first-child { border-top:0; }
.ag-elegido { display:flex; align-items:center; gap:8px; min-height:48px; padding:0 4px 0 12px; border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); background:var(--color-background-primary); font-weight:500; font-size:15px; }
.ag-qty { display:grid; grid-template-columns:1fr auto; gap:8px; }
.ag-agot { min-height:56px; border-radius:var(--border-radius-md); border:0.5px solid var(--ag-rojo-borde); background:var(--color-background-primary); color:var(--ag-rojo); font-size:15px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; }
.ag-agot[aria-pressed=true] { background:var(--ag-rojo-bg); border-width:2px; }
.ag-stp { display:flex; align-items:center; border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); background:var(--color-background-primary); overflow:hidden; }
.ag-stp button { width:46px; height:54px; border:0; background:none; color:var(--ag-azul); font-size:18px; border-radius:0; }
.ag-stp input { width:64px; height:54px; border:0; text-align:center; font-size:24px; font-weight:600; font-variant-numeric:tabular-nums; background:none; padding:0; }
.ag-stp input:focus { outline:none; }
.ag-stp.pocas { border:2px solid var(--ag-amar-borde); background:var(--ag-amar-bg); }
.ag-tag { display:inline-flex; align-items:center; gap:4px; height:24px; padding:0 8px; border-radius:var(--border-radius-sm); font-size:12px; font-weight:600; white-space:nowrap; border:0.5px solid; }
.ag-tag.rojo { background:var(--ag-rojo-bg); color:var(--ag-rojo); border-color:var(--ag-rojo-borde); }
.ag-tag.amar { background:var(--ag-amar-bg); color:var(--ag-amar); border-color:var(--ag-amar-borde); }
.ag-tag.azul { background:var(--ag-azul-claro); color:var(--ag-azul); border-color:var(--ag-azul-medio); }
.ag-tag.verde { background:var(--ag-verde-bg); color:var(--ag-verde); border-color:var(--ag-verde-borde); }
.ag-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:40px; padding:0 14px; border-radius:var(--border-radius-md); border:0.5px solid var(--color-border-tertiary); background:var(--color-background-primary); font-size:14px; color:var(--color-text-primary); }
.ag-btn.pri { background:var(--ag-azul); border-color:var(--ag-azul); color:#fff; font-weight:500; }
.ag-btn.pri:disabled { opacity:.45; }
.ag-btn.grande { min-height:56px; width:100%; font-size:15px; }
.ag-dock { position:sticky; bottom:0; padding:12px 0 14px; background:linear-gradient(rgba(244,246,249,0), #F4F6F9 30%); margin-top:8px; z-index:5; }
.ag-chips { display:flex; gap:6px; flex-wrap:wrap; }
.ag-chip { min-height:38px; padding:0 13px; border-radius:19px; border:0.5px solid var(--color-border-secondary); background:var(--color-background-primary); font-size:13px; display:inline-flex; align-items:center; gap:5px; color:var(--color-text-primary); }
.ag-chip[aria-pressed=true] { background:var(--ag-azul); border-color:var(--ag-azul); color:#fff; font-weight:500; }
.ag-item { background:var(--color-background-primary); border:0.5px solid var(--color-border-tertiary); border-radius:var(--border-radius-lg); padding:12px; }
.ag-item + .ag-item { margin-top:8px; }
.ag-item.rojo { border-color:var(--ag-rojo-borde); background:linear-gradient(var(--ag-rojo-bg),var(--ag-rojo-bg)) top/100% 4px no-repeat, var(--color-background-primary); }
.ag-item.amar { border-color:var(--ag-amar-borde); background:linear-gradient(var(--ag-amar-bg),var(--ag-amar-bg)) top/100% 4px no-repeat, var(--color-background-primary); }
.ag-item.cerrado { opacity:.75; }
.ag-nombre { font-size:14px; line-height:20px; font-weight:500; }
.ag-meta { font-size:13px; line-height:18px; color:var(--color-text-secondary); }
.ag-sec { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--color-text-secondary); margin:18px 2px 8px; text-transform:uppercase; letter-spacing:.04em; }
.ag-dot { width:8px; height:8px; border-radius:4px; }
.ag-pv { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
.ag-pvc { height:32px; padding:0 11px; border-radius:16px; font-size:12px; font-weight:500; display:inline-flex; align-items:center; gap:4px; border:0.5px solid var(--color-border-secondary); background:var(--color-background-primary); color:var(--color-text-primary); min-height:auto; }
.ag-pvc.pedido { background:var(--ag-azul-claro); border-color:var(--ag-azul-medio); color:var(--ag-azul); }
.ag-pvc.add { border-style:dashed; color:var(--color-text-info); }
.ag-pasos { display:flex; border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); overflow:hidden; margin-top:10px; }
.ag-pasos button { flex:1; min-height:42px; border:0; border-left:0.5px solid var(--color-border-secondary); background:var(--color-background-primary); font-size:13px; display:flex; align-items:center; justify-content:center; gap:4px; color:var(--color-text-secondary); border-radius:0; }
.ag-pasos button:first-child { border-left:0; }
.ag-pasos button[aria-pressed=true] { background:var(--ag-azul); color:#fff; font-weight:600; }
.ag-pasos button.llego[aria-pressed=true] { background:var(--ag-verde); }
.ag-hoy { display:flex; align-items:center; gap:10px; }
.ag-hoy .q { width:48px; text-align:center; flex-shrink:0; }
.ag-hoy .q b { display:block; font-size:20px; line-height:24px; font-variant-numeric:tabular-nums; }
.ag-hoy .q span { font-size:11px; }
.ag-cuenta { display:flex; gap:8px; margin-bottom:10px; }
.ag-cuenta div { flex:1; padding:8px 10px; border-radius:var(--border-radius-md); font-size:12px; font-weight:500; }
.ag-cuenta b { display:block; font-size:20px; line-height:24px; }
.ag-vacio { text-align:center; padding:40px 20px; color:var(--color-text-secondary); }
.ag-vacio .ic { width:64px; height:64px; border-radius:32px; background:var(--color-background-primary); border:0.5px solid var(--color-border-tertiary); display:flex; align-items:center; justify-content:center; margin:0 auto 14px; color:var(--ag-azul-medio); font-size:28px; }
.ag-vacio b { display:block; color:var(--color-text-primary); font-size:15px; margin-bottom:4px; }
.ag-vacio p { margin:0 auto; font-size:13px; line-height:18px; max-width:300px; }
.ag-op { display:flex; align-items:center; gap:10px; width:100%; min-height:52px; border:0; border-top:0.5px solid var(--color-border-tertiary); background:none; text-align:left; font-size:14px; padding:4px 2px; border-radius:0; color:var(--color-text-primary); }
.ag-box { width:24px; height:24px; border-radius:6px; border:1.5px solid var(--color-border-secondary); display:flex; align-items:center; justify-content:center; flex-shrink:0; background:var(--color-background-primary); color:#fff; font-size:15px; }
.ag-box.on { background:var(--ag-azul); border-color:var(--ag-azul); }
.ag-error { background:var(--color-background-danger); color:var(--color-text-danger); border:0.5px solid var(--color-border-danger); border-radius:var(--border-radius-md); padding:10px 12px; font-size:13px; margin-top:10px; display:flex; gap:8px; align-items:flex-start; }
.ag-ok { background:var(--color-background-success); color:var(--color-text-success); border-radius:var(--border-radius-md); padding:10px 12px; font-size:13px; margin-top:10px; }
.ag-tabla { width:100%; border-collapse:separate; border-spacing:0; background:var(--color-background-primary); border:0.5px solid var(--color-border-tertiary); border-radius:var(--border-radius-lg); overflow:hidden; font-size:14px; }
.ag-tabla th { text-align:left; font-size:12px; font-weight:500; color:var(--color-text-secondary); padding:10px 12px; background:var(--color-background-secondary); border-bottom:0.5px solid var(--color-border-secondary); }
.ag-tabla td { padding:10px 12px; border-bottom:0.5px solid var(--color-border-tertiary); vertical-align:middle; }
.ag-tabla tr:last-child td { border-bottom:0; }
.ag-tabla .grp td { background:#F4F6F9; font-size:12px; font-weight:600; color:var(--color-text-secondary); padding:7px 12px; text-transform:uppercase; letter-spacing:.04em; }
.ag-tabla .ag-pasos { margin-top:0; width:280px; }
.ag-tabla .ag-pasos button { min-height:36px; font-size:12px; }
.ag-tabla .ag-pv { margin-top:0; }
@media (min-width: 900px) { .ag-form { max-width:480px; } .ag-dock { position:static; background:none; } }
`;

// ---------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------

function Icono({ n, size = 16 }) {
  return <i className={`ti ti-${n}`} style={{ fontSize: size }} aria-hidden="true"></i>;
}

function EtiquetaQuedan({ r }) {
  return esAgotado(r) ? (
    <span className="ag-tag rojo">
      <Icono n="package-off" size={13} />
      Agotado
    </span>
  ) : (
    <span className="ag-tag amar">Quedan {formatCantidad(r.quedan)}</span>
  );
}

function EtiquetaEstado({ r }) {
  if (r.estado === "pedido")
    return (
      <span className="ag-tag azul">
        <Icono n="shopping-cart" size={13} />
        Pedido
      </span>
    );
  if (r.estado === "llego")
    return (
      <span className="ag-tag verde">
        <Icono n="check" size={13} />
        Llegó
      </span>
    );
  return null;
}

function Stepper({ value, onChange, ariaLabel, pocas = false, inputRef }) {
  const n = parseInt(value, 10);
  return (
    <div className={"ag-stp" + (pocas ? " pocas" : "")}>
      <button type="button" aria-label="Menos" onClick={() => onChange(String(Math.max(0, (Number.isFinite(n) ? n : 0) - 1)))}>
        <Icono n="minus" />
      </button>
      <input
        ref={inputRef}
        inputMode="numeric"
        aria-label={ariaLabel}
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label="Más" onClick={() => onChange(String((Number.isFinite(n) ? n : 0) + 1))}>
        <Icono n="plus" />
      </button>
    </div>
  );
}

function Pasos({ r, onCambiar }) {
  return (
    <div className="ag-pasos" role="group" aria-label={`Estado de ${r.producto}`}>
      <button type="button" aria-pressed={r.estado === "reportado"} onClick={() => r.estado !== "reportado" && onCambiar(r, "reportado")}>
        Reportado
      </button>
      <button type="button" aria-pressed={r.estado === "pedido"} onClick={() => r.estado !== "pedido" && onCambiar(r, "pedido")}>
        <Icono n="shopping-cart" size={14} />
        Pedido
      </button>
      <button type="button" className="llego" aria-pressed={r.estado === "llego"} onClick={() => r.estado !== "llego" && onCambiar(r, "llego")}>
        <Icono n="check" size={14} />
        Llegó
      </button>
    </div>
  );
}

function FichasProveedor({ r, onAsignar }) {
  return (
    <div className="ag-pv">
      {(r.proveedores || []).map((p) => {
        const pedido = r.proveedorPedido && r.proveedorPedido.toLowerCase() === p.toLowerCase() && r.estado !== "reportado";
        return (
          <button type="button" key={p} className={"ag-pvc" + (pedido ? " pedido" : "")} onClick={() => onAsignar(r)} title={pedido ? `Pedido a ${p}` : p}>
            {pedido && <Icono n="check" size={12} />}
            {p}
          </button>
        );
      })}
      <button type="button" className="ag-pvc add" onClick={() => onAsignar(r)} aria-label={`Proveedores de ${r.producto}`}>
        <Icono n="plus" size={12} />
        {(r.proveedores || []).length ? "" : "Asignar proveedor"}
      </button>
    </div>
  );
}

function Vacio({ icono, titulo, children }) {
  return (
    <div className="ag-vacio">
      <div className="ic">
        <Icono n={icono} size={28} />
      </div>
      <b>{titulo}</b>
      <p>{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Hojas (modales)
// ---------------------------------------------------------------------

// Asignar uno o varios proveedores a un producto. Los que ya le vendieron ese
// producto salen arriba.
function HojaProveedores({ r, reportes, onGuardar, onClose }) {
  const [elegidos, setElegidos] = useState(r.proveedores || []);
  const [texto, setTexto] = useState("");
  const antes = useMemo(() => proveedoresDelProducto(reportes, r.producto), [reportes, r.producto]);
  const todos = useMemo(() => proveedoresConocidos(reportes), [reportes]);
  const esta = (p) => elegidos.some((e) => e.toLowerCase() === p.toLowerCase());
  const filtro = texto.trim().toLowerCase();
  const visibles = (lista) => lista.filter((p) => !filtro || p.toLowerCase().includes(filtro));
  const otros = todos.filter((p) => !antes.some((a) => a.toLowerCase() === p.toLowerCase()));
  // Los recién escritos todavía no están en "conocidos": se muestran igual.
  const nuevos = elegidos.filter((p) => !todos.some((t) => t.toLowerCase() === p.toLowerCase()));
  const existeTexto = [...todos, ...elegidos].some((p) => p.toLowerCase() === filtro);

  const fila = (p) => (
    <button type="button" key={p} className="ag-op" onClick={() => setElegidos((x) => alternarProveedor(x, p))}>
      <span className={"ag-box" + (esta(p) ? " on" : "")}>{esta(p) && <Icono n="check" size={15} />}</span>
      <span style={{ flex: 1 }}>{p}</span>
    </button>
  );

  return (
    <ModalOverlay onClose={onClose} maxWidth={440}>
      <div style={{ padding: 6 }}>
        <div className="ag-nombre" style={{ fontSize: 15 }}>
          {r.producto}
        </div>
        <div className="ag-meta" style={{ margin: "4px 0 12px", display: "flex", gap: 6, alignItems: "center" }}>
          <EtiquetaQuedan r={r} />
          {r.pedir ? `pedir ${formatCantidad(r.pedir)}` : ""}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim() && !existeTexto) setElegidos((x) => alternarProveedor(x, texto.trim()));
            else if (texto.trim()) {
              const p = [...todos, ...elegidos].find((q) => q.toLowerCase() === filtro);
              if (p && !esta(p)) setElegidos((x) => alternarProveedor(x, p));
            }
            setTexto("");
          }}
        >
          <input className="ag-field" placeholder="Buscar o agregar proveedor" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </form>
        {texto.trim() && !existeTexto && (
          <button type="button" className="ag-op" style={{ color: "var(--color-text-info)" }} onClick={() => (setElegidos((x) => alternarProveedor(x, texto.trim())), setTexto(""))}>
            <Icono n="plus" />
            Agregar "{texto.trim()}"
          </button>
        )}
        {nuevos.length > 0 && <div>{nuevos.map(fila)}</div>}
        {visibles(antes).length > 0 && (
          <>
            <div className="ag-sec">Ya le vendieron este producto</div>
            {visibles(antes).map(fila)}
          </>
        )}
        {visibles(otros).length > 0 && (
          <>
            <div className="ag-sec">{antes.length ? "Otros proveedores" : "Proveedores"}</div>
            {visibles(otros).map(fila)}
          </>
        )}
        {todos.length === 0 && nuevos.length === 0 && !texto.trim() && (
          <p className="ag-meta" style={{ margin: "12px 2px" }}>
            Todavía no hay proveedores guardados. Escribe el nombre y toca Enter.
          </p>
        )}
        <button type="button" className="ag-btn pri grande" style={{ marginTop: 14 }} onClick={() => onGuardar(elegidos)}>
          Listo · {elegidos.length} {elegidos.length === 1 ? "proveedor" : "proveedores"}
        </button>
      </div>
    </ModalOverlay>
  );
}

// "¿A quién se le pidió?" — solo sale si el producto tiene varios proveedores
// (o ninguno). Con uno solo, el toque en Pedido basta.
function HojaPedidoA({ r, reportes, onElegir, onClose }) {
  const [texto, setTexto] = useState("");
  const opciones = (r.proveedores || []).length ? r.proveedores : proveedoresConocidos(reportes).slice(0, 8);
  return (
    <ModalOverlay onClose={onClose} maxWidth={420}>
      <div style={{ padding: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>¿A quién se le pidió?</div>
        <div className="ag-meta" style={{ margin: "2px 0 10px" }}>
          {r.producto}
        </div>
        {opciones.map((p) => (
          <button type="button" key={p} className="ag-op" onClick={() => onElegir(p)}>
            <Icono n="building-store" />
            <span style={{ flex: 1 }}>{p}</span>
            <Icono n="chevron-right" />
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim()) onElegir(texto.trim());
          }}
          style={{ display: "flex", gap: 8, marginTop: 10 }}
        >
          <input className="ag-field" placeholder="Otro proveedor" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <button type="submit" className="ag-btn pri" disabled={!texto.trim()} style={{ minHeight: 48 }}>
            Pedido
          </button>
        </form>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------
// Vista Reportar
// ---------------------------------------------------------------------

function VistaReportar({ reportes, catalogo, onReportar, onQuitar }) {
  const [texto, setTexto] = useState("");
  const [producto, setProducto] = useState("");
  const [agotado, setAgotado] = useState(true);
  const [quedan, setQuedan] = useState("");
  const [pedir, setPedir] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState(null);
  const buscadorRef = useRef(null);

  const sugerencias = useMemo(() => buscarEnCatalogo(catalogo, texto, 6), [catalogo, texto]);
  const exacto = sugerencias.some((s) => s.toLowerCase() === texto.trim().toLowerCase());
  const abierto = producto ? reporteAbiertoDe(reportes, producto) : null;
  const hoy = reportesDeHoy(reportes);
  const nAgot = hoy.filter(esAgotado).length;

  function elegir(nombre) {
    setProducto(nombre);
    setTexto("");
    const previo = reporteAbiertoDe(reportes, nombre);
    if (previo) {
      setAgotado(esAgotado(previo));
      setQuedan(esAgotado(previo) ? "" : String(previo.quedan));
      setPedir(previo.pedir ? String(previo.pedir) : "");
      setNota(previo.nota || "");
    } else {
      setAgotado(true);
      setQuedan("");
      const sug = ultimaCantidadPedir(reportes, nombre);
      setPedir(sug ? String(sug) : "");
      setNota("");
    }
  }

  function limpiar() {
    setProducto("");
    setTexto("");
    setAgotado(true);
    setQuedan("");
    setPedir("");
    setNota("");
    setTimeout(() => buscadorRef.current && buscadorRef.current.focus(), 0);
  }

  function cambiarQuedan(v) {
    const n = parseInt(v, 10);
    if (v === "" || n === 0) {
      setQuedan("");
      setAgotado(true);
    } else {
      setQuedan(String(n));
      setAgotado(false);
    }
  }

  async function enviar() {
    if (!producto || guardando) return;
    setGuardando(true);
    const ok = await onReportar({ producto, quedan: agotado ? 0 : parseInt(quedan, 10) || 0, pedir: pedir === "" ? null : Number(pedir), nota: nota.trim() }, abierto);
    setGuardando(false);
    if (ok) limpiar();
  }

  return (
    <div>
      <div className="ag-form">
        <label className="ag-label" htmlFor="ag-producto">
          Producto
        </label>
        {producto ? (
          <div className="ag-elegido">
            <span style={{ flex: 1 }}>{producto}</span>
            <button type="button" className="ag-link" aria-label="Cambiar producto" onClick={limpiar} style={{ minWidth: 40, minHeight: 40 }}>
              <Icono n="x" size={18} />
            </button>
          </div>
        ) : (
          <div>
            <input
              id="ag-producto"
              ref={buscadorRef}
              className="ag-field"
              placeholder="Escribe el producto que se acabó…"
              value={texto}
              autoComplete="off"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && texto.trim()) {
                  e.preventDefault();
                  elegir(sugerencias[0] && exacto ? sugerencias[0] : sugerencias.length === 1 ? sugerencias[0] : texto.trim());
                }
              }}
            />
            {texto.trim().length >= 2 && (
              <div className="ag-sug">
                {sugerencias.map((s) => {
                  const ya = reporteAbiertoDe(reportes, s);
                  const cat = categoriaDeProducto(s);
                  return (
                    <button type="button" key={s} onClick={() => elegir(s)}>
                      <span style={{ minWidth: 0 }}>{s}</span>
                      {ya ? <span className="ag-tag amar">ya reportado</span> : cat && <span className="ag-meta" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{cat.nombre}</span>}
                    </button>
                  );
                })}
                {!exacto && (
                  <button type="button" onClick={() => elegir(texto.trim())} style={{ color: "var(--color-text-info)" }}>
                    <span>
                      <Icono n="plus" size={14} /> Usar "{texto.trim()}" (no está en World Office)
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {producto && (
          <>
            {abierto && (
              <div className="ag-meta" style={{ marginTop: 6 }}>
                Ya está reportado ({cuandoCorto(abierto.reportadoEn)})
                {abierto.estado === "pedido" ? ` · pedido a ${abierto.proveedorPedido || "proveedor"}` : ""}. Se actualiza ese reporte.
              </div>
            )}
            <label className="ag-label">¿Cuántas quedan en bodega?</label>
            <div className="ag-qty">
              <button type="button" className="ag-agot" aria-pressed={agotado} onClick={() => cambiarQuedan("")}>
                <Icono n="package-off" size={18} />
                Agotado
              </button>
              <Stepper value={agotado ? "" : quedan} onChange={cambiarQuedan} ariaLabel="Unidades que quedan" pocas={!agotado} />
            </div>
            <div style={{ marginTop: 8 }}>
              {agotado ? (
                <span className="ag-tag rojo">
                  <Icono n="package-off" size={13} />
                  Agotado · 0 en bodega
                </span>
              ) : (
                <span className="ag-tag amar">
                  <Icono n="alert-triangle" size={13} />
                  Pocas unidades · quedan {formatCantidad(parseInt(quedan, 10))}
                </span>
              )}
            </div>
            <label className="ag-label">Pedir</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Stepper value={pedir} onChange={setPedir} ariaLabel="Cantidad sugerida a pedir" />
              <span className="ag-meta">{ultimaCantidadPedir(reportes, producto) ? `último pedido: ${formatCantidad(ultimaCantidadPedir(reportes, producto))}` : "opcional"}</span>
            </div>
            <label className="ag-label" htmlFor="ag-nota">
              Nota <span style={{ fontWeight: 400 }}>(opcional)</span>
            </label>
            <input id="ag-nota" className="ag-field" placeholder="Ej.: un cliente pidió 5 para el lunes" value={nota} onChange={(e) => setNota(e.target.value)} />
            <div className="ag-dock">
              <button type="button" className="ag-btn pri grande" onClick={enviar} disabled={guardando}>
                <Icono n="check" size={18} />
                {guardando ? "Guardando…" : abierto ? "Actualizar reporte" : "Reportar"}
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 10px" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Reportado hoy</div>
        <span className="ag-meta">
          {hoy.length} {hoy.length === 1 ? "producto" : "productos"}
        </span>
      </div>
      {hoy.length === 0 ? (
        <Vacio icono="clipboard-check" titulo="Nada reportado hoy">
          Cuando veas un producto agotado o a punto de acabarse, búscalo arriba. Queda guardado quién lo reportó y a qué hora.
        </Vacio>
      ) : (
        <>
          <div className="ag-cuenta">
            <div style={{ background: "var(--ag-rojo-bg)", color: "var(--ag-rojo)" }}>
              <b>{nAgot}</b>
              {nAgot === 1 ? "Agotado" : "Agotados"}
            </div>
            <div style={{ background: "var(--ag-amar-bg)", color: "var(--ag-amar)" }}>
              <b>{hoy.length - nAgot}</b>Pocas unidades
            </div>
          </div>
          {hoy.map((r) => {
            const a = esAgotado(r);
            return (
              <div key={r.id} className={"ag-item ag-hoy " + (a ? "rojo" : "amar")}>
                <div className="q" style={{ color: a ? "var(--ag-rojo)" : "var(--ag-amar)" }}>
                  <b>{a ? 0 : formatCantidad(r.quedan)}</b>
                  <span>{a ? "agotado" : "quedan"}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ag-nombre">{r.producto}</div>
                  <div className="ag-meta">
                    {r.pedir ? `Pedir ${formatCantidad(r.pedir)} · ` : ""}
                    {horaCorta(r.reportadoEn)}
                  </div>
                  {r.nota && <div className="ag-meta" style={{ color: "var(--color-text-primary)" }}>“{r.nota}”</div>}
                </div>
                {r.estado !== "reportado" ? (
                  <EtiquetaEstado r={r} />
                ) : (
                  <button
                    type="button"
                    className="ag-link"
                    style={{ color: quitando === r.id ? "var(--color-text-danger)" : "var(--color-text-secondary)", minHeight: 40 }}
                    onClick={() => {
                      if (quitando === r.id) {
                        setQuitando(null);
                        onQuitar(r);
                      } else {
                        setQuitando(r.id);
                        setTimeout(() => setQuitando((q) => (q === r.id ? null : q)), 4000);
                      }
                    }}
                  >
                    {quitando === r.id ? "¿Quitar?" : <Icono n="trash" size={17} />}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Vista Compras
// ---------------------------------------------------------------------

function VistaCompras({ reportes, ancho, onCambiar, onAsignar }) {
  const [filtro, setFiltro] = useState("abiertos");
  const lista = filtrarCompras(reportes, filtro);
  const n = {
    abiertos: filtrarCompras(reportes, "abiertos").length,
    pedido: filtrarCompras(reportes, "pedido").length,
    llego: filtrarCompras(reportes, "llego").length,
  };
  const agot = lista.filter((r) => esAgotado(r) && r.estado !== "llego");
  const pocas = lista.filter((r) => !esAgotado(r) && r.estado !== "llego");
  const grupos =
    filtro === "llego"
      ? [{ titulo: "Llegaron · últimos 7 días", color: "var(--ag-verde-borde)", items: lista }]
      : [
          { titulo: `Agotados · ${agot.length}`, color: "var(--ag-rojo-borde)", items: agot },
          { titulo: `Pocas unidades · ${pocas.length}`, color: "var(--ag-amar-borde)", items: pocas },
        ].filter((g) => g.items.length);

  const filtros = (
    <div className="ag-chips">
      <button type="button" className="ag-chip" aria-pressed={filtro === "abiertos"} onClick={() => setFiltro("abiertos")}>
        Abiertos · {n.abiertos}
      </button>
      <button type="button" className="ag-chip" aria-pressed={filtro === "pedido"} onClick={() => setFiltro("pedido")}>
        Pedidos · {n.pedido}
      </button>
      <button type="button" className="ag-chip" aria-pressed={filtro === "llego"} onClick={() => setFiltro("llego")}>
        Llegaron · {n.llego}
      </button>
    </div>
  );

  if (lista.length === 0) {
    return (
      <div style={{ marginTop: 12 }}>
        {filtros}
        {filtro === "abiertos" ? (
          <Vacio icono="circle-check" titulo="No hay nada por pedir">
            Lo que reporte bodega aparece aquí, con los agotados primero.
          </Vacio>
        ) : filtro === "pedido" ? (
          <Vacio icono="shopping-cart" titulo="Nada pedido por llegar">
            Cuando marques un producto como Pedido, queda aquí hasta que llegue.
          </Vacio>
        ) : (
          <Vacio icono="truck" titulo="Nada llegó esta semana">
            Lo que se marque como Llegó en los últimos 7 días sale aquí.
          </Vacio>
        )}
      </div>
    );
  }

  const reporto = (r) => <>Reportado {cuandoCorto(r.reportadoEn)}</>;

  if (ancho) {
    const sinProv = reportes.filter((r) => estaAbierto(r) && !(r.proveedores || []).length).length;
    const abiertos = filtrarCompras(reportes, "abiertos");
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            [abiertos.filter(esAgotado).length, "Agotados", "var(--ag-rojo)"],
            [abiertos.filter((r) => !esAgotado(r)).length, "Pocas unidades", "var(--ag-amar)"],
            [n.pedido, "Pedidos, por llegar", "var(--ag-azul)"],
            [sinProv, "Sin proveedor asignado", "var(--color-text-primary)"],
          ].map(([v, t, c]) => (
            <div key={t} className="ag-item" style={{ minWidth: 160, margin: 0, padding: "10px 14px" }}>
              <div style={{ fontSize: 22, fontWeight: 600, color: c, fontVariantNumeric: "tabular-nums" }}>{v}</div>
              <div className="ag-meta" style={{ fontSize: 12 }}>
                {t}
              </div>
            </div>
          ))}
        </div>
        {filtros}
        <table className="ag-tabla" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Producto</th>
              <th style={{ width: 120 }}>En bodega</th>
              <th style={{ width: 90, textAlign: "right" }}>Pedir</th>
              <th>Proveedores</th>
              <th style={{ width: 140 }}>Reportado</th>
              <th style={{ width: 300 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => [
              <tr className="grp" key={"g" + g.titulo}>
                <td colSpan={6}>{g.titulo}</td>
              </tr>,
              ...g.items.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>
                    {r.producto}
                    {r.nota && <div className="ag-meta" style={{ fontWeight: 400 }}>“{r.nota}”</div>}
                  </td>
                  <td>
                    <EtiquetaQuedan r={r} />
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.pedir ? formatCantidad(r.pedir) : "—"}</td>
                  <td>
                    <FichasProveedor r={r} onAsignar={onAsignar} />
                  </td>
                  <td>
                    <div className="ag-meta">{cuandoCorto(r.reportadoEn)}</div>
                  </td>
                  <td>
                    <Pasos r={r} onCambiar={onCambiar} />
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {filtros}
      {grupos.map((g) => (
        <div key={g.titulo}>
          <div className="ag-sec">
            <span className="ag-dot" style={{ background: g.color }}></span>
            {g.titulo}
          </div>
          {g.items.map((r) => (
            <div key={r.id} className={"ag-item " + (r.estado === "llego" ? "cerrado" : esAgotado(r) ? "rojo" : "amar")}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ag-nombre">{r.producto}</div>
                  <div className="ag-meta">
                    {r.pedir ? `Pedir ${formatCantidad(r.pedir)} · ` : ""}
                    {reporto(r)}
                  </div>
                  {r.nota && <div className="ag-meta" style={{ color: "var(--color-text-primary)" }}>“{r.nota}”</div>}
                </div>
                <EtiquetaQuedan r={r} />
              </div>
              <FichasProveedor r={r} onAsignar={onAsignar} />
              <Pasos r={r} onCambiar={onCambiar} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Vista Por proveedor
// ---------------------------------------------------------------------

function VistaProveedor({ reportes, onMarcarPedidos, onCambiar }) {
  const resumen = useMemo(() => resumenProveedores(reportes), [reportes]);
  const [elegido, setElegido] = useState("");
  const actual = resumen.find((x) => x.nombre === elegido) ? elegido : resumen[0] ? resumen[0].nombre : "";
  const v = useMemo(() => (actual ? vistaProveedor(reportes, actual) : { porPedir: [], yaPedido: [] }), [reportes, actual]);
  // Marcados por defecto: todo lo que se le puede pedir (un toque y listo).
  const [quitados, setQuitados] = useState(() => new Set());
  useEffect(() => setQuitados(new Set()), [actual]);
  const marcados = v.porPedir.filter((r) => !quitados.has(r.id));

  if (resumen.length === 0) {
    return (
      <Vacio icono="building-store" titulo="Ningún proveedor con productos pendientes">
        En Compras, asígnale proveedores a los productos reportados. Aquí verás qué pedirle a cada uno cuando llegue o llame el vendedor.
      </Vacio>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="ag-chips">
        {resumen.map((p) => (
          <button type="button" key={p.nombre} className="ag-chip" aria-pressed={p.nombre === actual} onClick={() => setElegido(p.nombre)}>
            {p.nombre} · {p.porPedir || p.yaPedido}
          </button>
        ))}
      </div>

      <div className="ag-item" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--border-radius-md)",
            background: "var(--ag-azul-claro)",
            color: "var(--ag-azul)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          <Icono n="building-store" size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{actual}</div>
          <div className="ag-meta">
            {v.porPedir.length} por pedir · {v.yaPedido.length} {v.yaPedido.length === 1 ? "pedido" : "pedidos"} sin llegar
          </div>
        </div>
      </div>

      <div className="ag-sec">
        <span className="ag-dot" style={{ background: "var(--ag-rojo-borde)" }}></span>
        Se le puede pedir
      </div>
      {v.porPedir.length === 0 ? (
        <p className="ag-meta" style={{ margin: "0 2px" }}>
          Nada pendiente por pedirle a {actual}.
        </p>
      ) : (
        <div className="ag-item" style={{ padding: "0 12px" }}>
          {v.porPedir.map((r, i) => {
            const on = !quitados.has(r.id);
            return (
              <button
                type="button"
                key={r.id}
                className="ag-op"
                style={i === 0 ? { borderTop: 0 } : undefined}
                onClick={() =>
                  setQuitados((s) => {
                    const n = new Set(s);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    return n;
                  })
                }
              >
                <span className={"ag-box" + (on ? " on" : "")}>{on && <Icono n="check" size={15} />}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="ag-nombre" style={{ display: "block" }}>
                    {r.producto}
                  </span>
                  <span className="ag-meta">
                    {r.pedir ? `Pedir ${formatCantidad(r.pedir)}` : "Sin cantidad"}
                    {(r.proveedores || []).length > 1 ? ` · también ${r.proveedores.filter((p) => p.toLowerCase() !== actual.toLowerCase()).join(", ")}` : ""}
                  </span>
                </span>
                <EtiquetaQuedan r={r} />
              </button>
            );
          })}
        </div>
      )}

      {v.yaPedido.length > 0 && (
        <>
          <div className="ag-sec">Ya pedido a {actual}</div>
          {v.yaPedido.map((r) => (
            <div key={r.id} className="ag-item" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ag-nombre">{r.producto}</div>
                <div className="ag-meta">
                  {r.pedir ? `${formatCantidad(r.pedir)} pedidos` : "Pedido"} {cuandoCorto(r.pedidoEn)}
                </div>
              </div>
              <button type="button" className="ag-btn" onClick={() => onCambiar(r, "llego")}>
                <Icono n="check" />
                Llegó
              </button>
            </div>
          ))}
        </>
      )}

      {v.porPedir.length > 0 && (
        <div className="ag-dock">
          <button type="button" className="ag-btn pri grande" disabled={marcados.length === 0} onClick={() => onMarcarPedidos(marcados, actual)}>
            <Icono n="shopping-cart" size={18} />
            Marcar {marcados.length} como {marcados.length === 1 ? "pedido" : "pedidos"} a {actual}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Módulo
// ---------------------------------------------------------------------

export default function Agotados({ onConteo }) {
  const [reportes, setReportes] = useState([]);
  const [productosWO, setProductosWO] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [vista, setVista] = useState("reportar");
  const [hojaProv, setHojaProv] = useState(null);
  const [hojaPedidoA, setHojaPedidoA] = useState(null);
  const ancho = useAncho(900);
  const avisoTimer = useRef(null);

  const recargar = useCallback(async () => {
    try {
      const lista = await cargarAgotados();
      setReportes(lista);
      setError("");
    } catch (e) {
      const msg = String((e && e.message) || "");
      setError(/agotados/.test(msg) && /exist|relation/i.test(msg) ? "Falta crear la tabla en Supabase: corre sql/agotados.sql." : "No se pudieron cargar los reportes. Revisa la conexión.");
    } finally {
      setCargando(false);
    }
  }, []);

  // Se carga al entrar y cada vez que el celular vuelve a la app: bodega
  // reporta desde el celular y Compras lo ve en el computador sin refrescar.
  // Nombres de World Office para el buscador. Se piden una vez: cambian solo
  // cuando entran facturas nuevas, y si falla el buscador sigue con lo reportado.
  useEffect(() => {
    let vivo = true;
    cargarCatalogoProductos()
      .then((lista) => vivo && setProductosWO(lista))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    recargar();
    const alVolver = () => document.visibilityState === "visible" && recargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [recargar]);

  useEffect(() => {
    if (onConteo) onConteo(reportes.filter((r) => estaAbierto(r) && esAgotado(r)).length);
  }, [reportes, onConteo]);

  useEffect(() => () => avisoTimer.current && clearTimeout(avisoTimer.current), []);

  function avisar(t) {
    setAviso(t);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(""), 3500);
  }

  const catalogo = useMemo(() => catalogoProductos(reportes, productosWO), [reportes, productosWO]);
  // Guardado optimista: se pinta ya y se deshace solo lo propio si falla.
  async function guardar(nuevo, previo) {
    setReportes((prev) => (previo ? reemplazarPorId(prev, nuevo) : [nuevo, ...prev]));
    try {
      await guardarAgotado(nuevo);
      return true;
    } catch {
      setReportes((prev) => (previo ? reemplazarPorId(prev, previo) : quitarPorId(prev, nuevo)));
      setError("No se pudo guardar. Revisa la conexión e inténtalo otra vez.");
      return false;
    }
  }

  function reportar(datos, abierto) {
    const ahora = new Date().toISOString();
    const nuevo = abierto
      ? { ...abierto, ...datos, reportadoEn: ahora }
      : { id: uid(), ...datos, reportadoEn: ahora, proveedores: [], estado: "reportado", proveedorPedido: null, pedidoEn: null, llegoEn: null };
    return guardar(nuevo, abierto).then((ok) => {
      if (ok) avisar(`${abierto ? "Actualizado" : "Reportado"}: ${datos.producto}`);
      return ok;
    });
  }

  async function quitar(r) {
    setReportes((prev) => quitarPorId(prev, r));
    try {
      await eliminarAgotado(r.id);
      avisar(`Quitado: ${r.producto}`);
    } catch {
      setReportes((prev) => reponerPorId(prev, r));
      setError("No se pudo quitar. Revisa la conexión.");
    }
  }

  function cambiar(r, estado, proveedor = null) {
    if (estado === "pedido" && !proveedor && !r.proveedorPedido && (r.proveedores || []).length !== 1) {
      setHojaPedidoA(r);
      return;
    }
    guardar(cambiarEstado(r, estado, { proveedor }), r);
  }

  async function marcarPedidos(lista, proveedor) {
    const ahora = new Date();
    const nuevos = lista.map((r) => cambiarEstado(r, "pedido", { proveedor, ahora }));
    const porId = new Map(lista.map((r) => [r.id, r]));
    setReportes((prev) => nuevos.reduce((acc, n) => reemplazarPorId(acc, n), prev));
    try {
      await guardarAgotados(nuevos);
      avisar(`${nuevos.length} ${nuevos.length === 1 ? "producto pedido" : "productos pedidos"} a ${proveedor}`);
    } catch {
      setReportes((prev) => nuevos.reduce((acc, n) => reemplazarPorId(acc, porId.get(n.id)), prev));
      setError("No se pudo guardar. Revisa la conexión e inténtalo otra vez.");
    }
  }

  return (
    <div className="ag">
      <style>{AG_CSS}</style>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: MARCA.azulMuyOscuro }}>Agotados</div>
        <button type="button" className="ag-link" onClick={recargar} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <Icono n="refresh" size={15} />
          Actualizar
        </button>
      </div>
      <div className="ag-seg" role="group" aria-label="Vista">
        <button type="button" aria-pressed={vista === "reportar"} onClick={() => setVista("reportar")}>
          <Icono n="pencil" size={15} />
          Reportar
        </button>
        <button type="button" aria-pressed={vista === "compras"} onClick={() => setVista("compras")}>
          <Icono n="shopping-cart" size={15} />
          Compras
        </button>
        <button type="button" aria-pressed={vista === "proveedor"} onClick={() => setVista("proveedor")}>
          <Icono n="building-store" size={15} />
          Por proveedor
        </button>
      </div>
      {error && (
        <div className="ag-error" role="alert">
          <Icono n="alert-triangle" />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="ag-link" onClick={() => setError("")} aria-label="Cerrar aviso" style={{ color: "inherit" }}>
            <Icono n="x" />
          </button>
        </div>
      )}
      {aviso && (
        <div className="ag-ok" role="status" aria-live="polite">
          {aviso}
        </div>
      )}

      {cargando ? (
        <div className="ag-meta" style={{ padding: "2rem 0", textAlign: "center" }}>
          Cargando reportes…
        </div>
      ) : vista === "reportar" ? (
        <VistaReportar reportes={reportes} catalogo={catalogo} onReportar={reportar} onQuitar={quitar} />
      ) : vista === "compras" ? (
        <VistaCompras reportes={reportes} ancho={ancho} onCambiar={(r, e) => cambiar(r, e)} onAsignar={setHojaProv} />
      ) : (
        <VistaProveedor reportes={reportes} onMarcarPedidos={marcarPedidos} onCambiar={(r, e) => cambiar(r, e)} />
      )}

      {hojaProv && (
        <HojaProveedores
          r={hojaProv}
          reportes={reportes}
          onClose={() => setHojaProv(null)}
          onGuardar={(proveedores) => {
            const r = reportes.find((x) => x.id === hojaProv.id) || hojaProv;
            setHojaProv(null);
            const sinCambio = proveedores.length === (r.proveedores || []).length && proveedores.every((p, i) => p === r.proveedores[i]);
            if (!sinCambio) guardar({ ...r, proveedores }, r);
          }}
        />
      )}
      {hojaPedidoA && (
        <HojaPedidoA
          r={hojaPedidoA}
          reportes={reportes}
          onClose={() => setHojaPedidoA(null)}
          onElegir={(p) => {
            const r = hojaPedidoA;
            setHojaPedidoA(null);
            cambiar(r, "pedido", p);
          }}
        />
      )}
    </div>
  );
}
