// supabaseClient.js
//
// Reemplaza a window.storage (que solo existe dentro de artifacts de
// Claude.ai) por llamadas reales a Supabase. Las funciones de abajo
// imitan la forma de trabajar que ya tenía la app (cargar todo al
// inicio, guardar la lista completa cada vez que cambia), para no
// tener que reescribir la lógica de DespachoPedidos.jsx.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://algzltupasibksbnmlrg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qyROZeNMERQlLjHQqYJC0g_nIeW5i7c";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Columnas que se cargan al abrir la app. Deliberadamente NO incluimos
// "pdf_data_url": ese PDF va en base64 y pesa 1-3 MB por pedido, así que
// traerlo de todos los pedidos e historial en cada carga descarga decenas
// de MB inútiles (el PDF solo se ve al abrir el visor o descargar).
// En su lugar traemos la columna generada "tiene_pdf" (un booleano) para
// saber si mostrar el botón "Ver documento", y cargamos el PDF bajo
// demanda con cargarPdfPedido / cargarPdfCotizacion.
const COLUMNAS_PEDIDO =
  "id, tipo_documento, numero_factura, cliente, telefono, telefono_contacto, direccion, vendedor, total, productos, vehiculo, vehiculo_secundario, destino, entrega_pendiente, nota_pendiente, file_name, fecha, fecha_despacho, hora, orden, estado, estado_pago, entregado_en, fecha_entrega, tiene_pdf, remision_de";
const COLUMNAS_COTIZACION =
  "id, numero_cotizacion, cliente, telefono, telefono_contacto, direccion, vendedor, total, productos, file_name, fecha, estado, fecha_seguimiento, fecha_vencimiento, notas, motivo_rechazo, tiene_pdf, created_at";

// Convierte una fila de la tabla "pedidos" (snake_case, como vive en la
// base de datos) al formato que usa el componente React (camelCase).
function filaAPedido(fila) {
  return {
    id: fila.id,
    tipoDocumento: fila.tipo_documento,
    numeroFactura: fila.numero_factura,
    cliente: fila.cliente,
    telefono: fila.telefono,
    telefonoContacto: fila.telefono_contacto,
    direccion: fila.direccion,
    vendedor: fila.vendedor,
    total: fila.total,
    productos: fila.productos || [],
    vehiculo: fila.vehiculo,
    vehiculoSecundario: fila.vehiculo_secundario,
    destino: fila.destino,
    entregaPendiente: fila.entrega_pendiente,
    notaPendiente: fila.nota_pendiente,
    // pdfDataUrl queda undefined en la carga de listas (no lo pedimos); se
    // llena bajo demanda. tienePdf dice si existe sin traer el PDF completo.
    pdfDataUrl: fila.pdf_data_url,
    tienePdf: fila.tiene_pdf,
    fileName: fila.file_name,
    fecha: fila.fecha,
    fechaDespacho: fila.fecha_despacho,
    hora: fila.hora,
    orden: fila.orden,
    estadoPago: fila.estado_pago,
    entregadoEn: fila.entregado_en,
    fechaEntrega: fila.fecha_entrega,
    // De qué factura viene esta remisión (número de la factura madre). null en
    // pedidos normales. Ver flujo de remisiones en DespachoPedidos.jsx.
    remisionDe: fila.remision_de,
  };
}

// Convierte un pedido del formato del componente (camelCase) al formato
// de la tabla (snake_case) para guardarlo.
function pedidoAFila(p, estado) {
  const fila = {
    id: p.id,
    tipo_documento: p.tipoDocumento,
    numero_factura: p.numeroFactura,
    cliente: p.cliente,
    telefono: p.telefono,
    telefono_contacto: p.telefonoContacto,
    direccion: p.direccion,
    vendedor: p.vendedor,
    total: p.total,
    productos: p.productos || [],
    vehiculo: p.vehiculo,
    vehiculo_secundario: p.vehiculoSecundario || null,
    destino: p.destino || null,
    entrega_pendiente: p.entregaPendiente || false,
    nota_pendiente: p.notaPendiente || null,
    file_name: p.fileName,
    fecha: p.fecha,
    fecha_despacho: p.fechaDespacho,
    hora: p.hora,
    orden: p.orden,
    estado,
    estado_pago: p.estadoPago || "pendiente",
    entregado_en: p.entregadoEn || null,
    fecha_entrega: p.fechaEntrega || null,
    remision_de: p.remisionDe || null,
  };
  // Solo mandamos pdf_data_url cuando el pedido realmente lo tiene en memoria
  // (pedido nuevo recién subido). Si es undefined significa "no lo cargué" —
  // NO lo incluimos, para que un update/upsert no borre el PDF ya guardado.
  // (tiene_pdf es una columna generada por la BD; nunca la escribimos.)
  if (p.pdfDataUrl !== undefined) fila.pdf_data_url = p.pdfDataUrl;
  return fila;
}

// Carga los pedidos activos (los que se ven en las 3 columnas de despacho).
export async function cargarPedidosActivos() {
  const { data, error } = await supabase.from("pedidos").select(COLUMNAS_PEDIDO).eq("estado", "activo");
  if (error) throw error;
  return (data || []).map(filaAPedido);
}

