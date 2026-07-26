// supabaseClient.js
//
// Reemplaza a window.storage (que solo existe dentro de artifacts de
// Claude.ai) por llamadas reales a Supabase. Las funciones de abajo
// imitan la forma de trabajar que ya tenía la app (cargar todo al
// inicio, guardar la lista completa cada vez que cambia), para no
// tener que reescribir la lógica de DespachoPedidos.jsx.

import { createClient } from "@supabase/supabase-js";
import { maxRemisionDeNumeros } from "./remisiones.js";

// URL y llave pública. Se leen de variables de entorno si existen, y si no se
// usan las de siempre, para que un despliegue sin configurar no rompa la app.
//
// Aclaración honesta: esto NO vuelve secreta la llave. Toda llave "publishable"
// termina en el bundle del navegador y así debe ser — es pública por diseño. El
// valor real de tenerla en variable de entorno es poder ROTARLA sin recompilar
// el fuente, y que el repositorio deje de apuntar directo a tu proyecto.
//
// Lo que de verdad protege los datos son las políticas RLS de
// sql/rls-politicas.sql más el login. Sin eso, la llave abre la puerta entera.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://algzltupasibksbnmlrg.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_qyROZeNMERQlLjHQqYJC0g_nIeW5i7c";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Estos tres son los que hacen que NO haya que escribir la clave cada vez:
    // la sesión queda guardada en el navegador (persistSession) y el token se
    // renueva solo en segundo plano antes de vencer (autoRefreshToken). El
    // usuario entra UNA vez por dispositivo y no vuelve a ver el login, ni al
    // refrescar (F5), ni al cerrar el navegador, ni al mes siguiente.
    persistSession: true,
    autoRefreshToken: true,
    // La app no usa enlaces mágicos ni OAuth; no hay tokens que leer de la URL.
    detectSessionInUrl: false,
  },
});

// --- Verificación del esquema ---

// Columnas que agrega sql/tanda2-historial-remisiones.sql. Si el SQL no se
// corrió, la app da errores raros al guardar ("column does not exist") que no
// dicen qué hacer. Esto se consulta una vez al abrir y devuelve la lista de las
// que falten, para poder mostrar un aviso que SÍ diga qué hacer.
const COLUMNAS_NUEVAS = [
  ["pedidos", "remision_de_id"],
  ["cotizaciones", "pedido_id"],
];

export async function columnasFaltantes() {
  const faltan = [];
  for (const [tabla, columna] of COLUMNAS_NUEVAS) {
    const { error } = await supabase.from(tabla).select(columna).limit(1);
    // Solo nos interesa el error de "columna inexistente" (42703). Un fallo de
    // red o de permisos no significa que falte la columna.
    if (error && (error.code === "42703" || String(error.message || "").includes(columna))) {
      faltan.push(`${tabla}.${columna}`);
    }
  }
  return faltan;
}

// --- Sesión (login con cuenta compartida de la ferretería) ---

// Devuelve la sesión guardada, o null. Se llama una vez al abrir la app para
// decidir si mostrar el tablero o el login.
export async function sesionActual() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

// Avisa cuando la sesión cambia (entrar, salir, renovar token). Devuelve la
// función para desuscribirse.
export function alCambiarSesion(callback) {
  const { data } = supabase.auth.onAuthStateChange((_evento, sesion) => callback(sesion));
  return () => data.subscription.unsubscribe();
}

export async function entrar(correo, clave) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(correo || "").trim(),
    password: String(clave || ""),
  });
  if (error) throw error;
  return data.session;
}

export async function salir() {
  await supabase.auth.signOut();
}

// Columnas que se cargan al abrir la app. Deliberadamente NO incluimos
// "pdf_data_url": ese PDF va en base64 y pesa 1-3 MB por pedido, así que
// traerlo de todos los pedidos e historial en cada carga descarga decenas
// de MB inútiles (el PDF solo se ve al abrir el visor o descargar).
// En su lugar traemos la columna generada "tiene_pdf" (un booleano) para
// saber si mostrar el botón "Ver documento", y cargamos el PDF bajo
// demanda con cargarPdfPedido / cargarPdfCotizacion.
const COLUMNAS_PEDIDO =
  "id, tipo_documento, numero_factura, cliente, telefono, telefono_contacto, direccion, vendedor, total, productos, vehiculo, vehiculo_secundario, destino, entrega_pendiente, nota_pendiente, file_name, fecha, fecha_despacho, hora, orden, estado, estado_pago, entregado_en, fecha_entrega, tiene_pdf, remision_de, remision_de_id, grupo_id, flete_externo";
