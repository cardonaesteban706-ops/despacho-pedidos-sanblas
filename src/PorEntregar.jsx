import { useMemo, useState } from "react";

/**
 * Pendientes — backlog de facturas de obra abiertas.
 * Componente de presentación puro: recibe `facturas` ya con los campos
 * derivados calculados aguas arriba y dispara callbacks. No toca BD ni storage.
 *
 * Props:
 *   facturas: Array<Factura>   (ver forma abajo)
 *   onCrearRemision(id)
 *   onProgramar(id)
 *   onDescontar(id)
 *   onMaterialEntregado(id)
 *   onVerPdf(id)
 *   onEditar(id)
 *   onEliminar(id)
 *
 * Factura = {
 *   id, cliente, numeroFactura, telefono, destino, total, estadoPago,
 *   tienePdf, fecha,                       // "DD/MM/AAAA"
 *   porcentajeEntregado,                   // 0..100, calculado POR VALOR EN PESOS
 *   numeroRemisiones,                      // entero
 *   diasSinMovimiento,                     // desde última remisión; si no hay, desde la subida
 *   productos: [{ descripcion, cantidad, unidad, cantidadRestante? }]
 * }
 */

const CSS = `
.pend-wrap{max-width:1240px;margin:0 auto;padding:0 0 24px;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color:var(--color-text-primary,#1a1a1a);}
.pend-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;}
.pend-search{position:relative;flex:1 1 260px;min-width:200px;}
.pend-search input{width:100%;padding:11px 12px 11px 39px;border:1px solid var(--color-border,#e3e7ec);
  border-radius:var(--border-radius-md,8px);font-family:inherit;font-size:14px;background:#fff;min-height:44px;}
.pend-seg{border:1px solid var(--color-border,#e3e7ec);background:#fff;color:var(--color-text-secondary,#5b6472);
  font-weight:500;font-size:13.5px;padding:9px 14px;min-height:42px;border-radius:var(--border-radius-md,8px);
  cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;}
.pend-seg[aria-pressed="true"]{background:#0C447C;border-color:#0C447C;color:#fff;}
.pend-chip{border:1px solid var(--color-border,#e3e7ec);background:#fff;border-radius:var(--border-radius-md,8px);
  padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:9px;text-align:left;min-height:44px;}
.pend-chip[aria-pressed="true"]{outline:2px solid #378ADD;outline-offset:-1px;}
.pend-chip:hover{background:var(--color-background-tertiary,#f6f8fa);}
.pend-row{display:grid;grid-template-columns:minmax(210px,2.3fr) minmax(200px,2.4fr) minmax(150px,1.3fr) auto;
  gap:18px;align-items:center;padding:13px 16px;background:#fff;border:1px solid var(--color-border,#e3e7ec);
  border-radius:var(--border-radius-md,8px);margin-bottom:8px;}
.pend-row:hover{background:#fbfcfe;}
.pend-detail{grid-column:1 / -1;border-top:1px dashed var(--color-border,#e3e7ec);margin-top:4px;padding-top:12px;
  display:grid;grid-template-columns:1.6fr 1fr;gap:20px;}
.pend-detbtn{font-size:12.5px;padding:8px 12px;min-height:38px;background:#fff;color:var(--color-text-primary,#1a1a1a);
  border:1px solid var(--color-border,#e3e7ec);border-radius:var(--border-radius-md,8px);cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;font-weight:500;}
.pend-detbtn:hover{background:var(--color-background-tertiary,#f6f8fa);}
.pend-crear{border:none;background:#0C447C;color:#fff;font-weight:600;font-size:13.5px;
  border-radius:var(--border-radius-md,8px);padding:11px 16px;min-height:44px;cursor:pointer;
  display:inline-flex;align-items:center;gap:7px;white-space:nowrap;}
.pend-crear:hover{background:#042C53;}
.pend-exp{width:40px;height:40px;border:1px solid var(--color-border,#e3e7ec);background:#fff;
  border-radius:var(--border-radius-md,8px);color:var(--color-text-tertiary,#9aa3af);cursor:pointer;flex-shrink:0;}
.pend-exp:hover{background:var(--color-background-tertiary,#f6f8fa);}
.pend-c-act{display:flex;align-items:center;gap:8px;}
@media (max-width:820px){
  .pend-row{grid-template-columns:1fr;gap:11px;padding:14px;}
  .pend-detail{grid-template-columns:1fr;gap:14px;}
  .pend-c-mov{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
  .pend-crear{flex:1;justify-content:center;}
  .pend-toolbar{align-items:stretch;}
  .pend-views{overflow-x:auto;}
}
`;

