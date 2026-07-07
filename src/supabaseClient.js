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
    pdfDataUrl: fila.pdf_data_url,
    fileName: fila.file_name,
    fecha: fila.fecha,
    fechaDespacho: fila.fecha_despacho,
    hora: fila.hora,
    orden: fila.orden,
    estadoPago: fila.estado_pago,
    entregadoEn: fila.entregado_en,
    fechaEntrega: fila.fecha_entrega,
  };
}

// Convierte un pedido del formato del componente (camelCase) al formato
// de la tabla (snake_case) para guardarlo.
function pedidoAFila(p, estado) {
  return {
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
    pdf_data_url: p.pdfDataUrl,
    file_name: p.fileName,
    fecha: p.fecha,
    fecha_despacho: p.fechaDespacho,
    hora: p.hora,
    orden: p.orden,
    estado,
    estado_pago: p.estadoPago || "pendiente",
    entregado_en: p.entregadoEn || null,
    fecha_entrega: p.fechaEntrega || null,
  };
}

// Carga los pedidos activos (los que se ven en las 3 columnas de despacho).
export async function cargarPedidosActivos() {
  const { data, error } = await supabase.from("pedidos").select("*").eq("estado", "activo");
  if (error) throw error;
  return (data || []).map(filaAPedido);
}

// Carga el historial (pedidos ya entregados).
export async function cargarHistorial() {
  const { data, error } = await supabase.from("pedidos").select("*").eq("estado", "entregado");
  if (error) throw error;
  return (data || []).map(filaAPedido);
}

// Guarda (crea o actualiza) un pedido individual. Usamos "upsert" porque
// no nos importa si ya existía o no: si existe lo actualiza, si no, lo crea.
export async function guardarPedido(pedido, estado = "activo") {
  const { error } = await supabase.from("pedidos").upsert(pedidoAFila(pedido, estado));
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
  return {
    id: c.id,
    numero_cotizacion: c.numeroFactura,
    cliente: c.cliente,
    telefono: c.telefono,
    telefono_contacto: c.telefonoContacto,
    direccion: c.direccion,
    vendedor: c.vendedor,
    total: c.total,
    productos: c.productos || [],
    pdf_data_url: c.pdfDataUrl,
    file_name: c.fileName,
    fecha: c.fecha,
    estado: c.estado || "pendiente",
    fecha_seguimiento: c.fechaSeguimiento || null,
    fecha_vencimiento: c.fechaVencimiento || null,
    notas: c.notas || null,
    motivo_rechazo: c.motivoRechazo || null,
    updated_at: new Date().toISOString(),
  };
}

// Carga todas las cotizaciones.
export async function cargarCotizaciones() {
  const { data, error } = await supabase
    .from("cotizaciones")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(filaACotizacion);
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
