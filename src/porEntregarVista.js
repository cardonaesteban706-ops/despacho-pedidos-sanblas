// porEntregarVista.js
//
// La lógica de la pantalla "Por entregar", separada de su JSX. Vivía dentro de
// PorEntregar.jsx y por eso no se podía probar: `node --test` no compila JSX.
//
// Lo que se decide acá NO es cosmético. `enrich` produce el "Quedan X de Y" de
// cada línea y la etiqueta de estancamiento ("Estancada · 70d sin mover"), que
// es lo que hace que alguien vaya a mirar una factura olvidada. Si el saldo se
// desvía o el umbral cambia sin querer, una factura con material pendiente deja
// de pedir atención y la venta se queda a medias.

import { cantidadNum, saldoDe } from "./saldo.js";

export const fmtPesos = (n) => "$" + Number(n || 0).toLocaleString("es-CO");
export const parseFecha = (f) => {
  const [d, m, y] = String(f).split("/").map(Number);
  return new Date(y, m - 1, d).getTime();
};

// El parseo colombiano y la regla del saldo vienen de saldo.js (fuente única).
// Antes este archivo tenía su propia copia de las dos cosas.
const numCant = cantidadNum;
const fmtCant = (n) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(n);

export function enrich(f) {
  const pct = Math.max(0, Math.min(100, f.porcentajeEntregado ?? 0));
  const productos = (f.productos || []).map((p) => {
    const cant = numCant(p.cantidad);
    // Copia del saldo eliminada: ahora viene de saldo.js, igual que en el
    // núcleo y en los modales. Así esta pantalla nunca puede discrepar de lo
    // que dice la tarjeta o el modal de remisión.
    const rest = saldoDe(p);
    const ent = cant - rest;
    const pctL = cant ? Math.round((ent / cant) * 100) : 0;
    const done = rest <= 0;
    return {
      desc: p.descripcion,
      label: done ? `Completo · ${fmtCant(cant)} ${p.unidad}` : `Quedan ${fmtCant(rest)} de ${fmtCant(cant)} ${p.unidad}`,
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
