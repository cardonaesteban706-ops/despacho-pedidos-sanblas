import React, { useMemo, useState } from "react";

// ---------------------------------------------------------------------
// PanelResumen — vista del "Resumen del día" rediseñada.
//
// Es un componente de PRESENTACIÓN: no toca Supabase ni el estado global.
// Recibe por props las mismas derivaciones memoizadas que DespachoPedidos ya
// calcula (resumenPanel, sinCategorizar, tendenciaPanel, promedioKilos30d…) y
// las dibuja con mejor jerarquía. Reemplaza el bloque JSX del Panel dentro de
// DespachoPedidos por: <PanelResumen ...props /> (ver README-integracion.md).
//
// Usa las MISMAS variables de color de la app (--color-*), los iconos Tabler
// y los colores de marca/vehículo, así que hereda el tema sin configurar nada.
// ---------------------------------------------------------------------

// Colores de identidad de marca SANBLAS (idénticos a DespachoPedidos.jsx).
const MARCA = {
  azulOscuro: "#0C447C",
  azulMedio: "#378ADD",
  azulClaro: "#E6F1FB",
  azulMuyOscuro: "#042C53",
};

// Vehículos con su color fijo de marca (idénticos a DespachoPedidos.jsx).
const VEHICULOS = [
  { id: "camion", label: "Camión", icon: "ti-truck", bg: "#E6F1FB", border: "#378ADD", text: "#0C447C" },
  { id: "motocarro", label: "Motocarro", icon: "ti-moped", bg: "#FAEEDA", border: "#BA7517", text: "#633806" },
  { id: "tractor", label: "Tractor", icon: "ti-tractor", bg: "#EAF3DE", border: "#639922", text: "#27500A" },
];

// Paleta para las barras de categoría de material (azules de marca + gris final).
const MAT_COLORS = ["#0C447C", "#378ADD", "#6BA6E0", "#96C2EA", "#BFDCF3", "#D9EAF8", "#B0B8C1"];

function formatCOP(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);
}
function formatCantidad(n) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(n);
}

