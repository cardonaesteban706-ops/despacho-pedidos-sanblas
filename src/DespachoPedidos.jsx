import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cargarPedidosActivos, cargarHistorial, guardarPedido, actualizarPedido, eliminarPedido, cargarPdfPedido } from "./supabaseClient";
import { cargarCotizaciones, guardarCotizacion, eliminarCotizacion, cargarPdfCotizacion } from "./supabaseClient";
import { buscarHistorial, maxNumeroRemision, columnasFaltantes, moverPedidoAEstado, salir, DIAS_HISTORIAL_PRECARGADO } from "./supabaseClient";
import PanelResumen from "./PanelResumen.jsx";
import PorEntregar from "./PorEntregar.jsx";
import ExtractReviewCard, { ExtractReviewCardCotizacion } from "./ExtractReviewCard.jsx";
// Modales y tarjetas extraídos del monolito. Son componentes hoja: reciben props
// simples y no tocan el estado de despacho, así que salir de acá no cambió nada
// de lo que hacen. TirillaModal se llevó además su propio CSS de impresión, y
// PedidoCard su CARD_CSS (que se sigue inyectando UNA sola vez desde acá: con 50
// pedidos, una etiqueta de estilos por tarjeta serían 50 copias en el DOM).
import ModalOverlay from "./ModalOverlay.jsx";
import TirillaModal from "./TirillaModal.jsx";
import MotivoRechazoModal from "./MotivoRechazoModal.jsx";
import MaterialPorUnidadesModal from "./MaterialPorUnidadesModal.jsx";
import DescontarMaterialModal from "./DescontarMaterialModal.jsx";
import PdfModal from "./PdfModal.jsx";
import RemisionManualModal from "./RemisionManualModal.jsx";
import DestinoSelector from "./DestinoSelector.jsx";
import PedidoCard, { CARD_CSS } from "./PedidoCard.jsx";
import GrupoCard from "./GrupoCard.jsx";
import HistorialRow from "./HistorialRow.jsx";
import CotizacionCard, { ESTADOS_COTIZACION_BADGE, ESTADOS_COTIZACION_BADGE_KEYS } from "./CotizacionCard.jsx";
import {
  parseCantidad,
  cantidadNum,
  saldoDe,
  entregadoParaPanelDe,
  topeEditableDe,
  valorInicialMaterialDe,
  aplicarEntregadoDirecto,
  sumarEntregadoDirecto,
  cerrarEntregaCompleta,
  faltantesDeProductos,
  notaDesdeFaltantes,
} from "./saldo.js";
// Kilos: lógica pura y testeada (peso.test.mjs). Salió del monolito porque las
// tarjetas la necesitaban y las tenía amarradas acá.
import { cargaDePedido, cargaPorEntregar, categoriaDeProducto, pesoDeProducto, cantidadEntregadaDe } from "./peso.js";
// Deshacer un cambio optimista con operaciones RELATIVAS al estado actual, en
// vez de restaurar una foto de la lista entera. Ver la cabecera de listas.js.
import { quitarPorId, reponerPorId, reemplazarPorId } from "./listas.js";
// Constantes y helpers puros (antes acá arriba). Se movieron a constants.js para
// romper la importación circular con ExtractReviewCard.jsx.
import {
  VEHICULOS,
  DESTINOS,
  MARCA,
  uid,
  formatCOP,
  formatCantidad,
  normalizarTexto,
  esLineaFlete,
  todayStr,
  todayISO,
  addDaysISO,
  formatFechaCorta,
  etiquetaFecha,
  nowTimeStr,
  compararOrden,
} from "./constants.js";
// Lectura y parseo de PDF (antes acá arriba, ~340 líneas). El parseo vive en un
// módulo puro y testeado (pdfParser.test.mjs, `npm test`); la lectura del PDF
// está aparte porque es la única parte que necesita pdf.js.
import { extractPdfLines } from "./pdfExtract.js";
import { parseDocumento } from "./pdfParser.js";
// Reglas de remisión (enlace madre-hija y correlativo REM), con tests.
import { remisionesDe, maxRemisionDeNumeros, formatearNumeroRemision } from "./remisiones.js";

// Se siguen re-exportando para no romper nada que los importara desde acá.
export { VEHICULOS, DESTINOS, formatCOP, esLineaFlete, todayISO, addDaysISO };





// Cuánto tiempo se puede deshacer un pedido borrado antes de que se elimine
// de verdad de la base de datos.
const VENTANA_DESHACER_MS = 8000;

// Columnas del tablero de cotizaciones. A nivel de módulo (igual que
// VEHICULOS): es una constante y no hay razón para recrearla en cada render.
const ESTADOS_COTIZACION = [
  { id: "pendiente", label: "Pendiente", icon: "ti-clock", bg: "#FAEEDA", border: "#BA7517", text: "#633806" },
  { id: "aceptada", label: "Aceptada", icon: "ti-check", bg: "#EAF3DE", border: "#639922", text: "#27500A" },
  { id: "rechazada", label: "Rechazada", icon: "ti-x", bg: "#FBE6E6", border: "#CC3333", text: "#7A1F1F" },
];







// parseCantidad / cantidadNum y toda la regla del saldo viven en saldo.js: es
// la fuente ÚNICA de verdad. Antes esa regla estaba copiada en seis sitios y
// cada desvío entre copias producía un bug de saldo (ver el encabezado de
// saldo.js). Se importan arriba.



// ---------------------------------------------------------------------
// Panel (resumen del día): PIN de acceso y pesos de material.
// ---------------------------------------------------------------------

// PIN para entrar al Panel. Es una BARRERA VISUAL para que el personal no vea
// los números, NO una seguridad real: la app usa la llave pública de Supabase,
// así que alguien con conocimiento técnico podría saltárselo. Para blindarlo de
// verdad habría que migrar a login por usuario. Cambia el valor por el que quieras.
// Se puede cambiar sin tocar el código, poniendo VITE_PIN_PANEL en Vercel
// (Project Settings -> Environment Variables). Si no está, queda "1234".
//
// Sigue siendo una BARRERA VISUAL, no seguridad: el PIN termina en el bundle del
// navegador y alguien con conocimiento técnico lo encuentra. Su trabajo es que el
// personal no vea los números del Panel de refilón, y para eso alcanza —ahora que
// RLS está cerrado, nadie de afuera puede sacar los datos por otra vía.
// Blindarlo de verdad pediría usuarios con roles distintos.
const PIN_PANEL = import.meta.env.VITE_PIN_PANEL || "1234";

// Peso (en kg) de UNA unidad de material tal como sale en la factura —un bulto,
// una varilla, un bloque…—, según fichas técnicas colombianas. La "carga" del
// día son los kilos movidos = peso × cantidad, sumados. Ajusta los kg o agrega
// categorías cuando haga falta. El ORDEN importa: se usa la primera categoría
// cuya palabra clave aparezca en la descripción, así que las más específicas
// (bloque, ladrillo, pegante) van antes que las genéricas (cemento).








// Cantidad que de verdad se entregó de una línea: si el despachador marcó
// "Material entregado" (cantidadEntregada), esa es la verdad; si no, se asume
// que se entregó todo lo facturado. El Panel usa SIEMPRE esta cantidad — contar
// lo facturado inflaba los kilos cuando la entrega fue incompleta, y contaba
// doble a las facturas madre archivadas (su material ya salió vía remisiones).
// Al cerrar un pedido (botón "Entregado") se deja registrado que salió TODO lo
// facturado. Sin esto, un pedido entregado en dos viajes conservaba el
// cantidadEntregada del primer viaje (ej. 570 de 900) y el Panel contaba ese
// número el día del cierre, perdiendo el resto para siempre. Las facturas
// madre (las que llevan saldo de remisiones) NO se tocan: su material ya se
// contó al salir cada remisión.

// Copia 1 de 6 -> saldo.js. Ojo: para el Panel, una línea NUNCA tocada cuenta
// como entregada completa (así el historial viejo no se vacía retroactivamente).
// Esa asimetría está explicada en entregadoParaPanelDe().

// Kilos de una línea de producto: peso unitario de su categoría × cantidad
// realmente entregada. (Solo se usa en el Panel, sobre el historial.)
// Peso de UNA unidad del producto, en kilos. Se resuelve en tres pasos, del
// más exacto al más aproximado:
//   1) el peso escrito en la propia descripción ("50 KG", "42,5 KG", "X 2 Kg").
//      Es el caso más común y el más confiable: el mismo cemento viene en
//      bultos de 50 y de 42,5, así que una tabla fija se quedaba corta.
//   2) varilla: se calcula el peso real del acero con su diámetro y su largo,
//      así no hay que mantener una lista de calibres.
//   3) si no, el peso por categoría de CATEGORIAS_PESO (aproximado).


// Kilos totales de un pedido: suma de todas sus líneas.

// Copia 2 de 6 -> saldo.js.

// Kilos de lo que TODAVÍA hay que subir al vehículo. Es el número de la
// tarjeta y el que se compara contra la capacidad del camión: si ya salieron
// remisiones, ese peso ya no cuenta porque ese material no está en la bodega.

