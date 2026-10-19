import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cargarLlegadas, guardarLlegada, cargarFotoLlegada, eliminarLlegada, cargarAgotados, guardarAgotados, cargarProveedores } from "./supabaseClient";
import { uid, MARCA } from "./constants.js";
import { quitarPorId, reponerPorId, reemplazarPorId } from "./listas.js";
import ModalOverlay from "./ModalOverlay.jsx";
import { AG_CSS, Icono, Vacio } from "./Agotados.jsx";
import { buscarEnCatalogo, horaCorta, cambiarEstado, esAgotado, estaAbierto } from "./agotados.js";
import {
  TIPOS_NOVEDAD,
  conNovedad,
  agruparPorDia,
  filtrarLlegadas,
  proveedoresParaLlegada,
  proveedoresRecientes,
  nombresRecibio,
  pedidosPendientesDe,
  armarLlegada,
} from "./llegadas.js";

// Módulo Llegada de proveedores (Bodega). Reemplaza la planilla en papel:
// quién llegó, cuándo, si todo bien o con novedad, y la foto de su remisión.
//
// Conexión con Agotados: al registrar la llegada de un proveedor se ofrecen,
// ya marcados, los productos que se le habían PEDIDO, para pasarlos a "Llegó"
// de un toque.
//
// La lógica pura vive en llegadas.js. Estilos y piezas: los de Agotados.

const LL_CSS = `
.ll-est { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.ll-est button { min-height:56px; border-radius:var(--border-radius-md); border:0.5px solid var(--color-border-secondary); background:var(--color-background-primary); font-size:15px; display:flex; align-items:center; justify-content:center; gap:6px; color:var(--color-text-primary); }
.ll-est .ok[aria-pressed=true] { background:var(--ag-verde-bg); border:2px solid var(--ag-verde-borde); color:var(--ag-verde); font-weight:600; }
.ll-est .nov[aria-pressed=true] { background:var(--ag-amar-bg); border:2px solid var(--ag-amar-borde); color:var(--ag-amar); font-weight:600; }
.ll-ro { display:flex; align-items:center; gap:8px; min-height:48px; padding:0 12px; border:0.5px solid var(--color-border-tertiary); border-radius:var(--border-radius-md); background:var(--color-background-secondary); color:var(--color-text-secondary); font-size:15px; }
.ll-foto { display:flex; align-items:center; gap:10px; width:100%; min-height:56px; padding:0 12px; border:1px dashed var(--color-border-secondary); border-radius:var(--border-radius-md); background:var(--color-background-primary); font-size:14px; color:var(--color-text-secondary); }
.ll-foto img { width:44px; height:44px; object-fit:cover; border-radius:6px; }
.ll-area { width:100%; min-height:76px; padding:10px 12px; border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); background:var(--color-background-primary); font-size:16px; line-height:20px; resize:vertical; font-family:inherit; }
.ll-area:focus { border:2px solid var(--color-border-info); outline:none; padding:9px 11px; }
.ll-card { display:flex; gap:10px; }
.ll-card .t { width:54px; flex-shrink:0; text-align:center; }
.ll-card .t b { display:block; font-size:15px; font-variant-numeric:tabular-nums; }
.ll-card .t span { font-size:11px; color:var(--color-text-secondary); }
.ll-obs { margin-top:6px; font-size:13px; line-height:18px; padding:8px 10px; border-radius:var(--border-radius-md); background:var(--ag-amar-bg); color:var(--ag-amar); }
.ll-dia { font-size:12px; font-weight:600; color:var(--color-text-secondary); margin:16px 2px 8px; text-transform:uppercase; letter-spacing:.04em; }
`;

// La foto de la remisión se achica en el celular antes de subirla: de 3-4 MB
// de la cámara a ~150 KB, que alcanza de sobra para leer la remisión.
function comprimirFoto(archivo, maxLado = 1400, calidad = 0.65) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", calidad));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la foto"));
    };
    img.src = url;
  });
}

// Cada celular recuerda quién lo usó la última vez para recibir: casi siempre
// es la misma persona, así que el campo ya viene lleno (se puede cambiar).
const CLAVE_RECIBIO = "sanblas.recibioLlegadas";