const fmtPesos = (n) => "$" + Number(n || 0).toLocaleString("es-CO");
const parseFecha = (f) => {
  const [d, m, y] = String(f).split("/").map(Number);
  return new Date(y, m - 1, d).getTime();
};

function enrich(f) {
  const pct = Math.max(0, Math.min(100, f.porcentajeEntregado ?? 0));
  const productos = (f.productos || []).map((p) => {
    const cant = Number(p.cantidad);
    const rest = p.cantidadRestante == null ? cant : p.cantidadRestante;
    const ent = cant - rest;
    const pctL = cant ? Math.round((ent / cant) * 100) : 0;
    const done = rest <= 0;
    return {
      desc: p.descripcion,
      label: done ? `Completo · ${cant} ${p.unidad}` : `Quedan ${rest} de ${cant} ${p.unidad}`,
      labelColor: done ? "#15803d" : "#b45309",
      pctWidth: pctL + "%",
      barColor: done ? "#16a34a" : "#378ADD",
      done,
    };
  });
  const pendN = productos.filter((p) => !p.done).length;
  const dias = f.diasSinMovimiento ?? 0;

  let mov, movColor, movBg;
  if (dias >= 60) { mov = `Estancada · ${dias}d sin mover`; movColor = "#dc2626"; movBg = "#fef2f2"; }
  else if (dias >= 30) { mov = `Quieta · ${dias}d`; movColor = "#b45309"; movBg = "#fffbeb"; }
  else { mov = f.numeroRemisiones === 0 ? `Subida hace ${dias}d` : `Movió hace ${dias}d`; movColor = "#6b7280"; movBg = "#f1f3f5"; }

  const barColor = pct === 0 ? "#cbd5e1" : pct >= 90 ? "#16a34a" : "#378ADD";
  let estadoTag = null, estadoColor = null, estadoBg = null;
  if (pct === 0) { estadoTag = "Sin remisionar"; estadoColor = "#64748b"; estadoBg = "#f1f5f9"; }
  else if (pct >= 90) { estadoTag = "Casi lista"; estadoColor = "#15803d"; estadoBg = "#ecfdf5"; }

  const pagado = f.estadoPago === "pagado";
  return {
    ...f, pct, productos, pendN, dias, mov, movColor, movBg, barColor, estadoTag, estadoColor, estadoBg,
    pendResumen: pendN === 0 ? "Todo entregado" : `${pendN} producto${pendN > 1 ? "s" : ""} por entregar`,
    remisionesLabel: f.numeroRemisiones === 0 ? "Sin remisiones" : `${f.numeroRemisiones} remisiones`,
    pagoLabel: pagado ? "Pagado" : "Paga al recibir",
    pagoColor: pagado ? "#15803d" : "#b45309",
    pagoBg: pagado ? "#ecfdf5" : "#fffbeb",
    totalFmt: fmtPesos(f.total),
  };
}

function ProductoRow({ p }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{p.desc}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: p.labelColor, whiteSpace: "nowrap" }}>{p.label}</span>
      </div>
      <div style={{ height: 6, background: "#eef1f5", borderRadius: 20, overflow: "hidden" }}>
        <div style={{ height: "100%", width: p.pctWidth, background: p.barColor, borderRadius: 20 }} />
      </div>
    </div>
  );
}