// Día local de Colombia (YYYY-MM-DD) en que se entregó el pedido. Preferimos
// entregadoEn (timestamp exacto); si es un pedido viejo sin ese dato, caemos a
// fechaEntrega ("DD/MM/YYYY" es-CO). Devuelve null si no hay ninguno.
function fechaEntregaISO(pedido) {
  if (pedido && pedido.entregadoEn) {
    const dt = new Date(pedido.entregadoEn);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    }
  }
  if (pedido && pedido.fechaEntrega && pedido.fechaEntrega.includes("/")) {
    const [d, m, y] = pedido.fechaEntrega.split("/");
    if (d && m && y) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

// Traduce la carga del día (kilos) frente al promedio en un veredicto claro:
// "Día fuerte / normal / flojo" con una frase que lo explica en palabras. Si
// todavía no hay promedio (pocos días de historial), lo dice honestamente.

// Seguimiento de material por unidades: un producto "tocado" tiene el campo
// cantidadEntregada. Devuelve los productos donde se entregaron MENOS unidades
// que las de la factura (con cuántas faltan). Un pedido sin ningún producto
// tocado devuelve lista vacía y se comporta como siempre.

// Nota de texto (mismo formato de siempre: "2 tejas; 1 bulto cemento") armada
// a partir de los faltantes por unidades. Se usa al pasar un pedido de
// "Pendientes" a despacho, para no tener que reescribir la nota a mano.











// Guía de carga interna: NO es una factura ni la reemplaza (no lleva CUFE, QR
// ni resolución DIAN). Es solo una hoja de apoyo para que el despachador sepa
// rápido qué productos subir al vehículo, sin tener que abrir el PDF completo
// de la factura. La factura legal y su copia siguen su proceso normal aparte.
// Se muestra como modal en la misma página (en vez de window.open) porque el
// artifact corre en un iframe con sandbox, y muchos navegadores bloquean las
// ventanas emergentes ahí incluso al hacer clic directo.













// Convierte la URL "data:" del PDF guardado en un Blob (archivo real). Los
// navegadores de celular bloquean descargar/abrir directamente desde "data:",
// así que todo lo que sea abrir, descargar o compartir pasa por aquí.


// Descarga el PDF. En celular usa el menú nativo de compartir (permite
// "Guardar en Archivos", mandarlo por WhatsApp, etc.); en computador hace la
// descarga normal.

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function DespachoPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [view, setView] = useState("despacho");
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState("idle");
  const [pendingExtract, setPendingExtract] = useState(null);
  const [editing, setEditing] = useState(null);
  const [viewingPdf, setViewingPdf] = useState(null);
  const [notaPendienteDe, setNotaPendienteDe] = useState(null);
  const [confirmandoEntrega, setConfirmandoEntrega] = useState(null);
  const [materialDe, setMaterialDe] = useState(null);
  // Factura madre sobre la que se está creando una remisión (abre RemisionModal).
  const [remisionDeModal, setRemisionDeModal] = useState(null);
  // Abre el formulario de remisión manual (pedido escrito a mano, sin PDF).
  const [remisionManualAbierta, setRemisionManualAbierta] = useState(false);
  // Factura madre a la que se le va a descontar material que el cliente ya se
  // llevó directo (sin remisión).
  const [descontarDe, setDescontarDe] = useState(null);
  // Remisión cuya tirilla se está viendo/imprimiendo.
  const [tirillaDe, setTirillaDe] = useState(null);
  // Pedido borrado que todavía se puede deshacer (ver deletePedido).
  const [borradoPendiente, setBorradoPendiente] = useState(null);
  const borradoRef = useRef(null);

  // Botón "Salir": el primer toque lo arma, el segundo cierra la sesión. Se
  // desarma solo para que no quede cebado esperando un roce en la tablet.
  const [confirmandoSalir, setConfirmandoSalir] = useState(false);
  const salirRef = useRef(null);
  function pedirConfirmacionSalir() {
    setConfirmandoSalir(true);
    clearTimeout(salirRef.current);
    salirRef.current = setTimeout(() => setConfirmandoSalir(false), 4000);
  }
  useEffect(() => () => clearTimeout(salirRef.current), []);
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  // Modo "juntar pedidos": al activarlo, las tarjetas del tablero se vuelven
  // seleccionables para agrupar varias en un solo viaje (mismo vehículo y día).
  const [modoJuntar, setModoJuntar] = useState(false);
  const [seleccionJuntar, setSeleccionJuntar] = useState([]);
  // Grupo cuya entrega se está confirmando (todas sus facturas de una).
  const [confirmandoEntregaGrupo, setConfirmandoEntregaGrupo] = useState(null);
  const [toast, setToast] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("");
  // Resultados de buscar en TODO el historial contra el servidor. null = sin
  // búsqueda activa (se muestra el historial precargado).
  const [resultadosHistorial, setResultadosHistorial] = useState(null);
  const [buscandoHistorial, setBuscandoHistorial] = useState(false);
  // Columnas que faltan porque el SQL de la tanda no se ha corrido. Se avisa con
  // un banner que dice qué hacer, en vez de dejar que reviente con "column does
  // not exist" al crear una remisión.
  const [faltaSql, setFaltaSql] = useState([]);
  // Texto del buscador de Despachos. Cuando tiene algo, el tablero por fecha se
  // reemplaza por una lista plana con los pedidos activos que coincidan (útil
  // cuando hay muchas facturas cargadas y no sabes en qué día quedó una).
  const [busquedaDespacho, setBusquedaDespacho] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayISO());

  // --- Estado del Panel (resumen del día, protegido con PIN) ---
  const [panelDesbloqueado, setPanelDesbloqueado] = useState(() => {
    try {
      return sessionStorage.getItem("panelDesbloqueado") === "1";
    } catch (e) {
      console.warn("No se pudo leer el estado del panel:", e);
      return false;
    }
  });
  const [pinIntento, setPinIntento] = useState("");
  const [pinError, setPinError] = useState(false);
  // Día que muestra el Panel (YYYY-MM-DD). null = aún sin fijar; se resuelve a
  // "ayer" (o al día más reciente con entregas) al abrir la vista.
  const [panelDia, setPanelDia] = useState(null);

  // --- Estado del módulo de Cotizaciones (independiente de despacho) ---
  const [cotizaciones, setCotizaciones] = useState([]);
  const [pendingExtractCotizacion, setPendingExtractCotizacion] = useState(null);
  const [cotizacionFilter, setCotizacionFilter] = useState("");
  const [editingCotizacion, setEditingCotizacion] = useState(null);
  const [viewingPdfCotizacion, setViewingPdfCotizacion] = useState(null);
  const [rechazandoCotizacion, setRechazandoCotizacion] = useState(null);
  const cotizacionFileInputRef = useRef(null);

  const hoyIso = todayISO();
  const fechaDe = (p) => p.fechaDespacho || hoyIso;
  const fileInputRef = useRef(null);

  const toastTimerRef = useRef(null);
  function showToast(msg, duracionMs = 2800) {
    setToast(msg);
    // Sin esto, el timeout de un toast anterior borraba antes de tiempo el
    // toast nuevo (los errores de guardado duran más y deben poder leerse).
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), duracionMs);
  }

  // Antes acá se inyectaba un <script> de cdnjs para cargar pdf.js en tiempo de
  // ejecución, con dos estados (libsReady/libsError) para saber si ya se podía
  // subir un PDF. Ya no hace falta: pdf.js viaja en el bundle como dependencia
  // de npm (ver pdfExtract.js), servido desde el mismo dominio. El lector está
  // listo desde el primer render y no depende de que un CDN ajeno esté arriba.

  useEffect(() => {
    (async () => {
      try {
        const activos = await cargarPedidosActivos();
        setPedidos(activos);
      } catch (e) {
        showToast("No se pudieron cargar los pedidos. Revisa tu conexión a internet y recarga la página.", 5000);
      }
      try {
        const entregados = await cargarHistorial();
        setHistorial(entregados);
      } catch (e) {
        // Sin este aviso, un fallo de carga se veía igual que "no hay nada"
        // y el usuario podía duplicar registros o sacar conclusiones falsas.
        showToast("No se pudo cargar el historial. Recarga la página.", 5000);
      }
      try {
        const cots = await cargarCotizaciones();
        setCotizaciones(cots);
      } catch (e) {
        showToast("No se pudieron cargar las cotizaciones. Recarga la página.", 5000);
      }
      setLoading(false);
      // Se comprueba de último y sin bloquear: si el SQL de la tanda no se corrió,
      // la app funciona igual pero hay que avisarlo con algo accionable.
      try {
        setFaltaSql(await columnasFaltantes());
      } catch (e) {
        /* si no se puede comprobar, no molestamos con un aviso */
      }
    })();
  }, []);

  // Guarda en Supabase solo el/los pedidos que cambiaron, y a la vez
  // actualiza el estado en pantalla de inmediato (para que la app se
  // sienta rápida, sin esperar la respuesta del servidor para reaccionar).
  //
  // - Los lotes de escritura se encolan uno detrás de otro (saveQueueRef):
  //   dos reordenamientos rápidos seguidos ya no intercalan sus upserts con
  //   red lenta (los rezagados del primero pisaban al segundo y la BD
  //   quedaba con un orden mezclado distinto al de la pantalla).
  // - "crear: true" usa upsert (pedido nuevo); sin él usa update, que no
  //   resucita filas borradas/entregadas desde otro dispositivo.
  // - Si el guardado falla, la pantalla no puede quedarse mostrando algo que
  //   la base de datos no tiene: re-sincronizamos desde la BD —que es la
  //   verdad tras un fallo a mitad de lote— y si ni eso se puede (sin
  //   conexión), revertimos al estado anterior.
  const saveQueueRef = useRef(Promise.resolve());
  const persistPedidos = useCallback(async (next, pedidosQueCambiaron, { crear = false } = {}) => {
    let prev;
    setPedidos((actual) => {
      prev = actual;
      return next;
    });
    const lote = saveQueueRef.current.then(async () => {
      for (const p of pedidosQueCambiaron || next) {
        if (crear) await guardarPedido(p, "activo");
        else await actualizarPedido(p);
      }
    });
    // La cola no debe quedar "rota" para el siguiente lote, falle o no este.
    saveQueueRef.current = lote.catch(() => {});
    try {
      await lote;
    } catch (e) {
      try {
        const activos = await cargarPedidosActivos();
        setPedidos(activos);
      } catch (e2) {
        setPedidos(prev);
      }
      showToast("No se pudo guardar en la base de datos. Se restauró la lista guardada.", 5000);
    }
  }, []);

  async function handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      showToast("Ese archivo no es un PDF. Busca el archivo que termina en .pdf e inténtalo de nuevo.");
      e.target.value = "";
      return;
    }
    setUploadState("reading");
    try {
      const [lines, dataUrl] = await Promise.all([extractPdfLines(file), fileToDataUrl(file)]);
      const parsed = parseDocumento(lines);
      setPendingExtract({
        ...parsed,
        // Si el cliente no tiene teléfono registrado (o es el placeholder
        // "111111111") pero el asesor anotó un celular de contacto, ese
        // celular pasa al campo real. Antes el input lo MOSTRABA como
        // fallback pero guardaba telefono vacío: lo visible y lo guardado
        // no coincidían.
        telefono:
          parsed.telefono && parsed.telefono !== "111111111"
            ? parsed.telefono
            : parsed.telefonoContacto || parsed.telefono || "",
        pdfDataUrl: dataUrl,
        fileName: file.name,
        vehiculo: "",
        estadoPago: "pendiente",
      });
    } catch (err) {
      showToast("No se pudo leer este PDF. Si es una foto o un escaneo, no funciona: usa el PDF original que genera el programa de facturación.", 5000);
    }
    setUploadState("idle");
    e.target.value = "";
  }

  function confirmPendingExtract(data) {
    if (!data.sinFechaDefinida && !data.vehiculo) {
      showToast("Selecciona un vehículo antes de guardar");
      return;
    }
    if (!data.cliente || !data.cliente.trim()) {
      showToast("Escribe el nombre del cliente antes de guardar");
      return;
    }
    // Fecha de despacho elegida en la tarjeta: hoy, un día futuro, "pendiente"
    // (sin fecha) o "viaje" (se lleva cuando salga un viaje a la zona). El orden
    // se calcula en la columna de ESE día, no siempre en la de hoy.
    const esViaje = data.fechaDespacho === "viaje";
    const sinTablero = data.sinFechaDefinida || esViaje;
    const fechaDestino = esViaje ? "viaje" : data.sinFechaDefinida ? "pendiente" : data.fechaDespacho || todayISO();
    const maxOrden = sinTablero
      ? 0
      : pedidos
          .filter((p) => p.vehiculo === data.vehiculo && fechaDe(p) === fechaDestino)
          .reduce((max, p) => Math.max(max, p.orden || 0), 0);

    const nuevo = {
      id: uid(),
      tipoDocumento: data.tipo || "factura",
      numeroFactura: data.numeroFactura || "",
      cliente: data.cliente.trim(),
      telefono: data.telefono || "",
      telefonoContacto: data.telefonoContacto || "",
      direccion: data.direccion || "",
      vendedor: data.vendedor || "",
      total: data.total || null,
      productos: data.productos || [],
      vehiculo: sinTablero ? null : data.vehiculo,
      destino: data.destino || "",
      pdfDataUrl: data.pdfDataUrl,
      fileName: data.fileName,
      // Fecha del documento (la impresa en la factura/cotización). Si el
      // lector no la encontró, se usa la de hoy. Es la que cuenta para saber
      // hace cuánto se generó, no el día en que se subió el PDF.
      fecha: data.fechaDocumento || todayStr(),
      fechaDespacho: fechaDestino,
      estadoPago: data.estadoPago || "pendiente",
      hora: nowTimeStr(),
      timestamp: Date.now(),
      orden: maxOrden + 1,
    };
    persistPedidos([...pedidos, nuevo], [nuevo], { crear: true });

    // Si el pedido nació de una cotización del otro tablero, la cerramos como
    // aceptada y le dejamos el enlace al pedido. Así no se puede despachar dos
    // veces y no se pierde el rastro de la venta.
    if (data.desdeCotizacion) {
      const cot = cotizaciones.find((c) => c.id === data.desdeCotizacion);
      if (cot) {
        updateCotizacion(cot.id, { estado: "aceptada", motivoRechazo: null, pedidoId: nuevo.id });
      }
    }

    setPendingExtract(null);
    // Llevamos la vista a donde cayó el pedido, para que se vea de inmediato.
    if (esViaje) setSelectedDate("viaje");
    else if (!data.sinFechaDefinida) setSelectedDate(fechaDestino);
    const vehiculoLabel = (VEHICULOS.find((v) => v.id === data.vehiculo) || {}).label || "";
    showToast(
      esViaje
        ? "Pedido agregado a Por viaje"
        : data.sinFechaDefinida
        ? "Pedido agregado a Pendientes"
        : fechaDestino === hoyIso
        ? "Pedido agregado a " + vehiculoLabel
        : `Pedido programado para ${etiquetaFecha(fechaDestino, hoyIso)} en ${vehiculoLabel}`
    );
  }

  // Borrado con ventana de "Deshacer": el pedido desaparece de la pantalla al
  // instante, pero NO se borra de la base de datos hasta que pasan unos
  // segundos. Si el usuario deshace, la base nunca se tocó. Se hace así (y no
  // borrando de una y recreando al deshacer) porque el PDF adjunto no está
  // cargado en memoria — recrear el pedido desde cero lo perdería.
  function flushBorradoPendiente() {
    const b = borradoRef.current;
    if (!b) return;
    clearTimeout(b.timer);
    borradoRef.current = null;
    setBorradoPendiente(null);
    eliminarPedido(b.pedido.id).catch(() => {
      setPedidos((prev) => (prev.some((p) => p.id === b.pedido.id) ? prev : [...prev, b.pedido]));
      showToast("No se pudo eliminar de la base de datos. El pedido se restauró.", 5000);
    });
  }

  function deletePedido(id) {
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) return;
    // Si ya había otro borrado esperando, ese se confirma ya (solo se puede
    // deshacer el último).
    flushBorradoPendiente();
    setPedidos((prev) => prev.filter((p) => p.id !== id));
    const timer = setTimeout(() => {
      borradoRef.current = null;
      setBorradoPendiente(null);
      eliminarPedido(pedido.id).catch(() => {
        setPedidos((prev) => (prev.some((p) => p.id === pedido.id) ? prev : [...prev, pedido]));
        showToast("No se pudo eliminar de la base de datos. El pedido se restauró.", 5000);
      });
    }, VENTANA_DESHACER_MS);
    borradoRef.current = { pedido, timer };
    setBorradoPendiente(pedido);
  }

  function deshacerBorrado() {
    const b = borradoRef.current;
    if (!b) return;
    clearTimeout(b.timer);
    borradoRef.current = null;
    setBorradoPendiente(null);
    setPedidos((prev) => (prev.some((p) => p.id === b.pedido.id) ? prev : [...prev, b.pedido]));
    showToast("Pedido restaurado");
  }

  // Un pedido "paga al recibir" no se entrega de un toque: primero se
  // confirma si el cliente pagó o quedó debiendo (abre ConfirmarEntregaModal).
  // Los que ya venían "pagado" sí se entregan directo, sin preguntar nada.
  function solicitarEntrega(pedido) {
    if ((pedido.estadoPago || "pendiente") === "pagado") {
      marcarEntregado(pedido.id);
    } else {
      setConfirmandoEntrega(pedido);
    }
  }

  // extra permite fijar el estado de pago decidido al confirmar la entrega
  // (p. ej. { estadoPago: "pagado" } cuando el cliente pagó al recibir).
  async function marcarEntregado(id, extra = {}) {
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) return;
    const entregado = {
      ...pedido,
      ...extra,
      productos: cerrarEntregaCompleta(pedido.productos),
      entregaPendiente: false,
      notaPendiente: "",
      entregadoEn: new Date().toISOString(),
      fechaEntrega: todayStr(),
    };
    // Una sola escritura (el upsert con estado "entregado" mueve el pedido de
    // despacho a historial); si falla, revertimos las dos listas para que el
    // pedido no desaparezca de despacho sin haber quedado entregado en la BD.
    const prevPedidos = pedidos;
    const prevHistorial = historial;
    setPedidos(pedidos.filter((p) => p.id !== id));
    setHistorial([entregado, ...historial]);
    showToast(entregado.estadoPago === "pagado" ? "Pedido entregado" : "Entregado — quedó debiendo");
    try {
      // update, no upsert: si otro dispositivo ya borró este pedido, no lo
      // resucitamos en el historial con los datos viejos que teníamos en memoria.
      const movido = await moverPedidoAEstado(entregado, "entregado");
      if (!movido) {
        setPedidos(prevPedidos.filter((p) => p.id !== id));
        setHistorial(prevHistorial);
        showToast("Ese pedido ya no existe (lo borraron desde otro dispositivo).", 5000);
      }
    } catch (e) {
      setPedidos(prevPedidos);
      setHistorial(prevHistorial);
      showToast("No se pudo guardar la entrega. El pedido volvió a despacho.", 5000);
    }
  }

  // --- Juntar pedidos en un solo viaje (mismo vehículo y día) ---

  // Alterna un pedido en la selección del modo juntar. Solo deja seleccionar
  // pedidos del mismo vehículo y fecha que el primero marcado (van en un viaje).
  function toggleSeleccionJuntar(pedido) {
    setSeleccionJuntar((prev) => {
      if (prev.includes(pedido.id)) return prev.filter((id) => id !== pedido.id);
      return [...prev, pedido.id];
    });
  }

  function salirModoJuntar() {
    setModoJuntar(false);
    setSeleccionJuntar([]);
  }

  // Asigna un mismo grupo_id a los pedidos seleccionados: pasan a mostrarse y
  // entregarse como un solo viaje.
  function confirmarJuntar() {
    const ids = seleccionJuntar;
    if (ids.length < 2) {
      showToast("Selecciona al menos 2 pedidos para juntar.");
      return;
    }
    const seleccionados = pedidos.filter((p) => ids.includes(p.id));
    // Guardia: un viaje juntado es un solo vehículo y un solo día.
    const mismoVehiculo = seleccionados.every((p) => p.vehiculo === seleccionados[0].vehiculo);
    const mismaFecha = seleccionados.every((p) => fechaDe(p) === fechaDe(seleccionados[0]));
    if (!mismoVehiculo || !mismaFecha) {
      showToast("Solo se pueden juntar pedidos del mismo vehículo y día.", 4000);
      return;
    }
    const grupoId = "g_" + uid();
    const nuevos = pedidos.map((p) => (ids.includes(p.id) ? { ...p, grupoId } : p));
    const cambiados = ids.map((id) => nuevos.find((p) => p.id === id)).filter(Boolean);
    salirModoJuntar();
    showToast(`${ids.length} pedidos juntados en un viaje.`);
    persistPedidos(nuevos, cambiados);
  }

  // Deshace un grupo: cada factura vuelve a ser un pedido suelto.
  function separarGrupo(grupoId) {
    const cambiados = pedidos.filter((p) => p.grupoId === grupoId).map((p) => ({ ...p, grupoId: null }));
    if (cambiados.length === 0) return;
    const nuevos = pedidos.map((p) => (p.grupoId === grupoId ? { ...p, grupoId: null } : p));
    showToast("Pedidos separados.");
    persistPedidos(nuevos, cambiados);
  }

  // Entrega un viaje juntado: si alguna factura estaba "paga al recibir", pide
  // una sola confirmación de pago para todo el grupo; si todas estaban pagadas,
  // las entrega directo.
  function solicitarEntregaGrupo(grupoId) {
    const miembros = pedidos.filter((p) => p.grupoId === grupoId);
    if (miembros.length === 0) return;
    const hayPorCobrar = miembros.some((m) => (m.estadoPago || "pendiente") !== "pagado");
    if (hayPorCobrar) {
      const total = miembros.reduce((s, m) => s + (Number(m.total) || 0), 0);
      setConfirmandoEntregaGrupo({ grupoId, count: miembros.length, total });
    } else {
      entregarGrupo(grupoId, "pagado");
    }
  }

  async function entregarGrupo(grupoId, estadoPagoPorCobrar) {
    const miembros = pedidos.filter((p) => p.grupoId === grupoId);
    if (miembros.length === 0) return;
    const entregados = miembros.map((m) => ({
      ...m,
      productos: cerrarEntregaCompleta(m.productos),
      // Las que ya estaban pagadas se respetan; a las "paga al recibir" se les
      // aplica la decisión tomada en la confirmación del grupo.
      estadoPago: (m.estadoPago || "pendiente") === "pagado" ? "pagado" : estadoPagoPorCobrar,
      entregaPendiente: false,
      notaPendiente: "",
      entregadoEn: new Date().toISOString(),
      fechaEntrega: todayStr(),
    }));
    const ids = new Set(miembros.map((m) => m.id));
    const prevPedidos = pedidos;
    const prevHistorial = historial;
    setPedidos(pedidos.filter((p) => !ids.has(p.id)));
    setHistorial([...entregados, ...historial]);
    showToast(`${miembros.length} pedidos entregados.`);
    try {
      // update, no upsert (ver moverPedidoAEstado): no resucitamos pedidos
      // que otro dispositivo haya borrado.
      for (const e of entregados) await moverPedidoAEstado(e, "entregado");
    } catch (err) {
      setPedidos(prevPedidos);
      setHistorial(prevHistorial);
      showToast("No se pudo guardar la entrega del grupo. Nada cambió.", 5000);
    }
  }

  // Crea una remisión manual (pedido escrito a mano, sin PDF ni factura de
  // origen). Materiales tipo arena/bloque que a veces se piden en una hoja
  // aparte de remisiones. Nace como pedido activo con número REM correlativo.
  // Descuenta material del saldo de una factura madre SIN crear una remisión:
  // para cuando el cliente ya se llevó algo directo (ej. un bulto de cemento en
  // el mostrador) y no tiene sentido remisionarlo. Si el saldo queda en cero,
  // la factura se archiva sola, igual que con las remisiones.
  async function descontarMaterialMadre(madre, cantidades) {
    const productosMadre = madre.productos || [];
    const totalDescontado = cantidades.reduce((s, c) => s + (Number(c) || 0), 0);
    if (totalDescontado <= 0) {
      showToast("Marca cuánto material se llevó el cliente.");
      return;
    }
    const hoyMov = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const nuevosProductos = productosMadre.map((p, i) => {
      const usado = Number(cantidades[i]) || 0;
      // sumarEntregadoDirecto ACUMULA en cantidadEntregada además de bajar el
      // saldo. Antes acá solo se tocaba cantidadRestante, y por eso el material
      // que el cliente se llevaba en el mostrador NO aparecía nunca en los
      // kilos del Panel: al archivarse la factura, entregadoParaPanelDe leía
      // cantidadEntregada (que había quedado en 0) y contaba cero.
      const base = usado > 0 ? sumarEntregadoDirecto(p, usado) : p;
      // Descontar material también es movimiento sobre la factura: se guarda
      // la fecha para que no se marque "estancada" si se le está restando.
      return usado > 0 ? { ...base, fechaMovimiento: hoyMov } : base;
    });
    // Con saldoDe y no con cantidadRestante: a una factura SIN remisiones no se
    // le inventa ese campo (sigue con la forma de dato de siempre), así que
    // sumar cantidadRestante daba 0 y la archivaba de una al primer descuento.
    const saldoTotal = nuevosProductos.reduce((s, p) => s + saldoDe(p), 0);
    const prevPedidos = pedidos;
    const prevHistorial = historial;

    if (saldoTotal <= 0) {
      const completada = {
        ...madre,
        // cantidadEntregada fija para que el Panel no vuelva a sumarle el peso
        // completo el día del archivo (ya se contó al salir cada remisión).
        productos: nuevosProductos.map((p) => ({
          ...p,
          cantidadEntregada: p.cantidadEntregada !== undefined && p.cantidadEntregada !== null ? p.cantidadEntregada : 0,
        })),
        entregaPendiente: false,
        notaPendiente: "",
        entregadoEn: new Date().toISOString(),
        fechaEntrega: todayStr(),
      };
      setPedidos((prev) => quitarPorId(prev, madre.id));
      setHistorial((prev) => [completada, ...prev]);
      showToast(`Material descontado. Factura ${madre.numeroFactura || ""} completada, pasó al historial.`, 4500);
      try {
        await moverPedidoAEstado(completada, "entregado");
      } catch (e) {
        // Deshacer = devolver la madre a despacho y sacarla del historial, sin
        // pisar lo que haya cambiado durante el await (ver listas.js).
        setPedidos((prev) => reponerPorId(prev, madre));
        setHistorial((prev) => quitarPorId(prev, madre.id));
        showToast("No se pudo guardar. Nada cambió.", 5000);
      }
    } else {
      const notaNueva = madre.entregaPendiente ? notaDesdeFaltantes(nuevosProductos) : "";
      const actualizada = {
        ...madre,
        productos: nuevosProductos,
        entregaPendiente: !!notaNueva,
        notaPendiente: notaNueva,
      };
      setPedidos((prev) => reemplazarPorId(prev, actualizada));
      showToast("Material descontado del saldo.");
      try {
        await actualizarPedido(actualizada);
      } catch (e) {
        // Deshacer = volver a dejar la versión ANTERIOR de la madre. Si otro
        // dispositivo la borró mientras tanto, reemplazarPorId no la resucita.
        setPedidos((prev) => reemplazarPorId(prev, madre));
        showToast("No se pudo guardar. Nada cambió.", 5000);
      }
    }
  }

  async function crearRemisionManual(data) {
    const productos = (data.productos || [])
      .filter((p) => (p.descripcion || "").trim() && cantidadNum(p.cantidad) > 0)
      .map((p) => ({
        descripcion: p.descripcion.trim(),
        cantidad: String(p.cantidad).trim(),
        unidad: (p.unidad || "").trim(),
        // Precio total de la línea. Si va vacío queda en 0, igual que antes.
        total: String(parseInt(String(p.precio || "0").replace(/[^\d]/g, ""), 10) || 0),
      }));
    if (productos.length === 0) {
      showToast("Agrega al menos un material con cantidad.");
      return;
    }
    const esConFecha = data.fechaDespacho !== "pendiente" && data.fechaDespacho !== "viaje";
    const vehiculoDest = esConFecha ? data.vehiculo || VEHICULOS[0].id : null;
    let orden = 0;
    if (esConFecha) {
      orden =
        pedidos
          .filter((p) => p.vehiculo === vehiculoDest && fechaDe(p) === data.fechaDespacho)
          .reduce((max, p) => Math.max(max, p.orden || 0), 0) + 1;
    }
    const nuevo = {
      id: uid(),
      tipoDocumento: "remision",
      numeroFactura: await siguienteNumeroRemision(),
      remisionDe: null,
      remisionDeId: null,
      cliente: (data.cliente || "").trim(),
      telefono: (data.telefono || "").trim(),
      direccion: (data.direccion || "").trim(),
      vendedor: "",
      total: productos.reduce((sum, p) => sum + (parseInt(p.total, 10) || 0), 0) || null,
      productos,
      vehiculo: vehiculoDest,
      destino: data.destino || null,
      fecha: todayStr(),
      fechaDespacho: data.fechaDespacho,
      hora: nowTimeStr(),
      orden,
      estadoPago: data.estadoPago || "pendiente",
      tienePdf: false,
    };
    persistPedidos([...pedidos, nuevo], [nuevo], { crear: true });
    setRemisionManualAbierta(false);
    setTirillaDe(nuevo);
    if (esConFecha) setSelectedDate(data.fechaDespacho);
    else if (data.fechaDespacho === "viaje") setSelectedDate("viaje");
    else setSelectedDate("pendiente");
    showToast(`Remisión manual ${nuevo.numeroFactura} creada.`);
  }

  // Corrige una entrega marcada por error: saca el pedido del historial y lo
  // regresa a despacho (estado "activo") con su vehículo y fecha originales.
  // Si esa fecha ya pasó, reaparece en "Hoy" con la etiqueta de atrasado.
  async function devolverADespacho(id) {
    const pedido = historial.find((p) => p.id === id);
    if (!pedido) return;
    // Al devolver un pedido a despacho hay que borrar la marca de "todo
    // entregado" que puso "Entregado" (cerrarEntregaCompleta fija
    // cantidadEntregada = cantidad). Si no se limpia, el pedido vuelve a
    // despacho creyendo que ya salió completo: no muestra peso, sale 100%
    // entregado en "Por entregar" y el modal de remisión muestra todo como
    // "ya se despachó completo" (no deja remisionar). Las líneas con saldo de
    // remisiones (cantidadRestante) SÍ se respetan: son facturas madre cuyo
    // material ya salió por remisiones y no debe volver a contarse.
    const productosLimpios = (pedido.productos || []).map((p) => {
      if (p.cantidadRestante !== undefined && p.cantidadRestante !== null) return p;
      if (p.cantidadEntregada === undefined || p.cantidadEntregada === null) return p;
      const copia = { ...p };
      delete copia.cantidadEntregada;
      return copia;
    });
    const restaurado = { ...pedido, productos: productosLimpios, entregadoEn: null, fechaEntrega: null };
    setHistorial((prev) => quitarPorId(prev, id));
    setPedidos((prev) => [restaurado, ...prev]);
    showToast("Pedido devuelto a despacho");
    try {
      // update con estado "activo": la fila ya existe (estaba entregada), así
      // que solo cambia su estado y limpia la marca de entrega. Con update y no
      // upsert, un pedido que otro dispositivo borró no revive.
      const movido = await moverPedidoAEstado(restaurado, "activo");
      if (!movido) {
        // Ya no existe en la base: se saca de despacho y NO se repone en el
        // historial (justamente porque lo borraron).
        setPedidos((prev) => quitarPorId(prev, id));
        showToast("Ese pedido ya no existe (lo borraron desde otro dispositivo).", 5000);
      }
    } catch (e) {
      // Deshacer = sacarlo de despacho y devolverlo al historial (ver listas.js).
      setPedidos((prev) => quitarPorId(prev, id));
      setHistorial((prev) => reponerPorId(prev, pedido));
      showToast("No se pudo devolver el pedido. Sigue en el historial.", 5000);
    }
  }

  function updatePedido(id, patch) {
    const anterior = pedidos.find((p) => p.id === id);
    if (!anterior) return;
    const actualizado = { ...anterior, ...patch };
    // Si cambió de vehículo o de fecha, va al final de la cola de su columna
    // destino. Conservar el orden viejo chocaba con el de otro pedido de esa
    // columna y la posición quedaba ambigua (cambiaba entre recargas).
    const cambioColumna =
      actualizado.vehiculo !== anterior.vehiculo || actualizado.fechaDespacho !== anterior.fechaDespacho;
    if (cambioColumna && actualizado.fechaDespacho !== "pendiente" && actualizado.fechaDespacho !== "viaje") {
      const fechaDestino = actualizado.fechaDespacho || hoyIso;
      const maxOrden = pedidos
        .filter((p) => p.id !== id && p.vehiculo === actualizado.vehiculo && fechaDe(p) === fechaDestino)
        .reduce((max, p) => Math.max(max, p.orden || 0), 0);
      actualizado.orden = maxOrden + 1;
    }
    persistPedidos(pedidos.map((p) => (p.id === id ? actualizado : p)), [actualizado]);
  }

  // Pone al día un pedido atrasado: fecha de despacho = hoy. updatePedido se
  // encarga de recalcular "orden" al final de la cola de su vehículo.
  function moverAHoy(id) {
    if (!pedidos.some((p) => p.id === id)) return;
    updatePedido(id, { fechaDespacho: hoyIso });
    showToast("Pedido movido a hoy");
  }

  // Cuánto queda por despachar de un producto de una factura madre:
  // - si ya se le hicieron remisiones, manda cantidadRestante (que ya nació
  //   descontando lo entregado a mano, ver abajo);
  // - si no, es la cantidad original MENOS lo que el despachador ya haya
  //   marcado como entregado en "Material entregado" — sin este descuento,
  //   una factura con material ya entregado ofrecía el total completo para
  //   remisionar y se duplicaba material.
  // Copia 4 de 6 -> saldo.js.
  const disponibleDe = saldoDe;

  // Siguiente número correlativo de remisión (REM-0001, REM-0002...).
  //
  // Se consulta contra la BASE, no contra la lista cargada en pantalla. Antes se
  // sacaba del máximo de `pedidos + historial` en memoria, con dos problemas: dos
  // dispositivos creando remisiones a la vez sacaban el mismo número, y —peor—
  // desde que el historial se carga por ventana de 90 días, el máximo en memoria
  // YA NO es el máximo real: los números se habrían reciclado en silencio.
  //
  // La unicidad final la garantiza el índice de la base (ver el SQL de la tanda):
  // si dos dispositivos coinciden en el mismo segundo, la base rechaza el
  // segundo y crearRemision reintenta con el siguiente.
  async function siguienteNumeroRemision() {
    const enLaBase = await maxNumeroRemision();
    // Red de seguridad: si la consulta fallara, no bajar de lo que ya se ve en
    // pantalla (nunca reutilizar un número visible).
    const enPantalla = maxRemisionDeNumeros([...pedidos, ...historial].map((p) => p.numeroFactura));
    return formatearNumeroRemision(Math.max(enLaBase, enPantalla) + 1);
  }

  // ¿Es el error de "ya existe ese número de remisión"? (violación del índice
  // único). Es el caso de dos dispositivos creando remisión a la vez.
  const esChoqueDeRemision = (e) =>
    e && (e.code === "23505" || /duplicate key|numero_remision_unico/i.test(String(e.message || "")));

  // Guarda una remisión y, si la base rechaza el número por duplicado (otro
  // dispositivo lo tomó en el mismo instante), pide el siguiente y reintenta.
  // El objeto se muta con el número definitivo para que la tirilla que se
  // imprime muestre el que realmente quedó guardado.
  async function guardarRemisionConReintento(child, intentos = 3) {
    for (let i = 0; i < intentos; i++) {
      try {
        await guardarPedido(child, "activo");
        return child.numeroFactura;
      } catch (e) {
        if (!esChoqueDeRemision(e) || i === intentos - 1) throw e;
        const nuevo = await siguienteNumeroRemision();
        child.numeroFactura = nuevo;
        setPedidos((prev) => prev.map((p) => (p.id === child.id ? { ...p, numeroFactura: nuevo } : p)));
        setTirillaDe((t) => (t && t.id === child.id ? { ...t, numeroFactura: nuevo } : t));
        showToast(`Ese número de remisión ya se había usado; quedó como ${nuevo}.`, 4000);
      }
    }
  }

  // Crea una remisión (parte de una factura grande). cantidades es un arreglo
  // alineado a madre.productos con cuántas unidades de cada uno van en ESTA
  // remisión. La remisión nace como pedido activo en la fecha/vehículo elegidos;
  // la factura madre se queda en Pendientes con el saldo rebajado, y si queda
  // toda en cero, pasa sola al historial.
  async function crearRemision(madre, cantidades, fechaDespacho, vehiculo) {
    const productosMadre = madre.productos || [];
    // Líneas de la remisión: solo los productos con cantidad > 0.
    const childProductos = [];
    productosMadre.forEach((p, i) => {
      const usado = Number(cantidades[i]) || 0;
      if (usado <= 0) return;
      const totalLinea = parseInt(String(p.total || "0").replace(/\./g, ""), 10) || 0;
      const cantOriginal = cantidadNum(p.cantidad);
      const totalProrateado = cantOriginal > 0 ? Math.round((totalLinea * usado) / cantOriginal) : 0;
      childProductos.push({
        codigo: p.codigo,
        descripcion: p.descripcion,
        unidad: p.unidad,
        cantidad: String(usado),
        total: String(totalProrateado),
      });
    });
    if (childProductos.length === 0) {
      showToast("Marca al menos un producto para la remisión.");
      return;
    }

    const numRemision = await siguienteNumeroRemision();
    const totalChild = childProductos.reduce((s, p) => s + (parseInt(p.total, 10) || 0), 0);
    // Orden al final de la cola de su vehículo/fecha destino, para que no salte
    // de posición al recargar (misma lógica que usa updatePedido).
    const vehiculoChild = vehiculo || VEHICULOS[0].id;
    const maxOrden = pedidos
      .filter((p) => p.vehiculo === vehiculoChild && fechaDe(p) === fechaDespacho)
      .reduce((max, p) => Math.max(max, p.orden || 0), 0);
    const child = {
      id: uid(),
      tipoDocumento: "factura",
      numeroFactura: numRemision,
      // El número se sigue guardando porque es lo que va impreso en la tirilla.
      // El ENLACE de verdad es remisionDeId: el número puede cambiar (si alguien
      // corrige la factura en "Editar") o repetirse ("s/n" en todas las que no
      // tienen número), y con eso las remisiones quedaban huérfanas o cruzadas
      // entre clientes distintos.
      remisionDe: madre.numeroFactura || "s/n",
      remisionDeId: madre.id,
      cliente: madre.cliente,
      telefono: madre.telefono,
      telefonoContacto: madre.telefonoContacto,
      direccion: madre.direccion,
      vendedor: madre.vendedor,
      total: totalChild || null,
      productos: childProductos,
      vehiculo: vehiculoChild,
      destino: madre.destino || null,
      fechaDespacho,
      hora: "",
      orden: maxOrden + 1,
      estadoPago: madre.estadoPago || "pendiente",
      tienePdf: false,
    };

    // Saldo nuevo de la madre por producto.
    const nuevosProductosMadre = productosMadre.map((p, i) => {
      const usado = Number(cantidades[i]) || 0;
      return { ...p, cantidadRestante: Math.max(0, disponibleDe(p) - usado) };
    });
    // Mismo criterio que en descontarMaterialMadre: se pregunta por saldoDe, no
    // por el campo crudo. Acá da idéntico (esta rama siempre escribe
    // cantidadRestante), pero leer el campo a mano es justo lo que dejó suelta
    // la copia que se desvió.
    const saldoTotal = nuevosProductosMadre.reduce((s, p) => s + saldoDe(p), 0);
    const madreAgotada = saldoTotal <= 0;

    if (madreAgotada) {
      const madreCompletada = {
        ...madre,
        // El material de esta factura ya se contó en el Panel el día que se
        // entregó cada remisión. Al archivarla fijamos cantidadEntregada
        // (lo marcado a mano en "Material entregado", o 0) para que el Panel
        // NO le sume el peso completo otra vez el día del archivo.
        productos: nuevosProductosMadre.map((p) => ({
          ...p,
          cantidadEntregada: p.cantidadEntregada !== undefined && p.cantidadEntregada !== null ? p.cantidadEntregada : 0,
        })),
        entregaPendiente: false,
        notaPendiente: "",
        entregadoEn: new Date().toISOString(),
        fechaEntrega: todayStr(),
      };
      setPedidos((prev) => [child, ...quitarPorId(prev, madre.id)]);
      setHistorial((prev) => [madreCompletada, ...prev]);
      setTirillaDe(child);
      showToast(`Remisión ${numRemision} creada. Factura ${madre.numeroFactura || ""} completada, pasó al historial.`, 4500);
      try {
        await guardarRemisionConReintento(child);
        await moverPedidoAEstado(madreCompletada, "entregado");
      } catch (e) {
        // Deshacer = quitar la remisión que se había pintado, devolver la madre
        // a despacho y sacarla del historial. Todo relativo al estado actual
        // (ver listas.js): durante el await pudo pasar cualquier otra cosa.
        setPedidos((prev) => reponerPorId(quitarPorId(prev, child.id), madre));
        setHistorial((prev) => quitarPorId(prev, madre.id));
        showToast("No se pudo guardar la remisión. Nada cambió.", 5000);
      }
    } else {
      // El mensaje rojo de "debe material" se RECALCULA con el saldo nuevo: si
      // no se hace, sigue mostrando material que ya salió en esta remisión.
      // Solo se mantiene encendido si la factura ya venía marcada así.
      const notaNueva = madre.entregaPendiente ? notaDesdeFaltantes(nuevosProductosMadre) : "";
      const nuevaMadre = {
        ...madre,
        productos: nuevosProductosMadre,
        entregaPendiente: !!notaNueva,
        notaPendiente: notaNueva,
      };
      setPedidos((prev) => [child, ...reemplazarPorId(prev, nuevaMadre)]);
      // Se abre la tirilla de una: es el momento en que se necesita imprimir.
      setTirillaDe(child);
      showToast(`Remisión ${numRemision} creada y enviada a despacho.`, 4000);
      try {
        await guardarRemisionConReintento(child);
        await actualizarPedido(nuevaMadre);
      } catch (e) {
        // Deshacer = quitar la remisión y devolverle a la madre su saldo
        // anterior, sin tocar nada más de la lista (ver listas.js).
        setPedidos((prev) => reemplazarPorId(quitarPorId(prev, child.id), madre));
        showToast("No se pudo guardar la remisión. Nada cambió.", 5000);
      }
    }
  }

  // --- Funciones del módulo de Cotizaciones (independiente de despacho) ---

  const persistCotizaciones = useCallback(async (next, cambiada) => {
    let prev;
    setCotizaciones((actual) => {
      prev = actual;
      return next;
    });
    try {
      if (cambiada) await guardarCotizacion(cambiada);
    } catch (e) {
      // Una sola escritura: con revertir al estado anterior basta.
      setCotizaciones(prev);
      showToast("No se pudo guardar la cotización. El cambio se revirtió.", 5000);
    }
  }, []);

  async function handleCotizacionFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      showToast("Ese archivo no es un PDF. Busca el archivo que termina en .pdf e inténtalo de nuevo.");
      e.target.value = "";
      return;
    }
    setUploadState("reading");
    try {
      const [lines, dataUrl] = await Promise.all([extractPdfLines(file), fileToDataUrl(file)]);
      const parsed = parseDocumento(lines);
      setPendingExtractCotizacion({
        ...parsed,
        // Mismo criterio que en facturas: el celular de contacto anotado
        // pasa al campo real de teléfono si no hay uno registrado.
        telefono:
          parsed.telefono && parsed.telefono !== "111111111"
            ? parsed.telefono
            : parsed.telefonoContacto || parsed.telefono || "",
        pdfDataUrl: dataUrl,
        fileName: file.name,
        estado: "pendiente",
        fechaSeguimiento: "",
      });
    } catch (err) {
      showToast("No se pudo leer este PDF. Si es una foto o un escaneo, no funciona: usa el PDF original que genera el programa de facturación.", 5000);
    }
    setUploadState("idle");
    e.target.value = "";
  }

  function confirmPendingExtractCotizacion(data) {
    if (!data.cliente || !data.cliente.trim()) {
      showToast("Escribe el nombre del cliente antes de guardar");
      return;
    }
    const nueva = {
      id: uid(),
      numeroFactura: data.numeroFactura || "",
      cliente: data.cliente.trim(),
      telefono: data.telefono || "",
      telefonoContacto: data.telefonoContacto || "",
      direccion: data.direccion || "",
      vendedor: data.vendedor || "",
      total: data.total || null,
      productos: data.productos || [],
      pdfDataUrl: data.pdfDataUrl,
      fileName: data.fileName,
      // Fecha del documento (la impresa en la factura/cotización). Si el
      // lector no la encontró, se usa la de hoy. Es la que cuenta para saber
      // hace cuánto se generó, no el día en que se subió el PDF.
      fecha: data.fechaDocumento || todayStr(),
      estado: "pendiente",
      fechaSeguimiento: data.fechaSeguimiento || null,
      fechaVencimiento: data.fechaVencimiento || null,
      notas: data.notas || "",
    };
    persistCotizaciones([nueva, ...cotizaciones], nueva);
    setPendingExtractCotizacion(null);
    showToast("Cotización agregada");
  }

  // Pasa una cotización (o una factura que se subió por error en este tablero)
  // al flujo de despacho, SIN volver a subir el PDF: se trae de la base de
  // datos, donde ya está guardado.
  //
  // Antes, "Aceptar" solo pintaba la tarjeta de verde y ahí moría: para
  // despacharla había que ir a la pestaña Despacho y volver a subir un PDF que
  // el vendedor a veces ya no tenía como archivo. La cotización verde PARECÍA
  // atendida y nadie la auditaba: la venta se cerraba y el material no salía.
  async function pasarCotizacionADespacho(cot) {
    if (cot.pedidoId && pedidos.some((p) => p.id === cot.pedidoId)) {
      showToast("Esta cotización ya está en despacho.");
      return;
    }
    // El PDF no viene en la carga de listas (pesa megas); se pide bajo demanda.
    let pdf = cot.pdfDataUrl;
    if (pdf === undefined && cot.tienePdf) {
      try {
        pdf = await cargarPdfCotizacion(cot.id);
      } catch (e) {
        // Sin PDF se puede despachar igual: los datos ya están extraídos. Solo
        // avisamos para que nadie crea que el respaldo quedó adjunto.
        pdf = null;
        showToast("No se pudo traer el PDF; el pedido se crea sin documento adjunto.", 4000);
      }
    }
    setPendingExtract({
      tipo: "cotizacion",
      numeroFactura: cot.numeroFactura || "",
      cliente: cot.cliente || "",
      telefono: cot.telefono || "",
      telefonoContacto: cot.telefonoContacto || "",
      direccion: cot.direccion || "",
      vendedor: cot.vendedor || "",
      total: cot.total || null,
      productos: cot.productos || [],
      // Ya se revisaron al subirla; no hay líneas nuevas que reportar.
      lineasIgnoradas: [],
      // Se conserva la fecha impresa del documento, no la de hoy.
      fechaDocumento: cot.fecha || null,
      pdfDataUrl: pdf === undefined ? null : pdf,
      fileName: cot.fileName,
      vehiculo: "",
      estadoPago: "pendiente",
      // Marca de origen: al confirmar, confirmPendingExtract cierra la
      // cotización como aceptada y le enlaza el pedido creado.
      desdeCotizacion: cot.id,
    });
    // La tarjeta de revisión se dibuja en la vista de despacho.
    setView("despacho");
  }

  function deleteCotizacion(id) {
    const prev = cotizaciones;
    setCotizaciones(cotizaciones.filter((c) => c.id !== id));
    eliminarCotizacion(id).catch(() => {
      setCotizaciones(prev);
      showToast("No se pudo eliminar de la base de datos. La cotización se restauró.", 5000);
    });
  }

  function updateCotizacion(id, patch) {
    const actualizada = { ...cotizaciones.find((c) => c.id === id), ...patch };
    persistCotizaciones(cotizaciones.map((c) => (c.id === id ? actualizada : c)), actualizada);
  }

  // Derivaciones memoizadas: sin useMemo, cada render del componente (un
  // toast, una tecla en un buscador, un dragover) rehacía todos estos
  // filter/sort aunque los datos no hubieran cambiado.
  const cotizacionesAgrupadas = useMemo(() => {
    const filtradas = cotizaciones.filter((c) => {
      if (!cotizacionFilter.trim()) return true;
      const q = cotizacionFilter.toLowerCase();
      return (
        (c.cliente || "").toLowerCase().includes(q) ||
        (c.numeroFactura || "").toLowerCase().includes(q) ||
        (c.fecha || "").toLowerCase().includes(q)
      );
    });
    return ESTADOS_COTIZACION.map((est) => ({
      ...est,
      items: filtradas
        .filter((c) => (c.estado || "pendiente") === est.id)
        .sort((a, b) => (b.id > a.id ? 1 : -1)),
    }));
  }, [cotizaciones, cotizacionFilter]);

  // Avisos de seguimiento: cotizaciones pendientes cuya fecha de
  // seguimiento es hoy o mañana, para recordar llamar al cliente.
  const mananaIso = addDaysISO(hoyIso, 1);
  const cotizacionesConSeguimientoProximo = useMemo(
    () =>
      cotizaciones.filter(
        (c) =>
          (c.estado || "pendiente") === "pendiente" &&
          c.fechaSeguimiento &&
          (c.fechaSeguimiento === hoyIso || c.fechaSeguimiento === mananaIso)
      ),
    [cotizaciones, hoyIso, mananaIso]
  );

  // Cotizaciones pendientes cuya fecha de seguimiento ya pasó sin que nadie
  // las atendiera: merecen una alerta más urgente que las de "próximo".
  const cotizacionesConSeguimientoVencido = useMemo(
    () =>
      cotizaciones.filter(
        (c) => (c.estado || "pendiente") === "pendiente" && c.fechaSeguimiento && c.fechaSeguimiento < hoyIso
      ),
    [cotizaciones, hoyIso]
  );

  function handleDragStart(id) {
    setDragId(id);
  }
  // Se dispara al TERMINAR cualquier arrastre, caiga donde caiga. Sin esto,
  // soltar la tarjeta fuera del tablero (o cancelar con Esc) dejaba dragId
  // "pegado", y el siguiente drop sobre una columna —incluso arrastrando
  // texto o un archivo externo— movía ese pedido viejo de vehículo.
  function handleDragEnd() {
    setDragId(null);
    setDragOverCol(null);
  }
  function handleDropOnColumn(vehiculoId, overId) {
    if (!dragId) return;
    const dragged = pedidos.find((p) => p.id === dragId);
    if (!dragged) return;

    const dragFecha = fechaDe(dragged);

    // Si el pedido arrastrado es parte de un viaje juntado, se mueve TODO el
    // grupo como un bloque (sus miembros siempre comparten vehículo y fecha).
    const idsArrastrados = dragged.grupoId
      ? pedidos.filter((p) => p.grupoId === dragged.grupoId).map((p) => p.id)
      : [dragId];
    const setArrastrados = new Set(idsArrastrados);

    // Solo reordenamos dentro de los pedidos de la misma fecha de despacho
    // que el pedido arrastrado; los de otras fechas quedan intactos.
    const others = pedidos.filter(
      (p) => !setArrastrados.has(p.id) && !(fechaDe(p) === dragFecha && p.vehiculo === vehiculoId)
    );
    const colItems = pedidos
      .filter((p) => !setArrastrados.has(p.id) && fechaDe(p) === dragFecha && p.vehiculo === vehiculoId)
      .sort(compararOrden);

    // El bloque arrastrado (uno o varios si es grupo), en su orden interno.
    const bloque = pedidos
      .filter((p) => setArrastrados.has(p.id))
      .sort(compararOrden)
      .map((p) => {
        const m = { ...p, vehiculo: vehiculoId };
        if (m.vehiculoSecundario === vehiculoId) m.vehiculoSecundario = null;
        return m;
      });

    let insertAt = colItems.length;
    if (overId && !setArrastrados.has(overId)) {
      const idx = colItems.findIndex((p) => p.id === overId);
      if (idx !== -1) insertAt = idx;
    }
    colItems.splice(insertAt, 0, ...bloque);

    // Copias con el orden nuevo (mutar los objetos del estado anterior en
    // sitio corrompía el snapshot previo de React), y a la base de datos
    // solo van las filas que de verdad cambiaron, no toda la columna.
    // El Map por id evita un find() dentro del filter (O(n²) → O(n)).
    const reordenados = colItems.map((p, i) => ({ ...p, orden: i + 1 }));
    const porId = new Map(pedidos.map((p) => [p.id, p]));
    const cambiados = reordenados.filter((p) => {
      const antes = porId.get(p.id);
      return (
        !antes ||
        antes.orden !== p.orden ||
        antes.vehiculo !== p.vehiculo ||
        antes.vehiculoSecundario !== p.vehiculoSecundario
      );
    });

    persistPedidos([...others, ...reordenados], cambiados);
    setDragId(null);
    setDragOverCol(null);
  }

  // Pedidos que quedaron debiendo material, sin importar de qué día sean.
  // Es lo primero que la persona del mostrador necesita ver al abrir la app.

  const pedidosPendientes = useMemo(() => pedidos.filter((p) => fechaDe(p) === "pendiente"), [pedidos, hoyIso]);

  // Pedidos que ya están listos pero se llevan solo cuando salga un viaje a
  // esa zona. Usan el valor especial "viaje" en fechaDespacho (hermano de
  // "pendiente"): no ocupan una fecha real ni el tablero de un día.
  const pedidosEsperaViaje = useMemo(() => pedidos.filter((p) => fechaDe(p) === "viaje"), [pedidos, hoyIso]);

  // Datos derivados para la pantalla "Por entregar": cuánto lleva entregado
  // cada factura, cuántas remisiones se le han hecho y hace cuántos días se
  // movió por última vez. Se calculan aquí (no en el componente) porque hay que
  // cruzar la factura con sus remisiones, que viven en pedidos e historial.
  const facturasPorEntregar = useMemo(() => {
    const todos = [...pedidos, ...historial];
    return pedidosPendientes.map((f) => {
      const productos = f.productos || [];
      // % entregado POR VALOR: cada línea aporta según su peso en pesos, así
      // una línea de $3M cuenta más que una de $9.000.
      let valorTotal = 0;
      let valorEntregado = 0;
      for (const p of productos) {
        const totalLinea = parseInt(String(p.total || "0").replace(/\./g, ""), 10) || 0;
        const cant = cantidadNum(p.cantidad);
        // Copia inline (la séptima, la que se había desviado) -> saldo.js.
        const resta = saldoDe(p);
        valorTotal += totalLinea;
        valorEntregado += cant > 0 ? (totalLinea * (cant - resta)) / cant : 0;
      }
      const porcentajeEntregado = valorTotal > 0 ? Math.round((valorEntregado / valorTotal) * 100) : 0;

      // Remisiones hechas contra esta factura (activas o ya entregadas). La regla
      // del enlace vive en remisiones.js, con tests.
      const hijas = remisionesDe(f, todos);

      // Última señal de movimiento: la remisión más reciente; si no hay
      // ninguna, la fecha en que se subió la factura.
      const fechas = [];
      // Descuentos de material hechos a mano: no generan remisión, pero sí son
      // movimiento sobre la factura.
      for (const prod of productos) {
        if (prod.fechaMovimiento) fechas.push(prod.fechaMovimiento);
      }
      for (const h of hijas) {
        const entregada = fechaEntregaISO(h);
        if (entregada) fechas.push(entregada);
        else if (h.fechaDespacho && /^\d{4}-\d{2}-\d{2}$/.test(h.fechaDespacho)) fechas.push(h.fechaDespacho);
      }
      if (fechas.length === 0 && f.fecha && f.fecha.includes("/")) {
        const [d, m, y] = f.fecha.split("/");
        if (d && m && y) fechas.push(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
      }
      const ultima = fechas.sort().pop() || null;
      let diasSinMovimiento = 0;
      if (ultima) {
        const [ay, am, ad] = ultima.split("-").map(Number);
        const [hy, hm, hd] = hoyIso.split("-").map(Number);
        diasSinMovimiento = Math.max(0, Math.round((Date.UTC(hy, hm - 1, hd) - Date.UTC(ay, am - 1, ad)) / 86400000));
      }

      return {
        ...f,
        porcentajeEntregado,
        numeroRemisiones: hijas.length,
        diasSinMovimiento,
        fecha: f.fecha || "",
        telefono: f.telefono || f.telefonoContacto || "",
        destino: f.destino || "Sin destino",
      };
    });
  }, [pedidosPendientes, pedidos, historial, hoyIso]);

  // ¿El documento que se está por guardar ya existe? Nada impedía subir la misma
  // factura dos veces: quedaban dos tarjetas idénticas en dos columnas y se
  // despachaba doble, o alguien perdía media hora averiguando cuál era la buena.
  // Es un AVISO, no un bloqueo: hay casos legítimos (una nota de la misma
  // factura, un número corregido a mano), y bloquear agregaría trabajo.
  // En el caso normal —número nuevo— no aparece nada y no cuesta ningún toque.
  const duplicadoPendiente = useMemo(() => {
    const num = (pendingExtract && pendingExtract.numeroFactura ? String(pendingExtract.numeroFactura) : "").trim();
    if (!num) return null;
    // Un pedido que nació de esta misma cotización no es un duplicado.
    // Acá había una guardia que pretendía excluir "el pedido que nació de esta
    // misma cotización": comparaba `pendingExtract.desdeCotizacion` (un id de
    // COTIZACIÓN) contra `p.id` (un id de PEDIDO). Son dominios distintos, así
    // que nunca coincidían y la condición era siempre verdadera: no excluía
    // nada. Se quitó en vez de "arreglarla" porque lo que quería proteger ya
    // está cubierto, y mejor, en pasarCotizacionADespacho: si la cotización ya
    // tiene un pedido ACTIVO, ni siquiera se llega hasta aquí.
    //
    // El único caso que sí llega es que ese pedido ya se haya entregado, y ahí
    // avisar es lo correcto: "esta factura ya está en el historial" es
    // justamente lo que hay que saber antes de despacharla otra vez.
    const existente =
      pedidos.find((p) => (p.numeroFactura || "").trim() === num) ||
      historial.find((p) => (p.numeroFactura || "").trim() === num);
    if (!existente) return null;
    const enHistorial = !pedidos.some((p) => p.id === existente.id);
    let donde;
    if (enHistorial) {
      donde = `ya está entregada (historial${existente.fechaEntrega ? `, ${existente.fechaEntrega}` : ""})`;
    } else {
      const f = fechaDe(existente);
      const veh = (VEHICULOS.find((v) => v.id === existente.vehiculo) || {}).label;
      const cuando =
        f === "pendiente" ? "Por entregar" : f === "viaje" ? "Por viaje" : etiquetaFecha(f, hoyIso);
      donde = `ya está en despacho (${[veh, cuando].filter(Boolean).join(", ")})`;
    }
    return { numero: num, cliente: existente.cliente || "", donde };
  }, [pendingExtract, pedidos, historial, hoyIso]);

  // Resultados del buscador de Despachos: pedidos activos (de cualquier fecha,
  // incluidos Pendientes y Por viaje) que coincidan por cliente, número de
  // factura, dirección, destino o vendedor. Sin acentos ni mayúsculas para que
  // "corozal" encuentre "Corozal". Vacío = no se filtra (se usa el tablero).
  const busquedaNorm = normalizarTexto(busquedaDespacho).trim();
  const resultadosBusqueda = useMemo(() => {
    if (!busquedaNorm) return [];
    return pedidos.filter((p) => {
      const campos = [p.cliente, p.numeroFactura, p.direccion, p.destino, p.vendedor];
      return campos.some((c) => normalizarTexto(c).includes(busquedaNorm));
    });
  }, [pedidos, busquedaNorm]);

  // --- Cálculos del Panel (resumen del día) ---
  function intentarDesbloquearPanel() {
    if (pinIntento === PIN_PANEL) {
      setPanelDesbloqueado(true);
      setPinIntento("");
      setPinError(false);
      try {
        sessionStorage.setItem("panelDesbloqueado", "1");
      } catch (e) {
        console.warn("No se pudo recordar el desbloqueo del panel:", e);
      }
    } else {
      setPinError(true);
    }
  }

  // Agrupa el historial (pedidos entregados) por día local de Colombia.
  const entregasPorDia = useMemo(() => {
    const mapa = new Map();
    for (const p of historial) {
      const iso = fechaEntregaISO(p);
      if (!iso) continue;
      if (!mapa.has(iso)) mapa.set(iso, []);
      mapa.get(iso).push(p);
    }
    return mapa;
  }, [historial]);

  // Días con al menos una entrega, del más nuevo al más viejo.
  const diasConEntrega = useMemo(
    () => [...entregasPorDia.keys()].sort((a, b) => (a < b ? 1 : -1)),
    [entregasPorDia]
  );

  // Día por defecto al abrir el Panel: ayer si tuvo entregas; si no, el día más
  // reciente que sí tuvo (y si no hay ninguno, ayer aunque salga vacío).
  const panelDiaPorDefecto = useMemo(() => {
    const ayer = addDaysISO(todayISO(), -1);
    if (entregasPorDia.has(ayer)) return ayer;
    return diasConEntrega[0] || ayer;
  }, [entregasPorDia, diasConEntrega]);

  const panelDiaMostrado = panelDia || panelDiaPorDefecto;

  // Resumen del día mostrado: pedidos, kilos, facturado y desglose por vehículo
  // y por destino. Los kilos de un pedido con dos vehículos se cuentan solo al
  // principal (para no duplicar el total del día); el secundario suma el pedido.
  const resumenPanel = useMemo(() => {
    const lista = entregasPorDia.get(panelDiaMostrado) || [];
    let kilos = 0;
    const porVehiculo = new Map();
    const porDestino = new Map();
    // "Qué se movió": agrupa TODAS las líneas de producto del día por categoría
    // de material (la misma que usa el peso). Suma unidades y kilos por categoría
    // para ver de verdad qué salió (ej: "Cemento: 120 bultos"). Los productos sin
    // categoría conocida caen en "Otros".
    const porCategoria = new Map();
    const pedidosDia = [];
    for (const p of lista) {
      const cargaP = cargaDePedido(p);
      kilos += cargaP;
      const veh = p.vehiculo || "Sin vehículo";
      if (!porVehiculo.has(veh)) porVehiculo.set(veh, { pedidos: 0, kilos: 0 });
      porVehiculo.get(veh).pedidos += 1;
      porVehiculo.get(veh).kilos += cargaP;
      if (p.vehiculoSecundario) {
        if (!porVehiculo.has(p.vehiculoSecundario)) porVehiculo.set(p.vehiculoSecundario, { pedidos: 0, kilos: 0 });
        porVehiculo.get(p.vehiculoSecundario).pedidos += 1;
      }
      const dest = p.destino || "Sin destino";
      porDestino.set(dest, (porDestino.get(dest) || 0) + 1);
      for (const prod of p.productos || []) {
        if (esLineaFlete(prod && prod.descripcion)) continue; // se cuenta aparte, en $ no en kg
        const cat = categoriaDeProducto(prod && prod.descripcion);
        const nombre = cat ? cat.nombre : "Otros";
        if (!porCategoria.has(nombre)) porCategoria.set(nombre, { unidades: 0, kilos: 0 });
        porCategoria.get(nombre).unidades += cantidadEntregadaDe(prod);
        porCategoria.get(nombre).kilos += pesoDeProducto(prod);
      }
      pedidosDia.push({
        id: p.id,
        cliente: p.cliente,
        numeroFactura: p.numeroFactura,
        vehiculo: p.vehiculo,
        kilos: cargaP,
        // Detalle de lo que se contó en esta factura, para poder verificar en
        // el Panel que el total de material cuadra con lo que salió de verdad.
        items: (p.productos || []).map((prod) => ({
          descripcion: prod.descripcion || "(sin descripción)",
          unidad: prod.unidad || "",
          contada: cantidadEntregadaDe(prod),
          facturada: cantidadNum(prod.cantidad),
          kilos: esLineaFlete(prod.descripcion) ? 0 : pesoDeProducto(prod),
          esFlete: esLineaFlete(prod.descripcion),
        })),
      });
    }
    return {
      totalPedidos: lista.length,
      kilos,
      porVehiculo: [...porVehiculo.entries()].sort((a, b) => b[1].kilos - a[1].kilos),
      porDestino: [...porDestino.entries()].sort((a, b) => b[1] - a[1]),
      porCategoria: [...porCategoria.entries()].sort((a, b) => b[1].kilos - a[1].kilos),
      pedidosDia: pedidosDia.sort((a, b) => b.kilos - a.kilos),
    };
  }, [entregasPorDia, panelDiaMostrado]);

  // "Sin categorizar": productos entregados (en TODO el historial, no solo el
  // día mostrado — para tener datos suficientes) cuya descripción no coincidió
  // con ninguna clave de CATEGORIAS_PESO y cayeron en "Otros". Se agrupan por
  // descripción normalizada para ver cuáles se repiten más — esas son las que
  // vale la pena agregar a la tabla de pesos. No es un cálculo "en vivo": es
  // una foto de lo que ya se entregó, así que un ajuste a la tabla no lo hace
  // desaparecer de aquí retroactivamente hasta la próxima entrega.
  const sinCategorizar = useMemo(() => {
    const mapa = new Map();
    for (const p of historial) {
      for (const prod of p.productos || []) {
        if (esLineaFlete(prod && prod.descripcion)) continue; // no es material, se reporta aparte
        const cat = categoriaDeProducto(prod && prod.descripcion);
        if (cat) continue; // ya tiene categoría, no nos interesa aquí
        const desc = (prod && prod.descripcion ? prod.descripcion.trim() : "") || "(sin descripción)";
        const clave = normalizarTexto(desc);
        if (!mapa.has(clave)) mapa.set(clave, { descripcion: desc, veces: 0, unidades: 0 });
        const entry = mapa.get(clave);
        entry.veces += 1;
        entry.unidades += cantidadEntregadaDe(prod);
      }
    }
    return [...mapa.values()].sort((a, b) => b.veces - a.veces);
  }, [historial]);

  // Promedio de kilos por día CON despacho en los últimos 30 días. Es la
  // referencia del % de rendimiento (los días cerrados no cuentan como 0).
  const promedioKilos30d = useMemo(() => {
    const hoy = todayISO();
    const hace30 = addDaysISO(hoy, -30);
    let suma = 0;
    let dias = 0;
    for (const [iso, lista] of entregasPorDia.entries()) {
      if (iso >= hace30 && iso <= hoy) {
        let k = 0;
        for (const p of lista) k += cargaDePedido(p);
        suma += k;
        dias += 1;
      }
    }
    return dias ? suma / dias : 0;
  }, [entregasPorDia]);

  // Navegación entre días con entregas, relativa al día mostrado.
  const panelDiaAnterior = useMemo(
    () => diasConEntrega.find((d) => d < panelDiaMostrado) || null,
    [diasConEntrega, panelDiaMostrado]
  );
  const panelDiaSiguiente = useMemo(() => {
    const masNuevos = diasConEntrega.filter((d) => d > panelDiaMostrado);
    return masNuevos.length ? masNuevos[masNuevos.length - 1] : null;
  }, [diasConEntrega, panelDiaMostrado]);

  // Carga (kilos) de los últimos 14 días terminando en el día mostrado, para la
  // mini-gráfica de tendencia. El último punto es el día que se está viendo.
  const tendenciaPanel = useMemo(() => {
    const DIAS = 14;
    const dias = [];
    let max = 0;
    for (let i = DIAS - 1; i >= 0; i--) {
      const iso = addDaysISO(panelDiaMostrado, -i);
      const lista = entregasPorDia.get(iso) || [];
      let kg = 0;
      for (const p of lista) kg += cargaDePedido(p);
      if (kg > max) max = kg;
      dias.push({ iso, kg, esActual: i === 0 });
    }
    return { dias, max };
  }, [entregasPorDia, panelDiaMostrado]);

  // Un pedido cuya fecha de despacho ya pasó y sigue activo está ATRASADO:
  // se muestra automáticamente en la pestaña "Hoy" (con etiqueta roja), en
  // vez de quedar escondido en una pestaña de fecha vieja. No le reescribimos
  // la fecha en la base de datos: así no se pierde el rastro de cuándo debió
  // salir. El botón "Mover a hoy" de la tarjeta sí lo pone al día formalmente.
  const esAtrasado = (p) => {
    const f = fechaDe(p);
    return f !== "pendiente" && f !== "viaje" && f < hoyIso;
  };

  // Un pedido aparece en la columna de su vehículo principal y, si tiene un
  // vehículo secundario asignado, también en la columna de ese segundo
  // vehículo. No se duplica el registro: es la misma tarjeta mostrada dos
  // veces. En la columna secundaria se muestra en modo "solo lectura".
  const grouped = useMemo(() => {
    const pedidosDelDia =
      selectedDate === hoyIso
        ? pedidos.filter((p) => fechaDe(p) === hoyIso || esAtrasado(p))
        : pedidos.filter((p) => fechaDe(p) === selectedDate);
    return VEHICULOS.map((v) => ({
      ...v,
      items: pedidosDelDia
        .filter((p) => p.vehiculo === v.id || p.vehiculoSecundario === v.id)
        .sort((a, b) => {
          // Los atrasados van primero (los más viejos arriba); dentro de la
          // misma fecha se respeta el orden que armó el despachador.
          const fa = fechaDe(a);
          const fb = fechaDe(b);
          if (fa !== fb) return fa < fb ? -1 : 1;
          return compararOrden(a, b);
        }),
    }));
  }, [pedidos, selectedDate, hoyIso]);

  // Pestañas de fecha: siempre Hoy y Mañana, más cualquier fecha futura que
  // ya tenga pedidos programados. Las fechas pasadas no generan pestaña:
  // sus pedidos (atrasados) se muestran dentro de "Hoy" con etiqueta roja.
  // "pendiente" se excluye de este cálculo: tiene su propia pestaña fija aparte.
  // El conteo por pestaña se hace en UNA sola pasada sobre los pedidos (antes
  // era un filter completo por cada pestaña): un atrasado (fecha < hoy) cuenta
  // en "Hoy", que es donde se muestra.
  const { fechasTabs, conteoPorFecha } = useMemo(() => {
    const fechasConPedidos = Array.from(new Set(pedidos.map(fechaDe))).filter(
      (f) => f !== "pendiente" && f !== "viaje" && f >= hoyIso
    );
    const tabs = Array.from(new Set([hoyIso, addDaysISO(hoyIso, 1), ...fechasConPedidos])).sort();
    const conteo = {};
    for (const f of tabs) conteo[f] = 0;
    for (const p of pedidos) {
      const f = fechaDe(p);
      if (f === "pendiente" || f === "viaje") continue;
      const tab = f < hoyIso ? hoyIso : f;
      if (conteo[tab] !== undefined) conteo[tab] += 1;
    }
    return { fechasTabs: tabs, conteoPorFecha: conteo };
  }, [pedidos, hoyIso]);

  // Si la pestaña seleccionada deja de existir (se entregó el último pedido
  // de una fecha atrasada, o la app quedó abierta de un día para otro y
  // "hoy" ya es otra fecha), volvemos a la pestaña de hoy en vez de dejar
  // el tablero apuntando a una fecha sin pestaña.
  useEffect(() => {
    if (selectedDate !== "pendiente" && selectedDate !== "viaje" && !fechasTabs.includes(selectedDate)) {
      setSelectedDate(hoyIso);
    }
  }, [selectedDate, fechasTabs.join(","), hoyIso]);

  // Al cambiar de pestaña se sale del modo juntar (la selección era de esa
  // pestaña; mantenerla abierta entre pestañas confundía qué se iba a juntar).
  useEffect(() => {
    setModoJuntar(false);
    setSeleccionJuntar([]);
  }, [selectedDate]);

  // Historial que se muestra. Sin búsqueda es el precargado (los últimos 90
  // días); con búsqueda son los resultados que trae el servidor, que abarcan
  // TODO el historial sin límite de fecha.
  //
  // Antes esto filtraba el arreglo en memoria, así que el buscador solo
  // encontraba entre lo cargado — y como el historial se cargaba completo,
  // "completo" iba a dejar de serlo en silencio al pasar de 1.000 filas. Ahora
  // busca donde están los datos de verdad.
  const filteredHistorial = useMemo(() => {
    if (!historyFilter.trim()) return historial;
    // Mientras llegan los resultados del servidor se muestra lo que ya hay
    // filtrado localmente, para que la lista no parpadee en vacío.
    if (resultadosHistorial === null) {
      const q = normalizarTexto(historyFilter);
      return historial.filter(
        (h) => normalizarTexto(h.cliente).includes(q) || normalizarTexto(h.numeroFactura).includes(q)
      );
    }
    return resultadosHistorial;
  }, [historial, historyFilter, resultadosHistorial]);

  // Consulta al servidor con freno (300 ms): sin esto se dispararía una consulta
  // por cada tecla.
  useEffect(() => {
    const q = historyFilter.trim();
    if (!q) {
      setResultadosHistorial(null);
      return;
    }
    let vivo = true;
    setBuscandoHistorial(true);
    const t = setTimeout(() => {
      buscarHistorial(q)
        .then((r) => {
          if (!vivo) return;
          setResultadosHistorial(r);
          setBuscandoHistorial(false);
        })
        .catch(() => {
          if (!vivo) return;
          // Si la búsqueda en el servidor falla, se queda el filtro local: peor
          // es dejar la pantalla en blanco.
          setResultadosHistorial(null);
          setBuscandoHistorial(false);
        });
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [historyFilter]);

  if (loading) {
    return (
      <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
        Cargando pedidos...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      {/* Foco visible al navegar con teclado o lector de pantalla */}
      <style>{`
        button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible {
          outline: 3px solid #378ADD;
          outline-offset: 2px;
        }
        button, a {
          touch-action: manipulation;
          -webkit-tap-highlight-color: rgba(55, 138, 221, 0.15);
        }
        /* En pantallas táctiles: target de 44px y fuente de input de 16px
           (por debajo de 16px, iOS hace zoom automático al tocar un campo). */
        @media (pointer: coarse) {
          button { min-height: 44px; }
          input, textarea, select { font-size: 16px; }
        }
      `}</style>
      <h2 className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
        Sistema de despacho de pedidos: lista por vehículo con subida de facturas y cotizaciones en PDF
      </h2>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: "1.25rem",
          paddingBottom: "0.75rem",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "var(--border-radius-md)",
            background: MARCA.azulOscuro,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <i className="ti ti-building-warehouse" style={{ fontSize: 22, color: "white" }} aria-hidden="true"></i>
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.2, color: MARCA.azulMuyOscuro }}>Ferromateriales San Blas</div>
          <div style={{ fontSize: 12, color: MARCA.azulMedio, fontWeight: 500, lineHeight: 1.3 }}>Despacho de pedidos</div>
        </div>

        {/* Salir. Hasta ahora salir() existía en supabaseClient.js y no la
            llamaba nadie: la sesión se guarda en el navegador y se renueva sola,
            así que la tablet del mostrador quedaba dentro PARA SIEMPRE y no
            había forma de sacarla desde la app. Si el equipo se pierde o alguien
            sale de la empresa, tocaba cambiar la clave compartida en Supabase y
            eso tumba a todo el mundo.

            Pide dos toques a propósito: un clic accidental en plena jornada
            dejaría al despachador escribiendo correo y clave otra vez. Se
            desarma solo a los 4 segundos para que el botón no quede cebado. */}
        <button
          onClick={confirmandoSalir ? salir : pedirConfirmacionSalir}
          title={confirmandoSalir ? "Toca otra vez para salir" : "Cerrar sesión en este dispositivo"}
          style={{
            marginLeft: "auto",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 500,
            minHeight: 40,
            padding: "8px 12px",
            borderRadius: "var(--border-radius-md)",
            cursor: "pointer",
            background: confirmandoSalir ? "var(--color-background-danger)" : "transparent",
            color: confirmandoSalir ? "var(--color-text-danger)" : "var(--color-text-secondary)",
            border: confirmandoSalir ? "0.5px solid var(--color-border-danger)" : "0.5px solid var(--color-border-tertiary)",
          }}
        >
          <i className="ti ti-logout" style={{ fontSize: 15 }} aria-hidden="true"></i>
          {confirmandoSalir ? "¿Salir?" : "Salir"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setView("despacho")}
            aria-pressed={view === "despacho"}
            style={{
              border: view === "despacho" ? "none" : "0.5px solid var(--color-border-tertiary)",
              background: view === "despacho" ? MARCA.azulOscuro : "transparent",
              color: view === "despacho" ? "white" : "var(--color-text-primary)",
              fontWeight: view === "despacho" ? 500 : 400,
              padding: "6px 14px",
              minHeight: 40,
              borderRadius: "var(--border-radius-md)",
              fontSize: 14,
            }}
          >
            <i className="ti ti-truck-delivery" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
            Despacho
          </button>
          <button
            onClick={() => setView("historial")}
            aria-pressed={view === "historial"}
            style={{
              border: view === "historial" ? "none" : "0.5px solid var(--color-border-tertiary)",
              background: view === "historial" ? MARCA.azulOscuro : "transparent",
              color: view === "historial" ? "white" : "var(--color-text-primary)",
              fontWeight: view === "historial" ? 500 : 400,
              padding: "6px 14px",
              minHeight: 40,
              borderRadius: "var(--border-radius-md)",
              fontSize: 14,
            }}
          >
            <i className="ti ti-history" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
            Historial
          </button>
          <button
            onClick={() => setView("cotizaciones")}
            aria-pressed={view === "cotizaciones"}
            style={{
              border: view === "cotizaciones" ? "none" : "0.5px solid var(--color-border-tertiary)",
              background: view === "cotizaciones" ? MARCA.azulOscuro : "transparent",
              color: view === "cotizaciones" ? "white" : "var(--color-text-primary)",
              fontWeight: view === "cotizaciones" ? 500 : 400,
              padding: "6px 14px",
              minHeight: 40,
              borderRadius: "var(--border-radius-md)",
              fontSize: 14,
            }}
          >
            <i className="ti ti-file-text" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
            Cotizaciones
          </button>
          <button
            onClick={() => setView("panel")}
            aria-pressed={view === "panel"}
            style={{
              border: view === "panel" ? "none" : "0.5px solid var(--color-border-tertiary)",
              background: view === "panel" ? MARCA.azulOscuro : "transparent",
              color: view === "panel" ? "white" : "var(--color-text-primary)",
              fontWeight: view === "panel" ? 500 : 400,
              padding: "6px 14px",
              minHeight: 40,
              borderRadius: "var(--border-radius-md)",
              fontSize: 14,
            }}
          >
            <i className="ti ti-chart-bar" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
            Panel
          </button>
        </div>

        {view === "despacho" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelected} style={{ display: "none" }} />
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={uploadState === "reading"}
              style={{
                border: "none",
                background: MARCA.azulMedio,
                color: "white",
                fontWeight: 500,
                padding: "8px 16px",
                minHeight: 44,
                borderRadius: "var(--border-radius-md)",
                fontSize: 14,
              }}
            >
              <i className="ti ti-file-upload" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
              {uploadState === "reading" ? "Leyendo PDF..." : "Subir factura o cotización"}
            </button>
            <button
              onClick={() => setRemisionManualAbierta(true)}
              style={{
                border: "0.5px solid var(--color-border-tertiary)",
                background: "var(--color-background-secondary)",
                color: "var(--color-text-primary)",
                fontWeight: 500,
                padding: "8px 16px",
                minHeight: 44,
                borderRadius: "var(--border-radius-md)",
                fontSize: 14,
              }}
            >
              <i className="ti ti-pencil-plus" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
              Remisión manual
            </button>
          </div>
        )}

        {view === "cotizaciones" && (
          <div>
            <input
              ref={cotizacionFileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleCotizacionFileSelected}
              style={{ display: "none" }}
            />
            <button
              onClick={() => cotizacionFileInputRef.current && cotizacionFileInputRef.current.click()}
              disabled={uploadState === "reading"}
              style={{
                border: "none",
                background: MARCA.azulMedio,
                color: "white",
                fontWeight: 500,
                padding: "8px 16px",
                minHeight: 44,
                borderRadius: "var(--border-radius-md)",
                fontSize: 14,
              }}
            >
              <i className="ti ti-file-upload" style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
              {uploadState === "reading" ? "Leyendo PDF..." : "Subir cotización"}
            </button>
          </div>
        )}
      </div>



      {faltaSql.length > 0 && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            background: "var(--color-background-warning)",
            border: "0.5px solid var(--color-border-warning)",
            color: "var(--color-text-warning)",
            fontSize: 13,
            padding: "10px 14px",
            borderRadius: "var(--border-radius-md)",
            marginBottom: 12,
          }}
        >
          <i className="ti ti-database-exclamation" style={{ fontSize: 17, flexShrink: 0, marginTop: 1 }} aria-hidden="true"></i>
          <span>
            <b>Falta un paso en la base de datos.</b> Corre{" "}
            <code style={{ background: "#fff", padding: "1px 5px", borderRadius: 4 }}>sql/tanda2-historial-remisiones.sql</code>{" "}
            en Supabase (SQL Editor → New query → pegar → Run). Mientras no lo hagas, crear remisiones va a fallar.
            <span style={{ display: "block", fontSize: 11.5, marginTop: 3, opacity: 0.85 }}>
              Falta: {faltaSql.join(", ")}
            </span>
          </span>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: "var(--color-background-success)",
            color: "var(--color-text-success)",
            fontSize: 13,
            padding: "8px 14px",
            borderRadius: "var(--border-radius-md)",
            marginBottom: 12,
          }}
        >
          {toast}
        </div>
      )}

      {/* Estilos de la tarjeta de pedido: una sola vez para toda la app. */}
      <style>{CARD_CSS}</style>

      {borradoPendiente && (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--color-background-warning)",
            border: "0.5px solid var(--color-border-warning)",
            color: "var(--color-text-warning)",
            fontSize: 13,
            padding: "10px 14px",
            borderRadius: "var(--border-radius-md)",
            marginBottom: 12,
          }}
        >
          <i className="ti ti-trash" style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true"></i>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Se eliminó el pedido de {borradoPendiente.cliente || "sin nombre"}
            {borradoPendiente.numeroFactura ? ` (${borradoPendiente.numeroFactura})` : ""}
          </span>
          <button
            onClick={deshacerBorrado}
            style={{
              flexShrink: 0,
              fontSize: 13,
              fontWeight: 600,
              minHeight: 40,
              padding: "8px 14px",
              border: "0.5px solid var(--color-border-warning)",
              background: "var(--color-background-primary)",
              color: "var(--color-text-warning)",
              borderRadius: "var(--border-radius-md)",
            }}
          >
            <i className="ti ti-arrow-back-up" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Deshacer
          </button>
        </div>
      )}

      {pendingExtract && (
        <ExtractReviewCard
          data={pendingExtract}
          duplicado={duplicadoPendiente}
          onChange={setPendingExtract}
          onConfirm={() => confirmPendingExtract(pendingExtract)}
          onCancel={() => setPendingExtract(null)}
        />
      )}

      {pendingExtractCotizacion && (
        <ExtractReviewCardCotizacion
          data={pendingExtractCotizacion}
          onChange={setPendingExtractCotizacion}
          onConfirm={() => confirmPendingExtractCotizacion(pendingExtractCotizacion)}
          onCancel={() => setPendingExtractCotizacion(null)}
        />
      )}

      {view === "despacho" ? (
        <>
          {/* Buscador del tablero. Va ARRIBA de los avisos y pestañas: mientras
              se escribe, abajo solo se ven los resultados (filas compactas y
              estables), sin que los banners/pestañas/tarjetas brinquen. Tocar
              un resultado lleva a la pestaña donde vive ese pedido.
              En "Por entregar" se esconde: esa pantalla trae su propio buscador
              (con orden y agrupación) y dos barras seguidas confundían. */}
          <div style={{ position: "relative", marginBottom: 12, display: selectedDate === "pendiente" ? "none" : "block" }}>
            <i
              className="ti ti-search"
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: "var(--color-text-tertiary)" }}
              aria-hidden="true"
            ></i>
            <input
              type="text"
              placeholder="Buscar pedido por cliente, factura, dirección..."
              value={busquedaDespacho}
              onChange={(e) => setBusquedaDespacho(e.target.value)}
              aria-label="Buscar pedidos en despacho"
              style={{ width: "100%", paddingLeft: 34, paddingRight: busquedaDespacho ? 40 : 12 }}
            />
            {busquedaDespacho && (
              <button
                onClick={() => setBusquedaDespacho("")}
                aria-label="Borrar búsqueda"
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", minWidth: 32, minHeight: 32, padding: 0, border: "none", background: "transparent", color: "var(--color-text-tertiary)" }}
              >
                <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
              </button>
            )}
          </div>

          {busquedaNorm ? (
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8, minHeight: 18 }}>
                {resultadosBusqueda.length === 0
                  ? `No se encontró ningún pedido con "${busquedaDespacho.trim()}".`
                  : `${resultadosBusqueda.length} ${resultadosBusqueda.length === 1 ? "coincidencia" : "coincidencias"} — toca una para ir a su pestaña.`}
              </div>
              <div>
                {resultadosBusqueda.map((p) => {
                  const f = fechaDe(p);
                  const esAtras = f !== "pendiente" && f !== "viaje" && f < hoyIso;
                  const etiqueta =
                    f === "pendiente" ? "Por entregar" : f === "viaje" ? "Por viaje" : esAtras ? `Atrasado (${formatFechaCorta(f)})` : etiquetaFecha(f, hoyIso);
                  // Los atrasados no tienen pestaña propia: se muestran en "Hoy".
                  const tabDestino = f === "pendiente" || f === "viaje" ? f : esAtras ? hoyIso : f;
                  const veh = (VEHICULOS.find((v) => v.id === p.vehiculo) || {}).label || "Sin vehículo";
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "var(--color-background-primary)",
                        border: "0.5px solid var(--color-border-tertiary)",
                        borderRadius: "var(--border-radius-md)",
                        padding: "8px 10px",
                        marginBottom: 8,
                      }}
                    >
                      <button
                        onClick={() => {
                          setSelectedDate(tabDestino);
                          setBusquedaDespacho("");
                          showToast(`Mostrando ${f === "pendiente" ? "Por entregar" : f === "viaje" ? "Por viaje" : etiquetaFecha(tabDestino, hoyIso)}`);
                        }}
                        style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", padding: "4px 0", minHeight: 44, cursor: "pointer" }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.cliente || "Sin nombre"}
                          {p.numeroFactura ? <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}> · {p.numeroFactura}</span> : ""}
                        </div>
                        <div style={{ fontSize: 12, color: esAtras ? "var(--color-text-danger)" : "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                          {etiqueta} · {veh}
                          {p.destino && p.destino.trim() ? ` · ${p.destino}` : ""}
                          {p.entregaPendiente ? " · debe material" : ""}
                        </div>
                      </button>
                      {(p.tienePdf || p.pdfDataUrl) && (
                        <button
                          onClick={() => setViewingPdf(p)}
                          aria-label="Ver documento"
                          title="Ver documento"
                          style={{ minWidth: 40, minHeight: 40, padding: 0, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", borderRadius: "var(--border-radius-md)", color: "var(--color-text-secondary)" }}
                        >
                          <i className="ti ti-file-text" style={{ fontSize: 16 }} aria-hidden="true"></i>
                        </button>
                      )}
                      <button
                        onClick={() => setEditing(p)}
                        aria-label="Editar pedido"
                        title="Editar"
                        style={{ minWidth: 40, minHeight: 40, padding: 0, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", borderRadius: "var(--border-radius-md)", color: "var(--color-text-secondary)" }}
                      >
                        <i className="ti ti-pencil" style={{ fontSize: 16 }} aria-hidden="true"></i>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
          <>
          {/* Recordatorio de pedidos que esperan un viaje a su zona. No sale
              cuando ya estás en la pestaña "Por viaje" (ahí ves la lista completa).
              Se puede tocar para saltar a esa pestaña. */}
          {pedidosEsperaViaje.length > 0 && selectedDate !== "viaje" && (
            <button
              onClick={() => setSelectedDate("viaje")}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "var(--color-background-info)",
                border: "0.5px solid var(--color-border-info)",
                borderRadius: "var(--border-radius-md)",
                padding: "10px 14px",
                marginBottom: 14,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--color-text-info)" }}>
                <i className="ti ti-map-pin" style={{ fontSize: 16 }} aria-hidden="true"></i>
                <span style={{ fontWeight: 500, fontSize: 13 }}>
                  Esperando viaje a la zona ({pedidosEsperaViaje.length})
                </span>
                <i className="ti ti-chevron-right" style={{ fontSize: 15, marginLeft: "auto" }} aria-hidden="true"></i>
              </div>
              {pedidosEsperaViaje.map((p) => {
                const zona = (p.destino && p.destino.trim()) || (p.direccion && p.direccion.trim()) || "";
                return (
                  <div key={p.id} style={{ fontSize: 12, color: "var(--color-text-info)", padding: "2px 0" }}>
                    {p.cliente}
                    {zona ? ` — ${zona}` : ""}
                  </div>
                );
              })}
            </button>
          )}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 14,
              overflowX: "auto",
              paddingBottom: 2,
            }}
          >
            {fechasTabs.map((f) => {
              const activo = f === selectedDate;
              const count = conteoPorFecha[f] || 0;
              return (
                <button
                  key={f}
                  onClick={() => setSelectedDate(f)}
                  aria-pressed={activo}
                  style={{
                    flexShrink: 0,
                    border: activo ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                    background: activo ? "var(--color-background-info)" : "var(--color-background-primary)",
                    color: activo ? "var(--color-text-info)" : "var(--color-text-primary)",
                    fontWeight: activo ? 600 : 400,
                    padding: "8px 16px",
                    minHeight: 44,
                    borderRadius: "var(--border-radius-md)",
                    fontSize: 14,
                    whiteSpace: "nowrap",
                  }}
                >
                  {etiquetaFecha(f, hoyIso)}
                  {count > 0 && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 12,
                        color: activo ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                      }}
                    >
                      ({count})
                    </span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => setSelectedDate("pendiente")}
              aria-pressed={selectedDate === "pendiente"}
              style={{
                flexShrink: 0,
                border: selectedDate === "pendiente" ? "2px solid var(--color-border-warning)" : "0.5px solid var(--color-border-tertiary)",
                background: selectedDate === "pendiente" ? "var(--color-background-warning)" : "var(--color-background-primary)",
                color: selectedDate === "pendiente" ? "var(--color-text-warning)" : "var(--color-text-primary)",
                fontWeight: selectedDate === "pendiente" ? 600 : 400,
                padding: "8px 16px",
                minHeight: 44,
                borderRadius: "var(--border-radius-md)",
                fontSize: 14,
                whiteSpace: "nowrap",
              }}
            >
              <i className="ti ti-package" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
              Por entregar
              {pedidosPendientes.length > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 12,
                    color: selectedDate === "pendiente" ? "var(--color-text-warning)" : "var(--color-text-tertiary)",
                  }}
                >
                  ({pedidosPendientes.length})
                </span>
              )}
            </button>
            <button
              onClick={() => setSelectedDate("viaje")}
              aria-pressed={selectedDate === "viaje"}
              style={{
                flexShrink: 0,
                border: selectedDate === "viaje" ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                background: selectedDate === "viaje" ? "var(--color-background-info)" : "var(--color-background-primary)",
                color: selectedDate === "viaje" ? "var(--color-text-info)" : "var(--color-text-primary)",
                fontWeight: selectedDate === "viaje" ? 600 : 400,
                padding: "8px 16px",
                minHeight: 44,
                borderRadius: "var(--border-radius-md)",
                fontSize: 14,
                whiteSpace: "nowrap",
              }}
            >
              <i className="ti ti-map-pin" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
              Por viaje
              {pedidosEsperaViaje.length > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 12,
                    color: selectedDate === "viaje" ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                  }}
                >
                  ({pedidosEsperaViaje.length})
                </span>
              )}
            </button>
          </div>

          {selectedDate === "pendiente" ? (
            <PorEntregar
              facturas={facturasPorEntregar}
              onCrearRemision={(id) => {
                const p = pedidos.find((x) => x.id === id);
                if (p) setRemisionDeModal(p);
              }}
              onProgramar={(id) => {
                const p = pedidos.find((x) => x.id === id);
                if (p) setEditing(p);
              }}
              onDescontar={(id) => {
                const p = pedidos.find((x) => x.id === id);
                if (p) setDescontarDe(p);
              }}
              onVerPdf={(id) => {
                const p = pedidos.find((x) => x.id === id);
                if (p) setViewingPdf(p);
              }}
              onEditar={(id) => {
                const p = pedidos.find((x) => x.id === id);
                if (p) setEditing(p);
              }}
              onEliminar={(id) => deletePedido(id)}
            />
          ) : selectedDate === "viaje" ? (
            (() => {
              const esViaje = true;
              const lista = pedidosEsperaViaje;
              const ayuda =
                "Pedidos listos que se llevan cuando salga un viaje a su zona. Cuando salga el viaje, toca \u201CMover a despacho\u201D para asignarles fecha y vehículo.";
              const vacio =
                "No hay pedidos esperando viaje. Al subir una factura, o al editar un pedido, elige \u201CPor viaje\u201D para que aparezca aquí.";
              return (
                <div
                  style={{
                    background: "var(--color-background-secondary)",
                    borderRadius: "var(--border-radius-lg)",
                    padding: "12px",
                  }}
                >
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>{ayuda}</div>
                  {lista.length === 0 && (
                    <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: "8px 4px" }}>{vacio}</div>
                  )}
                  {lista.map((p) => (
                    <PedidoCard
                      key={p.id}
                      pedido={p}
                      posicion={null}
                      isDragging={false}
                      onDragStart={() => {}}
                      onDragOverItem={() => {}}
                      onDropItem={() => {}}
                      onDelete={() => deletePedido(p.id)}
                      onEntregado={() => solicitarEntrega(p)}
                      onEdit={() => setEditing(p)}
                      onVerPdf={() => setViewingPdf(p)}
                      onProgramar={() => setEditing(p)}
                      onMaterialUnidades={esViaje ? undefined : () => setMaterialDe(p)}
                      onCrearRemision={esViaje ? undefined : () => setRemisionDeModal(p)}
                      onDescontarMaterial={() => setDescontarDe(p)}
                      onImprimirTirilla={() => setTirillaDe(p)}
                    />
                  ))}
                </div>
              );
            })()
          ) : (
          <>
          {/* Modo juntar: agrupar varios pedidos del mismo vehículo y día en un
              solo viaje. Fuera del modo, botón para activarlo. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {!modoJuntar ? (
              <button
                onClick={() => setModoJuntar(true)}
                style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40, background: "var(--color-background-secondary)", color: "var(--color-text-primary)", border: "0.5px solid var(--color-border-tertiary)" }}
              >
                <i className="ti ti-layers-intersect" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                Juntar pedidos
              </button>
            ) : (
              <>
                <span style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginRight: "auto" }}>
                  Toca los pedidos que van juntos en un viaje (mismo vehículo).
                </span>
                <button
                  onClick={confirmarJuntar}
                  disabled={seleccionJuntar.length < 2}
                  style={{
                    fontSize: 12.5,
                    padding: "9px 12px",
                    minHeight: 40,
                    fontWeight: 500,
                    background: seleccionJuntar.length >= 2 ? "#639922" : "var(--color-background-secondary)",
                    color: seleccionJuntar.length >= 2 ? "white" : "var(--color-text-tertiary)",
                    border: "none",
                    borderRadius: "var(--border-radius-md)",
                    cursor: seleccionJuntar.length >= 2 ? "pointer" : "not-allowed",
                  }}
                >
                  <i className="ti ti-layers-intersect" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                  Juntar ({seleccionJuntar.length})
                </button>
                <button onClick={salirModoJuntar} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
                  Cancelar
                </button>
              </>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {grouped.map((col) => {
              // Vehículo del primer pedido marcado: fija a qué columna se limita
              // la selección (un viaje = un solo vehículo).
              const vehiculoSel = seleccionJuntar.length
                ? (pedidos.find((p) => p.id === seleccionJuntar[0]) || {}).vehiculo
                : null;
              // Unidades a pintar: los pedidos de un mismo grupo se colapsan en
              // una sola tarjeta (la primera aparición marca su posición).
              const unidades = [];
              const vistos = new Set();
              for (const p of col.items) {
                if (p.grupoId) {
                  if (vistos.has(p.grupoId)) continue;
                  vistos.add(p.grupoId);
                  unidades.push({ tipo: "grupo", grupoId: p.grupoId, miembros: col.items.filter((x) => x.grupoId === p.grupoId) });
                } else {
                  unidades.push({ tipo: "pedido", pedido: p });
                }
              }
              return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.id);
                }}
              onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                handleDropOnColumn(col.id, null);
              }}
              style={{
                background: dragOverCol === col.id ? "var(--color-background-info)" : col.bg,
                borderTop: `3px solid ${col.border}`,
                borderRadius: "var(--border-radius-lg)",
                padding: "12px",
                minHeight: 160,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <i className={`ti ${col.icon}`} style={{ fontSize: 18, color: col.text }} aria-hidden="true"></i>
                <span style={{ fontWeight: 500, fontSize: 14, color: col.text }}>{col.label}</span>
                <span
                  style={{
                    fontSize: 12,
                    color: col.text,
                    marginLeft: "auto",
                    background: "var(--color-background-primary)",
                    borderRadius: "var(--border-radius-sm)",
                    padding: "1px 7px",
                  }}
                >
                  {col.items.length}
                </span>
              </div>

              {col.items.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: "8px 4px" }}>Sin pedidos aún. Sube una factura con el botón azul de arriba.</div>
              )}

              {modoJuntar
                ? col.items.map((p) => {
                    const seleccionado = seleccionJuntar.includes(p.id);
                    const yaEnGrupo = !!p.grupoId;
                    const bloqueado = (vehiculoSel !== null && vehiculoSel !== col.id) || yaEnGrupo;
                    return (
                      <button
                        key={p.id}
                        onClick={() => !bloqueado && toggleSeleccionJuntar(p)}
                        disabled={bloqueado}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          textAlign: "left",
                          marginBottom: 8,
                          padding: "10px 12px",
                          minHeight: 48,
                          borderRadius: "var(--border-radius-md)",
                          background: seleccionado ? "var(--color-background-info)" : "var(--color-background-primary)",
                          border: seleccionado ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                          color: "var(--color-text-primary)",
                          opacity: bloqueado ? 0.45 : 1,
                          cursor: bloqueado ? "not-allowed" : "pointer",
                        }}
                      >
                        <i
                          className={seleccionado ? "ti ti-circle-check-filled" : "ti ti-circle"}
                          style={{ fontSize: 18, color: seleccionado ? "var(--color-text-info)" : "var(--color-text-tertiary)", flexShrink: 0 }}
                          aria-hidden="true"
                        ></i>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5 }}>
                          {p.cliente}
                          {p.numeroFactura ? <span style={{ color: "var(--color-text-tertiary)" }}> · {p.numeroFactura}</span> : ""}
                        </span>
                        {yaEnGrupo && <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>ya en un viaje</span>}
                        {p.total ? <span style={{ fontSize: 13, fontWeight: 500, color: MARCA.azulOscuro, flexShrink: 0 }}>${formatCOP(p.total)}</span> : null}
                      </button>
                    );
                  })
                : unidades.map((u, idx) =>
                    u.tipo === "grupo" ? (
                      <GrupoCard
                        key={u.grupoId}
                        miembros={u.miembros}
                        isDragging={dragId != null && u.miembros.some((m) => m.id === dragId)}
                        onDragStart={() => handleDragStart(u.miembros[0].id)}
                        onDragEnd={handleDragEnd}
                        onDragOverItem={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverCol(col.id);
                        }}
                        onDropItem={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDropOnColumn(col.id, u.miembros[0].id);
                        }}
                        onEntregarGrupo={() => solicitarEntregaGrupo(u.grupoId)}
                        onSeparar={() => separarGrupo(u.grupoId)}
                        onVerPdf={(m) => setViewingPdf(m)}
                      />
                    ) : (
                      <PedidoCard
                        key={u.pedido.id}
                        pedido={u.pedido}
                        posicion={idx + 1}
                        esSecundario={u.pedido.vehiculo !== col.id}
                        isDragging={dragId === u.pedido.id}
                        onDragStart={() => handleDragStart(u.pedido.id)}
                        onDragEnd={handleDragEnd}
                        onDragOverItem={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverCol(col.id);
                        }}
                        onDropItem={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDropOnColumn(col.id, u.pedido.id);
                        }}
                        onDelete={() => deletePedido(u.pedido.id)}
                        onEntregado={() => solicitarEntrega(u.pedido)}
                        onEdit={() => setEditing(u.pedido)}
                        onVerPdf={() => setViewingPdf(u.pedido)}
                        onMaterialUnidades={() => setMaterialDe(u.pedido)}
                        onDescontarMaterial={() => setDescontarDe(u.pedido)}
                        onImprimirTirilla={() => setTirillaDe(u.pedido)}
                        atrasadoDesde={esAtrasado(u.pedido) ? fechaDe(u.pedido) : null}
                        onMoverAHoy={() => moverAHoy(u.pedido.id)}
                      />
                    )
                  )}
            </div>
              );
            })}
          </div>
          </>
          )}
          </>
          )}
        </>
      ) : view === "historial" ? (
        <div>
          <input
            type="text"
            placeholder="Buscar por cliente o número de factura..."
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            style={{ width: "100%", marginBottom: 6 }}
          />
          {/* Se dice de dónde salen los resultados: sin búsqueda se ven los
              últimos 90 días (lo precargado); buscando, se consulta TODO el
              historial contra el servidor. Sin este aviso, alguien podía creer
              que una entrega vieja se había perdido. */}
          <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", marginBottom: 12, minHeight: 16 }}>
            {historyFilter.trim() ? (
              buscandoHistorial ? (
                "Buscando en todo el historial..."
              ) : (
                <>
                  {filteredHistorial.length} {filteredHistorial.length === 1 ? "resultado" : "resultados"} en todo el historial
                </>
              )
            ) : (
              <>
                Últimos {DIAS_HISTORIAL_PRECARGADO} días. Para ver entregas más viejas, búscalas por cliente o número.
              </>
            )}
          </div>
          {filteredHistorial.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--color-text-tertiary)", padding: "1.5rem 0", textAlign: "center" }}>
              {historyFilter.trim()
                ? `No se encontró nada con "${historyFilter.trim()}". Revisa la ortografía o borra la búsqueda.`
                : 'Aún no hay entregas. Cuando toques "Entregado" en un pedido, quedará guardado aquí.'}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredHistorial.map((h) => (
                <HistorialRow key={h.id} pedido={h} onVerPdf={() => setViewingPdf(h)} onDevolver={() => devolverADespacho(h.id)} />
              ))}
            </div>
          )}
        </div>
      ) : view === "cotizaciones" ? (
        <div>
          {cotizacionesConSeguimientoVencido.length > 0 && (
            <div
              style={{
                background: "var(--color-background-danger)",
                border: "0.5px solid var(--color-border-danger)",
                borderRadius: "var(--border-radius-md)",
                padding: "10px 14px",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--color-text-danger)" }}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 16 }} aria-hidden="true"></i>
                <span style={{ fontWeight: 500, fontSize: 13 }}>
                  Seguimiento vencido sin atender ({cotizacionesConSeguimientoVencido.length})
                </span>
              </div>
              {cotizacionesConSeguimientoVencido.map((c) => (
                <div key={c.id} style={{ fontSize: 12, color: "var(--color-text-danger)", padding: "2px 0" }}>
                  Era para {c.fechaSeguimiento} — llamar a {c.cliente}
                  {c.numeroFactura ? ` (Cotización ${c.numeroFactura})` : ""}
                </div>
              ))}
            </div>
          )}
          {cotizacionesConSeguimientoProximo.length > 0 && (
            <div
              style={{
                background: "var(--color-background-warning)",
                border: "0.5px solid var(--color-border-warning)",
                borderRadius: "var(--border-radius-md)",
                padding: "10px 14px",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--color-text-warning)" }}>
                <i className="ti ti-bell-ringing" style={{ fontSize: 16 }} aria-hidden="true"></i>
                <span style={{ fontWeight: 500, fontSize: 13 }}>
                  Seguimiento próximo ({cotizacionesConSeguimientoProximo.length})
                </span>
              </div>
              {cotizacionesConSeguimientoProximo.map((c) => (
                <div key={c.id} style={{ fontSize: 12, color: "var(--color-text-warning)", padding: "2px 0" }}>
                  {c.fechaSeguimiento === hoyIso ? "Hoy" : "Mañana"} — llamar a {c.cliente}
                  {c.numeroFactura ? ` (Cotización ${c.numeroFactura})` : ""}
                </div>
              ))}
            </div>
          )}
          <input
            type="text"
            placeholder="Buscar por cliente o número de cotización..."
            value={cotizacionFilter}
            onChange={(e) => setCotizacionFilter(e.target.value)}
            style={{ width: "100%", marginBottom: 12 }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {cotizacionesAgrupadas.map((col) => (
              <div
                key={col.id}
                style={{
                  background: col.bg,
                  borderTop: `3px solid ${col.border}`,
                  borderRadius: "var(--border-radius-lg)",
                  padding: "12px",
                  minHeight: 160,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <i className={`ti ${col.icon}`} style={{ fontSize: 18, color: col.text }} aria-hidden="true"></i>
                  <span style={{ fontWeight: 500, fontSize: 14, color: col.text }}>{col.label}</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: col.text,
                      marginLeft: "auto",
                      background: "var(--color-background-primary)",
                      borderRadius: "var(--border-radius-sm)",
                      padding: "1px 7px",
                    }}
                  >
                    {col.items.length}
                  </span>
                </div>

                {/* Carga total de la columna: es el número con el que se
                    decide si el día sale en un viaje o en varios. */}
                {(() => {
                  const cargaCol = col.items.reduce((s2, p) => s2 + cargaPorEntregar(p), 0);
                  if (cargaCol <= 0) return null;
                  const cap = col.capacidadKg;
                  const viajes = cap ? Math.ceil(cargaCol / cap) : 1;
                  const pasa = !!cap && cargaCol > cap;
                  return (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        marginBottom: 10,
                        padding: "6px 9px",
                        borderRadius: "var(--border-radius-sm)",
                        background: pasa ? "var(--color-background-danger)" : "var(--color-background-primary)",
                        color: pasa ? "var(--color-text-danger)" : col.text,
                        fontWeight: 500,
                      }}
                    >
                      <i className={pasa ? "ti ti-alert-triangle" : "ti ti-weight"} style={{ fontSize: 13, flexShrink: 0 }} aria-hidden="true"></i>
                      {formatCOP(Math.round(cargaCol))} kg
                      {cap ? ` de ${formatCOP(cap)} kg` : ""}
                      {pasa ? ` · ${viajes} viajes` : ""}
                    </div>
                  );
                })()}

                {col.items.length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: "8px 4px" }}>
                    {col.id === "pendiente" ? "Sin cotizaciones aún" : col.id === "aceptada" ? "Ninguna aceptada aún" : "Ninguna rechazada"}
                  </div>
                )}

                {col.items.map((c) => (
                  <CotizacionCard
                    key={c.id}
                    cotizacion={c}
                    hoyIso={hoyIso}
                    onDelete={() => deleteCotizacion(c.id)}
                    onEdit={() => setEditingCotizacion(c)}
                    onVerPdf={() => setViewingPdfCotizacion(c)}
                    onPasarADespacho={() => pasarCotizacionADespacho(c)}
                    // "Ya está en despacho" solo si el pedido enlazado sigue
                    // vivo: si alguien lo borró, la cotización vuelve a poder
                    // mandarse (si no, quedaría trabada para siempre).
                    yaEnDespacho={!!c.pedidoId && pedidos.some((p) => p.id === c.pedidoId)}
                    onCambiarEstado={(estado) => {
                      if (estado === "rechazada") {
                        setRechazandoCotizacion(c);
                      } else {
                        updateCotizacion(c.id, { estado, motivoRechazo: null });
                      }
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === "panel" &&
        (!panelDesbloqueado ? (
          <div style={{ maxWidth: 340, margin: "40px auto", textAlign: "center" }}>
            <i className="ti ti-lock" style={{ fontSize: 32, color: MARCA.azulMedio }} aria-hidden="true"></i>
            <div style={{ fontSize: 17, fontWeight: 500, color: MARCA.azulMuyOscuro, marginTop: 10 }}>Panel del administrador</div>
            <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginTop: 4, marginBottom: 16 }}>
              Ingresa el PIN para ver el resumen del día.
            </div>
            <input
              type="password"
              inputMode="numeric"
              value={pinIntento}
              onChange={(e) => {
                setPinIntento(e.target.value);
                setPinError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") intentarDesbloquearPanel();
              }}
              placeholder="PIN"
              aria-label="PIN del panel"
              style={{ width: "100%", textAlign: "center", letterSpacing: 4, fontSize: 18, marginBottom: 10 }}
            />
            {pinError && (
              <div style={{ fontSize: 13, color: "var(--color-text-danger)", marginBottom: 10 }}>PIN incorrecto. Inténtalo de nuevo.</div>
            )}
            <button
              onClick={intentarDesbloquearPanel}
              style={{ width: "100%", border: "none", background: MARCA.azulOscuro, color: "white", fontWeight: 500, minHeight: 44, borderRadius: "var(--border-radius-md)", fontSize: 15 }}
            >
              Entrar
            </button>
          </div>
        ) : (
          <PanelResumen
            resumen={resumenPanel}
            sinCategorizar={sinCategorizar}
            promedio={promedioKilos30d}
            tendencia={tendenciaPanel}
            panelDia={panelDiaMostrado}
            puedeAnterior={!!panelDiaAnterior}
            puedeSiguiente={!!panelDiaSiguiente}
            onAnterior={() => panelDiaAnterior && setPanelDia(panelDiaAnterior)}
            onSiguiente={() => panelDiaSiguiente && setPanelDia(panelDiaSiguiente)}
            historial={historial}
          />
        ))}

      {editing && (
        <EditModal
          pedido={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            const fechaAnterior = fechaDe(editing);
            // Al pasar un pedido de "Pendientes" a una fecha real (despacho), si
            // en el material por unidades quedaron faltantes, generamos sola la
            // nota de material pendiente en el formato de siempre y lo marcamos.
            const pasaADespacho =
              fechaAnterior === "pendiente" &&
              patch.fechaDespacho &&
              patch.fechaDespacho !== "pendiente" &&
              patch.fechaDespacho !== "viaje";
            let patchFinal = patch;
            let notaAuto = "";
            if (pasaADespacho) {
              notaAuto = notaDesdeFaltantes(patch.productos);
              if (notaAuto) {
                patchFinal = { ...patch, entregaPendiente: true, notaPendiente: notaAuto };
              }
            }
            updatePedido(editing.id, patchFinal);
            setEditing(null);
            if (patch.fechaDespacho === "pendiente" && fechaAnterior !== "pendiente") {
              // "pendiente" no es una fecha ISO: etiquetaFecha la partía con
              // split("-") y el toast decía "movido a undefined undefined".
              showToast("Pedido movido a Pendientes");
            } else if (patch.fechaDespacho === "viaje" && fechaAnterior !== "viaje") {
              // "viaje" tampoco es una fecha ISO: mismo cuidado que "pendiente".
              showToast("Pedido movido a Por viaje");
            } else if (notaAuto) {
              showToast("Movido a despacho — quedó material pendiente");
            } else if (
              patch.fechaDespacho &&
              patch.fechaDespacho !== "pendiente" &&
              patch.fechaDespacho !== "viaje" &&
              patch.fechaDespacho !== fechaAnterior
            ) {
              showToast(`Pedido movido a ${etiquetaFecha(patch.fechaDespacho, hoyIso)}`);
            } else {
              showToast("Pedido actualizado");
            }
          }}
        />
      )}

      {viewingPdf && <PdfModal pedido={viewingPdf} fetchPdf={cargarPdfPedido} onClose={() => setViewingPdf(null)} />}

      {notaPendienteDe && (
        <NotaPendienteModal
          pedido={notaPendienteDe}
          onClose={() => setNotaPendienteDe(null)}
          onGuardar={(nota) => {
            updatePedido(notaPendienteDe.id, { entregaPendiente: true, notaPendiente: nota });
            setNotaPendienteDe(null);
            showToast("Pedido marcado como pendiente");
          }}
          onQuitar={() => {
            updatePedido(notaPendienteDe.id, { entregaPendiente: false, notaPendiente: "" });
            setNotaPendienteDe(null);
            showToast("Pendiente resuelto");
          }}
        />
      )}

      {confirmandoEntrega && (
        <ConfirmarEntregaModal
          pedido={confirmandoEntrega}
          onClose={() => setConfirmandoEntrega(null)}
          onConfirm={(estadoPago) => {
            marcarEntregado(confirmandoEntrega.id, { estadoPago });
            setConfirmandoEntrega(null);
          }}
        />
      )}

      {confirmandoEntregaGrupo && (
        <ConfirmarEntregaGrupoModal
          info={confirmandoEntregaGrupo}
          onClose={() => setConfirmandoEntregaGrupo(null)}
          onConfirm={(estadoPago) => {
            entregarGrupo(confirmandoEntregaGrupo.grupoId, estadoPago);
            setConfirmandoEntregaGrupo(null);
          }}
        />
      )}

      {materialDe && (
        <MaterialPorUnidadesModal
          pedido={materialDe}
          onClose={() => setMaterialDe(null)}
          onGuardar={(productos) => {
            // En Pendientes/Por viaje solo se guarda lo marcado (el aviso de
            // "debe material" se prende después, al programarlo a una fecha).
            // En una fecha de día, el marcado ES la entrega: si algo quedó
            // faltando, se prende solo el aviso rojo con una nota automática
            // (sin escribir nada); si se entregó todo, se apaga.
            const enDia = fechaDe(materialDe) !== "pendiente" && fechaDe(materialDe) !== "viaje";
            if (enDia) {
              const faltan = faltantesDeProductos(productos);
              updatePedido(
                materialDe.id,
                faltan.length > 0
                  ? { productos, entregaPendiente: true, notaPendiente: notaDesdeFaltantes(productos) }
                  : { productos, entregaPendiente: false, notaPendiente: "" }
              );
            } else {
              updatePedido(materialDe.id, { productos });
            }
            setMaterialDe(null);
            showToast("Material actualizado");
          }}
        />
      )}

      {remisionDeModal && (
        <RemisionModal
          pedido={remisionDeModal}
          hoyIso={hoyIso}
          onClose={() => setRemisionDeModal(null)}
          onCrear={(cantidades, fechaDespacho, vehiculo) => {
            crearRemision(remisionDeModal, cantidades, fechaDespacho, vehiculo);
            setRemisionDeModal(null);
          }}
        />
      )}

      {remisionManualAbierta && (
        <RemisionManualModal
          hoyIso={hoyIso}
          onClose={() => setRemisionManualAbierta(false)}
          onCrear={crearRemisionManual}
        />
      )}

      {tirillaDe && <TirillaModal pedido={tirillaDe} onClose={() => setTirillaDe(null)} />}

      {descontarDe && (
        <DescontarMaterialModal
          pedido={descontarDe}
          onClose={() => setDescontarDe(null)}
          onDescontar={(cantidades) => {
            descontarMaterialMadre(descontarDe, cantidades);
            setDescontarDe(null);
          }}
        />
      )}

      {editingCotizacion && (
        <EditCotizacionModal
          cotizacion={editingCotizacion}
          onClose={() => setEditingCotizacion(null)}
          onSave={(patch) => {
            updateCotizacion(editingCotizacion.id, patch);
            setEditingCotizacion(null);
            showToast("Cotización actualizada");
          }}
        />
      )}

      {viewingPdfCotizacion && (
        <PdfModal pedido={viewingPdfCotizacion} fetchPdf={cargarPdfCotizacion} onClose={() => setViewingPdfCotizacion(null)} />
      )}

      {rechazandoCotizacion && (
        <MotivoRechazoModal
          cotizacion={rechazandoCotizacion}
          onClose={() => setRechazandoCotizacion(null)}
          onConfirm={(motivo) => {
            updateCotizacion(rechazandoCotizacion.id, { estado: "rechazada", motivoRechazo: motivo });
            setRechazandoCotizacion(null);
            showToast("Cotización rechazada");
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", inputMode, spellCheck }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        spellCheck={spellCheck}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%" }}
      />
    </label>
  );
}

// Selector de destino: Corozal / Morroa / Otro (con campo manual). Guarda el
// nombre del lugar en "value" (un string): para los presets es su nombre; para
// "Otro" es lo que se escriba a mano.

// Estilos de la tarjeta. Se inyectan UNA sola vez desde el componente
// principal (no por tarjeta): con 50 pedidos en pantalla, una etiqueta de
// estilos por tarjeta serían 50 copias idénticas en el DOM.

// Renderiza el PDF como imagen usando PDF.js + canvas, en vez de un iframe.
// Esto evita los bloqueos de visor nativo que impedían ver el PDF dentro
// del artifact.

// Overlay de modal verdadero: position:fixed cubre toda la ventana visible
// (sin esto, el "fondo oscuro" solo ocupaba el alto del contenido y el click
// afuera o el modal mismo podían quedar fuera de la vista, dando la sensación
// de que "no cierra"). Cierra con click fuera, botón X, o tecla Esc.

// El PDF ya no viene en la carga inicial (pesa demasiado): si el pedido no lo
// trae en memoria pero tiene_pdf es true, lo pedimos aquí con fetchPdf al abrir
// el visor. Estados: "cargando" | "listo" | "vacio" | "error".

// Tarjeta de un "viaje juntado": varias facturas que van juntas. Se muestra
// como una sola tarjeta con el detalle de cada factura adentro, se arrastra en
// bloque y se entrega de una. Ver handlers de juntar/entregarGrupo arriba.

// Confirmación de pago al entregar un viaje juntado (una sola vez para todas
// las facturas por cobrar del grupo).
function ConfirmarEntregaGrupoModal({ info, onClose, onConfirm }) {
  return (
    <ModalOverlay onClose={onClose} maxWidth={380}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>¿El cliente pagó?</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 14 }}>
        Viaje juntado · {info.count} facturas{info.total ? ` — $${formatCOP(info.total)}` : ""}. La respuesta aplica a las que estaban "paga al recibir".
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={() => onConfirm("pagado")}
          style={{ fontSize: 14, fontWeight: 500, padding: "11px 12px", minHeight: 46, background: "var(--color-background-success)", color: "var(--color-text-success)", border: "0.5px solid var(--color-border-success)" }}
        >
          <i className="ti ti-cash" style={{ fontSize: 15, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
          Sí, pagó completo
        </button>
        <button
          onClick={() => onConfirm("pendiente")}
          style={{ fontSize: 14, fontWeight: 500, padding: "11px 12px", minHeight: 46, background: "var(--color-background-warning)", color: "var(--color-text-warning)", border: "0.5px solid var(--color-border-warning)" }}
        >
          <i className="ti ti-clock-dollar" style={{ fontSize: 15, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
          Quedó debiendo
        </button>
        <button onClick={onClose} style={{ fontSize: 13, marginTop: 2 }}>Cancelar</button>
      </div>
    </ModalOverlay>
  );
}


// Guía de carga interna: NO es factura ni la reemplaza (no lleva CUFE, QR ni
// resolución DIAN), solo ayuda al despachador a saber qué subir al vehículo.
// Solo para ver en pantalla — no se imprime desde aquí (el sandbox del
// artifact no permite window.print() de forma confiable).
// Modal mínimo para marcar que un pedido quedó debiendo material.
// No pide cantidades ni productos: una frase escrita a mano basta.
function NotaPendienteModal({ pedido, onClose, onGuardar, onQuitar }) {
  const [nota, setNota] = useState(pedido.notaPendiente || "");
  const yaEstabaPendiente = !!pedido.entregaPendiente;

  return (
    <ModalOverlay onClose={onClose} maxWidth={420}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>¿Qué quedó pendiente?</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 12 }}>
        {pedido.cliente}
        {pedido.numeroFactura ? ` — ${pedido.tipoDocumento === "cotizacion" ? "Cotización" : "Factura"} ${pedido.numeroFactura}` : ""}
      </div>

      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Ej: faltó la arena y 2 tejas"
        autoFocus={window.matchMedia("(pointer: fine)").matches}
        style={{ width: "100%", minHeight: 70, fontSize: 13, marginBottom: 6 }}
      />
      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 14 }}>
        Escríbelo como lo dirías de viva voz. El pedido se queda en su columna marcado en rojo hasta que se complete.
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {yaEstabaPendiente && (
          <button onClick={onQuitar} style={{ fontSize: 13, marginRight: "auto" }}>
            <i className="ti ti-check" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Ya se completó
          </button>
        )}
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => onGuardar(nota.trim())}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: "var(--color-background-danger)",
            color: "var(--color-text-danger)",
            border: "0.5px solid var(--color-border-danger)",
          }}
        >
          Marcar como pendiente
        </button>
      </div>
    </ModalOverlay>
  );
}