function leerRecibio() {
  try {
    return window.localStorage.getItem(CLAVE_RECIBIO) || "";
  } catch {
    return "";
  }
}

function recordarRecibio(nombre) {
  try {
    if (nombre) window.localStorage.setItem(CLAVE_RECIBIO, nombre);
  } catch {
    // Almacenamiento bloqueado: la próxima vez el campo sale vacío, nada más.
  }
}

function partirHora(iso) {
  const h = horaCorta(iso);
  const i = h.indexOf(" ");
  return [h.slice(0, i), h.slice(i + 1)];
}

// ---------------------------------------------------------------------
// Formulario: llegó mercancía
// ---------------------------------------------------------------------

function FormLlegada({ proveedores, recientes, nombres, reportes, onGuardar, onCancelar }) {
  const [texto, setTexto] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [estado, setEstado] = useState(null);
  const [novedades, setNovedades] = useState([]);
  const [observacion, setObservacion] = useState("");
  const [recibio, setRecibio] = useState(leerRecibio);
  const [foto, setFoto] = useState(null);
  const [procesandoFoto, setProcesandoFoto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorFoto, setErrorFoto] = useState("");
  const [ahora, setAhora] = useState(() => new Date());
  const archivoRef = useRef(null);

  // La hora que se ve es la de la llegada: se refresca cada minuto.
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const sugerencias = useMemo(() => buscarEnCatalogo(proveedores, texto, 5), [proveedores, texto]);
  const exacto = sugerencias.some((s) => s.toLowerCase() === texto.trim().toLowerCase());
  const pendientes = proveedor ? pedidosPendientesDe(reportes, proveedor) : [];
  const listo = proveedor && estado && !guardando && !procesandoFoto;

  function elegir(p) {
    setProveedor(p);
    setTexto("");
  }

  async function tomarFoto(e) {
    const archivo = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!archivo) return;
    setProcesandoFoto(true);
    setErrorFoto("");
    try {
      setFoto(await comprimirFoto(archivo));
    } catch {
      setErrorFoto("No se pudo usar esa foto. Intenta tomarla otra vez.");
    } finally {
      setProcesandoFoto(false);
    }
  }

  async function enviar() {
    if (!listo) return;
    setGuardando(true);
    const nueva = armarLlegada({ id: uid(), proveedor, estado, novedades, observacion, recibio, foto });
    const ok = await onGuardar(nueva);
    if (ok) recordarRecibio(nueva.recibio);
    if (!ok) setGuardando(false);
  }

  return (
    <div className="ag-form">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "16px 2px 0" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Llegó mercancía</div>
        <button type="button" className="ag-link" onClick={onCancelar}>
          Cancelar
        </button>
      </div>

      <label className="ag-label" htmlFor="ll-proveedor">
        Proveedor
      </label>
      {proveedor ? (
        <div className="ag-elegido">
          <span style={{ flex: 1 }}>{proveedor}</span>
          {pendientes.length > 0 && (
            <span className="ag-tag azul" style={{ marginRight: 4 }}>
              {pendientes.length} {pendientes.length === 1 ? "pedido" : "pedidos"}
            </span>
          )}
          <button type="button" className="ag-link" aria-label="Cambiar proveedor" onClick={() => setProveedor("")} style={{ minWidth: 40, minHeight: 40 }}>
            <Icono n="x" size={18} />
          </button>
        </div>
      ) : (
        <>
          <input
            id="ll-proveedor"
            className="ag-field"
            placeholder="¿Quién llegó?"
            autoComplete="off"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && texto.trim()) {
                e.preventDefault();
                elegir(exacto ? sugerencias.find((s) => s.toLowerCase() === texto.trim().toLowerCase()) : texto.trim());
              }
            }}
          />
          {texto.trim().length >= 1 && (
            <div className="ag-sug">
              {sugerencias.map((s) => {
                const n = pedidosPendientesDe(reportes, s).length;
                return (
                  <button type="button" key={s} onClick={() => elegir(s)}>
                    <span>{s}</span>
                    {n > 0 && (
                      <span className="ag-tag azul">
                        {n} {n === 1 ? "pedido" : "pedidos"}
                      </span>
                    )}
                  </button>
                );
              })}
              {!exacto && (
                <button type="button" onClick={() => elegir(texto.trim())} style={{ color: "var(--color-text-info)" }}>
                  <span>
                    <Icono n="plus" size={14} /> Nuevo proveedor: "{texto.trim()}"
                  </span>
                </button>
              )}
            </div>
          )}
          {!texto.trim() && recientes.length > 0 && (
            <div className="ag-chips" style={{ marginTop: 8, alignItems: "center" }}>
              <span className="ag-meta">Recientes:</span>
              {recientes.map((p) => (
                <button type="button" key={p} className="ag-chip" onClick={() => elegir(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <label className="ag-label">Cuándo</label>
      <div className="ll-ro">
        <Icono n="clock" />
        Hoy · {horaCorta(ahora)}
      </div>

      <label className="ag-label" htmlFor="ll-recibio">
        ¿Quién recibió? <span style={{ fontWeight: 400 }}>(opcional)</span>
      </label>
      <input
        id="ll-recibio"
        className="ag-field"
        placeholder="Nombre del trabajador"
        autoComplete="off"
        value={recibio}
        onChange={(e) => setRecibio(e.target.value)}
      />
      {nombres.filter((n) => n.toLowerCase() !== recibio.trim().toLowerCase()).length > 0 && (
        <div className="ag-chips" style={{ marginTop: 8 }}>
          {nombres
            .filter((n) => n.toLowerCase() !== recibio.trim().toLowerCase())
            .map((n) => (
              <button type="button" key={n} className="ag-chip" onClick={() => setRecibio(n)}>
                <Icono n="user" size={14} />
                {n}
              </button>
            ))}
        </div>
      )}

      <label className="ag-label">¿Cómo llegó?</label>
      <div className="ll-est">
        <button type="button" className="ok" aria-pressed={estado === "todo_bien"} onClick={() => setEstado("todo_bien")}>
          <Icono n="circle-check" size={18} />
          Todo bien
        </button>
        <button type="button" className="nov" aria-pressed={estado === "con_novedad"} onClick={() => setEstado("con_novedad")}>
          <Icono n="alert-triangle" size={18} />
          Con novedad
        </button>
      </div>

      {estado === "con_novedad" && (
        <>
          <label className="ag-label">¿Qué pasó?</label>
          <div className="ag-chips" style={{ marginBottom: 8 }}>
            {TIPOS_NOVEDAD.map((t) => (
              <button
                type="button"
                key={t}
                className="ag-chip"
                aria-pressed={novedades.includes(t)}
                onClick={() => setNovedades((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea className="ll-area" placeholder="Ej.: faltaron 6 tubos de 1/2. Vienen el viernes." value={observacion} onChange={(e) => setObservacion(e.target.value)} aria-label="Observación" />
        </>
      )}

      <label className="ag-label">
        Foto de la remisión <span style={{ fontWeight: 400 }}>(opcional)</span>
      </label>
      <input ref={archivoRef} type="file" accept="image/*" capture="environment" onChange={tomarFoto} style={{ display: "none" }} />
      {foto ? (
        <div className="ll-foto" style={{ borderStyle: "solid" }}>
          <img src={foto} alt="Foto de la remisión" />
          <span style={{ flex: 1, color: "var(--color-text-primary)" }}>Foto lista</span>
          <button type="button" className="ag-link" onClick={() => archivoRef.current && archivoRef.current.click()}>
            Cambiar
          </button>
          <button type="button" className="ag-link" style={{ color: "var(--color-text-secondary)" }} onClick={() => setFoto(null)} aria-label="Quitar foto">
            <Icono n="trash" size={17} />
          </button>
        </div>
      ) : (
        <button type="button" className="ll-foto" onClick={() => archivoRef.current && archivoRef.current.click()} disabled={procesandoFoto}>
          <Icono n="camera" size={20} />
          {procesandoFoto ? "Preparando foto…" : "Tomar foto"}
        </button>
      )}
      {errorFoto && (
        <div className="ag-meta" style={{ color: "var(--color-text-danger)", marginTop: 6 }}>
          {errorFoto}
        </div>
      )}

      <div className="ag-dock">
        <button type="button" className="ag-btn pri grande" onClick={enviar} disabled={!listo}>
          <Icono n="check" size={18} />
          {guardando ? "Guardando…" : !proveedor ? "Elige el proveedor" : !estado ? "Toca cómo llegó" : "Registrar llegada"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Hojas
// ---------------------------------------------------------------------

// Después de guardar: lo que estaba pedido a ese proveedor, ya marcado.
function HojaLlegaron({ proveedor, pendientes, onMarcar, onClose }) {
  const [quitados, setQuitados] = useState(() => new Set());
  const marcados = pendientes.filter((r) => !quitados.has(r.id));
  return (
    <ModalOverlay onClose={onClose} maxWidth={440}>
      <div style={{ padding: 6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, fontWeight: 600 }}>
          <span style={{ color: "var(--color-text-success)" }}>
            <Icono n="circle-check" size={22} />
          </span>
          Llegada de {proveedor} registrada
        </div>
        <p className="ag-meta" style={{ margin: "6px 0 10px" }}>
          A {proveedor} se le pidieron estos productos. ¿Cuáles llegaron?
        </p>
        {pendientes.map((r, i) => {
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
                  {r.pedir ? `Pedidos ${r.pedir}` : "Pedido"} · {esAgotado(r) ? "estaba agotado" : `quedaban ${r.quedan}`}
                </span>
              </span>
            </button>
          );
        })}
        <button type="button" className="ag-btn pri grande" style={{ marginTop: 12 }} disabled={marcados.length === 0} onClick={() => onMarcar(marcados)}>
          <Icono n="check" size={18} />
          Marcar {marcados.length} como "Llegó"
        </button>
        <button type="button" className="ag-btn grande" style={{ marginTop: 8, border: 0, background: "none", color: "var(--color-text-secondary)" }} onClick={onClose}>
          Ahora no
        </button>
      </div>
    </ModalOverlay>
  );
}

function HojaFoto({ llegada, onClose }) {
  const [foto, setFoto] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    cargarFotoLlegada(llegada.id)
      .then((f) => vivo && (f ? setFoto(f) : setError("Esta llegada no tiene foto.")))
      .catch(() => vivo && setError("No se pudo cargar la foto. Revisa la conexión."));
    return () => {
      vivo = false;
    };
  }, [llegada.id]);
  return (
    <ModalOverlay onClose={onClose} maxWidth={720}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px 10px" }}>
        <b style={{ fontSize: 14 }}>Remisión de {llegada.proveedor}</b>
        <button type="button" className="ag-link" onClick={onClose} aria-label="Cerrar" style={{ minWidth: 40, minHeight: 40 }}>
          <Icono n="x" size={18} />
        </button>
      </div>
      {foto ? (
        <img src={foto} alt={`Remisión de ${llegada.proveedor}`} style={{ width: "100%", borderRadius: 8, display: "block" }} />
      ) : (
        <div className="ag-meta" style={{ padding: "2rem 0", textAlign: "center" }}>
          {error || "Cargando foto…"}
        </div>
      )}
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------
// Módulo
// ---------------------------------------------------------------------

export default function Llegadas({ onConteoAgotados }) {
  const [llegadas, setLlegadas] = useState([]);
  const [reportes, setReportes] = useState([]);
  const [catalogoProv, setCatalogoProv] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [formAbierto, setFormAbierto] = useState(false);
  const [soloNovedad, setSoloNovedad] = useState(false);
  const [filtroProv, setFiltroProv] = useState("");
  const [hojaLlegaron, setHojaLlegaron] = useState(null);
  const [verFoto, setVerFoto] = useState(null);
  const [quitando, setQuitando] = useState(null);
  const avisoTimer = useRef(null);

  const recargar = useCallback(async () => {
    try {
      const [ll, ag] = await Promise.all([cargarLlegadas(), cargarAgotados()]);
      setLlegadas(ll);
      setReportes(ag);
      setError("");
    } catch (e) {
      const msg = String((e && e.message) || "");
      setError(/llegadas/.test(msg) && /exist|relation/i.test(msg) ? "Falta crear la tabla en Supabase: corre sql/llegadas.sql." : "No se pudieron cargar las llegadas. Revisa la conexión.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    recargar();
    const alVolver = () => document.visibilityState === "visible" && recargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [recargar]);

  useEffect(() => () => avisoTimer.current && clearTimeout(avisoTimer.current), []);

  // Catálogo de proveedores para el autocompletado (se pide una vez).
  useEffect(() => {
    let vivo = true;
    cargarProveedores()
      .then((l) => vivo && setCatalogoProv(l))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  function avisar(t) {
    setAviso(t);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(""), 3500);
  }

  const proveedores = useMemo(() => proveedoresParaLlegada(llegadas, reportes, catalogoProv), [llegadas, reportes, catalogoProv]);
  const recientes = useMemo(() => proveedoresRecientes(llegadas), [llegadas]);
  const nombres = useMemo(() => nombresRecibio(llegadas), [llegadas]);
  const provEnLista = useMemo(() => proveedoresParaLlegada(llegadas, []), [llegadas]);
  const visibles = filtrarLlegadas(llegadas, { soloNovedad, proveedor: filtroProv });
  const grupos = agruparPorDia(visibles);
  const nNovedad = filtrarLlegadas(llegadas, { soloNovedad: true, proveedor: filtroProv }).length;

  async function registrar(nueva) {
    // La foto no se guarda en la lista (pesa): solo la marca tieneFoto.
    const enLista = { ...nueva, foto: undefined };
    setLlegadas((prev) => [enLista, ...prev]);
    try {
      await guardarLlegada(nueva);
    } catch {
      setLlegadas((prev) => quitarPorId(prev, enLista));
      setError("No se pudo guardar la llegada. Revisa la conexión e inténtalo otra vez.");
      return false;
    }
    setFormAbierto(false);
    const pendientes = pedidosPendientesDe(reportes, nueva.proveedor);
    if (pendientes.length) setHojaLlegaron({ proveedor: nueva.proveedor, pendientes });
    else avisar(`Llegada de ${nueva.proveedor} registrada`);
    return true;
  }

  async function marcarLlegaron(lista) {
    const ahora = new Date();
    const nuevos = lista.map((r) => cambiarEstado(r, "llego", { ahora }));
    const porId = new Map(lista.map((r) => [r.id, r]));
    const proveedor = hojaLlegaron && hojaLlegaron.proveedor;
    setHojaLlegaron(null);
    setReportes((prev) => nuevos.reduce((acc, n) => reemplazarPorId(acc, n), prev));
    try {
      await guardarAgotados(nuevos);
      avisar(`${nuevos.length} ${nuevos.length === 1 ? "producto marcado" : "productos marcados"} como "Llegó"${proveedor ? ` (${proveedor})` : ""}`);
    } catch {
      setReportes((prev) => nuevos.reduce((acc, n) => reemplazarPorId(acc, porId.get(n.id)), prev));
      setError("No se pudo marcar en Agotados. Hazlo desde Agotados > Por proveedor.");
    }
  }

  // El contador rojo del botón Agotados se mantiene al día desde aquí también.
  useEffect(() => {
    if (onConteoAgotados && !cargando) onConteoAgotados(reportes.filter((r) => estaAbierto(r) && esAgotado(r)).length);
  }, [reportes, cargando, onConteoAgotados]);

  async function quitar(l) {
    setLlegadas((prev) => quitarPorId(prev, l));
    try {
      await eliminarLlegada(l.id);
      avisar(`Quitada la llegada de ${l.proveedor}`);
    } catch {
      setLlegadas((prev) => reponerPorId(prev, l));
      setError("No se pudo quitar. Revisa la conexión.");
    }
  }

  return (
    <div className="ag">
      <style>{AG_CSS + LL_CSS}</style>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: MARCA.azulMuyOscuro }}>Llegada de proveedores</div>
        {!formAbierto && (
          <button type="button" className="ag-link" onClick={recargar} style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <Icono n="refresh" size={15} />
            Actualizar
          </button>
        )}
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
          Cargando llegadas…
        </div>
      ) : formAbierto ? (
        <FormLlegada proveedores={proveedores} recientes={recientes} nombres={nombres} reportes={reportes} onGuardar={registrar} onCancelar={() => setFormAbierto(false)} />
      ) : (
        <>
          {llegadas.length > 0 && (
            <div className="ag-chips" style={{ marginTop: 12, alignItems: "center" }}>
              <button type="button" className="ag-chip" aria-pressed={!soloNovedad} onClick={() => setSoloNovedad(false)}>
                Todas · {filtrarLlegadas(llegadas, { proveedor: filtroProv }).length}
              </button>
              <button type="button" className="ag-chip" aria-pressed={soloNovedad} onClick={() => setSoloNovedad(true)}>
                <Icono n="alert-triangle" size={14} />
                Con novedad · {nNovedad}
              </button>
              <select
                className="ag-chip"
                aria-label="Filtrar por proveedor"
                value={filtroProv}
                onChange={(e) => setFiltroProv(e.target.value)}
                style={filtroProv ? { background: "var(--ag-azul)", color: "#fff", borderColor: "var(--ag-azul)" } : undefined}
              >
                <option value="">Proveedor: todos</option>
                {provEnLista.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          {llegadas.length === 0 ? (
            <Vacio icono="truck" titulo="No hay llegadas registradas">
              Cuando llegue un proveedor, toca "Llegó mercancía" y registra cómo llegó. Toma menos de un minuto.
            </Vacio>
          ) : grupos.length === 0 ? (
            <Vacio icono="filter" titulo="Nada con ese filtro">
              Ninguna llegada de los últimos 30 días coincide.
            </Vacio>
          ) : (
            grupos.map((g) => (
              <div key={g.titulo}>
                <div className="ll-dia">{g.titulo}</div>
                {g.items.map((l) => {
                  const [h, ampm] = partirHora(l.llegoEn);
                  return (
                    <div key={l.id} className="ag-item ll-card">
                      <div className="t">
                        <b>{h}</b>
                        <span>{ampm}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <b className="ag-nombre" style={{ flex: 1, minWidth: 0 }}>
                            {l.proveedor}
                          </b>
                          {conNovedad(l) ? (
                            <span className="ag-tag amar">
                              <Icono n="alert-triangle" size={13} />
                              Con novedad
                            </span>
                          ) : (
                            <span className="ag-tag verde">
                              <Icono n="check" size={13} />
                              Todo bien
                            </span>
                          )}
                        </div>
                        {conNovedad(l) && (l.novedades.length > 0 || l.observacion) && (
                          <div className="ll-obs">
                            {l.novedades.length > 0 && <b>{l.novedades.join(" · ")}</b>}
                            {l.novedades.length > 0 && l.observacion ? ". " : ""}
                            {l.observacion}
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                          {l.recibio && (
                            <span className="ag-meta" style={{ display: "flex", gap: 4, alignItems: "center", marginRight: 8 }}>
                              <Icono n="user" size={14} />
                              Recibió {l.recibio}
                            </span>
                          )}
                          {l.tieneFoto && (
                            <button type="button" className="ag-link" onClick={() => setVerFoto(l)} style={{ display: "flex", gap: 4, alignItems: "center", paddingLeft: 0 }}>
                              <Icono n="photo" size={15} />
                              Ver foto
                            </button>
                          )}
                          <button
                            type="button"
                            className="ag-link"
                            style={{ marginLeft: "auto", color: quitando === l.id ? "var(--color-text-danger)" : "var(--color-text-secondary)", minHeight: 36 }}
                            aria-label={quitando === l.id ? "Confirmar quitar" : "Quitar llegada"}
                            onClick={() => {
                              if (quitando === l.id) {
                                setQuitando(null);
                                quitar(l);
                              } else {
                                setQuitando(l.id);
                                setTimeout(() => setQuitando((q) => (q === l.id ? null : q)), 4000);
                              }
                            }}
                          >
                            {quitando === l.id ? "¿Quitar?" : <Icono n="trash" size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          <div className="ag-dock">
            <button type="button" className="ag-btn pri grande" onClick={() => setFormAbierto(true)}>
              <Icono n="plus" size={18} />
              Llegó mercancía
            </button>
          </div>
        </>
      )}

      {hojaLlegaron && (
        <HojaLlegaron proveedor={hojaLlegaron.proveedor} pendientes={hojaLlegaron.pendientes} onMarcar={marcarLlegaron} onClose={() => setHojaLlegaron(null)} />
      )}
      {verFoto && <HojaFoto llegada={verFoto} onClose={() => setVerFoto(null)} />}
    </div>
  );
}