// Carga el historial (pedidos ya entregados).
export async function cargarHistorial() {
  const { data, error } = await supabase.from("pedidos").select(COLUMNAS_PEDIDO).eq("estado", "entregado");
  if (error) throw error;
  return (data || []).map(filaAPedido);
}

// Trae el PDF (base64) de un pedido, bajo demanda, al abrir el visor o
// descargar. Devuelve la cadena data-url o null si no hay documento.
export async function cargarPdfPedido(id) {
  const { data, error } = await supabase.from("pedidos").select("pdf_data_url").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data && data.pdf_data_url) || null;
}

// Guarda (crea o actualiza) un pedido individual. Usamos "upsert" porque
// no nos importa si ya existía o no: si existe lo actualiza, si no, lo crea.
export async function guardarPedido(pedido, estado = "activo") {
  const { error } = await supabase.from("pedidos").upsert(pedidoAFila(pedido, estado));
  if (error) throw error;
}

// Actualiza un pedido EXISTENTE (editar, reordenar, mover de vehículo) sin
// tocar su columna "estado" y sin recrear filas. La diferencia con el upsert
// de guardarPedido importa cuando hay varios dispositivos abiertos a la vez:
// si otro dispositivo ya borró o entregó este pedido, un update sobre una
// fila inexistente (o ya entregada) no la resucita como "activo" — el upsert
// sí lo hacía, recreando pedidos borrados con los datos viejos en memoria.
export async function actualizarPedido(pedido) {
  const fila = pedidoAFila(pedido, "activo");
  delete fila.estado;
  delete fila.id;
  const { error } = await supabase.from("pedidos").update(fila).eq("id", pedido.id);
  if (error) throw error;
}

// Elimina un pedido por completo (se usa al borrar desde la app).
export async function eliminarPedido(id) {
  const { error } = await supabase.from("pedidos").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Cotizaciones (módulo independiente de despacho/pedidos).
// ---------------------------------------------------------------------

// Convierte una fila de la tabla "cotizaciones" (snake_case) al formato
// que usa el componente React (camelCase).
function filaACotizacion(fila) {
  return {
    id: fila.id,
    numeroFactura: fila.numero_cotizacion,
    cliente: fila.cliente,
    telefono: fila.telefono,
    telefonoContacto: fila.telefono_contacto,
    direccion: fila.direccion,
    vendedor: fila.vendedor,
    total: fila.total,
    productos: fila.productos || [],
    pdfDataUrl: fila.pdf_data_url,
    tienePdf: fila.tiene_pdf,
    fileName: fila.file_name,
    fecha: fila.fecha,
    estado: fila.estado,
    fechaSeguimiento: fila.fecha_seguimiento,
    fechaVencimiento: fila.fecha_vencimiento,
    notas: fila.notas,
    motivoRechazo: fila.motivo_rechazo,
  };
}

// Convierte una cotización del formato del componente (camelCase) al
// formato de la tabla (snake_case) para guardarla.
function cotizacionAFila(c) {
  const fila = {
    id: c.id,
    numero_cotizacion: c.numeroFactura,
    cliente: c.cliente,
    telefono: c.telefono,
    telefono_contacto: c.telefonoContacto,
    direccion: c.direccion,
    vendedor: c.vendedor,
    total: c.total,
    productos: c.productos || [],
    file_name: c.fileName,
    fecha: c.fecha,
    estado: c.estado || "pendiente",
    fecha_seguimiento: c.fechaSeguimiento || null,
    fecha_vencimiento: c.fechaVencimiento || null,
    notas: c.notas || null,
    motivo_rechazo: c.motivoRechazo || null,
    updated_at: new Date().toISOString(),
  };
  // Igual que en pedidos: solo escribimos el PDF si está en memoria, para no
  // borrarlo al actualizar una cotización cuyo PDF nunca se cargó.
  if (c.pdfDataUrl !== undefined) fila.pdf_data_url = c.pdfDataUrl;
  return fila;
}

// Carga todas las cotizaciones.
export async function cargarCotizaciones() {
  const { data, error } = await supabase
    .from("cotizaciones")
    .select(COLUMNAS_COTIZACION)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(filaACotizacion);
}

// Trae el PDF (base64) de una cotización, bajo demanda. Devuelve la cadena
// data-url o null si no hay documento.
export async function cargarPdfCotizacion(id) {
  const { data, error } = await supabase.from("cotizaciones").select("pdf_data_url").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data && data.pdf_data_url) || null;
}

// Guarda (crea o actualiza) una cotización. Igual que con pedidos,
// usamos "upsert": si existe la actualiza, si no, la crea.
export async function guardarCotizacion(cotizacion) {
  const { error } = await supabase.from("cotizaciones").upsert(cotizacionAFila(cotizacion));
  if (error) throw error;
}

// Elimina una cotización por completo.
export async function eliminarCotizacion(id) {
  const { error } = await supabase.from("cotizaciones").delete().eq("id", id);
  if (error) throw error;
}