// Solo se usa en la pestaña "Pendientes": lista producto por producto cuántas
// unidades se entregaron (de las que trae la factura), por si no se entregó
// todo. Guarda cantidadEntregada en cada producto. La nota de material
// pendiente NO se crea aquí: se genera sola al pasar el pedido a despacho.

// Modal para crear una remisión: elegir cuántas unidades de cada producto de
// una factura grande se despachan esta vez, y a qué fecha/vehículo van. Lo que
// se elige sale de la factura madre (se le rebaja el saldo); la remisión nace
// como pedido activo en la fecha elegida. Ver crearRemision() en el componente.
function RemisionModal({ pedido, hoyIso, onClose, onCrear }) {
  const productos = pedido.productos || [];
  // Copia 5 de 6 -> saldo.js.
  const dispo = saldoDe;

  const [cantidades, setCantidades] = useState(() => productos.map(() => 0));
  const [fechaOpcion, setFechaOpcion] = useState("hoy");
  const [fechaOtro, setFechaOtro] = useState(hoyIso);
  const [vehiculo, setVehiculo] = useState(pedido.vehiculo || VEHICULOS[0].id);

  // Mañana calculado desde hoyIso en UTC, para no correrse por zona horaria.
  const manana = (() => {
    const [y, m, d] = hoyIso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  })();

  const setCantidad = (idx, valor) => {
    setCantidades((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const max = dispo(productos[idx]);
        let n = valor;
        if (isNaN(n) || n < 0) n = 0;
        if (n > max) n = max;
        return n;
      })
    );
  };

  const totalUnidades = cantidades.reduce((s, c) => s + (Number(c) || 0), 0);
  const fechaResuelta = fechaOpcion === "hoy" ? hoyIso : fechaOpcion === "manana" ? manana : fechaOpcion === "viaje" ? "viaje" : fechaOtro;
  const puedeCrear = totalUnidades > 0 && (fechaOpcion !== "otro" || !!fechaOtro);

  const opcionesFecha = [
    { id: "hoy", label: "Hoy" },
    { id: "manana", label: "Mañana" },
    { id: "viaje", label: "Por viaje" },
    { id: "otro", label: "Otro día" },
  ];

  return (
    <ModalOverlay onClose={onClose} maxWidth={480}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Crear remisión</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 12 }}>
        {pedido.cliente}
        {pedido.numeroFactura ? ` · Factura ${pedido.numeroFactura}` : ""} — marca cuántas unidades se lleva el cliente esta vez.
      </div>

      {productos.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: "8px 4px" }}>
          Esta factura no tiene productos detallados, no se puede remisionar por unidades.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {productos.map((p, idx) => {
          const disponible = dispo(p);
          const va = cantidades[idx];
          const agotado = disponible <= 0;
          return (
            <div
              key={idx}
              style={{
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-md)",
                padding: "8px 10px",
                opacity: agotado ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <b style={{ fontWeight: 500 }}>{p.descripcion}</b>
                <span style={{ color: "var(--color-text-tertiary)" }}> · disponible {formatCantidad(disponible)} {p.unidad}</span>
              </div>
              {!agotado && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Se lleva:</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={disponible}
                    value={va}
                    onChange={(e) => setCantidad(idx, parseCantidad(e.target.value))}
                    style={{ width: 90 }}
                  />
                  <button onClick={() => setCantidad(idx, disponible)} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>
                    Todo
                  </button>
                  <button onClick={() => setCantidad(idx, 0)} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>
                    Nada
                  </button>
                </div>
              )}
              {agotado && <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Ya se despachó completo.</div>}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>¿Para cuándo?</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: fechaOpcion === "otro" ? 8 : 14 }}>
        {opcionesFecha.map((o) => (
          <button
            key={o.id}
            onClick={() => setFechaOpcion(o.id)}
            aria-pressed={fechaOpcion === o.id}
            style={{
              fontSize: 12.5,
              padding: "8px 12px",
              minHeight: 40,
              fontWeight: fechaOpcion === o.id ? 600 : 400,
              background: fechaOpcion === o.id ? "var(--color-background-info)" : "var(--color-background-primary)",
              color: fechaOpcion === o.id ? "var(--color-text-info)" : "var(--color-text-primary)",
              border: fechaOpcion === o.id ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {fechaOpcion === "otro" && (
        <div style={{ marginBottom: 14 }}>
          <input type="date" value={fechaOtro} min={hoyIso} onChange={(e) => setFechaOtro(e.target.value)} style={{ width: "100%" }} />
        </div>
      )}

      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>¿En qué vehículo?</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {VEHICULOS.map((v) => (
          <button
            key={v.id}
            onClick={() => setVehiculo(v.id)}
            aria-pressed={vehiculo === v.id}
            style={{
              fontSize: 12.5,
              padding: "8px 12px",
              minHeight: 40,
              fontWeight: vehiculo === v.id ? 600 : 400,
              background: vehiculo === v.id ? v.bg : "var(--color-background-primary)",
              color: vehiculo === v.id ? v.text : "var(--color-text-primary)",
              border: vehiculo === v.id ? `2px solid ${v.border}` : "0.5px solid var(--color-border-tertiary)",
            }}
          >
            <i className={`ti ${v.icon}`} style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            {v.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginRight: "auto" }}>
          {totalUnidades > 0 ? `${formatCantidad(totalUnidades)} unidades en esta remisión` : "Nada marcado aún"}
        </span>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => puedeCrear && onCrear(cantidades, fechaResuelta, vehiculo)}
          disabled={!puedeCrear}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: puedeCrear ? "#639922" : "var(--color-background-secondary)",
            color: puedeCrear ? "white" : "var(--color-text-tertiary)",
            border: "none",
            borderRadius: "var(--border-radius-md)",
            padding: "9px 14px",
            minHeight: 40,
            cursor: puedeCrear ? "pointer" : "not-allowed",
          }}
        >
          <i className="ti ti-arrows-split" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Crear remisión
        </button>
      </div>
    </ModalOverlay>
  );
}

// Al entregar un pedido "paga al recibir" preguntamos si el cliente pagó, para
// dejar el registro correcto en el historial. Los pedidos que ya venían
// "pagado" NO pasan por aquí: se entregan de un solo toque, como siempre.
// Descontar del saldo de una factura madre el material que el cliente ya se
// llevó directo (mostrador), sin generar una remisión. Mismo estilo que
// RemisionModal pero sin fecha ni vehículo: aquí nada sale a despacho.

// Tirilla de remisión para impresora térmica de 58 mm. NO es factura de venta
// (no lleva CUFE, QR ni resolución DIAN): es el comprobante interno de que el
// material salió y alguien lo recibió. Por eso lleva firma de quien recibe.
// Sin peso a propósito: el peso de la app es aproximado y no debe imprimirse
// en un papel que el cliente firma.

// Formulario para crear una remisión a mano (sin PDF): pedidos que llegan en
// hoja aparte de remisiones (arena, bloque, etc.), ajenos a World Office. El
// número REM lo pone el componente padre (siguienteNumeroRemision).

function ConfirmarEntregaModal({ pedido, onClose, onConfirm }) {
  return (
    <ModalOverlay onClose={onClose} maxWidth={380}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>¿El cliente pagó?</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 14 }}>
        {pedido.cliente}
        {pedido.total ? ` — $${formatCOP(pedido.total)}` : ""} · estaba marcado "paga al recibir".
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={() => onConfirm("pagado")}
          style={{
            fontSize: 14,
            fontWeight: 500,
            padding: "11px 12px",
            minHeight: 46,
            background: "var(--color-background-success)",
            color: "var(--color-text-success)",
            border: "0.5px solid var(--color-border-success)",
          }}
        >
          <i className="ti ti-cash" style={{ fontSize: 15, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
          Sí, pagó completo
        </button>
        <button
          onClick={() => onConfirm("pendiente")}
          style={{
            fontSize: 14,
            fontWeight: 500,
            padding: "11px 12px",
            minHeight: 46,
            background: "var(--color-background-warning)",
            color: "var(--color-text-warning)",
            border: "0.5px solid var(--color-border-warning)",
          }}
        >
          <i className="ti ti-clock-dollar" style={{ fontSize: 15, verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true"></i>
          Quedó debiendo
        </button>
        <button onClick={onClose} style={{ fontSize: 13, marginTop: 2 }}>Cancelar</button>
      </div>
    </ModalOverlay>
  );
}

function EditModal({ pedido, onClose, onSave }) {
  const [form, setForm] = useState({ ...pedido, estadoPago: pedido.estadoPago || "pendiente" });
  const [aviso, setAviso] = useState("");
  // Tres modos de despacho: con fecha (va al tablero), sin fecha ("Pendientes")
  // o por viaje ("Por viaje"). Los dos últimos no llevan fecha ni vehículo, así
  // que reutilizamos "sinFecha" para ocultar esos campos en ambos casos.
  const modo = form.fechaDespacho === "pendiente" ? "pendiente" : form.fechaDespacho === "viaje" ? "viaje" : "fecha";
  const sinFecha = modo !== "fecha";
  const fechaRealActual =
    form.fechaDespacho && form.fechaDespacho !== "pendiente" && form.fechaDespacho !== "viaje"
      ? form.fechaDespacho
      : todayISO();
  const opcionModo = (activo) => ({
    flex: 1,
    fontSize: 12,
    padding: "8px 0",
    minHeight: 40,
    borderRadius: "var(--border-radius-md)",
    border: activo ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
    background: activo ? "var(--color-background-info)" : "transparent",
    color: activo ? "var(--color-text-info)" : "var(--color-text-primary)",
    fontWeight: activo ? 500 : 400,
  });

  return (
    <ModalOverlay onClose={onClose} maxWidth={420}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Editar pedido</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <Field label="Cliente" value={form.cliente || ""} onChange={(v) => setForm({ ...form, cliente: v })} />
        <Field label="Teléfono" type="tel" value={form.telefono || ""} onChange={(v) => setForm({ ...form, telefono: v })} />

        <div>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
            ¿Cuándo se entrega?
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              aria-pressed={modo === "fecha"}
              onClick={() => setForm({ ...form, fechaDespacho: fechaRealActual })}
              style={opcionModo(modo === "fecha")}
            >
              Con fecha
            </button>
            <button
              aria-pressed={modo === "pendiente"}
              onClick={() => setForm({ ...form, fechaDespacho: "pendiente", vehiculo: null, vehiculoSecundario: null })}
              style={opcionModo(modo === "pendiente")}
            >
              Por entregar
            </button>
            <button
              aria-pressed={modo === "viaje"}
              onClick={() => setForm({ ...form, fechaDespacho: "viaje", vehiculo: null, vehiculoSecundario: null })}
              style={opcionModo(modo === "viaje")}
            >
              Por viaje
            </button>
          </div>
          {modo === "pendiente" && (
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 4 }}>
              Va a la pestaña "Por entregar" hasta que sepas cuándo y en qué vehículo se entrega.
            </span>
          )}
          {modo === "viaje" && (
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 4 }}>
              Va a la pestaña "Por viaje". Se lleva cuando salga un viaje a esa zona; ahí le asignas fecha y vehículo.
            </span>
          )}
        </div>

        {!sinFecha && (
          <div>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>
              Fecha de despacho
            </span>
            {/* Botones grandes para los próximos días (elegir de un toque), y
                un calendario de respaldo abajo para fechas más lejanas. */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 8 }}>
              {Array.from({ length: 8 }, (_, i) => addDaysISO(todayISO(), i)).map((iso, i) => {
                const [yy, mm, dd] = iso.split("-").map(Number);
                const fechaObj = new Date(yy, mm - 1, dd);
                const diaSemana = fechaObj.toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "");
                const mesAbrev = fechaObj.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
                const etiqueta = i === 0 ? "Hoy" : i === 1 ? "Mañana" : diaSemana;
                const sel = (form.fechaDespacho || todayISO()) === iso;
                return (
                  <button
                    key={iso}
                    onClick={() => setForm({ ...form, fechaDespacho: iso })}
                    aria-pressed={sel}
                    style={{
                      flexShrink: 0,
                      minWidth: 62,
                      padding: "8px 8px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 1,
                      borderRadius: "var(--border-radius-md)",
                      border: sel ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                      background: sel ? "var(--color-background-info)" : "var(--color-background-primary)",
                      color: sel ? "var(--color-text-info)" : "var(--color-text-primary)",
                    }}
                  >
                    <span style={{ fontSize: 11, textTransform: "capitalize", color: sel ? "var(--color-text-info)" : "var(--color-text-tertiary)" }}>{etiqueta}</span>
                    <span style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1 }}>{dd}</span>
                    <span style={{ fontSize: 10, textTransform: "capitalize", color: sel ? "var(--color-text-info)" : "var(--color-text-tertiary)" }}>{mesAbrev}</span>
                  </button>
                );
              })}
            </div>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginBottom: 4 }}>
                u otra fecha
              </span>
              <input
                type="date"
                value={form.fechaDespacho || todayISO()}
                min={todayISO()}
                onChange={(e) => setForm({ ...form, fechaDespacho: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 4 }}>
              Si elige una fecha futura, el pedido se mueve a esa pestaña de día.
            </span>
          </div>
        )}

        <DestinoSelector value={form.destino || ""} onChange={(v) => setForm({ ...form, destino: v })} />

        <div>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
            Estado de pago
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setForm({ ...form, estadoPago: "pagado" })}
              aria-pressed={form.estadoPago === "pagado"}
              style={{
                flex: 1,
                fontSize: 12,
                padding: "6px 0",
                border: form.estadoPago === "pagado" ? "2px solid var(--color-border-success)" : "0.5px solid var(--color-border-tertiary)",
                background: form.estadoPago === "pagado" ? "var(--color-background-success)" : "transparent",
                color: form.estadoPago === "pagado" ? "var(--color-text-success)" : "var(--color-text-primary)",
              }}
            >
              Ya pagado
            </button>
            <button
              onClick={() => setForm({ ...form, estadoPago: "pendiente" })}
              aria-pressed={form.estadoPago === "pendiente"}
              style={{
                flex: 1,
                fontSize: 12,
                padding: "6px 0",
                border: form.estadoPago === "pendiente" ? "2px solid var(--color-border-warning)" : "0.5px solid var(--color-border-tertiary)",
                background: form.estadoPago === "pendiente" ? "var(--color-background-warning)" : "transparent",
                color: form.estadoPago === "pendiente" ? "var(--color-text-warning)" : "var(--color-text-primary)",
              }}
            >
              Paga al recibir
            </button>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!form.fleteExterno}
            onChange={(e) => setForm({ ...form, fleteExterno: e.target.checked })}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
            El flete de este pedido lo cobró un tercero (no entra a la ferretería)
          </span>
        </label>

        {!sinFecha && (
          <div>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Vehículo</span>
            <div style={{ display: "flex", gap: 6 }}>
              {VEHICULOS.map((v) => (
                <button
                  key={v.id}
                  aria-pressed={form.vehiculo === v.id}
                  onClick={() => {
                    setAviso("");
                    setForm({
                      ...form,
                      vehiculo: v.id,
                      vehiculoSecundario: form.vehiculoSecundario === v.id ? null : form.vehiculoSecundario,
                    });
                  }}
                  style={{
                    flex: 1,
                    fontSize: 12,
                    padding: "6px 0",
                    border: form.vehiculo === v.id ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                    background: form.vehiculo === v.id ? "var(--color-background-info)" : "transparent",
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!sinFecha && form.vehiculo && (
          <div>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
              ¿Parte del pedido va en otro vehículo? <span style={{ color: "var(--color-text-tertiary)" }}>(opcional)</span>
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {VEHICULOS.filter((v) => v.id !== form.vehiculo).map((v) => {
                const activo = form.vehiculoSecundario === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => setForm({ ...form, vehiculoSecundario: activo ? null : v.id })}
                    aria-pressed={activo}
                    style={{
                      flex: 1,
                      fontSize: 12,
                      padding: "6px 0",
                      border: activo ? `2px solid ${v.border}` : "0.5px solid var(--color-border-tertiary)",
                      background: activo ? v.bg : "transparent",
                      color: activo ? v.text : "var(--color-text-primary)",
                      fontWeight: activo ? 500 : 400,
                    }}
                  >
                    {activo ? "✓ " : ""}
                    {v.label}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 4 }}>
              El pedido aparecerá también en esa columna. Toca de nuevo para quitarlo.
            </span>
          </div>
        )}
      </div>
      {aviso && (
        <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 8, textAlign: "right" }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          {aviso}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => {
            // Antes este caso retornaba sin decir nada y el botón parecía roto.
            if (!sinFecha && !form.vehiculo) {
              setAviso("Selecciona un vehículo antes de guardar");
              return;
            }
            onSave(form);
          }}
          style={{ fontSize: 13, fontWeight: 500, background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)" }}
        >
          Guardar cambios
        </button>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------
// Componentes del módulo de Cotizaciones (independiente de despacho).
// ---------------------------------------------------------------------






function EditCotizacionModal({ cotizacion, onClose, onSave }) {
  const [form, setForm] = useState({ ...cotizacion, estado: cotizacion.estado || "pendiente" });

  return (
    <ModalOverlay onClose={onClose} maxWidth={420}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Editar cotización</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <Field label="Cliente" value={form.cliente || ""} onChange={(v) => setForm({ ...form, cliente: v })} />
        <Field label="Teléfono" type="tel" value={form.telefono || ""} onChange={(v) => setForm({ ...form, telefono: v })} />

        <div>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Estado</span>
          <div style={{ display: "flex", gap: 6 }}>
            {ESTADOS_COTIZACION_BADGE_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setForm({ ...form, estado: key })}
                aria-pressed={form.estado === key}
                style={{
                  flex: 1,
                  fontSize: 12,
                  padding: "6px 0",
                  border: form.estado === key ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  background: form.estado === key ? "var(--color-background-info)" : "transparent",
                }}
              >
                {ESTADOS_COTIZACION_BADGE[key].label}
              </button>
            ))}
          </div>
        </div>

        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
            Fecha de seguimiento
          </span>
          <input
            type="date"
            value={form.fechaSeguimiento || ""}
            onChange={(e) => setForm({ ...form, fechaSeguimiento: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
            Notas
          </span>
          <textarea
            value={form.notas || ""}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
            style={{ width: "100%", minHeight: 60, fontSize: 13 }}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => onSave(form)}
          style={{ fontSize: 13, fontWeight: 500, background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)" }}
        >
          Guardar cambios
        </button>
      </div>
    </ModalOverlay>
  );
}
