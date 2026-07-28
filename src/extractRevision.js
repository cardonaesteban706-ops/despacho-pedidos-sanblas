// extractRevision.js
//
// Las decisiones de la tarjeta de revisión, separadas de su JSX para poderlas
// probar (`node --test` no compila JSX).
//
// Acá vive la MATRIZ que hay que validar en cada cambio: documento
// (factura / cotización) × flujo (despacho / seguimiento). La regla del proyecto
// es que el FLUJO lo decide por dónde se subió el PDF, no el formato del
// documento — y como son dos booleanos parecidos que se leen del mismo objeto,
// es fácil cruzarlos sin darse cuenta. Cruzarlos significa mandar una cotización
// al tablero de despacho, o pedirle vehículo a un seguimiento.
//
// Y vive `motivoBloqueo`, que es lo único que impide guardar un pedido vacío o
// un duplicado sin que alguien lo mire.

// Estado derivado de la tarjeta.
//
//   seguimiento -> LAYOUT: true = tablero de cotizaciones (datos + fecha de
//                  seguimiento); false = despacho (vehículo, fecha, destino).
//   data.tipo   -> ETIQUETAS solamente ("N° cotización" vs "N° documento").
export function revisarExtraccion(data, seguimiento = false) {
  const d = data || {};
  const esCotizacion = !!seguimiento;
  const tipoCotizacion = d.tipo === "cotizacion";

  const missing = [];
  if (!d.cliente) missing.push("cliente");
  if (!d.numeroFactura) missing.push(tipoCotizacion ? "número" : "N° documento");
  if (!d.telefono) missing.push("teléfono");
  if (!d.vendedor) missing.push("vendedor");
  if (!d.total) missing.push("total");

  const lineasIgnoradas = d.lineasIgnoradas || [];
  const hayIgnoradas = lineasIgnoradas.length > 0;

  // El lector no sacó NI UN producto. Es el fallo más peligroso del parser y era
  // el único que pasaba callado: `missing` avisa de cliente, número, teléfono,
  // vendedor y total, pero nunca de los productos. Un PDF con el encabezado de
  // tabla cambiado devuelve cero productos Y cero lineasIgnoradas —no hay tramo
  // de tabla, así que no hay nada que reportar— y la tarjeta se veía normal, con
  // un discreto "Productos (0)". El pedido se guardaba vacío y el camión salía
  // sin nada.
  //
  // Cuando además hay líneas ignoradas, esa alarma ya lo dice (y ya trae su
  // casilla), así que esta solo aparece en el caso silencioso.
  const sinProductos = (d.productos || []).length === 0;
  const alarmaSinProductos = sinProductos && !hayIgnoradas;

  return { esCotizacion, tipoCotizacion, missing, lineasIgnoradas, hayIgnoradas, sinProductos, alarmaSinProductos };
}

// Por qué NO se puede guardar todavía, o null si se puede.
//
// El orden de las guardas es el que ve el usuario: se le señala primero lo que
// tiene que arreglar (vehículo, cliente) y solo después lo que tiene que
// confirmar. Devolver el mensaje en vez de un booleano es lo que permite probar
// que cada caso avisa de lo suyo.
export function motivoBloqueo(data, { seguimiento = false, ack = false, ackDup = false, duplicado = null } = {}) {
  const d = data || {};
  const { esCotizacion, hayIgnoradas, alarmaSinProductos } = revisarExtraccion(d, seguimiento);

  // El vehículo solo se exige en despacho: un seguimiento de cotización no
  // despacha nada. Y tampoco se exige si el pedido va sin fecha definida
  // (Pendientes / Por viaje), que no ocupan columna de tablero.
  if (!esCotizacion && !d.sinFechaDefinida && !d.vehiculo) return "Selecciona un vehículo antes de guardar";
  if (!d.cliente || !String(d.cliente).trim()) return "Escribe el nombre del cliente antes de guardar";
  if (hayIgnoradas && !ack) return "Confirma que revisarás el material que no se pudo leer";
  if (alarmaSinProductos && !ack) return "No se leyó ningún material: confirma que lo revisarás en el PDF";
  if (duplicado && !ackDup) return "Ese número ya existe: confirma que quieres guardarlo igual";
  return null;
}