function Fila({ f, expanded, onToggle, cb }) {
  return (
    <div className="pend-row" style={{ borderLeft: `4px solid ${f.movColor}` }}>
      {/* Cliente / factura / pago */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.cliente}</div>
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary,#9aa3af)", margin: "3px 0 6px" }}>
          Factura {f.numeroFactura} · {f.totalFmt} · {f.destino}
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 500, color: f.pagoColor, background: f.pagoBg, borderRadius: 20, padding: "2px 9px" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: f.pagoColor }} />{f.pagoLabel}
        </span>
      </div>

      {/* Progreso */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 5, gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0C447C" }}>{f.pct}% entregado</span>
          {f.estadoTag && (
            <span style={{ fontSize: 11, fontWeight: 600, color: f.estadoColor, background: f.estadoBg, borderRadius: 20, padding: "2px 9px" }}>{f.estadoTag}</span>
          )}
        </div>
        <div style={{ height: 8, background: "#eef1f5", borderRadius: 20, overflow: "hidden" }}>
          <div style={{ height: "100%", width: f.pct + "%", background: f.barColor, borderRadius: 20 }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary,#5b6472)", marginTop: 6 }}>{f.pendResumen}</div>
      </div>

      {/* Movimiento */}
      <div className="pend-c-mov">
        <div style={{ fontSize: 12.5, color: "var(--color-text-secondary,#5b6472)", marginBottom: 5 }}>
          <i className="ti ti-arrows-split" style={{ fontSize: 13, verticalAlign: -2, marginRight: 4 }} />{f.remisionesLabel}
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, color: f.movColor, background: f.movBg, borderRadius: 6, padding: "4px 9px" }}>
          <i className="ti ti-clock" style={{ fontSize: 12 }} />{f.mov}
        </span>
      </div>

      {/* Acción */}
      <div className="pend-c-act">
        <button className="pend-crear" onClick={() => cb.onCrearRemision?.(f.id)}>
          <i className="ti ti-plus" style={{ fontSize: 16 }} />Crear remisión
        </button>
        <button className="pend-exp" onClick={onToggle} aria-label="Ver detalle" aria-expanded={expanded}>
          <i className={expanded ? "ti ti-chevron-up" : "ti ti-chevron-down"} style={{ fontSize: 16 }} />
        </button>
      </div>

      {/* Detalle */}
      {expanded && (
        <div className="pend-detail">
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary,#9aa3af)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 9 }}>Saldo por producto</div>
            {f.productos.map((p, i) => <ProductoRow key={i} p={p} />)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary,#9aa3af)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 9 }}>Acciones</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 }}>
              <button className="pend-detbtn" onClick={() => cb.onProgramar?.(f.id)}><i className="ti ti-calendar-plus" style={{ fontSize: 14 }} />Programar</button>
              <button className="pend-detbtn" onClick={() => cb.onDescontar?.(f.id)}><i className="ti ti-checklist" style={{ fontSize: 14 }} />Descontar material</button>
              <button className="pend-detbtn" onClick={() => cb.onMaterialEntregado?.(f.id)}><i className="ti ti-package-import" style={{ fontSize: 14 }} />Material entregado</button>
              {f.tienePdf && <button className="pend-detbtn" onClick={() => cb.onVerPdf?.(f.id)}><i className="ti ti-file-text" style={{ fontSize: 14 }} />Ver PDF</button>}
              <button className="pend-detbtn" onClick={() => cb.onEditar?.(f.id)}><i className="ti ti-edit" style={{ fontSize: 14 }} />Editar</button>
              <button className="pend-detbtn" style={{ color: "#dc2626" }} onClick={() => cb.onEliminar?.(f.id)}><i className="ti ti-trash" style={{ fontSize: 14 }} />Eliminar</button>
            </div>
            <a href={`tel:${f.telefono}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#378ADD", textDecoration: "none" }}>
              <i className="ti ti-phone" style={{ fontSize: 14 }} />{f.telefono}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Pendientes({
  facturas = [],
  onCrearRemision, onProgramar, onDescontar, onMaterialEntregado, onVerPdf, onEditar, onEliminar,
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("movimiento");
  const [view, setView] = useState("lista");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);

  const cb = { onCrearRemision, onProgramar, onDescontar, onMaterialEntregado, onVerPdf, onEditar, onEliminar };

  const enriched = useMemo(() => facturas.map(enrich), [facturas]);
  const stats = useMemo(() => ({
    total: enriched.length,
    est: enriched.filter((r) => r.dias >= 60).length,
    casi: enriched.filter((r) => r.pct >= 90).length,
    sin: enriched.filter((r) => r.pct === 0).length,
  }), [enriched]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = enriched.filter((r) => {
      if (term && !(r.cliente.toLowerCase().includes(term) || String(r.numeroFactura).includes(term))) return false;
      if (filter === "est" && !(r.dias >= 60)) return false;
      if (filter === "casi" && !(r.pct >= 90)) return false;
      if (filter === "sin" && !(r.pct === 0)) return false;
      return true;
    });
    out.sort((a, b) =>
      sort === "avance" ? b.pct - a.pct
      : sort === "cliente" ? a.cliente.localeCompare(b.cliente)
      : sort === "antigua" ? parseFecha(a.fecha) - parseFecha(b.fecha)
      : b.dias - a.dias
    );
    return out;
  }, [enriched, q, filter, sort]);

  // Construye la lista a mostrar según la vista (con encabezados de grupo)
  const display = useMemo(() => {
    if (view === "lista") return rows.map((r) => ({ type: "row", f: r }));
    if (view === "cliente") {
      const map = {};
      rows.forEach((r) => { (map[r.cliente] = map[r.cliente] || []).push(r); });
      const out = [];
      Object.keys(map).sort((a, b) => a.localeCompare(b)).forEach((name) => {
        const g = map[name], prod = g.reduce((s, r) => s + r.pendN, 0);
        out.push({ type: "header", id: "h-" + name, title: name, accent: "#0C447C",
          sub: `${g.length} factura${g.length > 1 ? "s" : ""} abierta${g.length > 1 ? "s" : ""} · ${prod} productos por entregar` });
        g.forEach((r) => out.push({ type: "row", f: r }));
      });
      return out;
    }
    const bucket = (r) => (r.pct === 0 ? "sin" : r.dias >= 60 ? "est" : r.pct >= 90 ? "casi" : "curso");
    const defs = [["est", "Estancadas", "#dc2626"], ["sin", "Sin remisionar", "#64748b"], ["curso", "En curso", "#378ADD"], ["casi", "Casi listas", "#16a34a"]];
    const out = [];
    defs.forEach(([k, title, accent]) => {
      const g = rows.filter((r) => bucket(r) === k);
      if (!g.length) return;
      out.push({ type: "header", id: "h-" + k, title: `${title} (${g.length})`, sub: "", accent });
      g.forEach((r) => out.push({ type: "row", f: r }));
    });
    return out;
  }, [rows, view]);

  const toggleFilter = (k) => setFilter((cur) => (cur === k ? "all" : k));

  return (
    <div className="pend-wrap">
      <style>{CSS}</style>

      {/* Sin título propio: la pestaña "Por entregar" ya lo dice. */}
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary,#5b6472)" }}>
        Facturas que aún no se entregan completas · se van despachando por remisiones.
      </p>

      {/* Chips de estado / filtros rápidos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 18 }}>
        <button className="pend-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: "#E6F1FB", color: "#0C447C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-files" style={{ fontSize: 18 }} /></span>
          <span><span style={{ display: "block", fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{stats.total}</span><span style={{ fontSize: 12, color: "var(--color-text-secondary,#5b6472)" }}>Abiertas</span></span>
        </button>
        <button className="pend-chip" aria-pressed={filter === "est"} onClick={() => toggleFilter("est")}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: "#fef2f2", color: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-clock-exclamation" style={{ fontSize: 18 }} /></span>
          <span><span style={{ display: "block", fontSize: 18, fontWeight: 700, lineHeight: 1.1, color: "#dc2626" }}>{stats.est}</span><span style={{ fontSize: 12, color: "var(--color-text-secondary,#5b6472)" }}>Estancadas +60d</span></span>
        </button>
        <button className="pend-chip" aria-pressed={filter === "casi"} onClick={() => toggleFilter("casi")}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: "#ecfdf5", color: "#15803d", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-circle-check" style={{ fontSize: 18 }} /></span>
          <span><span style={{ display: "block", fontSize: 18, fontWeight: 700, lineHeight: 1.1, color: "#15803d" }}>{stats.casi}</span><span style={{ fontSize: 12, color: "var(--color-text-secondary,#5b6472)" }}>Casi listas +90%</span></span>
        </button>
        <button className="pend-chip" aria-pressed={filter === "sin"} onClick={() => toggleFilter("sin")}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: "#f1f5f9", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-hourglass-empty" style={{ fontSize: 18 }} /></span>
          <span><span style={{ display: "block", fontSize: 18, fontWeight: 700, lineHeight: 1.1, color: "#475569" }}>{stats.sin}</span><span style={{ fontSize: 12, color: "var(--color-text-secondary,#5b6472)" }}>Sin remisionar</span></span>
        </button>
      </div>

      {/* Toolbar */}
      <div className="pend-toolbar">
        <div className="pend-search">
          <i className="ti ti-search" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "var(--color-text-tertiary,#9aa3af)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="text" placeholder="Buscar por cliente o número de factura..." />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary,#5b6472)", whiteSpace: "nowrap" }}><i className="ti ti-arrows-sort" style={{ fontSize: 15, verticalAlign: -2, marginRight: 3 }} />Ordenar</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ border: "1px solid var(--color-border,#e3e7ec)", borderRadius: "var(--border-radius-md,8px)", padding: "10px 12px", minHeight: 44, fontSize: 13.5, fontFamily: "inherit", background: "#fff", color: "var(--color-text-primary,#1a1a1a)", cursor: "pointer" }}>
            <option value="movimiento">Más quietas primero</option>
            <option value="antigua">Más antiguas</option>
            <option value="avance">Más avanzadas</option>
            <option value="cliente">Cliente A–Z</option>
          </select>
        </div>
        <div className="pend-views" style={{ display: "flex", gap: 6 }}>
          <button className="pend-seg" aria-pressed={view === "lista"} onClick={() => setView("lista")}><i className="ti ti-list" style={{ fontSize: 16 }} />Lista</button>
          <button className="pend-seg" aria-pressed={view === "cliente"} onClick={() => setView("cliente")}><i className="ti ti-users" style={{ fontSize: 16 }} />Por cliente</button>
          <button className="pend-seg" aria-pressed={view === "estado"} onClick={() => setView("estado")}>
            <i className="ti ti-layout-columns" style={{ fontSize: 16 }} />Por estado
            <span style={{ fontSize: 9.5, fontWeight: 700, background: "#fbeafc", color: "#7a1f6b", padding: "1px 5px", borderRadius: 8, letterSpacing: 0.3 }}>EXP</span>
          </button>
        </div>
      </div>

      {/* Lista */}
      <div style={{ marginTop: 16 }}>
        {display.map((item) =>
          item.type === "header" ? (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 2px 9px" }}>
              <span style={{ width: 4, height: 18, borderRadius: 3, background: item.accent }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: "#042C53" }}>{item.title}</span>
              {item.sub && <span style={{ fontSize: 12.5, color: "var(--color-text-tertiary,#9aa3af)" }}>{item.sub}</span>}
            </div>
          ) : (
            <Fila
              key={item.f.id}
              f={item.f}
              expanded={expanded === item.f.id}
              onToggle={() => setExpanded((cur) => (cur === item.f.id ? null : item.f.id))}
              cb={cb}
            />
          )
        )}

        {rows.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--color-text-tertiary,#9aa3af)" }}>
            <i className="ti ti-search-off" style={{ fontSize: 34 }} />
            <div style={{ marginTop: 10, fontSize: 14 }}>No hay facturas que coincidan con la búsqueda o el filtro.</div>
          </div>
        )}
      </div>
    </div>
  );
}
