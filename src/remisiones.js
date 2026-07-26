// remisiones.js
//
// Reglas de las remisiones que antes vivían sueltas dentro de
// DespachoPedidos.jsx y no se podían probar: el enlace entre una remisión y su
// factura madre, y el correlativo REM-XXXX. Las dos habían causado bugs, así
// que ahora están acá, en un módulo puro, con tests (remisiones.test.mjs).

// ¿La remisión `hija` pertenece a la factura `madre`?
//
// Manda el ENLACE POR ID. El respaldo por número existe solo para las remisiones
// viejas que quedaron sin remisionDeId (su madre se borró, o su número está
// repetido y el relleno del SQL no pudo decidir cuál era).
//
// Por qué no basta el número, que era el enlace original:
//   - si alguien corrige el número de la madre en "Editar", todas sus remisiones
//     quedan huérfanas: el contador vuelve a "Sin remisiones" y la factura se
//     marca "Estancada" aunque se haya movido ayer;
//   - todas las facturas sin número guardan el texto "s/n", así que TODAS
//     compartían sus remisiones, cruzando material entre clientes distintos.
//     Por eso "s/n" nunca vale como enlace.
export function esRemisionDe(hija, madre) {
  if (!hija || !madre) return false;
  if (hija.remisionDeId) return hija.remisionDeId === madre.id;
  if (!hija.remisionDe || hija.remisionDe === "s/n") return false;
  return !!madre.numeroFactura && hija.remisionDe === madre.numeroFactura;
}

// Todas las remisiones de una factura, dentro de una lista de pedidos.
export function remisionesDe(madre, pedidos) {
  return (pedidos || []).filter((h) => esRemisionDe(h, madre));
}

// Mayor número de remisión de una lista de textos ("REM-0007", ...).
//
// Se compara NUMÉRICAMENTE a propósito: ordenar por texto no sirve porque
// "REM-9999" ordena DESPUÉS de "REM-10000", y ahí el correlativo se reiniciaría.
export function maxRemisionDeNumeros(numeros) {
  let max = 0;
  for (const n of numeros || []) {
    const m = /^REM-(\d+)$/i.exec(String(n || "").trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

// Formatea el siguiente correlativo. Se rellena a 4 dígitos para que quede
// parejo en la tirilla; pasando de 9999 simplemente crece (REM-10000), y por eso
// la comparación de arriba es numérica y no de texto.
export function formatearNumeroRemision(n) {
  return `REM-${String(n).padStart(4, "0")}`;
}