const COLUMNAS_COTIZACION =
  "id, numero_cotizacion, cliente, telefono, telefono_contacto, direccion, vendedor, total, productos, file_name, fecha, estado, fecha_seguimiento, fecha_vencimiento, notas, motivo_rechazo, tiene_pdf, created_at, pedido_id";

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
    // Se sigue guardando porque es lo que se imprime en la tirilla.
    remisionDe: fila.remision_de,
    // id de la factura madre. Es el enlace REAL entre remisión y factura.
    // remision_de (el número) no sirve como enlace: si se corrige el número de
    // la factura en "Editar", todas sus remisiones quedaban huérfanas —el
    // contador volvía a "Sin remisiones" y la factura se marcaba "Estancada"
    // aunque se hubiera movido ayer— y todas las facturas sin número compartían
    // el texto "s/n", cruzando remisiones entre clientes distintos.
    remisionDeId: fila.remision_de_id,
    // Facturas con el mismo grupo_id son un solo "viaje juntado": se muestran
    // como una tarjeta y se entregan juntas. null en pedidos sueltos.
    grupoId: fila.grupo_id,
    // true si el flete de este pedido lo cobró un tercero (ej. el motero
    // externo que recoge el pedido), no la ferretería. Se usa para separar
    // "fletes tuyos" de "fletes de terceros" en el reporte del Panel.
    fleteExterno: !!fila.flete_externo,
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
    remision_de_id: p.remisionDeId || null,
    grupo_id: p.grupoId || null,
    flete_externo: !!p.fleteExterno,
  };
  // Solo mandamos pdf_data_url cuando el pedido realmente lo tiene en memoria
  // (pedido nuevo recién subido). Si es undefined significa "no lo cargué" —
  // NO lo incluimos, para que un update/upsert no borre el PDF ya guardado.
  // (tiene_pdf es una columna generada por la BD; nunca la escribimos.)
  if (p.pdfDataUrl !== undefined) fila.pdf_data_url = p.pdfDataUrl;
  return fila;
}

// ---------------------------------------------------------------------
// Paginación: por qué existe
// ---------------------------------------------------------------------
// PostgREST (la API de Supabase) NO devuelve filas sin límite: corta la
// respuesta en el "max-rows" del proyecto (1.000 por defecto) y **no avisa**.
// Devuelve 200 con menos filas de las que hay.
//
// Antes esto se pedía de un solo tirón. Con 175 pedidos no dolía, pero al pasar
// de 1.000 el historial se habría empezado a truncar EN SILENCIO, y eso no da un
// error rojo: da números mentirosos. El Panel mostrando menos kilos de los
// reales, y la numeración de remisiones calculada sobre una lista incompleta
// (ver maxNumeroRemision). El síntoma no se habría parecido a la causa.
//
// Esta función pide por tandas hasta que la base deja de devolver filas, así
// que ya no hay techo silencioso.
const TAMANO_PAGINA = 1000;

async function traerTodo(construirConsulta) {
  const filas = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await construirConsulta().range(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw error;
    const tanda = data || [];
    filas.push(...tanda);
    // Si la tanda vino incompleta, ya no hay más que pedir.
    if (tanda.length < TAMANO_PAGINA) break;
  }
  return filas;
}

// Carga los pedidos activos (los que se ven en las 3 columnas de despacho).
export async function cargarPedidosActivos() {
  const filas = await traerTodo(() => supabase.from("pedidos").select(COLUMNAS_PEDIDO).eq("estado", "activo"));
  return filas.map(filaAPedido);
}

// Cuántos días de historial se precargan al abrir la app.
//
// El historial completo NO se necesita para trabajar: el Panel mira el día, la
// tendencia de 14 días y el promedio de 30. Traerlo todo era, a 50 entregas
// diarias, bajar decenas de MB en cada apertura — en el celular del despachador
// con datos móviles, peor que el problema que resolvía.
//
// Para buscar una factura vieja no hace falta tenerla cargada: buscarHistorial()
// consulta contra el servidor y encuentra en TODO el historial, sin límite de
// fecha (antes el buscador solo encontraba entre lo que estuviera en memoria,
// así que esto además mejora lo que había).
export const DIAS_HISTORIAL_PRECARGADO = 90;

// Carga el historial reciente (pedidos ya entregados).
export async function cargarHistorial({ diasAtras = DIAS_HISTORIAL_PRECARGADO } = {}) {
  const corte = new Date(Date.now() - diasAtras * 86400000).toISOString();
  const filas = await traerTodo(() =>
    supabase
      .from("pedidos")
      .select(COLUMNAS_PEDIDO)
      .eq("estado", "entregado")
      // Se incluyen también las filas con entregado_en nulo: son pedidos
      // anteriores a que existiera ese campo (solo tienen fecha_entrega como
      // texto "DD/MM/AAAA", que no se puede comparar por fecha en SQL). Es un
      // conjunto CERRADO que no vuelve a crecer —todo pedido nuevo guarda
      // entregado_en—, así que no reintroduce el problema del historial infinito,
      // y evita que esos pedidos desaparezcan del Panel de un día para otro.
      .or(`entregado_en.gte.${corte},entregado_en.is.null`)
  );
  return filas.map(filaAPedido);
}

