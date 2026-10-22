// cementoSync.js
//
// Aplica en Supabase lo que decide cementoDespacho.js: cuando cambia lo que ha
// salido de un pedido en Despacho, descuenta (o devuelve) el cemento en
// Bodega > Cemento > Saldo.
//
// Se llama DESPUÉS de que la entrega quedó guardada. Si esto falla, la entrega
// sigue bien hecha; solo hay que avisar que el cemento no se descontó.

import { cargarTiposCemento, cargarMovimientosDePedido, guardarMovimientosCemento, eliminarMovimientosCemento } from "./supabaseClient";
import { uid, todayISO } from "./constants.js";
import { planCemento, tieneCemento } from "./cementoDespacho.js";

// Los tipos cambian casi nunca: se piden una vez cada 5 minutos, no en cada
// entrega.
let tiposCache = null;
let tiposCacheEn = 0;

async function tiposCemento() {
  if (!tiposCache || !tiposCache.length || Date.now() - tiposCacheEn > 5 * 60 * 1000) {
    // Una lista vacía no se guarda: si justo falló la sesión o la red, la
    // siguiente entrega vuelve a preguntar en vez de saltarse el descuento.
    const tipos = await cargarTiposCemento();
    tiposCache = tipos.length ? tipos : null;
    tiposCacheEn = Date.now();
    return tipos;
  }
  return tiposCache;
}

// Devuelve { descontados, devueltos } en bultos, o null si el pedido no tiene
// cemento con saldo. Lanza si no se pudo guardar.
export async function sincronizarCemento(antes, despues) {
  const pedido = despues || antes;
  if (!pedido || !pedido.id) return null;
  const tipos = await tiposCemento();
  if (!tieneCemento(antes, tipos) && !tieneCemento(despues, tipos)) return null;
  const movsPedido = await cargarMovimientosDePedido(pedido.id);
  const { crear, borrar } = planCemento({ antes, despues, tipos, movsPedido, hoy: todayISO(), nuevoId: uid });
  if (!crear.length && !borrar.length) return null;
  await eliminarMovimientosCemento(borrar);
  await guardarMovimientosCemento(crear);
  const borrado = movsPedido.filter((m) => borrar.includes(m.id)).reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  const salidas = crear.filter((m) => m.clase === "salida").reduce((s, m) => s + m.cantidad, 0);
  const entradas = crear.filter((m) => m.clase === "entrada").reduce((s, m) => s + m.cantidad, 0);
  return { descontados: Math.max(0, salidas - borrado), devueltos: entradas + Math.max(0, borrado - salidas) };
}
