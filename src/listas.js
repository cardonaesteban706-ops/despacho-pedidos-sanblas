// listas.js
//
// Operaciones RELATIVAS sobre las listas de pedidos e historial, para aplicar y
// deshacer cambios optimistas.
//
// ---------------------------------------------------------------------
// EL PROBLEMA QUE RESUELVEN
// ---------------------------------------------------------------------
// Los handlers pintan el cambio en pantalla antes de que la base confirme, y si
// la escritura falla lo deshacen. Hasta ahora lo deshacían guardando una FOTO de
// la lista entera antes del `await`:
//
//     const prevPedidos = pedidos;          // foto
//     setPedidos(pedidos.filter(...));      // cambio optimista
//     try { await guardar(); }
//     catch { setPedidos(prevPedidos); }    // <- pisa TODO con la foto vieja
//
// Entre el `await` y el catch pueden pasar segundos, y en ese rato el usuario
// puede haber creado una remisión, borrado otro pedido o reordenado el tablero.
// Restaurar la foto no deshace "mi" cambio: revierte la lista al estado de hace
// tres segundos y se lleva por delante todo lo que pasó en medio. El pedido
// borrado reaparece, la remisión nueva se esfuma.
//
// La forma correcta es que deshacer sea una operación relativa al estado ACTUAL
// —"vuelve a meter ESTE pedido", "saca ESTE del historial"— y no un reemplazo
// completo. Eso es lo que hay acá, y por eso se usa siempre con la forma
// funcional de setState: setPedidos((prev) => reponerPorId(prev, pedido)).
//
// El patrón ya existía en deletePedido (el "Deshacer" del borrado). Esto lo
// generaliza al resto de handlers.

// Acepta ids sueltos, objetos con id, o listas de cualquiera de los dos.
function idsDe(x) {
  const arr = Array.isArray(x) ? x : [x];
  return new Set(arr.filter(Boolean).map((i) => (typeof i === "object" ? i.id : i)));
}

// Saca de la lista los elementos indicados.
export function quitarPorId(lista, quitar) {
  const ids = idsDe(quitar);
  if (ids.size === 0) return lista || [];
  return (lista || []).filter((p) => !ids.has(p.id));
}

// Vuelve a meter elementos que se habían sacado, SIN duplicar los que ya estén.
//
// Van al final: la posición en el array no decide nada, porque el tablero se
// ordena con compararOrden al pintar. Es el mismo criterio que ya usaba el
// "Deshacer" del borrado.
export function reponerPorId(lista, items) {
  const base = lista || [];
  const arr = (Array.isArray(items) ? items : [items]).filter(Boolean);
  const presentes = new Set(base.map((p) => p.id));
  const faltan = arr.filter((i) => !presentes.has(i.id));
  // Si no falta ninguno se devuelve la MISMA referencia: React no re-renderiza
  // por un cambio que no existe.
  return faltan.length ? [...base, ...faltan] : base;
}

// Deja la versión `item` del elemento que tenga su mismo id.
//
// Si ya no está en la lista NO lo resucita, a propósito: es el mismo criterio de
// moverPedidoAEstado ("update, no upsert"). Un pedido que otro dispositivo borró
// mientras tanto no debe volver a aparecer porque a mí me falló una escritura.
export function reemplazarPorId(lista, item) {
  const base = lista || [];
  if (!item) return base;
  if (!base.some((p) => p.id === item.id)) return base;
  return base.map((p) => (p.id === item.id ? item : p));
}