// Busca en TODO el historial contra el servidor, sin importar si está precargado.
// Se usa en la pestaña Historial: antes filtraba un arreglo en memoria, así que
// solo encontraba lo que se hubiera cargado.
export async function buscarHistorial(texto) {
  const q = String(texto || "").trim();
  if (!q) return [];
  // El % de PostgREST hay que escaparlo, y la coma parte la lista de filtros
  // del .or() — sin esto, buscar "a,b" produce un filtro inválido.
  const seguro = q.replace(/[%,()]/g, " ");
  const { data, error } = await supabase
    .from("pedidos")
    .select(COLUMNAS_PEDIDO)
    .eq("estado", "entregado")
    .or(`cliente.ilike.%${seguro}%,numero_factura.ilike.%${seguro}%`)
    .order("entregado_en", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map(filaAPedido);
}

// Número de remisión más alto que existe EN LA BASE (no en la lista cargada).
//
// Antes el correlativo se calculaba con el máximo de lo que hubiera en memoria
// (pedidos + historial). Eso tenía dos fallas: con dos dispositivos creando
// remisiones a la vez salía el mismo número, y —peor— cuando el historial dejara
// de cargarse completo, el máximo se habría calculado sobre datos incompletos y
// los números se habrían RECICLADO: dos tirillas firmadas por clientes distintos
// con el mismo REM.
//
// Se traen solo los números (una columna de texto, unos pocos KB) y se saca el
// máximo NUMÉRICAMENTE. Ordenar por texto en SQL no sirve: "REM-9999" ordena
// después de "REM-10000".
export async function maxNumeroRemision() {
  const filas = await traerTodo(() =>
    supabase.from("pedidos").select("numero_factura").like("numero_factura", "REM-%")
  );
  return maxRemisionDeNumeros(filas.map((f) => f.numero_factura));
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

// Mueve un pedido que YA EXISTE a otro estado ("entregado" / "activo").
//
// La diferencia con guardarPedido importa con varios dispositivos abiertos: el
// upsert de guardarPedido RESUCITA la fila si otro dispositivo ya la borró —el
// pedido reaparecía en el historial como entregado, con los datos viejos que
// tuviera en memoria—. Un update no puede crear nada: si la fila no está, no
// pasa nada y se avisa.
//
// Devuelve true si de verdad movió una fila, false si ya no existía.
export async function moverPedidoAEstado(pedido, estado) {
  const fila = pedidoAFila(pedido, estado);
  delete fila.id;
  const { data, error } = await supabase.from("pedidos").update(fila).eq("id", pedido.id).select("id");
  if (error) throw error;
  return (data || []).length > 0;
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
    // Pedido de despacho que se generó desde esta cotización (botón "Aceptar y
    // despachar"). null = todavía no ha pasado a despacho.
    pedidoId: fila.pedido_id,
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
    pedido_id: c.pedidoId || null,
    updated_at: new Date().toISOString(),
  };
  // Igual que en pedidos: solo escribimos el PDF si está en memoria, para no
  // borrarlo al actualizar una cotización cuyo PDF nunca se cargó.
  if (c.pdfDataUrl !== undefined) fila.pdf_data_url = c.pdfDataUrl;
  return fila;
}

// Igual que COLUMNAS_COTIZACION pero sin "pedido_id": es el respaldo para
// cuando la app nueva se despliega ANTES de correr sql/rls-politicas.sql (que es
// el que crea esa columna). Sin esto, el select entero falla con "column does
// not exist" y el tablero de cotizaciones aparece vacío con un error — un
// desplieque en el orden equivocado dejaba la pantalla caída.
const COLUMNAS_COTIZACION_SIN_PEDIDO = COLUMNAS_COTIZACION.replace(", pedido_id", "");

// Carga todas las cotizaciones.
export async function cargarCotizaciones() {
  const { data, error } = await supabase
    .from("cotizaciones")
    .select(COLUMNAS_COTIZACION)
    .order("created_at", { ascending: false });

  if (error) {
    // ¿Falta la columna pedido_id (SQL sin correr)? Reintentamos sin ella para
    // que la pantalla siga sirviendo. El botón "Aceptar y despachar" sí va a
    // fallar hasta que se corra el SQL, pero avisa y no daña nada.
    const msg = String((error && error.message) || "");
    if (/pedido_id/i.test(msg)) {
      console.warn("Falta la columna pedido_id: corre sql/rls-politicas.sql. Cargando cotizaciones sin ella.");
      const reintento = await supabase
        .from("cotizaciones")
        .select(COLUMNAS_COTIZACION_SIN_PEDIDO)
        .order("created_at", { ascending: false });
      if (reintento.error) throw reintento.error;
      return (reintento.data || []).map(filaACotizacion);
    }
    throw error;
  }
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
