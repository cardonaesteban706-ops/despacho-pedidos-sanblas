import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cargarTiposCemento,
  guardarTipoCemento,
  cargarConteosCemento,
  guardarConteosCemento,
  cargarCatalogoProductos,
  cargarMovimientosCemento,
  guardarMovimientoCemento,
  eliminarMovimientoCemento,
} from "./supabaseClient";
import { uid, todayISO, formatCantidad, MARCA } from "./constants.js";
import { AG_CSS, Icono, Vacio } from "./Agotados.jsx";
import { horaCorta } from "./agotados.js";
import {
  tiposActivos,
  leerBultos,
  conteosDelDia,
  anteriorA,
  etiquetaDia,
  fechaLarga,
  ultimoGuardado,
  historial,
  serieDias,
  sugerenciasTipos,
  armarConteos,
  COLORES_BULTO,
  colorSugerido,
  colorDeTipo,
  saldoEsperado,
  saldoActual,
  movimientosDelDia,
  cuadre,
  armarMovimiento,
} from "./cemento.js";

// Módulo Conteo de cemento (Bodega). Reemplaza el papel donde se anotaba a
// diario cuántos bultos hay. Así trabaja la bodega:
//
//   Conteo  en la mañana se cuenta cada tipo; al lado sale lo que se esperaba
//           encontrar (lo de ayer menos lo que salió) y si cuadra o no.
//   Saldo   durante el día se va restando lo que sale ("Sacar") y sumando si
//           entra cemento ("Entró"): el saldo del momento, sin papel.
//   30 días gráfica y tabla de los conteos.
//
// La lógica pura vive en cemento.js. Estilos y piezas: los de Agotados.

// Un bultico del color del empaque, para reconocer cada cemento de un vistazo
// (Kolcem naranja, Ecocem verde, Ultracem azul, Estructural rojo vino). La
// franja de abajo, más oscura, imita la franja de los sacos.
function Bulto({ color, size = 20 }) {
  return (
    <svg width={size * 0.82} height={size} viewBox="0 0 18 22" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1" y="1.5" width="16" height="19" rx="3" fill={color} />
      <rect x="1" y="14" width="16" height="6.5" rx="0" fill="#000" opacity="0.28" />
      <rect x="1" y="1.5" width="16" height="19" rx="3" fill="none" stroke="#000" strokeOpacity="0.18" />
      <line x1="4" y1="5" x2="14" y2="5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.2" />
    </svg>
  );
}

const CC_CSS = `
.cc-fila { display:flex; align-items:center; gap:12px; padding:12px; background:var(--color-background-primary); border:0.5px solid var(--color-border-tertiary); border-radius:var(--border-radius-lg); }
.cc-fila + .cc-fila { margin-top:8px; }
.cc-num { width:118px; height:56px; border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); background:var(--color-background-primary); font-size:28px; font-weight:600; text-align:center; font-variant-numeric:tabular-nums; padding:0; flex-shrink:0; }
.cc-num:focus { border:2px solid var(--color-border-info); outline:none; }
.cc-num[readonly] { background:var(--color-background-secondary); border-color:var(--color-border-tertiary); color:var(--color-text-primary); }
.cc-hist { width:100%; border-collapse:collapse; font-size:13px; }
.cc-hist th { font-size:12px; font-weight:500; color:var(--color-text-secondary); text-align:right; padding:6px 4px; border-bottom:0.5px solid var(--color-border-secondary); }
.cc-hist td { padding:9px 4px; border-bottom:0.5px solid var(--color-border-tertiary); text-align:right; font-variant-numeric:tabular-nums; }
.cc-hist th:first-child, .cc-hist td:first-child { text-align:left; }
.cc-leg { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--color-text-secondary); margin:4px 0 6px; }
.cc-leg i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
`;

// "Cuadra" / "Faltan 3" / "Sobran 2": lo contado contra lo que se esperaba.
function Cuadre({ contado, esperado }) {
  const q = cuadre(contado, esperado);
  if (!q) return null;
  if (q.estado === "cuadra")
    return (
      <span className="ag-tag verde">
        <Icono n="check" size={13} />
        Cuadra
      </span>
    );
  return (
    <span className={"ag-tag " + (q.estado === "faltan" ? "rojo" : "amar")}>
      <Icono n="alert-triangle" size={13} />
      {q.estado === "faltan" ? "Faltan" : "Sobran"} {formatCantidad(q.n)}
    </span>
  );
}