// Fecha larga y legible: "lunes, 20 de julio de 2026".
function formatFechaLarga(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function diaCorto(iso) {
  const [, , d] = iso.split("-");
  return d;
}

// --- Reporte de fletes ("Transporte de carga de cliente") ---
// El flete se agrega a mano en la factura desde World Office como una línea
// más, pero no es material (no pesa) — se cuenta en pesos ($), no en kilos.
function normalizarTexto(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function esLineaFlete(descripcion) {
  const d = normalizarTexto(descripcion);
  return d.includes("transporte de carga") || d.includes("transporte carga") || /\bflete\b/.test(d);
}
// Día ISO (YYYY-MM-DD) en que se entregó un pedido, igual que en DespachoPedidos.
function fechaEntregaISO(pedido) {
  if (pedido && pedido.entregadoEn) {
    const dt = new Date(pedido.entregadoEn);
    if (!isNaN(dt.getTime())) return dt.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  }
  if (pedido && pedido.fechaEntrega && pedido.fechaEntrega.includes("/")) {
    const [d, m, y] = pedido.fechaEntrega.split("/");
    if (d && m && y) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}
function primerDiaMesISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function hoyISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

// Veredicto del día (misma lógica que DespachoPedidos.jsx). Devuelve además un
// % explícito para el titular. Usa variables de color de la app.
function veredictoDia(kilos, promedio) {
  if (!promedio || promedio <= 0) {
    return { texto: "Sin comparación todavía", detalle: "Necesito unos días más de despachos para comparar.", icono: "ti-minus", color: "var(--color-text-tertiary)", fondo: "var(--color-background-secondary)", borde: "var(--color-border-tertiary)", pct: null };
  }
  const ratio = kilos / promedio;
  const dif = Math.round(Math.abs(ratio - 1) * 100);
  const pct = Math.round((ratio - 1) * 100);
  if (ratio >= 1.25) return { texto: "Día fuerte", detalle: `Se movió un ${dif}% más de carga que un día normal.`, icono: "ti-trending-up", color: "var(--color-text-success)", fondo: "var(--color-background-success)", borde: "var(--color-border-success)", pct };
  if (ratio >= 0.85) return { texto: "Día normal", detalle: "Se movió más o menos la carga de un día normal.", icono: "ti-arrow-right", color: "var(--color-text-info)", fondo: "var(--color-background-info)", borde: "var(--color-border-info)", pct };
  if (ratio >= 0.5) return { texto: "Día flojo", detalle: `Se movió un ${dif}% menos de carga que un día normal.`, icono: "ti-trending-down", color: "var(--color-text-warning)", fondo: "var(--color-background-warning)", borde: "var(--color-border-warning)", pct };
  return { texto: "Día muy flojo", detalle: `Se movió un ${dif}% menos de carga que un día normal.`, icono: "ti-trending-down", color: "var(--color-text-danger)", fondo: "var(--color-background-danger)", borde: "var(--color-border-danger)", pct };
}

// Estilos base de tarjeta (usan variables del tema).
const card = {
  background: "var(--color-background-secondary, #fff)",
  border: "0.5px solid var(--color-border-tertiary, #e6e8ec)",
  borderRadius: "var(--border-radius-md, 14px)",
  padding: 16,
};
const cardTitle = { fontSize: 13, fontWeight: 700, color: MARCA.azulMuyOscuro, marginBottom: 12 };
const barTrack = { flex: 1, height: 9, borderRadius: 5, background: "var(--color-background-tertiary, #eef0f3)", overflow: "hidden" };

// CSS responsivo del Panel: móvil = 1 columna; escritorio (≥760px) = 3
// columnas con bloques que abarcan 2 o 3. Se inyecta una sola vez.
const PANEL_CSS = `
.pr-grid{display:grid;grid-template-columns:1fr;gap:14px}
.pr-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.pr-veredicto-comp{width:100%;margin-top:14px}
@media(min-width:760px){
  .pr-grid{grid-template-columns:repeat(3,1fr)}
  .pr-span3{grid-column:1 / -1}
  .pr-span2{grid-column:span 2}
  .pr-veredicto{display:flex;align-items:center;gap:20px}
  .pr-veredicto-comp{width:260px;margin-top:0;flex-shrink:0}
}`;

export default function PanelResumen({
  resumen,                 // resumenPanel: { totalPedidos, kilos, porVehiculo, porDestino, porCategoria, pedidosDia }
  sinCategorizar = [],     // [{ descripcion, veces, unidades }]
  promedio = 0,            // promedioKilos30d
  tendencia = { dias: [], max: 1 }, // { dias: [{iso, kg, esActual}], max }
  panelDia,                // ISO del día mostrado
  puedeAnterior = true,
  puedeSiguiente = true,
  onAnterior,
  onSiguiente,
  onCompartir,             // opcional; si falta, usa navigator.share / portapapeles
  maxCategorias = 6,       // top N categorías; el resto se agrupa en "Otros"
  historial = [],          // TODOS los pedidos entregados (para el reporte de fletes por rango)
}) {
  const [sinCatAbierto, setSinCatAbierto] = useState(false);
  const [fleteDesde, setFleteDesde] = useState(primerDiaMesISO);
  const [fleteHasta, setFleteHasta] = useState(hoyISO);

  // Fletes cobrados por vehículo en el rango [fleteDesde, fleteHasta], separados
  // entre lo que es ingreso de la ferretería y lo que le corresponde a un
  // tercero (motero externo, etc. — marcado con fleteExterno en el pedido).
  const reporteFletes = useMemo(() => {
    const porVeh = new Map();
    for (const p of historial) {
      const iso = fechaEntregaISO(p);
      if (!iso || iso < fleteDesde || iso > fleteHasta) continue;
      let valorFlete = 0;
      for (const prod of p.productos || []) {
        if (esLineaFlete(prod && prod.descripcion)) valorFlete += parseInt(String(prod.total || "0").replace(/\./g, ""), 10) || 0;
      }
      if (valorFlete <= 0) continue;
      const veh = p.vehiculo || "Sin vehículo";
      if (!porVeh.has(veh)) porVeh.set(veh, { propio: 0, externo: 0 });
      const bucket = porVeh.get(veh);
      if (p.fleteExterno) bucket.externo += valorFlete;
      else bucket.propio += valorFlete;
    }
    const filas = [...porVeh.entries()].map(([veh, d]) => {
      const info = VEHICULOS.find((x) => x.id === veh) || { label: veh, bg: "var(--color-background-tertiary, #eef0f3)", border: "#9AA0A6", text: MARCA.azulMuyOscuro, icon: "ti-package" };
      return { veh, label: info.label, icon: info.icon, bg: info.bg, border: info.border, text: info.text, propio: d.propio, externo: d.externo, total: d.propio + d.externo };
    }).sort((a, b) => b.total - a.total);
    const totalPropio = filas.reduce((s, f) => s + f.propio, 0);
    const totalExterno = filas.reduce((s, f) => s + f.externo, 0);
    return { filas, totalPropio, totalExterno };
  }, [historial, fleteDesde, fleteHasta]);

  const r = resumen || { totalPedidos: 0, kilos: 0, porVehiculo: [], porDestino: [], porCategoria: [], pedidosDia: [] };
  const v = veredictoDia(r.kilos, promedio);
  const maxComp = Math.max(r.kilos, promedio, 1);

  // Vehículos: normaliza [id,{pedidos,kilos}] y añade color/label de marca.
  const maxVehKilos = Math.max(1, ...r.porVehiculo.map(([, d]) => d.kilos));
  const vehiculos = r.porVehiculo.map(([veh, d]) => {
    const info = VEHICULOS.find((x) => x.id === veh) || { label: veh, border: "#9AA0A6", text: MARCA.azulMuyOscuro, icon: "ti-package" };
    return { key: veh, label: info.label, icon: info.icon, border: info.border, text: info.text, pedidos: d.pedidos, kilos: d.kilos, pct: (d.kilos / maxVehKilos) * 100 };
  });

  // Destinos: [dest, n].
  const maxDest = Math.max(1, ...r.porDestino.map(([, n]) => n));
  const destinos = r.porDestino.map(([dest, n]) => ({ dest, n, pct: (n / maxDest) * 100 }));

  // Categorías: top N + "Otros" con el resto sumado.
  const cats = r.porCategoria || [];
  const top = cats.slice(0, maxCategorias);
  const resto = cats.slice(maxCategorias);
  const restoKg = resto.reduce((s, [, d]) => s + d.kilos, 0);
  const restoU = resto.reduce((s, [, d]) => s + (d.unidades || 0), 0);
  const filas = restoKg > 0 ? [...top, ["Otros", { unidades: restoU, kilos: restoKg, _otros: true }]] : top;
  const maxCat = Math.max(1, ...filas.map(([, d]) => d.kilos));
  const materiales = filas.map(([cat, d], i) => ({
    cat, unidades: d.unidades, kilos: d.kilos, otros: !!d._otros,
    pct: (d.kilos / maxCat) * 100, color: MAT_COLORS[Math.min(i, MAT_COLORS.length - 1)],
  }));

  const dias = tendencia.dias || [];
  const maxTrend = Math.max(tendencia.max || 1, promedio, 1);
  const promPct = promedio > 0 ? (promedio / maxTrend) * 100 : null;

  function compartir() {
    if (onCompartir) return onCompartir();
    const lineas = [
      "Resumen del día — Ferromateriales San Blas",
      formatFechaLarga(panelDia),
      `Pedidos despachados: ${r.totalPedidos}`,
      `Carga movida: ${formatCOP(Math.round(r.kilos))} kg${v.pct !== null ? ` (${v.pct >= 0 ? "+" : ""}${v.pct}% vs lo normal)` : ""}`,
      ...vehiculos.map((x) => `${x.label}: ${x.pedidos} pedidos, ${formatCOP(Math.round(x.kilos))} kg`),
    ];
    const texto = lineas.join("\n");
    if (navigator.share) navigator.share({ title: "Resumen del día", text: texto }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(texto);
  }

  const btnFlecha = (habil) => ({
    width: 36, height: 36, borderRadius: 9, border: "0.5px solid var(--color-border-tertiary, #e6e8ec)",
    background: "var(--color-background-secondary, #fff)", color: habil ? MARCA.azulOscuro : "var(--color-text-tertiary, #9aa0a6)",
    fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: habil ? "pointer" : "default",
    opacity: habil ? 1 : 0.5,
  });

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto", width: "100%" }}>
      <style>{PANEL_CSS}</style>

      {/* Encabezado: navegación de día + compartir */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: MARCA.azulMedio, textTransform: "uppercase", letterSpacing: "0.08em" }}>Resumen del día</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
            <button aria-label="Día anterior" onClick={puedeAnterior ? onAnterior : undefined} disabled={!puedeAnterior} style={btnFlecha(puedeAnterior)}><i className="ti ti-chevron-left" /></button>
            <div style={{ fontSize: 21, fontWeight: 700, color: MARCA.azulMuyOscuro, textTransform: "capitalize" }}>{formatFechaLarga(panelDia)}</div>
            <button aria-label="Día siguiente" onClick={puedeSiguiente ? onSiguiente : undefined} disabled={!puedeSiguiente} style={btnFlecha(puedeSiguiente)}><i className="ti ti-chevron-right" /></button>
          </div>
        </div>
        <button onClick={compartir} style={{ display: "flex", alignItems: "center", gap: 8, background: MARCA.azulOscuro, color: "#fff", border: "none", padding: "11px 18px", borderRadius: 11, fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          <i className="ti ti-share" /> Compartir resumen
        </button>
      </div>

      {r.totalPedidos === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "48px 20px", color: "var(--color-text-tertiary, #9aa0a6)" }}>
          <i className="ti ti-clipboard-off" style={{ fontSize: 28 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10, color: MARCA.azulMuyOscuro }}>Sin despachos este día</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>No hubo entregas registradas el {formatFechaLarga(panelDia)}.</div>
        </div>
      ) : (
        <div className="pr-grid">

          {/* Veredicto del día + comparación explícita contra el promedio */}
          <div className="pr-span3 pr-veredicto" style={{ background: v.fondo, border: `1px solid ${v.borde}`, borderRadius: 18, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: v.color, flexShrink: 0 }}>
                <i className={`ti ${v.icono}`} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: v.color }}>{v.texto}</div>
                <div style={{ fontSize: 13.5, color: "var(--color-text-secondary, #4b5563)", marginTop: 2 }}>{v.detalle}</div>
              </div>
            </div>
            {promedio > 0 && (
              <div className="pr-veredicto-comp">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 78, fontSize: 12, fontWeight: 600, color: MARCA.azulMuyOscuro, flexShrink: 0 }}>Hoy</div>
                  <div style={{ ...barTrack, background: "rgba(255,255,255,0.55)" }}><div style={{ height: "100%", width: `${(r.kilos / maxComp) * 100}%`, background: v.color, borderRadius: 5 }} /></div>
                  <div style={{ width: 54, textAlign: "right", fontSize: 12, fontWeight: 700, color: MARCA.azulMuyOscuro, fontVariantNumeric: "tabular-nums" }}>{formatCOP(Math.round(r.kilos))}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 78, fontSize: 12, color: "var(--color-text-secondary, #4b5563)", flexShrink: 0 }}>Normal 30d</div>
                  <div style={{ ...barTrack, background: "rgba(255,255,255,0.55)" }}><div style={{ height: "100%", width: `${(promedio / maxComp) * 100}%`, background: "var(--color-text-tertiary, #9aa0a6)", borderRadius: 5 }} /></div>
                  <div style={{ width: 54, textAlign: "right", fontSize: 12, color: "var(--color-text-secondary, #4b5563)", fontVariantNumeric: "tabular-nums" }}>{formatCOP(Math.round(promedio))}</div>
                </div>
              </div>
            )}
          </div>

          {/* KPIs principales */}
          <div className="pr-span3 pr-kpis">
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary, #9aa0a6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Pedidos</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: MARCA.azulMuyOscuro, lineHeight: 1.1, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{r.totalPedidos}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary, #9aa0a6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Carga movida</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: MARCA.azulMuyOscuro, lineHeight: 1.1, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{formatCOP(Math.round(r.kilos))}<span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-secondary, #4b5563)" }}> kg</span></div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary, #9aa0a6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>vs. lo normal</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: v.color, lineHeight: 1.1, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{v.pct !== null ? `${v.pct >= 0 ? "+" : ""}${v.pct}%` : "—"}</div>
            </div>
          </div>

          {/* Tendencia 14 días — barras con línea de promedio */}
          <div className="pr-span2" style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <div style={cardTitle}>Tendencia de carga — últimos {dias.length} días</div>
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary, #9aa0a6)" }}>kilos por día</div>
            </div>
            <div style={{ position: "relative", height: 150, display: "flex", alignItems: "flex-end", gap: 6 }}>
              {promPct !== null && (
                <>
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: `${promPct}%`, borderTop: "1.5px dashed var(--color-text-tertiary, #9aa0a6)" }} />
                  <div style={{ position: "absolute", right: 0, bottom: `calc(${promPct}% + 3px)`, fontSize: 10.5, fontWeight: 600, color: "var(--color-text-secondary, #4b5563)", background: "var(--color-background-secondary, #fff)", padding: "0 4px" }}>prom. {formatCOP(Math.round(promedio))}</div>
                </>
              )}
              {dias.map((d, i) => (
                <div key={d.iso || i} title={`${formatCOP(Math.round(d.kg))} kg`} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  <div style={{ width: "100%", maxWidth: 26, height: `${Math.max(4, (d.kg / maxTrend) * 100)}%`, background: d.esActual ? MARCA.azulOscuro : "#9DBFDD", borderRadius: "5px 5px 2px 2px" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
              {dias.map((d, i) => (
                <div key={(d.iso || i) + "l"} style={{ flex: 1, textAlign: "center", fontSize: 10, color: d.esActual ? MARCA.azulOscuro : "var(--color-text-tertiary, #9aa0a6)", fontWeight: d.esActual ? 700 : 400 }}>{d.iso ? diaCorto(d.iso) : ""}</div>
              ))}
            </div>
          </div>

          {/* Por vehículo */}
          <div style={card}>
            <div style={cardTitle}>Por vehículo</div>
            {vehiculos.map((x) => (
              <div key={x.key} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                  <i className={`ti ${x.icon}`} style={{ color: x.border, fontSize: 15 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: x.text }}>{x.label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-tertiary, #9aa0a6)", fontVariantNumeric: "tabular-nums" }}>{x.pedidos} · {formatCOP(Math.round(x.kilos))} kg</span>
                </div>
                <div style={barTrack}><div style={{ height: "100%", width: `${x.pct}%`, background: x.border, borderRadius: 5 }} /></div>
              </div>
            ))}
          </div>

          {/* Por categoría de material */}
          <div className="pr-span2" style={card}>
            <div style={cardTitle}>Por categoría de material</div>
            {materiales.map((m, i) => (
              <div key={m.cat + i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 130, fontSize: 13, fontWeight: 600, color: m.otros ? "var(--color-text-tertiary, #9aa0a6)" : MARCA.azulMuyOscuro, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.cat}</div>
                <div style={barTrack}><div style={{ height: "100%", width: `${m.pct}%`, background: m.color, borderRadius: 5 }} /></div>
                <div style={{ width: 150, textAlign: "right", fontSize: 12, color: "var(--color-text-tertiary, #9aa0a6)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{m.otros ? `${formatCOP(Math.round(m.kilos))} kg` : `${formatCantidad(m.unidades)} u · ${formatCOP(Math.round(m.kilos))} kg`}</div>
              </div>
            ))}
          </div>

          {/* Por destino */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <div style={cardTitle}>Por destino</div>
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary, #9aa0a6)" }}>pedidos</div>
            </div>
            {destinos.map((d) => (
              <div key={d.dest} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 74, fontSize: 13, fontWeight: 600, color: MARCA.azulMuyOscuro, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.dest}</div>
                <div style={{ ...barTrack, height: 8 }}><div style={{ height: "100%", width: `${d.pct}%`, background: MARCA.azulMedio, borderRadius: 4 }} /></div>
                <div style={{ width: 22, textAlign: "right", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary, #4b5563)", fontVariantNumeric: "tabular-nums" }}>{d.n}</div>
              </div>
            ))}
          </div>

          {/* Tabla de pedidos del día */}
          <div className="pr-span2" style={{ ...card, padding: "16px 0 6px" }}>
            <div style={{ ...cardTitle, padding: "0 16px" }}>Pedidos del día</div>
            <div style={{ maxHeight: 300, overflowY: "auto", padding: "0 16px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Cliente", "Factura", "Vehículo"].map((h) => (
                      <th key={h} style={{ textAlign: "left", fontWeight: 500, color: "var(--color-text-tertiary, #9aa0a6)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em", padding: "0 0 8px", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)" }}>{h}</th>
                    ))}
                    <th style={{ textAlign: "right", fontWeight: 500, color: "var(--color-text-tertiary, #9aa0a6)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em", padding: "0 0 8px", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)" }}>Kilos</th>
                  </tr>
                </thead>
                <tbody>
                  {r.pedidosDia.map((p, i) => {
                    const info = VEHICULOS.find((x) => x.id === p.vehiculo);
                    return (
                      <tr key={p.id || p.numeroFactura || i}>
                        <td style={{ padding: "9px 0", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)", fontWeight: 600, color: "var(--color-text-primary, #1a1a1a)" }}>{p.cliente || "—"}</td>
                        <td style={{ padding: "9px 0", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)", color: "var(--color-text-tertiary, #9aa0a6)", fontVariantNumeric: "tabular-nums" }}>{p.numeroFactura ? `#${p.numeroFactura}` : "—"}</td>
                        <td style={{ padding: "9px 0", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20, background: info ? info.bg : "var(--color-background-tertiary, #eef0f3)", color: info ? info.text : "var(--color-text-secondary, #4b5563)" }}>{info ? info.label : (p.vehiculo || "—")}</span>
                        </td>
                        <td style={{ padding: "9px 0", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)", textAlign: "right", fontWeight: 700, color: MARCA.azulMuyOscuro, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatCOP(Math.round(p.kilos))} kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fletes por vehículo — rango de fechas elegido por el usuario,
              independiente del día que se esté mirando arriba. */}
          <div className="pr-span3" style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
              <div style={cardTitle}>Fletes cobrados por vehículo</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <input
                  type="date"
                  value={fleteDesde}
                  max={fleteHasta}
                  onChange={(e) => setFleteDesde(e.target.value)}
                  aria-label="Desde"
                  style={{ fontSize: 12.5, padding: "6px 8px", border: "0.5px solid var(--color-border-tertiary, #e6e8ec)", borderRadius: 8 }}
                />
                <span style={{ fontSize: 12, color: "var(--color-text-tertiary, #9aa0a6)" }}>a</span>
                <input
                  type="date"
                  value={fleteHasta}
                  min={fleteDesde}
                  max={hoyISO()}
                  onChange={(e) => setFleteHasta(e.target.value)}
                  aria-label="Hasta"
                  style={{ fontSize: 12.5, padding: "6px 8px", border: "0.5px solid var(--color-border-tertiary, #e6e8ec)", borderRadius: 8 }}
                />
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary, #9aa0a6)", marginBottom: 14 }}>
              Solo cuenta la línea "Transporte de carga de cliente" de las facturas. Los fletes marcados como cobrados por un tercero no se suman como ingreso tuyo.
            </div>
            {reporteFletes.filas.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--color-text-tertiary, #9aa0a6)", padding: "8px 0" }}>No hay fletes registrados en ese rango de fechas.</div>
            ) : (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", fontWeight: 500, color: "var(--color-text-tertiary, #9aa0a6)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em", padding: "0 0 8px", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)" }}>Vehículo</th>
                      <th style={{ textAlign: "right", fontWeight: 500, color: "var(--color-text-tertiary, #9aa0a6)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em", padding: "0 0 8px", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)" }}>Fletes propios</th>
                      <th style={{ textAlign: "right", fontWeight: 500, color: "var(--color-text-tertiary, #9aa0a6)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em", padding: "0 0 8px", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)" }}>De terceros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reporteFletes.filas.map((f) => (
                      <tr key={f.veh}>
                        <td style={{ padding: "9px 0", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20, background: f.bg || "var(--color-background-tertiary, #eef0f3)", color: f.text }}>
                            <i className={`ti ${f.icon}`} style={{ fontSize: 12, verticalAlign: "-1px", marginRight: 4 }} />
                            {f.label}
                          </span>
                        </td>
                        <td style={{ padding: "9px 0", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)", textAlign: "right", fontWeight: 700, color: MARCA.azulMuyOscuro, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {f.propio > 0 ? `$${formatCOP(f.propio)}` : "—"}
                        </td>
                        <td style={{ padding: "9px 0", borderBottom: "0.5px solid var(--color-border-tertiary, #e6e8ec)", textAlign: "right", color: "var(--color-text-tertiary, #9aa0a6)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {f.externo > 0 ? `$${formatCOP(f.externo)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ padding: "9px 0 0", fontWeight: 700, fontSize: 12.5 }}>Total</td>
                      <td style={{ padding: "9px 0 0", textAlign: "right", fontWeight: 700, color: MARCA.azulMuyOscuro, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>${formatCOP(reporteFletes.totalPropio)}</td>
                      <td style={{ padding: "9px 0 0", textAlign: "right", color: "var(--color-text-tertiary, #9aa0a6)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{reporteFletes.totalExterno > 0 ? `$${formatCOP(reporteFletes.totalExterno)}` : "—"}</td>
                    </tr>
                  </tfoot>
                </table>
                {reporteFletes.totalExterno > 0 && (
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary, #9aa0a6)", marginTop: 8 }}>
                    Los ${formatCOP(reporteFletes.totalExterno)} de fletes de terceros no son ingreso tuyo — quedan aquí solo de registro.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sin categorizar — plegable */}
          {sinCategorizar.length > 0 && (
            <div style={{ ...card, padding: 0, overflow: "hidden", alignSelf: "start" }}>
              <button onClick={() => setSinCatAbierto((s) => !s)} aria-expanded={sinCatAbierto} style={{ width: "100%", background: "transparent", border: "none", padding: 16, display: "flex", alignItems: "center", gap: 8, textAlign: "left", cursor: "pointer" }}>
                <div style={{ flex: 1 }}>
                  <div style={cardTitle}>Sin categorizar</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary, #9aa0a6)", marginTop: -8 }}>{sinCategorizar.length} productos sin peso — no suman a los kilos</div>
                </div>
                <i className={`ti ${sinCatAbierto ? "ti-chevron-up" : "ti-chevron-down"}`} style={{ fontSize: 16, color: "var(--color-text-tertiary, #9aa0a6)" }} />
              </button>
              {sinCatAbierto && (
                <div style={{ padding: "0 16px 8px" }}>
                  {sinCategorizar.slice(0, 30).map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "0.5px solid var(--color-border-tertiary, #e6e8ec)", fontSize: 12.5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-primary, #1a1a1a)" }}>{item.descripcion}</span>
                      <span style={{ color: "var(--color-text-tertiary, #9aa0a6)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{item.veces} {item.veces === 1 ? "vez" : "veces"} · {formatCantidad(item.unidades)} u</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
