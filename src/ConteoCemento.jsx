import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cargarTiposCemento, guardarTipoCemento, cargarConteosCemento, guardarConteosCemento, cargarCatalogoProductos } from "./supabaseClient";
import { uid, todayISO, formatCantidad, MARCA } from "./constants.js";
import { AG_CSS, Icono, Vacio } from "./Agotados.jsx";
import { horaCorta } from "./agotados.js";
import {
  tiposActivos,
  leerBultos,
  conteosDelDia,
  anteriorA,
  diferencia,
  etiquetaDia,
  fechaLarga,
  ultimoGuardado,
  historial,
  serieDias,
  sugerenciasTipos,
  armarConteos,
} from "./cemento.js";

// Módulo Conteo de cemento (Bodega). Reemplaza el papel donde se anotaba a
// diario cuántos bultos hay: un número grande por tipo, la diferencia con el
// conteo anterior, y el historial de 30 días.
//
// La lógica pura vive en cemento.js. Estilos y piezas: los de Agotados.

// Colores de las líneas de la gráfica: distintos en claridad, no solo en tono.
const COLORES_SERIE = [MARCA.azulMuyOscuro, MARCA.azulMedio, "#BA7517", "#639922", "#CC3333"];

const CC_CSS = `
.cc-fila { display:flex; align-items:center; gap:12px; padding:12px; background:var(--color-background-primary); border:0.5px solid var(--color-border-tertiary); border-radius:var(--border-radius-lg); }
.cc-fila + .cc-fila { margin-top:8px; }
.cc-num { width:118px; height:56px; border:0.5px solid var(--color-border-secondary); border-radius:var(--border-radius-md); background:var(--color-background-primary); font-size:28px; font-weight:600; text-align:center; font-variant-numeric:tabular-nums; padding:0; flex-shrink:0; }
.cc-num:focus { border:2px solid var(--color-border-info); outline:none; }
.cc-num[readonly] { background:var(--color-background-secondary); border-color:var(--color-border-tertiary); color:var(--color-text-primary); }
.cc-dif { display:inline-flex; align-items:center; gap:2px; font-weight:600; }
.cc-dif.baja { color:var(--ag-rojo); }
.cc-dif.sube { color:var(--ag-verde); }
.cc-dif.igual { color:var(--color-text-secondary); }
.cc-hist { width:100%; border-collapse:collapse; font-size:13px; }
.cc-hist th { font-size:12px; font-weight:500; color:var(--color-text-secondary); text-align:right; padding:6px 4px; border-bottom:0.5px solid var(--color-border-secondary); }
.cc-hist td { padding:9px 4px; border-bottom:0.5px solid var(--color-border-tertiary); text-align:right; font-variant-numeric:tabular-nums; }
.cc-hist th:first-child, .cc-hist td:first-child { text-align:left; }
.cc-leg { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--color-text-secondary); margin:4px 0 6px; }
.cc-leg i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
`;

function Diferencia({ actual, anterior }) {
  const d = diferencia(actual, anterior);
  if (!d) return null;
  if (d.sentido === "igual")
    return (
      <span className="cc-dif igual">
        <Icono n="minus" size={13} />
        igual
      </span>
    );
  return (
    <span className={"cc-dif " + d.sentido} aria-label={`${d.sentido === "sube" ? "subió" : "bajó"} ${d.n}`}>
      <Icono n={d.sentido === "sube" ? "arrow-up" : "arrow-down"} size={13} />
      {formatCantidad(d.n)}
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
        const color = COLORES_SERIE[k % COLORES_SERIE.length];
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
                <Icono n="plus" size={14} />
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

export default function ConteoCemento() {
  const [tipos, setTipos] = useState([]);
  const [conteos, setConteos] = useState([]);
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
      const [t, c] = await Promise.all([cargarTiposCemento(), cargarConteosCemento()]);
      setTipos(t);
      setConteos(c);
      setError("");
    } catch (e) {
      const msg = String((e && e.message) || "");
      setError(/cemento/.test(msg) && /exist|relation/i.test(msg) ? "Falta crear las tablas en Supabase: corre sql/conteo-cemento.sql." : "No se pudo cargar el conteo. Revisa la conexión.");
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
    const nuevo = previo ? { ...previo, activo: true } : { id: uid(), nombre: limpio, orden: Math.max(0, ...tipos.map((t) => t.orden || 0)) + 1, activo: true };
    setTipos((prev) => (previo ? prev.map((t) => (t.id === nuevo.id ? nuevo : t)) : [...prev, nuevo]));
    try {
      await guardarTipoCemento(nuevo);
      avisar(`Agregado: ${limpio}`);
    } catch {
      setTipos((prev) => (previo ? prev.map((t) => (t.id === previo.id ? previo : t)) : prev.filter((t) => t.id !== nuevo.id)));
      setError("No se pudo agregar el tipo. Revisa la conexión.");
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
          <Icono n="bucket-droplet" size={15} />
          Hoy
        </button>
        <button type="button" aria-pressed={vista === "historial"} onClick={() => setVista("historial")}>
          <Icono n="chart-line" size={15} />
          Últimos 30 días
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
            const actual = leerBultos(valorDe(t));
            return (
              <div key={t.id} className="cc-fila">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, lineHeight: "20px", fontWeight: 500 }}>{t.nombre}</div>
                  <div className="ag-meta" style={{ marginTop: 2 }}>
                    {ant ? (
                      <>
                        {etiquetaDia(ant.fecha, hoy)} {formatCantidad(ant.bultos)}
                        {actual !== null && (
                          <>
                            {" · "}
                            <Diferencia actual={actual} anterior={ant.bultos} />
                          </>
                        )}
                      </>
                    ) : (
                      "Primer conteo"
                    )}
                    {!editable && !delDia.has(t.id) && " · sin contar hoy"}
                  </div>
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
                {editTipos ? "Listo" : "Quitar tipos"}
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
                  <i style={{ background: COLORES_SERIE[k % COLORES_SERIE.length] }}></i>
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
                      <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 4, background: COLORES_SERIE[k % COLORES_SERIE.length] }}></i>
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