// Gráfica de líneas de 30 días, una por tipo. Los días sin conteo (domingos,
// festivos) no se dibujan como 0: la línea une los días que sí se contaron.
function Grafica({ conteos, tipos, hoy }) {
  const W = 320;
  const H = 150;
  const x0 = 34;
  const y0 = 8;
  const ancho = W - x0 - 6;
  const alto = H - y0 - 22;
  const series = tipos.map((t) => serieDias(conteos, t.id, hoy, 30));
  const max = Math.max(10, ...series.flat().map((p) => p.bultos || 0));
  const tope = Math.ceil(max / 100) * 100 || 10;
  const x = (i) => x0 + (i * ancho) / 29;
  const y = (v) => y0 + alto - (v / tope) * alto;
  const marcas = [0, tope / 2, tope];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bultos por tipo de cemento, últimos 30 días">
      {marcas.map((v) => (
        <g key={v}>
          <line x1={x0} x2={W - 6} y1={y(v)} y2={y(v)} stroke="var(--color-border-tertiary)" strokeWidth="1" />
          <text x={x0 - 4} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--color-text-secondary)">
            {formatCantidad(v)}
          </text>
        </g>
      ))}
      {[0, 14, 29].map((i) => (
        <text key={i} x={x(i)} y={H - 4} fontSize="10" fill="var(--color-text-secondary)" textAnchor={i === 0 ? "start" : i === 29 ? "end" : "middle"}>
          {etiquetaDia(series[0] ? series[0][i].fecha : hoy, hoy)}
        </text>
      ))}
      {series.map((s, k) => {
        const puntos = s.map((p, i) => (p.bultos === null ? null : [x(i), y(p.bultos)])).filter(Boolean);
        const color = colorDeTipo(tipos[k], tipos);
        if (puntos.length === 0) return null;
        return (
          <g key={tipos[k].id}>
            {puntos.length === 1 ? (
              <circle cx={puntos[0][0]} cy={puntos[0][1]} r="2.5" fill={color} />
            ) : (
              <polyline points={puntos.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            )}
            <circle cx={puntos[puntos.length - 1][0]} cy={puntos[puntos.length - 1][1]} r="3" fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

// Agregar un tipo: los cementos de World Office como fichas de un toque, o
// escrito a mano.
function AgregarTipo({ sugerencias, onAgregar, onCancelar }) {
  const [texto, setTexto] = useState("");
  return (
    <div className="ag-item" style={{ marginTop: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Agregar tipo de cemento</div>
      {sugerencias.length > 0 && (
        <>
          <div className="ag-meta" style={{ marginBottom: 6 }}>
            Como sale en World Office:
          </div>
          <div className="ag-chips" style={{ marginBottom: 10 }}>
            {sugerencias.map((s) => (
              <button type="button" key={s} className="ag-chip" onClick={() => onAgregar(s)}>
                <Bulto color={colorSugerido(s)} size={16} />
                {s}
              </button>
            ))}
          </div>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim()) onAgregar(texto.trim());
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input className="ag-field" placeholder="Otro tipo…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="ag-btn pri" disabled={!texto.trim()} style={{ minHeight: 48 }}>
          Agregar
        </button>
      </form>
      {onCancelar && (
        <button type="button" className="ag-link" style={{ marginTop: 6 }} onClick={onCancelar}>
          Cancelar
        </button>
      )}
    </div>
  );
}

// Cantidades de un toque para "Sacar" / "Entró": lo que más se despacha.
const CANTIDADES_RAPIDAS = [1, 2, 5, 10, 20, 50];

// Vista Saldo: el saldo de cada tipo en este momento y los botones para restar
// lo que sale (o sumar si entra). Pensada para ir anotando durante el día.
function VistaSaldo({ activos, tipos, conteos, movimientos, hoy, onMovimiento, onBorrar, onIrAContar }) {
  const [abierto, setAbierto] = useState(null); // { tipoId, clase }
  const [cantidad, setCantidad] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(null);
  const [verTodos, setVerTodos] = useState({});

  function abrir(tipoId, clase) {
    if (abierto && abierto.tipoId === tipoId && abierto.clase === clase) {
      setAbierto(null);
      return;
    }
    setAbierto({ tipoId, clase });
    setCantidad("");
  }

  async function registrar() {
    if (!abierto || guardando) return;
    setGuardando(true);
    const ok = await onMovimiento(abierto.tipoId, abierto.clase, cantidad);
    setGuardando(false);
    if (ok) {
      setAbierto(null);
      setCantidad("");
    }
  }

  const sinBase = activos.every((t) => !saldoActual(conteos, movimientos, t.id, hoy));
  if (sinBase) {
    return (
      <>
        <Vacio icono="bucket-droplet" titulo="Primero hay que contar">
          El saldo parte del conteo. Cuenta los bultos en la pestaña Conteo y aquí se irá restando lo que salga en el día.
        </Vacio>
        <div style={{ textAlign: "center" }}>
          <button type="button" className="ag-btn pri" onClick={onIrAContar}>
            Ir a contar
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="ag-form" style={{ marginTop: 14 }}>
      {activos.map((t) => {
        const s = saldoActual(conteos, movimientos, t.id, hoy);
        const { lista } = movimientosDelDia(movimientos, t.id, hoy);
        const panel = abierto && abierto.tipoId === t.id ? abierto.clase : null;
        const n = leerBultos(cantidad);
        const visibles = verTodos[t.id] ? lista : lista.slice(0, 4);
        return (
          <div key={t.id} className="ag-item" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Bulto color={colorDeTipo(t, tipos)} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, lineHeight: "20px", fontWeight: 500 }}>{t.nombre}</div>
                <div className="ag-meta" style={{ marginTop: 2 }}>
                  {!s
                    ? "Sin conteo todavía"
                    : `${s.contadoHoy ? "Contado hoy" : "Esperado hoy"} ${formatCantidad(s.base)}${s.salidas ? ` · salió ${formatCantidad(s.salidas)}` : ""}${s.entradas ? ` · entró ${formatCantidad(s.entradas)}` : ""}`}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 30, lineHeight: "34px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: s && s.saldo < 0 ? "var(--ag-rojo)" : "var(--color-text-primary)" }}>
                  {s ? formatCantidad(s.saldo) : "—"}
                </div>
                <div className="ag-meta" style={{ fontSize: 12 }}>
                  saldo
                </div>
              </div>
            </div>

            {s && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className={"ag-btn" + (panel === "salida" ? "" : " pri")} style={{ flex: 2, minHeight: 48 }} aria-expanded={panel === "salida"} onClick={() => abrir(t.id, "salida")}>
                  <Icono n="minus" size={17} />
                  Sacar
                </button>
                <button type="button" className="ag-btn" style={{ flex: 1, minHeight: 48 }} aria-expanded={panel === "entrada"} onClick={() => abrir(t.id, "entrada")}>
                  <Icono n="plus" size={17} />
                  Entró
                </button>
              </div>
            )}

            {panel && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: "var(--border-radius-md)", background: panel === "salida" ? "var(--color-background-secondary)" : "var(--ag-verde-bg)" }}>
                <div className="ag-meta" style={{ marginBottom: 6, color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {panel === "salida" ? "¿Cuántos bultos salieron?" : "¿Cuántos bultos entraron?"}
                </div>
                <div className="ag-chips" style={{ marginBottom: 8 }}>
                  {CANTIDADES_RAPIDAS.map((q) => (
                    <button type="button" key={q} className="ag-chip" aria-pressed={n === q} onClick={() => setCantidad(String(q))} style={{ minWidth: 46, justifyContent: "center" }}>
                      {q}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="cc-num"
                    style={{ width: 96, height: 48, fontSize: 22 }}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="Cantidad de bultos"
                    value={cantidad}
                    autoFocus
                    onChange={(e) => setCantidad(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && registrar()}
                  />
                  <button type="button" className="ag-btn pri" style={{ flex: 1, minHeight: 48 }} disabled={!n || guardando} onClick={registrar}>
                    {guardando ? "Guardando…" : !n ? "Elige cuántos" : panel === "salida" ? `Restar ${formatCantidad(n)}` : `Sumar ${formatCantidad(n)}`}
                  </button>
                </div>
              </div>
            )}

            {lista.length > 0 && (
              <div style={{ marginTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 6 }}>
                {visibles.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36, fontSize: 14 }}>
                    <b style={{ width: 56, fontVariantNumeric: "tabular-nums", color: m.clase === "entrada" ? "var(--ag-verde)" : "var(--color-text-primary)" }}>
                      {m.clase === "entrada" ? "+" : "−"}
                      {formatCantidad(m.cantidad)}
                    </b>
                    <span className="ag-meta" style={{ flex: 1 }}>
                      {m.clase === "entrada" ? "entró" : "salió"} · {horaCorta(m.creadoEn)}
                    </span>
                    <button
                      type="button"
                      className="ag-link"
                      style={{ minHeight: 36, minWidth: 40, color: borrando === m.id ? "var(--color-text-danger)" : "var(--color-text-secondary)" }}
                      aria-label={borrando === m.id ? "Confirmar borrar" : "Borrar este movimiento"}
                      onClick={() => {
                        if (borrando === m.id) {
                          setBorrando(null);
                          onBorrar(m);
                        } else {
                          setBorrando(m.id);
                          setTimeout(() => setBorrando((b) => (b === m.id ? null : b)), 4000);
                        }
                      }}
                    >
                      {borrando === m.id ? "¿Borrar?" : <Icono n="x" size={16} />}
                    </button>
                  </div>
                ))}
                {lista.length > 4 && (
                  <button type="button" className="ag-link" onClick={() => setVerTodos((v) => ({ ...v, [t.id]: !v[t.id] }))}>
                    {verTodos[t.id] ? "Ver menos" : `Ver los ${lista.length} de hoy`}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="ag-meta" style={{ margin: "12px 2px 0" }}>
        Mañana, al contar, la app compara lo contado con este saldo y dice si cuadra.
      </p>
    </div>
  );
}

export default function ConteoCemento() {
  const [tipos, setTipos] = useState([]);
  const [conteos, setConteos] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [catalogoWO, setCatalogoWO] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [vista, setVista] = useState("hoy");
  const [valores, setValores] = useState({});
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [editTipos, setEditTipos] = useState(false);
  const [quitando, setQuitando] = useState(null);
  const avisoTimer = useRef(null);
  const inputs = useRef({});

  const hoy = todayISO();
  const activos = useMemo(() => tiposActivos(tipos), [tipos]);
  const delDia = useMemo(() => conteosDelDia(conteos, hoy), [conteos, hoy]);
  const guardado = delDia.size > 0;
  const editable = !guardado || editando;

  const recargar = useCallback(async () => {
    try {
      const [t, c, m] = await Promise.all([cargarTiposCemento(), cargarConteosCemento(), cargarMovimientosCemento()]);
      setTipos(t);
      setConteos(c);
      setMovimientos(m);
      setError("");
    } catch (e) {
      const msg = String((e && e.message) || "");
      setError(/cemento/.test(msg) && /exist|relation/i.test(msg) ? "Falta crear las tablas en Supabase: corre sql/conteo-cemento.sql y sql/movimientos-cemento.sql." : "No se pudo cargar el conteo. Revisa la conexión.");
    } finally {
      setCargando(false);
    }
  }, []);

  // Mientras se corrige no se recarga al volver a la app: pisaría lo escrito.
  const editandoRef = useRef(false);
  editandoRef.current = editando;

  useEffect(() => {
    recargar();
    const alVolver = () => document.visibilityState === "visible" && !editandoRef.current && recargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [recargar]);

  // Nombres de World Office para sugerir tipos (se piden una vez).
  useEffect(() => {
    let vivo = true;
    cargarCatalogoProductos()
      .then((l) => vivo && setCatalogoWO(l))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => () => avisoTimer.current && clearTimeout(avisoTimer.current), []);

  // Al abrir: si hoy ya se contó, lo que sigue es ir restando (Saldo); si no,
  // toca contar. Solo la primera vez, después manda la pestaña que se toque.
  const vistaElegida = useRef(false);
  useEffect(() => {
    if (cargando || vistaElegida.current) return;
    vistaElegida.current = true;
    if (conteos.some((c) => c.fecha === hoy)) setVista("saldo");
  }, [cargando, conteos, hoy]);

  async function registrarMovimiento(tipoId, clase, cantidad) {
    const m = armarMovimiento({ id: uid(), tipoId, clase, cantidad, fecha: hoy });
    if (!m) return false;
    setMovimientos((prev) => [m, ...prev]);
    try {
      await guardarMovimientoCemento(m);
      const t = tipos.find((x) => x.id === tipoId);
      avisar(`${clase === "entrada" ? "Entraron" : "Salieron"} ${formatCantidad(m.cantidad)} · ${t ? t.nombre : ""}`);
      return true;
    } catch {
      setMovimientos((prev) => prev.filter((x) => x.id !== m.id));
      setError("No se pudo guardar. Revisa la conexión e inténtalo otra vez.");
      return false;
    }
  }

  async function borrarMovimiento(m) {
    setMovimientos((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await eliminarMovimientoCemento(m.id);
      avisar("Movimiento borrado");
    } catch {
      setMovimientos((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]));
      setError("No se pudo borrar. Revisa la conexión.");
    }
  }

  function avisar(t) {
    setAviso(t);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(""), 3500);
  }

  // Lo que se ve en cada campo: lo escrito, o lo ya guardado hoy.
  function valorDe(t) {
    if (editable && valores[t.id] !== undefined) return valores[t.id];
    const c = delDia.get(t.id);
    return c ? (editable ? String(c.bultos) : formatCantidad(c.bultos)) : "";
  }

  async function guardar() {
    const conValores = {};
    for (const t of activos) conValores[t.id] = valorDe(t);
    const nuevos = armarConteos(conValores, activos, hoy);
    if (!nuevos.length) {
      setError("Escribe cuántos bultos hay de al menos un tipo.");
      return;
    }
    setGuardando(true);
    const previos = conteos;
    setConteos((prev) => [...prev.filter((c) => !nuevos.some((n) => n.id === c.id)), ...nuevos]);
    try {
      await guardarConteosCemento(nuevos);
      setEditando(false);
      setValores({});
      setError("");
      avisar(guardado ? "Conteo de hoy corregido" : "Conteo de hoy guardado");
    } catch {
      // Se deshace solo lo de hoy de estos tipos, no lo que haya llegado mientras.
      setConteos((prev) => [...prev.filter((c) => !nuevos.some((n) => n.id === c.id)), ...previos.filter((c) => nuevos.some((n) => n.id === c.id))]);
      setError("No se pudo guardar el conteo. Revisa la conexión e inténtalo otra vez.");
    } finally {
      setGuardando(false);
    }
  }

  async function agregarTipo(nombre) {
    const limpio = nombre.replace(/\s+/g, " ").trim();
    // Si ya existió y se había quitado, se reactiva (conserva su historial).
    const previo = tipos.find((t) => t.nombre.toLowerCase() === limpio.toLowerCase());
    const color = colorSugerido(limpio, tiposActivos(tipos).map((t) => t.color));
    const nuevo = previo
      ? { ...previo, activo: true, color: previo.color || color }
      : { id: uid(), nombre: limpio, orden: Math.max(0, ...tipos.map((t) => t.orden || 0)) + 1, activo: true, color };
    setTipos((prev) => (previo ? prev.map((t) => (t.id === nuevo.id ? nuevo : t)) : [...prev, nuevo]));
    try {
      await guardarTipoCemento(nuevo);
      avisar(`Agregado: ${limpio}`);
    } catch {
      setTipos((prev) => (previo ? prev.map((t) => (t.id === previo.id ? previo : t)) : prev.filter((t) => t.id !== nuevo.id)));
      setError("No se pudo agregar el tipo. Revisa la conexión.");
    }
  }

  async function cambiarColor(t, color) {
    const nuevo = { ...t, color };
    setTipos((prev) => prev.map((x) => (x.id === t.id ? nuevo : x)));
    try {
      await guardarTipoCemento(nuevo);
    } catch {
      setTipos((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setError("No se pudo cambiar el color. Revisa la conexión.");
    }
  }

  async function quitarTipo(t) {
    const nuevo = { ...t, activo: false };
    setTipos((prev) => prev.map((x) => (x.id === t.id ? nuevo : x)));
    try {
      await guardarTipoCemento(nuevo);
      avisar(`Ya no se cuenta: ${t.nombre}`);
    } catch {
      setTipos((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setError("No se pudo quitar el tipo. Revisa la conexión.");
    }
  }

  const sugerencias = sugerenciasTipos(catalogoWO, tipos);
  const filasHist = historial(conteos, activos, hoy);
  const horaGuardado = ultimoGuardado(delDia);

  return (
    <div className="ag">
      <style>{AG_CSS + CC_CSS}</style>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: MARCA.azulMuyOscuro }}>Conteo de cemento</div>
        <span className="ag-meta">{fechaLarga(hoy).replace(/^./, (l) => l.toUpperCase())}</span>
      </div>
      <div className="ag-seg" role="group" aria-label="Vista">
        <button type="button" aria-pressed={vista === "hoy"} onClick={() => setVista("hoy")}>
          <Icono n="clipboard-check" size={15} />
          Conteo
        </button>
        <button type="button" aria-pressed={vista === "saldo"} onClick={() => setVista("saldo")}>
          <Icono n="minus" size={15} />
          Saldo
        </button>
        <button type="button" aria-pressed={vista === "historial"} onClick={() => setVista("historial")}>
          <Icono n="chart-line" size={15} />
          30 días
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
          Cargando conteo…
        </div>
      ) : activos.length === 0 ? (
        <>
          <Vacio icono="bucket-droplet" titulo="Aún no hay tipos de cemento">
            Agrega los cementos que se cuentan cada día. Solo se hace una vez.
          </Vacio>
          <AgregarTipo sugerencias={sugerencias} onAgregar={agregarTipo} />
        </>
      ) : vista === "saldo" ? (
        <VistaSaldo
          activos={activos}
          tipos={tipos}
          conteos={conteos}
          movimientos={movimientos}
          hoy={hoy}
          onMovimiento={registrarMovimiento}
          onBorrar={borrarMovimiento}
          onIrAContar={() => setVista("hoy")}
        />
      ) : vista === "hoy" ? (
        <div className="ag-form" style={{ marginTop: 14 }}>
          {guardado && !editando && (
            <div className="ag-item" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ color: "var(--color-text-success)" }}>
                <Icono n="circle-check" size={22} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>Conteo de hoy guardado</div>
                <div className="ag-meta">
                  {horaGuardado ? `a las ${horaCorta(horaGuardado)}` : ""} · {delDia.size} de {activos.length} {activos.length === 1 ? "tipo" : "tipos"}
                </div>
              </div>
              <button type="button" className="ag-btn" onClick={() => setEditando(true)}>
                <Icono n="pencil" size={15} />
                Corregir
              </button>
            </div>
          )}

          {activos.map((t, i) => {
            const ant = anteriorA(conteos, t.id, hoy);
            const esp = saldoEsperado(conteos, movimientos, t.id, hoy);
            const actual = leerBultos(valorDe(t));
            return (
              <div key={t.id} className="cc-fila">
                <Bulto color={colorDeTipo(t, tipos)} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, lineHeight: "20px", fontWeight: 500 }}>{t.nombre}</div>
                  <div className="ag-meta" style={{ marginTop: 2 }}>
                    {esp ? (
                      <>
                        Esperado {formatCantidad(esp.esperado)}
                        {actual !== null && (
                          <>
                            {" "}
                            <Cuadre contado={actual} esperado={esp.esperado} />
                          </>
                        )}
                        <span style={{ display: "block", fontSize: 12 }}>
                          {etiquetaDia(ant.fecha, hoy)} se contaron {formatCantidad(ant.bultos)}
                          {esp.esperado < ant.bultos ? ` y salieron ${formatCantidad(ant.bultos - esp.esperado)}` : ""}
                          {esp.esperado > ant.bultos ? ` y entraron ${formatCantidad(esp.esperado - ant.bultos)}` : ""}
                        </span>
                      </>
                    ) : (
                      "Primer conteo"
                    )}
                    {!editable && !delDia.has(t.id) && " · sin contar hoy"}
                  </div>
                  {editTipos && (
                    <div role="group" aria-label={`Color de ${t.nombre}`} style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 6 }}>
                      {COLORES_BULTO.map((c) => {
                        const activo = colorDeTipo(t, tipos).toLowerCase() === c.hex.toLowerCase();
                        return (
                          <button
                            type="button"
                            key={c.id}
                            aria-label={c.nombre}
                            aria-pressed={activo}
                            title={c.nombre}
                            onClick={() => !activo && cambiarColor(t, c.hex)}
                            style={{ width: 36, height: 36, minHeight: 36, padding: 0, border: 0, background: "none", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 12,
                                background: c.hex,
                                boxShadow: activo ? `0 0 0 2px #fff, 0 0 0 4px ${MARCA.azulOscuro}` : "inset 0 0 0 1px rgba(0,0,0,.15)",
                              }}
                            ></span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {editTipos ? (
                  <button
                    type="button"
                    className="ag-btn"
                    style={{ color: quitando === t.id ? "var(--color-text-danger)" : "var(--color-text-secondary)" }}
                    onClick={() => {
                      if (quitando === t.id) {
                        setQuitando(null);
                        quitarTipo(t);
                      } else {
                        setQuitando(t.id);
                        setTimeout(() => setQuitando((q) => (q === t.id ? null : q)), 4000);
                      }
                    }}
                  >
                    {quitando === t.id ? "¿Quitar?" : <Icono n="trash" size={17} />}
                  </button>
                ) : (
                  <input
                    ref={(el) => (inputs.current[t.id] = el)}
                    className="cc-num"
                    inputMode="numeric"
                    placeholder="—"
                    aria-label={`Bultos de ${t.nombre}`}
                    readOnly={!editable}
                    value={valorDe(t)}
                    onChange={(e) => setValores((v) => ({ ...v, [t.id]: e.target.value.replace(/[^\d.]/g, "").slice(0, 7) }))}
                    onFocus={(e) => editable && e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const sig = activos[i + 1];
                        if (sig && inputs.current[sig.id]) inputs.current[sig.id].focus();
                        else e.target.blur();
                      }
                    }}
                  />
                )}
              </div>
            );
          })}

          {agregando ? (
            <AgregarTipo
              sugerencias={sugerencias}
              onAgregar={(n) => {
                setAgregando(false);
                agregarTipo(n);
              }}
              onCancelar={() => setAgregando(false)}
            />
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="ag-btn" style={{ flex: 1, color: "var(--color-text-info)" }} onClick={() => setAgregando(true)}>
                <Icono n="plus" size={16} />
                Agregar tipo
              </button>
              <button type="button" className="ag-btn" style={{ color: "var(--color-text-secondary)" }} onClick={() => (setEditTipos((x) => !x), setQuitando(null))}>
                {editTipos ? "Listo" : "Editar tipos"}
              </button>
            </div>
          )}

          {editable && !editTipos && (
            <div className="ag-dock">
              <button type="button" className="ag-btn pri grande" onClick={guardar} disabled={guardando}>
                <Icono n="device-floppy" size={18} />
                {guardando ? "Guardando…" : editando ? "Guardar corrección" : "Guardar conteo de hoy"}
              </button>
              {editando && (
                <button type="button" className="ag-btn grande" style={{ marginTop: 8, border: 0, background: "none", color: "var(--color-text-secondary)" }} onClick={() => (setEditando(false), setValores({}))}>
                  Cancelar corrección
                </button>
              )}
            </div>
          )}
        </div>
      ) : filasHist.length === 0 ? (
        <Vacio icono="chart-line" titulo="Todavía no hay conteos">
          Cuando se guarde el primer conteo, aquí se verá cómo suben y bajan los bultos día a día.
        </Vacio>
      ) : (
        <div style={{ marginTop: 14, maxWidth: 600 }}>
          <div className="ag-item" style={{ padding: "10px 8px 6px" }}>
            <div className="cc-leg">
              {activos.map((t, k) => (
                <span key={t.id}>
                  <i style={{ background: colorDeTipo(t, activos) }}></i>
                  {t.nombre}
                </span>
              ))}
            </div>
            <Grafica conteos={conteos} tipos={activos} hoy={hoy} />
          </div>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="cc-hist">
              <thead>
                <tr>
                  <th>Día</th>
                  {activos.map((t, k) => (
                    <th key={t.id} title={t.nombre}>
                      <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 4, background: colorDeTipo(t, activos) }}></i>
                      {t.nombre.replace(/^cemento\s+/i, "").split(" ").slice(0, 2).join(" ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasHist.map((f) => (
                  <tr key={f.fecha}>
                    <td>{f.etiqueta}</td>
                    {activos.map((t) => (
                      <td key={t.id}>{f.valores[t.id] === null ? "—" : formatCantidad(f.valores[t.id])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
