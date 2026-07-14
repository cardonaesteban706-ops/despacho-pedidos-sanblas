import React, { useState, useEffect, useRef, useCallback } from "react";
import { cargarPedidosActivos, cargarHistorial, guardarPedido, actualizarPedido, eliminarPedido, cargarPdfPedido } from "./supabaseClient";
import { cargarCotizaciones, guardarCotizacion, eliminarCotizacion, cargarPdfCotizacion } from "./supabaseClient";

const VEHICULOS = [
  { id: "camion", label: "Camión", icon: "ti-truck", bg: "#E6F1FB", border: "#378ADD", text: "#0C447C" },
  { id: "motocarro", label: "Motocarro", icon: "ti-moped", bg: "#FAEEDA", border: "#BA7517", text: "#633806" },
  { id: "tractor", label: "Tractor", icon: "ti-tractor", bg: "#EAF3DE", border: "#639922", text: "#27500A" },
];

// Destinos frecuentes para marcar la zona del pedido al montarlo. "Otro" abre
// un campo de texto para escribir cualquier otro lugar a mano.
const DESTINOS = ["Corozal", "Morroa"];

// Colores de identidad de marca SANBLAS (tomados del logo: azul oscuro
// institucional + celeste claro de fondo). Se usan en el header, la
// pestaña activa y el botón principal de subir documento.
const MARCA = {
  azulOscuro: "#0C447C",
  azulMedio: "#378ADD",
  azulClaro: "#E6F1FB",
  azulMuyOscuro: "#042C53",
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatCOP(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);
}

// Convierte una cantidad en formato colombiano a número. "1.500" y
// "1.500,25" usan punto de miles y coma decimal (grupos de 3 dígitos);
// "2.5" o "2,5" usan el separador como decimal.
function parseCantidad(s) {
  const str = String(s).trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(str)) {
    return parseFloat(str.replace(/\./g, "").replace(",", ".")) || 0;
  }
  return parseFloat(str.replace(",", ".")) || 0;
}

// Cantidad como número. Los productos ya vienen parseados a número, pero si
// acaso llega un string lo normalizamos con la misma lógica colombiana.
function cantidadNum(v) {
  if (typeof v === "number") return v;
  return parseCantidad(v);
}

function formatCantidad(n) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(n);
}

// Seguimiento de material por unidades: un producto "tocado" tiene el campo
// cantidadEntregada. Devuelve los productos donde se entregaron MENOS unidades
// que las de la factura (con cuántas faltan). Un pedido sin ningún producto
// tocado devuelve lista vacía y se comporta como siempre.
function faltantesDeProductos(productos) {
  return (productos || [])
    .filter((p) => p.cantidadEntregada !== undefined && p.cantidadEntregada !== null)
    .map((p) => ({ ...p, faltan: cantidadNum(p.cantidad) - cantidadNum(p.cantidadEntregada) }))
    .filter((p) => p.faltan > 0);
}

// Nota de texto (mismo formato de siempre: "2 tejas; 1 bulto cemento") armada
// a partir de los faltantes por unidades. Se usa al pasar un pedido de
// "Pendientes" a despacho, para no tener que reescribir la nota a mano.
function notaDesdeFaltantes(productos) {
  const faltan = faltantesDeProductos(productos);
  if (faltan.length === 0) return "";
  return faltan.map((p) => `${formatCantidad(p.faltan)} ${p.unidad || ""} ${p.descripcion || ""}`.replace(/\s+/g, " ").trim()).join("; ");
}

function todayStr() {
  const d = new Date();
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Fecha de despacho: usamos formato ISO (YYYY-MM-DD) internamente porque es
// fácil de comparar y ordenar; el formato bonito (es-CO) es solo para mostrar.
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatFechaCorta(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  return `${dias[dt.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function etiquetaFecha(iso, hoyIso) {
  if (iso === hoyIso) return "Hoy";
  if (iso === addDaysISO(hoyIso, 1)) return "Mañana";
  return formatFechaCorta(iso);
}

// Guía de carga interna: NO es una factura ni la reemplaza (no lleva CUFE, QR
// ni resolución DIAN). Es solo una hoja de apoyo para que el despachador sepa
// rápido qué productos subir al vehículo, sin tener que abrir el PDF completo
// de la factura. La factura legal y su copia siguen su proceso normal aparte.
// Se muestra como modal en la misma página (en vez de window.open) porque el
// artifact corre en un iframe con sandbox, y muchos navegadores bloquean las
// ventanas emergentes ahí incluso al hacer clic directo.

function nowTimeStr() {
  const d = new Date();
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

// Reconstruye filas reales del PDF agrupando fragmentos de texto por su
// posición vertical (Y), no por orden de aparición en el stream del PDF.
// Lee TODAS las páginas: las facturas con muchos ítems continúan la tabla de
// productos (y traen el total) en la página 2 o siguientes.
async function extractPdfLines(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allLines = [];
  for (let num = 1; num <= pdf.numPages; num++) {
    const page = await pdf.getPage(num);
    const content = await page.getTextContent();

    const items = content.items
      .filter((it) => it.str && it.str.trim().length > 0)
      .map((it) => ({ text: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }));

    // La agrupación por Y es por página: la coordenada Y se reinicia en cada
    // página, así que mezclar páginas fusionaría filas que no van juntas.
    //
    // Se ordena por Y primero y se agrupa encadenando contra el ÚLTIMO
    // fragmento agregado (no contra un ancla fija): fragmentos de una misma
    // fila visual con Y = 100, 102, 104 quedan juntos aunque el primero y el
    // último disten más que la tolerancia. Antes, el resultado dependía del
    // orden de aparición en el stream del PDF y podía partir la fila de un
    // producto en dos líneas (que el regex descartaba en silencio).
    const sorted = [...items].sort((a, b) => b.y - a.y);
    const rows = [];
    let current = null;
    sorted.forEach((it) => {
      if (!current || Math.abs(current.lastY - it.y) > 2) {
        current = { lastY: it.y, items: [] };
        rows.push(current);
      }
      current.lastY = it.y;
      current.items.push(it);
    });
    rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));

    allLines.push(
      ...rows.map((r) => r.items.map((it) => it.text).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean)
    );
  }
  return allLines;
}

function detectTipoDocumento(lines) {
  const text = lines.join(" ");
  if (/COTIZACION No/i.test(text)) return "cotizacion";
  return "factura";
}

// Parser para Factura Electrónica de Venta (formato World Office / FECV).
function parseFactura(lines) {
  const text = lines.join(" | ");
  const result = {
    tipo: "factura",
    numeroFactura: null,
    cliente: null,
    telefono: null,
    telefonoContacto: null,
    direccion: null,
    vendedor: null,
    total: null,
    productos: [],
  };

  const fecvMatch = text.match(/FECV\s*No\.?\s*(\d+)/i);
  if (fecvMatch) result.numeroFactura = fecvMatch[1];

  const clienteLine = lines.find((l) => /^CLIENTE\b/i.test(l));
  if (clienteLine) {
    let rest = clienteLine.replace(/^CLIENTE\s*/i, "");
    const cut = rest.search(/\bPOR CONCEPTO\b/i);
    if (cut !== -1) rest = rest.slice(0, cut);
    result.cliente = rest.trim();
  }

  const headerIdx = lines.findIndex((l) => /DIRECCI[ÓO]N/i.test(l) && /CIUDAD/i.test(l) && /TEL[ÉE]FONO/i.test(l));
  if (headerIdx !== -1 && lines[headerIdx + 1]) {
    const dataLine = lines[headerIdx + 1];
    const telMatch = dataLine.match(/\b3\d{9}\b/);
    if (telMatch) result.telefono = telMatch[0];
    let rest = dataLine;
    if (telMatch) rest = rest.slice(0, dataLine.lastIndexOf(telMatch[0])).trim();
    const words = rest.split(/\s+/);
    if (words.length > 1) {
      words.pop(); // última palabra = ciudad
      result.direccion = words.join(" ").trim();
    } else {
      result.direccion = rest;
    }
  }

  const vendHeaderIdx = lines.findIndex((l) => /VENDEDOR/i.test(l) && /FORMA DE PAGO/i.test(l));
  if (vendHeaderIdx !== -1) {
    for (let j = vendHeaderIdx; j < Math.min(vendHeaderIdx + 2, lines.length); j++) {
      // En la línea del encabezado se quita el texto de las columnas: si la
      // agrupación por Y fusionó encabezado y datos en una sola línea, el
      // regex capturaba "VENDEDOR FORMA DE PAGO JUAN PEREZ" como nombre.
      const linea = j === vendHeaderIdx ? lines[j].replace(/^.*FORMA DE PAGO\s*/i, "") : lines[j];
      const m = linea.match(/(?:\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+)?([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+?)\s+(Contado|Cr[ée]dito)\b/i);
      if (m && m[1].trim().length >= 4) {
        result.vendedor = m[1].trim();
        break;
      }
    }
  }

  const totalHeaderIdx = lines.findIndex((l) => /TOTAL FACTURA/i.test(l));
  if (totalHeaderIdx !== -1) {
    for (let j = totalHeaderIdx + 1; j < Math.min(totalHeaderIdx + 3, lines.length); j++) {
      const nums = lines[j].match(/[\d.,]+/g);
      if (nums && nums.length >= 3) {
        const last = nums[nums.length - 1].replace(/\./g, "");
        const parsed = parseInt(last, 10);
        if (!isNaN(parsed) && parsed > 0) {
          result.total = parsed;
          break;
        }
      }
    }
  }

  const tableHeaderIdx = lines.findIndex((l) => /^C[óo]digo Descripci[óo]n/i.test(l));
  const tableEndIdx = lines.findIndex((l) => /TOTAL IT[ÉE]M/i.test(l));
  if (tableHeaderIdx !== -1 && tableEndIdx !== -1) {
    // La cantidad acepta separador de miles ("1.500", "1.500,00"): un pedido
    // de 1.500 ladrillos es normal en ferretería, y sin esa alternativa el
    // regex no matcheaba y la línea del producto se descartaba en silencio.
    const productLineRegex = /^(\d{1,2})\s+([A-Z0-9]{2,12})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?)\s+(Und\.?|Bulto|Caja|Mt\.?|Kg\.?|kg|Gal\.?|Lb\.?|Mts\.?|Paq\.?|Paquete|Rollo|Glb\.?|m2)\s+([\d.,]+)\s+(\d{1,2}%)\s+([\d.,]+)\s+([\d.,]+)\s*$/i;
    let pending = null;
    for (let i = tableHeaderIdx + 1; i < tableEndIdx; i++) {
      const line = lines[i].trim();
      const m = line.match(productLineRegex);
      if (m) {
        // En la factura (FECV), "Valor IVA" viene por unidad, no por línea.
        // El "Total" de la columna NO incluye IVA (es cantidad x valor unitario).
        // Para mostrar el precio con IVA incluido: total_linea_sin_iva + (valor_iva_unitario x cantidad).
        const cantidadNum = parseCantidad(m[4]);
        const valorIvaUnitario = parseInt(m[8].replace(/\./g, ""), 10) || 0;
        const totalSinIva = parseInt(m[9].replace(/\./g, ""), 10) || 0;
        const ivaLinea = Math.round(valorIvaUnitario * cantidadNum);
        const totalConIva = totalSinIva + ivaLinea;

        result.productos.push({
          codigo: m[2],
          descripcion: m[3].trim(),
          cantidad: m[4],
          unidad: m[5],
          total: String(totalConIva),
        });
        pending = result.productos[result.productos.length - 1];
      } else if (
        pending &&
        line.length > 0 &&
        line.length < 30 &&
        !/^\d/.test(line) &&
        // Con PDFs de varias páginas, entre el final de una página y el inicio
        // de la otra aparecen pies/encabezados repetidos ("Página 1 de 2",
        // "Código Descripción...", NIT, etc.) que no son continuación de nada.
        !/p[áa]gina|c[óo]digo|descripci[óo]n|nit\b|fecv|cliente|tel[ée]fono/i.test(line)
      ) {
        // Continuación de una descripción larga partida en 2 líneas (ej: "3H", "ATLANTIS")
        pending.descripcion = pending.descripcion + " " + line;
      }
    }
  }

  return result;
}

// Parser para Cotización (mismo proveedor, formato de columnas distinto: sin
// columna de "Valor IVA" en pesos, y el bloque de cliente/dirección/vendedor
// está ordenado de forma distinta a la factura).
function parseCotizacion(lines) {
  const text = lines.join(" | ");
  const result = {
    tipo: "cotizacion",
    numeroFactura: null,
    cliente: null,
    telefono: null,
    telefonoContacto: null,
    direccion: null,
    vendedor: null,
    total: null,
    productos: [],
  };

  const numMatch = text.match(/COTIZACION No\.?\s*(\d+)/i);
  if (numMatch) result.numeroFactura = numMatch[1];

  // Anclado al inicio de línea, igual que el replace de abajo: sin ancla,
  // una línea anterior con "CLIENTE" en el medio (p. ej. un encabezado
  // fusionado) se elegía y quedaba entera como nombre del cliente.
  const clienteLine = lines.find((l) => /^,?\s*CLIENTE\b/i.test(l));
  if (clienteLine) {
    let rest = clienteLine.replace(/^,?\s*CLIENTE\s*/i, "");
    const cut = rest.search(/\bP[áa]gina\b/i);
    if (cut !== -1) rest = rest.slice(0, cut);
    result.cliente = rest.trim();
  }

  const headerIdx = lines.findIndex((l) => /DIRECCION/i.test(l) && /CIUDAD/i.test(l) && /TELEFONO/i.test(l));
  if (headerIdx !== -1) {
    for (let j = headerIdx + 1; j < Math.min(headerIdx + 4, lines.length); j++) {
      const l = lines[j];
      if (/No informada/i.test(l) || /\d{6,10}/.test(l)) {
        const nums = l.match(/\d{6,10}/g);
        if (nums) result.telefono = nums[nums.length - 1];
        let rest = l.replace(/\d{6,10}\s*$/, "").trim();
        const words = rest.split(/\s+/);
        if (words.length > 1 && !/No informada/i.test(rest)) {
          words.pop();
          result.direccion = words.join(" ").trim();
        } else {
          result.direccion = rest;
        }
        break;
      }
    }
  }

  // Cuando el teléfono oficial no está registrado, a veces el asesor anota un
  // celular de contacto real en la línea de "información extra" bajo el
  // encabezado VENDEDOR/FORMA DE PAGO.
  if (!result.telefono || result.telefono === "111111111") {
    const celLine = lines.find((l) => /\bcel\b/i.test(l) && /\b3\d{9}\b/.test(l));
    if (celLine) {
      const celMatch = celLine.match(/\b3\d{9}\b/);
      if (celMatch) result.telefonoContacto = celMatch[0];
    }
  }

  const vendHeaderIdx = lines.findIndex((l) => /VENDEDOR/i.test(l) && /FORMA DE PAGO/i.test(l));
  if (vendHeaderIdx !== -1) {
    for (let j = vendHeaderIdx + 1; j < Math.min(vendHeaderIdx + 3, lines.length); j++) {
      const m = lines[j].match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+?)\s+(Contado|Cr[ée]dito)\b/i);
      if (m) {
        result.vendedor = m[1].trim();
        break;
      }
    }
  }

  const totalHeaderIdx = lines.findIndex((l) => /TOTAL PEDIDO/i.test(l));
  if (totalHeaderIdx !== -1 && lines[totalHeaderIdx + 1]) {
    const nums = lines[totalHeaderIdx + 1].match(/[\d.,]+/g);
    if (nums && nums.length) {
      const last = nums[nums.length - 1].replace(/\./g, "");
      const parsed = parseInt(last, 10);
      if (!isNaN(parsed) && parsed > 0) result.total = parsed;
    }
  }

  const tableHeaderIdx = lines.findIndex((l) => /^CODIGO DESCRIPCION/i.test(l));
  const tableEndIdx = lines.findIndex((l) => /^CANT SUBTOTAL/i.test(l));
  if (tableHeaderIdx !== -1 && tableEndIdx !== -1) {
    // Igual que en la factura: la cantidad acepta separador de miles.
    const productLineRegex = /^([A-Z0-9]{2,12})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,5}(?:[.,]\d{1,2})?)\s*(Und\.?|Bulto|Caja|Mt\.?|Kg\.?|kg|Gal\.?|Lb\.?|Mts\.?|Paq\.?|Paquete|Rollo|Glb\.?|m2)\s+([\d.,]+)\s+(\d{1,2}%)\s+([\d.,]+)\s*$/i;
    for (let i = tableHeaderIdx + 1; i < tableEndIdx; i++) {
      const line = lines[i].trim();
      const m = line.match(productLineRegex);
      if (m) {
        result.productos.push({
          codigo: m[1],
          descripcion: m[2].trim(),
          cantidad: m[3],
          unidad: m[4],
          total: m[7].replace(/\./g, ""),
        });
      }
    }
  }

  return result;
}

function parseDocumento(lines) {
  const tipo = detectTipoDocumento(lines);
  return tipo === "cotizacion" ? parseCotizacion(lines) : parseFactura(lines);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function DespachoPedidos() {
  const [libsReady, setLibsReady] = useState(false);
  const [libsError, setLibsError] = useState(false);
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
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [toast, setToast] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayISO());

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

  useEffect(() => {
    if (window.pdfjsLib) {
      setLibsReady(true);
      return;
    }
    const src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    // Si ya hay un <script> con este src (StrictMode monta el efecto dos
    // veces en desarrollo), no se inyecta otro: solo nos colgamos de sus
    // eventos. Y el cleanup quita los listeners para no llamar setState
    // sobre un componente desmontado.
    let script = document.querySelector(`script[src="${src}"]`);
    const esNuevo = !script;
    if (esNuevo) {
      script = document.createElement("script");
      script.src = src;
    }
    const onLoad = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        setLibsReady(true);
      } catch (e) {
        setLibsError(true);
      }
    };
    const onError = () => setLibsError(true);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (esNuevo) document.head.appendChild(script);
    return () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
  }, []);

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
      fecha: todayStr(),
      fechaDespacho: fechaDestino,
      estadoPago: data.estadoPago || "pendiente",
      hora: nowTimeStr(),
      timestamp: Date.now(),
      orden: maxOrden + 1,
    };
    persistPedidos([...pedidos, nuevo], [nuevo], { crear: true });
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

  function deletePedido(id) {
    const prev = pedidos;
    setPedidos(pedidos.filter((p) => p.id !== id));
    eliminarPedido(id).catch(() => {
      setPedidos(prev);
      showToast("No se pudo eliminar de la base de datos. El pedido se restauró.", 5000);
    });
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
      await guardarPedido(entregado, "entregado");
    } catch (e) {
      setPedidos(prevPedidos);
      setHistorial(prevHistorial);
      showToast("No se pudo guardar la entrega. El pedido volvió a despacho.", 5000);
    }
  }

  // Corrige una entrega marcada por error: saca el pedido del historial y lo
  // regresa a despacho (estado "activo") con su vehículo y fecha originales.
  // Si esa fecha ya pasó, reaparece en "Hoy" con la etiqueta de atrasado.
  async function devolverADespacho(id) {
    const pedido = historial.find((p) => p.id === id);
    if (!pedido) return;
    const restaurado = { ...pedido, entregadoEn: null, fechaEntrega: null };
    const prevPedidos = pedidos;
    const prevHistorial = historial;
    setHistorial(historial.filter((p) => p.id !== id));
    setPedidos([restaurado, ...pedidos]);
    showToast("Pedido devuelto a despacho");
    try {
      // upsert con estado "activo": la fila ya existe (estaba entregada), así
      // que solo cambia su estado y limpia la marca de entrega.
      await guardarPedido(restaurado, "activo");
    } catch (e) {
      setPedidos(prevPedidos);
      setHistorial(prevHistorial);
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
      fecha: todayStr(),
      estado: "pendiente",
      fechaSeguimiento: data.fechaSeguimiento || null,
      fechaVencimiento: data.fechaVencimiento || null,
      notas: data.notas || "",
    };
    persistCotizaciones([nueva, ...cotizaciones], nueva);
    setPendingExtractCotizacion(null);
    showToast("Cotización agregada");
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

  const ESTADOS_COTIZACION = [
    { id: "pendiente", label: "Pendiente", icon: "ti-clock", bg: "#FAEEDA", border: "#BA7517", text: "#633806" },
    { id: "aceptada", label: "Aceptada", icon: "ti-check", bg: "#EAF3DE", border: "#639922", text: "#27500A" },
    { id: "rechazada", label: "Rechazada", icon: "ti-x", bg: "#FBE6E6", border: "#CC3333", text: "#7A1F1F" },
  ];

  const cotizacionesFiltradas = cotizaciones.filter((c) => {
    if (!cotizacionFilter.trim()) return true;
    const q = cotizacionFilter.toLowerCase();
    return (
      (c.cliente || "").toLowerCase().includes(q) ||
      (c.numeroFactura || "").toLowerCase().includes(q) ||
      (c.fecha || "").toLowerCase().includes(q)
    );
  });

  const cotizacionesAgrupadas = ESTADOS_COTIZACION.map((est) => ({
    ...est,
    items: cotizacionesFiltradas
      .filter((c) => (c.estado || "pendiente") === est.id)
      .sort((a, b) => (b.id > a.id ? 1 : -1)),
  }));

  // Avisos de seguimiento: cotizaciones pendientes cuya fecha de
  // seguimiento es hoy o mañana, para recordar llamar al cliente.
  const mananaIso = addDaysISO(hoyIso, 1);
  const cotizacionesConSeguimientoProximo = cotizaciones.filter(
    (c) =>
      (c.estado || "pendiente") === "pendiente" &&
      c.fechaSeguimiento &&
      (c.fechaSeguimiento === hoyIso || c.fechaSeguimiento === mananaIso)
  );

  // Cotizaciones pendientes cuya fecha de seguimiento ya pasó sin que nadie
  // las atendiera: merecen una alerta más urgente que las de "próximo".
  const cotizacionesConSeguimientoVencido = cotizaciones.filter(
    (c) => (c.estado || "pendiente") === "pendiente" && c.fechaSeguimiento && c.fechaSeguimiento < hoyIso
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

    // Solo reordenamos dentro de los pedidos de la misma fecha de despacho
    // que el pedido arrastrado; los de otras fechas quedan intactos.
    const others = pedidos.filter(
      (p) => p.id !== dragId && !(fechaDe(p) === dragFecha && p.vehiculo === vehiculoId)
    );
    const colItems = pedidos
      .filter((p) => p.id !== dragId && fechaDe(p) === dragFecha && p.vehiculo === vehiculoId)
      .sort((a, b) => a.orden - b.orden);

    // Si lo arrastran a la columna que ya era su vehículo secundario, el
    // secundario deja de tener sentido (sería el mismo que el principal).
    const moved = { ...dragged, vehiculo: vehiculoId };
    if (moved.vehiculoSecundario === vehiculoId) moved.vehiculoSecundario = null;
    let insertAt = colItems.length;
    if (overId) {
      const idx = colItems.findIndex((p) => p.id === overId);
      if (idx !== -1) insertAt = idx;
    }
    colItems.splice(insertAt, 0, moved);

    // Copias con el orden nuevo (mutar los objetos del estado anterior en
    // sitio corrompía el snapshot previo de React), y a la base de datos
    // solo van las filas que de verdad cambiaron, no toda la columna.
    const reordenados = colItems.map((p, i) => ({ ...p, orden: i + 1 }));
    const cambiados = reordenados.filter((p) => {
      const antes = pedidos.find((x) => x.id === p.id);
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
  const pedidosConEntregaPendiente = pedidos.filter((p) => p.entregaPendiente);

  const pedidosPendientes = pedidos.filter((p) => fechaDe(p) === "pendiente");

  // Pedidos que ya están listos pero se llevan solo cuando salga un viaje a
  // esa zona. Usan el valor especial "viaje" en fechaDespacho (hermano de
  // "pendiente"): no ocupan una fecha real ni el tablero de un día.
  const pedidosEsperaViaje = pedidos.filter((p) => fechaDe(p) === "viaje");

  // Un pedido cuya fecha de despacho ya pasó y sigue activo está ATRASADO:
  // se muestra automáticamente en la pestaña "Hoy" (con etiqueta roja), en
  // vez de quedar escondido en una pestaña de fecha vieja. No le reescribimos
  // la fecha en la base de datos: así no se pierde el rastro de cuándo debió
  // salir. El botón "Mover a hoy" de la tarjeta sí lo pone al día formalmente.
  const esAtrasado = (p) => {
    const f = fechaDe(p);
    return f !== "pendiente" && f !== "viaje" && f < hoyIso;
  };
  const pedidosDelDia =
    selectedDate === hoyIso
      ? pedidos.filter((p) => fechaDe(p) === hoyIso || esAtrasado(p))
      : pedidos.filter((p) => fechaDe(p) === selectedDate);

  // Un pedido aparece en la columna de su vehículo principal y, si tiene un
  // vehículo secundario asignado, también en la columna de ese segundo
  // vehículo. No se duplica el registro: es la misma tarjeta mostrada dos
  // veces. En la columna secundaria se muestra en modo "solo lectura".
  const grouped = VEHICULOS.map((v) => ({
    ...v,
    items: pedidosDelDia
      .filter((p) => p.vehiculo === v.id || p.vehiculoSecundario === v.id)
      .sort((a, b) => {
        // Los atrasados van primero (los más viejos arriba); dentro de la
        // misma fecha se respeta el orden que armó el despachador.
        const fa = fechaDe(a);
        const fb = fechaDe(b);
        if (fa !== fb) return fa < fb ? -1 : 1;
        return a.orden - b.orden;
      }),
  }));

  // Pestañas de fecha: siempre Hoy y Mañana, más cualquier fecha futura que
  // ya tenga pedidos programados. Las fechas pasadas no generan pestaña:
  // sus pedidos (atrasados) se muestran dentro de "Hoy" con etiqueta roja.
  // "pendiente" se excluye de este cálculo: tiene su propia pestaña fija aparte.
  const fechasConPedidos = Array.from(new Set(pedidos.map(fechaDe))).filter(
    (f) => f !== "pendiente" && f !== "viaje" && f >= hoyIso
  );
  const fechasTabs = Array.from(new Set([hoyIso, addDaysISO(hoyIso, 1), ...fechasConPedidos])).sort();
  const conteoPorFecha = fechasTabs.reduce((acc, f) => {
    // "Hoy" cuenta también los atrasados, porque se muestran ahí.
    acc[f] =
      f === hoyIso
        ? pedidos.filter((p) => fechaDe(p) === hoyIso || esAtrasado(p)).length
        : pedidos.filter((p) => fechaDe(p) === f).length;
    return acc;
  }, {});

  // Si la pestaña seleccionada deja de existir (se entregó el último pedido
  // de una fecha atrasada, o la app quedó abierta de un día para otro y
  // "hoy" ya es otra fecha), volvemos a la pestaña de hoy en vez de dejar
  // el tablero apuntando a una fecha sin pestaña.
  useEffect(() => {
    if (selectedDate !== "pendiente" && selectedDate !== "viaje" && !fechasTabs.includes(selectedDate)) {
      setSelectedDate(hoyIso);
    }
  }, [selectedDate, fechasTabs.join(","), hoyIso]);

  const filteredHistorial = historial.filter((h) => {
    if (!historyFilter.trim()) return true;
    const q = historyFilter.toLowerCase();
    return (
      (h.cliente || "").toLowerCase().includes(q) ||
      (h.numeroFactura || "").toLowerCase().includes(q) ||
      (h.fecha || "").toLowerCase().includes(q)
    );
  });

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
        </div>

        {view === "despacho" && (
          <div>
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelected} style={{ display: "none" }} />
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={!libsReady || uploadState === "reading"}
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
              {uploadState === "reading" ? "Leyendo PDF..." : libsReady ? "Subir factura o cotización" : "Preparando lector de PDF..."}
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
              disabled={!libsReady || uploadState === "reading"}
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
              {uploadState === "reading" ? "Leyendo PDF..." : libsReady ? "Subir cotización" : "Preparando lector de PDF..."}
            </button>
          </div>
        )}
      </div>

      {libsError && (
        <div style={{ fontSize: 13, color: "var(--color-text-danger)", marginBottom: 12 }}>
          No se pudo cargar el lector de PDF. Revisa tu conexión a internet y recarga la página.
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

      {pendingExtract && (
        <ExtractReviewCard
          data={pendingExtract}
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
          {pedidosConEntregaPendiente.length > 0 && (
            <div
              style={{
                background: "var(--color-background-danger)",
                border: "0.5px solid var(--color-border-danger)",
                borderRadius: "var(--border-radius-md)",
                padding: "10px 14px",
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--color-text-danger)" }}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 16 }} aria-hidden="true"></i>
                <span style={{ fontWeight: 500, fontSize: 13 }}>
                  Quedó material por entregar ({pedidosConEntregaPendiente.length})
                </span>
              </div>
              {pedidosConEntregaPendiente.map((p) => (
                <div key={p.id} style={{ fontSize: 12, color: "var(--color-text-danger)", padding: "2px 0" }}>
                  {p.cliente}
                  {p.notaPendiente && p.notaPendiente.trim() ? ` — ${p.notaPendiente}` : ""}
                </div>
              ))}
            </div>
          )}
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
              <i className="ti ti-help-circle" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
              Pendientes
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

          {selectedDate === "pendiente" || selectedDate === "viaje" ? (
            (() => {
              const esViaje = selectedDate === "viaje";
              const lista = esViaje ? pedidosEsperaViaje : pedidosPendientes;
              const ayuda = esViaje
                ? "Pedidos listos que se llevan cuando salga un viaje a su zona. Cuando salga el viaje, toca \u201CMover a despacho\u201D para asignarles fecha y vehículo."
                : "Pedidos sin fecha ni vehículo asignado todavía. Cuando sepas cuándo se entregan, toca \u201CMover a despacho\u201D.";
              const vacio = esViaje
                ? "No hay pedidos esperando viaje. Al subir una factura, o al editar un pedido, elige \u201CPor viaje\u201D para que aparezca aquí."
                : "No hay pedidos sin fecha. Cuando subas una factura y elijas \u201CSin fecha aún\u201D, aparecerá aquí.";
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
                    />
                  ))}
                </div>
              );
            })()
          ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {grouped.map((col) => (
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

              {col.items.map((p, idx) => (
                <PedidoCard
                  key={p.id}
                  pedido={p}
                  posicion={idx + 1}
                  esSecundario={p.vehiculo !== col.id}
                  isDragging={dragId === p.id}
                  onDragStart={() => handleDragStart(p.id)}
                  onDragEnd={handleDragEnd}
                  onDragOverItem={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverCol(col.id);
                  }}
                  onDropItem={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDropOnColumn(col.id, p.id);
                  }}
                  onDelete={() => deletePedido(p.id)}
                  onEntregado={() => solicitarEntrega(p)}
                  onEdit={() => setEditing(p)}
                  onVerPdf={() => setViewingPdf(p)}
                  onNotaPendiente={() => setNotaPendienteDe(p)}
                  atrasadoDesde={esAtrasado(p) ? fechaDe(p) : null}
                  onMoverAHoy={() => moverAHoy(p.id)}
                />
              ))}
            </div>
            ))}
          </div>
          )}
        </>
      ) : view === "historial" ? (
        <div>
          <input
            type="text"
            placeholder="Buscar por cliente, factura o fecha..."
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            style={{ width: "100%", marginBottom: 12 }}
          />
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
      ) : (
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
      )}

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

      {materialDe && (
        <MaterialPorUnidadesModal
          pedido={materialDe}
          onClose={() => setMaterialDe(null)}
          onGuardar={(productos) => {
            updatePedido(materialDe.id, { productos });
            setMaterialDe(null);
            showToast("Material actualizado");
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

function ExtractReviewCard({ data, onChange, onConfirm, onCancel }) {
  const [aviso, setAviso] = useState("");
  const confirmadoRef = useRef(false);
  const missing = [];
  if (!data.cliente) missing.push("cliente");
  if (!data.numeroFactura) missing.push("número");
  if (!data.total) missing.push("total");
  if (!data.vendedor) missing.push("vendedor");

  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1rem 1.25rem",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <i className="ti ti-file-text" style={{ fontSize: 18 }} aria-hidden="true"></i>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Revisa los datos extraídos</span>
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: "var(--border-radius-sm)",
            background: "var(--color-background-secondary)",
            color: "var(--color-text-secondary)",
            marginLeft: "auto",
          }}
        >
          {data.tipo === "cotizacion" ? "Cotización" : "Factura"}
        </span>
      </div>

      {missing.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--color-text-warning)", marginBottom: 10 }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          No se detectó: {missing.join(", ")}. Complétalo a mano.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Field label="N° documento" inputMode="numeric" spellCheck={false} value={data.numeroFactura || ""} onChange={(v) => onChange({ ...data, numeroFactura: v })} />
        <Field label="Cliente" value={data.cliente || ""} onChange={(v) => onChange({ ...data, cliente: v })} />
        <Field
          label="Teléfono"
          type="tel"
          value={data.telefono || ""}
          onChange={(v) => onChange({ ...data, telefono: v })}
        />
        <Field label="Vendedor" value={data.vendedor || ""} onChange={(v) => onChange({ ...data, vendedor: v })} />
      </div>

      {data.telefonoContacto && data.telefono === "111111111" && (
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
          <i className="ti ti-phone" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Cliente sin teléfono registrado, pero hay un celular de contacto anotado: {data.telefonoContacto}
        </div>
      )}

      {data.productos && data.productos.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            Productos detectados ({data.productos.length}) — precio con IVA incluido
          </div>
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden", maxHeight: 220, overflowY: "auto" }}>
            {data.productos.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 13,
                  padding: "6px 10px",
                  borderTop: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none",
                }}
              >
                <span>{p.cantidad} {p.unidad} — {p.descripcion}</span>
                <span style={{ color: "var(--color-text-secondary)", flexShrink: 0 }}>${formatCOP(parseInt(p.total))}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--color-text-warning)", marginBottom: 12 }}>
          No se detectaron productos en la tabla. Puedes seguir igual; el PDF queda adjunto como respaldo.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Total (incluye IVA)</span>
        <span style={{ fontSize: 18, fontWeight: 500 }}>{data.total ? `$${formatCOP(data.total)}` : "No detectado"}</span>
      </div>

      {(() => {
        const esViaje = data.fechaDespacho === "viaje";
        const esPendiente = !!data.sinFechaDefinida && !esViaje;
        const fechaSel =
          data.fechaDespacho && data.fechaDespacho !== "pendiente" && data.fechaDespacho !== "viaje"
            ? data.fechaDespacho
            : todayISO();
        const esHoy = !esPendiente && !esViaje && fechaSel === todayISO();
        const esProgramado = !esPendiente && !esViaje && fechaSel !== todayISO();
        const opcion = (activo) => ({
          flex: 1,
          border: activo ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
          background: activo ? "var(--color-background-info)" : "var(--color-background-primary)",
          color: activo ? "var(--color-text-info)" : "var(--color-text-primary)",
          padding: "8px 4px",
          borderRadius: "var(--border-radius-md)",
          fontSize: 12.5,
          fontWeight: activo ? 500 : 400,
        });
        return (
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>
              ¿Cuándo se entrega?
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onChange({ ...data, sinFechaDefinida: false, fechaDespacho: todayISO() })} aria-pressed={esHoy} style={opcion(esHoy)}>
                Hoy
              </button>
              <button
                onClick={() => onChange({ ...data, sinFechaDefinida: false, fechaDespacho: addDaysISO(todayISO(), 1) })}
                aria-pressed={esProgramado}
                style={opcion(esProgramado)}
              >
                Otro día
              </button>
              <button
                onClick={() => onChange({ ...data, sinFechaDefinida: true, fechaDespacho: "pendiente", vehiculo: null })}
                aria-pressed={esPendiente}
                style={opcion(esPendiente)}
              >
                Sin fecha
              </button>
              <button
                onClick={() => onChange({ ...data, sinFechaDefinida: true, fechaDespacho: "viaje", vehiculo: null })}
                aria-pressed={esViaje}
                style={opcion(esViaje)}
              >
                Por viaje
              </button>
            </div>
            {esProgramado && (
              <div style={{ marginTop: 8 }}>
                <input
                  type="date"
                  aria-label="Fecha de despacho"
                  value={fechaSel}
                  min={todayISO()}
                  onChange={(e) => onChange({ ...data, fechaDespacho: e.target.value || todayISO() })}
                  style={{ width: "100%" }}
                />
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>
                  El pedido queda programado para esa fecha y aparece en su pestaña de día.
                </div>
              </div>
            )}
            {esPendiente && (
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 6 }}>
                El pedido va a la pestaña "Pendientes" hasta que sepas cuándo y en qué vehículo se entrega.
              </div>
            )}
            {esViaje && (
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 6 }}>
                El pedido va a la pestaña "Por viaje". Se lleva cuando salga un viaje a esa zona; ahí le asignas fecha y vehículo.
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ marginBottom: 12 }}>
        <DestinoSelector value={data.destino || ""} onChange={(v) => onChange({ ...data, destino: v })} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>
          Estado de pago
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onChange({ ...data, estadoPago: "pagado" })}
            aria-pressed={data.estadoPago === "pagado"}
            style={{
              flex: 1,
              border: data.estadoPago === "pagado" ? "2px solid var(--color-border-success)" : "0.5px solid var(--color-border-tertiary)",
              background: data.estadoPago === "pagado" ? "var(--color-background-success)" : "var(--color-background-primary)",
              color: data.estadoPago === "pagado" ? "var(--color-text-success)" : "var(--color-text-primary)",
              padding: "8px 0",
              borderRadius: "var(--border-radius-md)",
              fontSize: 13,
            }}
          >
            Ya pagado
          </button>
          <button
            onClick={() => onChange({ ...data, estadoPago: "pendiente" })}
            aria-pressed={data.estadoPago === "pendiente"}
            style={{
              flex: 1,
              border: data.estadoPago === "pendiente" ? "2px solid var(--color-border-warning)" : "0.5px solid var(--color-border-tertiary)",
              background: data.estadoPago === "pendiente" ? "var(--color-background-warning)" : "var(--color-background-primary)",
              color: data.estadoPago === "pendiente" ? "var(--color-text-warning)" : "var(--color-text-primary)",
              padding: "8px 0",
              borderRadius: "var(--border-radius-md)",
              fontSize: 13,
            }}
          >
            Paga al recibir
          </button>
        </div>
      </div>

      {!data.sinFechaDefinida && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>Vehículo</span>
          <div style={{ display: "flex", gap: 8 }}>
            {VEHICULOS.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setAviso("");
                  onChange({ ...data, vehiculo: v.id });
                }}
                aria-pressed={data.vehiculo === v.id}
                style={{
                  flex: 1,
                  border: data.vehiculo === v.id ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  background: data.vehiculo === v.id ? "var(--color-background-info)" : "var(--color-background-primary)",
                  color: data.vehiculo === v.id ? "var(--color-text-info)" : "var(--color-text-primary)",
                  padding: "8px 0",
                  borderRadius: "var(--border-radius-md)",
                  fontSize: 13,
                  fontWeight: data.vehiculo === v.id ? 500 : 400,
                }}
              >
                <i className={`ti ${v.icon}`} style={{ fontSize: 16, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {aviso && (
        <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 8, textAlign: "right" }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          {aviso}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => {
            // Evita el pedido duplicado por doble clic mientras la tarjeta se cierra.
            if (confirmadoRef.current) return;
            if (!data.sinFechaDefinida && !data.vehiculo) {
              setAviso("Selecciona un vehículo antes de guardar");
              return;
            }
            if (!data.cliente || !data.cliente.trim()) {
              setAviso("Escribe el nombre del cliente antes de guardar");
              return;
            }
            setAviso("");
            confirmadoRef.current = true;
            onConfirm();
          }}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: "var(--color-background-info)",
            color: "var(--color-text-info)",
            border: "0.5px solid var(--color-border-info)",
          }}
        >
          <i className="ti ti-check" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Agregar pedido
        </button>
      </div>
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
function DestinoSelector({ value, onChange }) {
  const esPreset = DESTINOS.includes(value);
  const [otroManual, setOtroManual] = useState(!!value && !esPreset);
  const mostrarOtro = otroManual || (!!value && !esPreset);
  const opcion = (activo) => ({
    flex: 1,
    fontSize: 12.5,
    padding: "8px 4px",
    minHeight: 40,
    borderRadius: "var(--border-radius-md)",
    border: activo ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
    background: activo ? "var(--color-background-info)" : "var(--color-background-primary)",
    color: activo ? "var(--color-text-info)" : "var(--color-text-primary)",
    fontWeight: activo ? 500 : 400,
  });
  return (
    <div>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
        ¿Para dónde va? <span style={{ color: "var(--color-text-tertiary)" }}>(opcional)</span>
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        {DESTINOS.map((d) => (
          <button
            key={d}
            aria-pressed={value === d}
            onClick={() => {
              setOtroManual(false);
              onChange(d);
            }}
            style={opcion(value === d)}
          >
            {d}
          </button>
        ))}
        <button
          aria-pressed={mostrarOtro}
          onClick={() => {
            setOtroManual(true);
            if (esPreset) onChange("");
          }}
          style={opcion(mostrarOtro)}
        >
          Otro
        </button>
      </div>
      {mostrarOtro && (
        <input
          type="text"
          autoComplete="off"
          placeholder="Escribe el lugar"
          value={esPreset ? "" : value || ""}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", marginTop: 8 }}
        />
      )}
    </div>
  );
}

function PedidoCard({ pedido, posicion, esSecundario, isDragging, onDragStart, onDragEnd, onDragOverItem, onDropItem, onDelete, onEntregado, onEdit, onVerPdf, onNotaPendiente, atrasadoDesde, onMoverAHoy, onProgramar, onMaterialUnidades }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [verProductos, setVerProductos] = useState(false);
  const productos = pedido.productos || [];
  const pagado = pedido.estadoPago === "pagado";
  const pendiente = !!pedido.entregaPendiente;
  const vehiculoPrincipal = VEHICULOS.find((v) => v.id === pedido.vehiculo);

  return (
    <div
      draggable={!esSecundario}
      onDragStart={esSecundario ? undefined : onDragStart}
      onDragEnd={esSecundario ? undefined : onDragEnd}
      onDragOver={esSecundario ? undefined : onDragOverItem}
      onDrop={esSecundario ? undefined : onDropItem}
      style={{
        background: "var(--color-background-primary)",
        border: pendiente ? "0.5px solid var(--color-border-danger)" : "0.5px solid var(--color-border-tertiary)",
        borderLeft: pendiente ? "3px solid var(--color-border-danger)" : undefined,
        borderRadius: "var(--border-radius-md)",
        padding: "10px 12px",
        marginBottom: 8,
        cursor: esSecundario ? "default" : "grab",
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: MARCA.azulClaro,
            color: MARCA.azulOscuro,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {posicion !== null ? posicion : <i className="ti ti-help-circle" style={{ fontSize: 13 }} aria-hidden="true"></i>}
        </span>
        <span style={{ fontWeight: 500, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pedido.cliente}
        </span>
        {pedido.total ? (
          <span style={{ fontSize: 14, fontWeight: 500, color: MARCA.azulOscuro, flexShrink: 0 }}>${formatCOP(pedido.total)}</span>
        ) : null}
        {!esSecundario && (
          <i className="ti ti-grip-vertical" style={{ fontSize: 14, color: "var(--color-text-tertiary)", flexShrink: 0 }} aria-hidden="true"></i>
        )}
      </div>

      {esSecundario && (
        <div style={{ marginBottom: 7, paddingLeft: 36 }}>
          <span
            style={{
              fontSize: 12,
              background: "var(--color-background-secondary)",
              color: "var(--color-text-secondary)",
              borderRadius: "var(--border-radius-sm)",
              padding: "2px 7px",
            }}
          >
            <i className="ti ti-arrows-split" style={{ fontSize: 11, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
            Parte de este pedido va aquí — el principal está en {vehiculoPrincipal ? vehiculoPrincipal.label : "otro vehículo"}
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7, paddingLeft: 36, flexWrap: "wrap" }}>
        {atrasadoDesde && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              background: "var(--color-background-danger)",
              color: "var(--color-text-danger)",
              borderRadius: "var(--border-radius-sm)",
              padding: "2px 7px",
            }}
          >
            <i className="ti ti-alert-triangle" style={{ fontSize: 11, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
            Atrasado — era para {formatFechaCorta(atrasadoDesde)}
          </span>
        )}
        {pedido.numeroFactura && (
          <span style={{ fontSize: 12, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)", borderRadius: "var(--border-radius-sm)", padding: "2px 7px" }}>
            {pedido.tipoDocumento === "cotizacion" ? "Cotización" : "Factura"} {pedido.numeroFactura}
          </span>
        )}
        {pedido.destino && pedido.destino.trim() && (
          <span style={{ fontSize: 12, background: "var(--color-background-info)", color: "var(--color-text-info)", borderRadius: "var(--border-radius-sm)", padding: "2px 7px" }}>
            <i className="ti ti-map-pin" style={{ fontSize: 11, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
            {pedido.destino}
          </span>
        )}
        {pedido.hora && <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{pedido.hora}</span>}
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: pagado ? "var(--color-text-success)" : "var(--color-text-warning)",
            marginLeft: "auto",
          }}
        ></span>
        <span style={{ fontSize: 12, color: pagado ? "var(--color-text-success)" : "var(--color-text-warning)" }}>
          {pagado ? "Pagado" : "Paga al recibir"}
        </span>
      </div>

      {productos.length > 0 && (
        <div style={{ marginBottom: 9, paddingLeft: 36 }}>
          {productos.length === 1 ? (
            <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
              <b style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
                {productos[0].cantidad} {productos[0].unidad}
              </b>{" "}
              — {productos[0].descripcion}
            </div>
          ) : (
            <>
              <button
                onClick={() => setVerProductos(!verProductos)}
                style={{
                  fontSize: 12.5,
                  padding: "8px 0",
                  minHeight: 40,
                  border: "none",
                  background: "transparent",
                  color: "var(--color-text-secondary)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {verProductos ? "Ocultar productos" : `${productos[0].descripcion} +${productos.length - 1} más`}
                <i
                  className={verProductos ? "ti ti-chevron-up" : "ti ti-chevron-down"}
                  style={{ fontSize: 13, verticalAlign: "-2px", marginLeft: 4, color: MARCA.azulMedio }}
                  aria-hidden="true"
                ></i>
              </button>

              {verProductos && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
                  {productos.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
                      <span
                        style={{
                          fontWeight: 500,
                          color: "var(--color-text-primary)",
                          flexShrink: 0,
                          minWidth: 58,
                        }}
                      >
                        {p.cantidad} {p.unidad}
                      </span>
                      <span style={{ color: "var(--color-text-secondary)" }}>{p.descripcion}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {pendiente && (
        <div
          style={{
            fontSize: 12.5,
            color: "var(--color-text-danger)",
            background: "var(--color-background-danger)",
            borderRadius: "var(--border-radius-sm)",
            padding: "6px 8px",
            marginBottom: 9,
            marginLeft: 36,
            fontWeight: 500,
          }}
        >
          <i className="ti ti-alert-triangle" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Quedó pendiente{pedido.notaPendiente && pedido.notaPendiente.trim() ? `: ${pedido.notaPendiente}` : ""}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 36, flexWrap: "wrap" }}>
        {onProgramar && (
          <button
            onClick={onProgramar}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              fontWeight: 500,
              background: "var(--color-background-info)",
              color: "var(--color-text-info)",
              border: "0.5px solid var(--color-border-info)",
            }}
          >
            <i className="ti ti-truck-delivery" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Mover a despacho
          </button>
        )}
        {onMaterialUnidades &&
          (() => {
            const faltan = faltantesDeProductos(pedido.productos);
            const tocado = (pedido.productos || []).some((p) => p.cantidadEntregada !== undefined && p.cantidadEntregada !== null);
            return (
              <button
                onClick={onMaterialUnidades}
                style={{
                  fontSize: 12.5,
                  padding: "9px 12px",
                  minHeight: 40,
                  background: faltan.length > 0 ? "var(--color-background-warning)" : "transparent",
                  color: faltan.length > 0 ? "var(--color-text-warning)" : "var(--color-text-primary)",
                  border: faltan.length > 0 ? "0.5px solid var(--color-border-warning)" : "0.5px solid var(--color-border-tertiary)",
                }}
              >
                <i className="ti ti-checklist" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                {faltan.length > 0 ? `Material (faltan ${faltan.length})` : tocado ? "Material ✓" : "Material entregado"}
              </button>
            );
          })()}
        {atrasadoDesde && !esSecundario && onMoverAHoy && (
          <button
            onClick={onMoverAHoy}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              fontWeight: 500,
              background: "var(--color-background-warning)",
              color: "var(--color-text-warning)",
              border: "0.5px solid var(--color-border-warning)",
            }}
          >
            <i className="ti ti-calendar-up" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Mover a hoy
          </button>
        )}
        {(pedido.tienePdf || pedido.pdfDataUrl) && (
          <button onClick={onVerPdf} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
            <i className="ti ti-file-text" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Ver documento
          </button>
        )}
        <button
          onClick={onEdit}
          style={{
            fontSize: 12.5,
            padding: "9px 12px",
            minHeight: 40,
            background: MARCA.azulClaro,
            color: MARCA.azulOscuro,
            border: `0.5px solid ${MARCA.azulMedio}`,
          }}
        >
          <i className="ti ti-edit" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Editar
        </button>
        {!esSecundario && onNotaPendiente && (
          <button
            onClick={onNotaPendiente}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              background: pendiente ? "var(--color-background-danger)" : "transparent",
              color: pendiente ? "var(--color-text-danger)" : "var(--color-text-primary)",
              border: pendiente ? "0.5px solid var(--color-border-danger)" : "0.5px solid var(--color-border-tertiary)",
            }}
          >
            <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            {pendiente ? "Editar pendiente" : "Quedó pendiente"}
          </button>
        )}
        {!esSecundario &&
          (confirmDelete ? (
            <button
              onClick={onDelete}
              style={{
                fontSize: 12.5,
                padding: "9px 12px",
                minHeight: 40,
                background: "var(--color-background-danger)",
                color: "var(--color-text-danger)",
                border: "0.5px solid var(--color-border-danger)",
                fontWeight: 500,
              }}
            >
              <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
              Toca otra vez para eliminar
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                fontSize: 12.5,
                padding: "9px 12px",
                minHeight: 40,
                background: "var(--color-background-danger)",
                color: "var(--color-text-danger)",
                border: "0.5px solid var(--color-border-danger)",
              }}
            >
              <i className="ti ti-trash" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
              Eliminar
            </button>
          ))}
        {!esSecundario && (
        <button
          onClick={onEntregado}
          style={{
            marginLeft: "auto",
            border: "none",
            background: "#639922",
            color: "white",
            fontWeight: 500,
            fontSize: 13,
            borderRadius: "var(--border-radius-md)",
            padding: "9px 14px",
            minHeight: 40,
          }}
        >
          <i className="ti ti-check" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Entregado
        </button>
        )}
      </div>
    </div>
  );
}

// Renderiza el PDF como imagen usando PDF.js + canvas, en vez de un iframe.
// Esto evita los bloqueos de visor nativo que impedían ver el PDF dentro
// del artifact.
function PdfCanvasViewer({ dataUrl }) {
  const containerRef = useRef(null);
  const pdfRef = useRef(null);
  const canvasRefs = useRef([]);
  const [status, setStatus] = useState("loading");
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);

  // Fase 1: cargar el documento (una sola vez por PDF) y saber cuántas
  // páginas tiene. La página real se dibuja en la Fase 2, cuando ya existen
  // los <canvas> en el DOM.
  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    async function load() {
      if (!window.pdfjsLib) {
        setStatus("error");
        return;
      }
      try {
        const base64 = dataUrl.split(",")[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        loadingTask = window.pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) setStatus("error");
      }
    }
    load();
    return () => {
      cancelled = true;
      pdfRef.current = null;
      // Libera el documento y su memoria en el worker de pdf.js. Sin esto,
      // cada apertura del modal dejaba un documento vivo y la pestaña
      // acumulaba memoria durante toda la jornada.
      if (loadingTask) loadingTask.destroy().catch(() => {});
    };
  }, [dataUrl]);

  // Fase 2: dibujar cada página ajustada al ancho del modal (no a una escala
  // fija, que en computador se veía pequeña) y a la densidad real de píxeles
  // de la pantalla, para que el texto salga nítido y no pixelado. El zoom
  // multiplica ese ajuste.
  useEffect(() => {
    if (status !== "ready" || !pdfRef.current || !numPages) return;
    let cancelled = false;
    const tasks = [];
    (async () => {
      const pdf = pdfRef.current;
      const contenedor = containerRef.current;
      const anchoDisponible = contenedor ? contenedor.clientWidth - 4 : 800;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= numPages; n++) {
        if (cancelled) return;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const escalaCss = ((anchoDisponible / base.width) || 1) * zoom;
        const viewport = page.getViewport({ scale: escalaCss * dpr });
        const canvas = canvasRefs.current[n - 1];
        if (!canvas) continue;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = base.width * escalaCss + "px";
        canvas.style.height = base.height * escalaCss + "px";
        const task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
        tasks.push(task);
        try {
          await task.promise;
        } catch (e) {
          /* render cancelado al re-dibujar: normal */
        }
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel && t.cancel());
    };
  }, [status, numPages, zoom]);

  return (
    <div>
      {status === "ready" && numPages > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            {numPages === 1 ? "1 página" : `${numPages} páginas`}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
              aria-label="Alejar"
              style={{ padding: "8px 12px", minWidth: 40, minHeight: 40, fontSize: 14 }}
            >
              <i className="ti ti-minus" style={{ fontSize: 13 }} aria-hidden="true"></i>
            </button>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", minWidth: 42, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
              aria-label="Acercar"
              style={{ padding: "8px 12px", minWidth: 40, minHeight: 40, fontSize: 14 }}
            >
              <i className="ti ti-plus" style={{ fontSize: 13 }} aria-hidden="true"></i>
            </button>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          maxHeight: "72vh",
          overflow: "auto",
          overscrollBehavior: "contain",
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-md)",
          padding: 8,
          textAlign: "center",
        }}
      >
        {status === "loading" && (
          <div style={{ padding: "3rem 0", textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>Cargando documento...</div>
        )}
        {status === "error" && (
          <div style={{ padding: "2rem 1rem", textAlign: "center", fontSize: 13, color: "var(--color-text-warning)" }}>
            No se pudo mostrar el documento aquí. Usa "Descargar PDF" abajo para abrirlo.
          </div>
        )}
        {status === "ready" &&
          Array.from({ length: numPages }).map((_, i) => (
            <canvas
              key={i}
              ref={(el) => (canvasRefs.current[i] = el)}
              style={{
                display: "block",
                margin: i > 0 ? "10px auto 0" : "0 auto",
                boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                background: "white",
              }}
            />
          ))}
      </div>
    </div>
  );
}

// Overlay de modal verdadero: position:fixed cubre toda la ventana visible
// (sin esto, el "fondo oscuro" solo ocupaba el alto del contenido y el click
// afuera o el modal mismo podían quedar fuera de la vista, dando la sensación
// de que "no cierra"). Cierra con click fuera, botón X, o tecla Esc.
function ModalOverlay({ onClose, children, maxWidth = 480 }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          padding: 12,
          width: "100%",
          maxWidth,
          maxHeight: "90vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// El PDF ya no viene en la carga inicial (pesa demasiado): si el pedido no lo
// trae en memoria pero tiene_pdf es true, lo pedimos aquí con fetchPdf al abrir
// el visor. Estados: "cargando" | "listo" | "vacio" | "error".
function PdfModal({ pedido, fetchPdf, onClose }) {
  const [dataUrl, setDataUrl] = useState(pedido.pdfDataUrl || null);
  const [estado, setEstado] = useState(
    pedido.pdfDataUrl ? "listo" : pedido.tienePdf ? "cargando" : "vacio"
  );

  useEffect(() => {
    // Si ya lo tenemos (pedido recién subido) o no hay PDF, no cargamos nada.
    if (pedido.pdfDataUrl || !pedido.tienePdf || !fetchPdf) return;
    let activo = true;
    setEstado("cargando");
    fetchPdf(pedido.id)
      .then((url) => {
        if (!activo) return;
        if (url) {
          setDataUrl(url);
          setEstado("listo");
        } else {
          setEstado("vacio");
        }
      })
      .catch(() => {
        if (activo) setEstado("error");
      });
    return () => {
      activo = false;
    };
  }, [pedido.id, pedido.pdfDataUrl, pedido.tienePdf, fetchPdf]);

  return (
    <ModalOverlay onClose={onClose} maxWidth={860}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pedido.fileName || "Documento"}
        </span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40, flexShrink: 0, marginLeft: 8 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      {estado === "listo" && dataUrl && <PdfCanvasViewer dataUrl={dataUrl} />}
      {estado === "cargando" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "2rem 0", textAlign: "center" }}>
          Cargando documento…
        </div>
      )}
      {estado === "vacio" && (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "2rem 0", textAlign: "center" }}>
          No hay documento adjunto para este pedido
        </div>
      )}
      {estado === "error" && (
        <div style={{ fontSize: 13, color: "var(--color-text-warning)", padding: "2rem 0", textAlign: "center" }}>
          No se pudo cargar el documento. Revisa tu conexión e inténtalo de nuevo.
        </div>
      )}
      {estado === "listo" && dataUrl && (
        <div style={{ marginTop: 8, textAlign: "right" }}>
          <a href={dataUrl} download={pedido.fileName || "documento.pdf"} style={{ fontSize: 12 }}>
            <i className="ti ti-download" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Descargar PDF
          </a>
        </div>
      )}
    </ModalOverlay>
  );
}

function HistorialRow({ pedido, onVerPdf, onDevolver }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDevolver, setConfirmDevolver] = useState(false);
  const pagado = pedido.estadoPago === "pagado";
  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          font: "inherit",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <i className={`ti ${(VEHICULOS.find((v) => v.id === pedido.vehiculo) || {}).icon || "ti-package"}`} style={{ fontSize: 16, color: "var(--color-text-secondary)" }} aria-hidden="true"></i>
        <span style={{ fontWeight: 500, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pedido.cliente}</span>
        {/* Marca de "quedó debiendo" bien visible: sirve para saber a quién cobrar. */}
        {!pagado && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              background: "var(--color-background-warning)",
              color: "var(--color-text-warning)",
              borderRadius: "var(--border-radius-sm)",
              padding: "1px 7px",
              flexShrink: 0,
            }}
          >
            Debe
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{pedido.fechaEntrega || pedido.fecha}</span>
        <i className={`ti ti-chevron-${expanded ? "up" : "down"}`} style={{ fontSize: 14, color: "var(--color-text-tertiary)", flexShrink: 0 }} aria-hidden="true"></i>
      </button>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 12, color: "var(--color-text-secondary)" }}>
          <div>Documento: {pedido.numeroFactura || "-"} ({pedido.tipoDocumento === "cotizacion" ? "cotización" : "factura"})</div>
          <div>Vendedor: {pedido.vendedor || "-"}</div>
          <div>Vehículo: {(VEHICULOS.find((v) => v.id === pedido.vehiculo) || {}).label || "-"}</div>
          {pedido.destino && pedido.destino.trim() && <div>Destino: {pedido.destino}</div>}
          <div>Total: {pedido.total ? `$${formatCOP(pedido.total)}` : "-"}</div>
          <div style={{ color: pagado ? "var(--color-text-success)" : "var(--color-text-warning)", fontWeight: 500 }}>
            Pago: {pagado ? "Pagado" : "Quedó debiendo"}
          </div>
          {pedido.productos && pedido.productos.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {pedido.productos.map((p, i) => (
                <div key={i}>· {p.cantidad} {p.unidad} {p.descripcion}</div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {(pedido.tienePdf || pedido.pdfDataUrl) && (
              <button onClick={onVerPdf} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
                <i className="ti ti-file-text" style={{ fontSize: 12, verticalAlign: "-1px", marginRight: 3 }} aria-hidden="true"></i>
                Ver documento
              </button>
            )}
            {/* Corrige una entrega marcada por error. Doble toque para no
                devolver un pedido sin querer. */}
            {onDevolver &&
              (confirmDevolver ? (
                <button
                  onClick={onDevolver}
                  style={{
                    fontSize: 12.5,
                    padding: "9px 12px",
                    minHeight: 40,
                    fontWeight: 500,
                    background: "var(--color-background-warning)",
                    color: "var(--color-text-warning)",
                    border: "0.5px solid var(--color-border-warning)",
                  }}
                >
                  <i className="ti ti-arrow-back-up" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                  Toca otra vez para devolver
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDevolver(true)}
                  style={{
                    fontSize: 12.5,
                    padding: "9px 12px",
                    minHeight: 40,
                    background: "transparent",
                    color: "var(--color-text-primary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                  }}
                >
                  <i className="ti ti-arrow-back-up" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
                  Devolver a despacho
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
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
function MaterialPorUnidadesModal({ pedido, onClose, onGuardar }) {
  const [items, setItems] = useState(() =>
    (pedido.productos || []).map((p) => ({
      ...p,
      // Por defecto asumimos que se entregó todo; el usuario baja las que
      // faltaron. Si ya se había tocado antes, respetamos ese valor.
      entregadas: p.cantidadEntregada !== undefined && p.cantidadEntregada !== null ? cantidadNum(p.cantidadEntregada) : cantidadNum(p.cantidad),
    }))
  );

  const setEntregadas = (idx, valor) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const total = cantidadNum(it.cantidad);
        let n = valor;
        if (isNaN(n) || n < 0) n = 0;
        if (n > total) n = total;
        return { ...it, entregadas: n };
      })
    );
  };

  return (
    <ModalOverlay onClose={onClose} maxWidth={460}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Material entregado</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginBottom: 12 }}>
        {pedido.cliente} · marca cuántas unidades de cada material se entregaron.
      </div>

      {items.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: "8px 4px" }}>
          Este pedido no tiene productos detallados.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {items.map((it, idx) => {
          const total = cantidadNum(it.cantidad);
          const falta = total - it.entregadas;
          const completo = falta <= 0;
          return (
            <div
              key={idx}
              style={{
                border: completo ? "0.5px solid var(--color-border-success)" : "0.5px solid var(--color-border-warning)",
                borderRadius: "var(--border-radius-md)",
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <b style={{ fontWeight: 500 }}>{formatCantidad(total)} {it.unidad}</b> — {it.descripcion}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Entregadas:</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={total}
                  value={it.entregadas}
                  onChange={(e) => setEntregadas(idx, parseCantidad(e.target.value))}
                  style={{ width: 80 }}
                />
                <button onClick={() => setEntregadas(idx, total)} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>
                  Todo
                </button>
                <button onClick={() => setEntregadas(idx, 0)} style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}>
                  Nada
                </button>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    fontWeight: 500,
                    color: completo ? "var(--color-text-success)" : "var(--color-text-warning)",
                  }}
                >
                  {completo ? "Completo" : `Faltan ${formatCantidad(falta)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => onGuardar(items.map(({ entregadas, ...rest }) => ({ ...rest, cantidadEntregada: entregadas })))}
          style={{ fontSize: 13, fontWeight: 500, background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)" }}
        >
          Guardar
        </button>
      </div>
    </ModalOverlay>
  );
}

// Al entregar un pedido "paga al recibir" preguntamos si el cliente pagó, para
// dejar el registro correcto en el historial. Los pedidos que ya venían
// "pagado" NO pasan por aquí: se entregan de un solo toque, como siempre.
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
              Sin fecha
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
              Va a la pestaña "Pendientes" hasta que sepas cuándo y en qué vehículo se entrega.
            </span>
          )}
          {modo === "viaje" && (
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 4 }}>
              Va a la pestaña "Por viaje". Se lleva cuando salga un viaje a esa zona; ahí le asignas fecha y vehículo.
            </span>
          )}
        </div>

        {!sinFecha && (
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>
              Fecha de despacho
            </span>
            <input
              type="date"
              value={form.fechaDespacho || todayISO()}
              min={todayISO()}
              onChange={(e) => setForm({ ...form, fechaDespacho: e.target.value })}
              style={{ width: "100%" }}
            />
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 4 }}>
              Si elige una fecha futura, el pedido se mueve a esa pestaña de día.
            </span>
          </label>
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

const ESTADOS_COTIZACION_BADGE = {
  pendiente: { label: "Pendiente", bg: "var(--color-background-warning)", text: "var(--color-text-warning)" },
  aceptada: { label: "Aceptada", bg: "var(--color-background-success)", text: "var(--color-text-success)" },
  rechazada: { label: "Rechazada", bg: "var(--color-background-danger)", text: "var(--color-text-danger)" },
};

const ESTADOS_COTIZACION_BADGE_KEYS = ["pendiente", "aceptada", "rechazada"];

function CotizacionCard({ cotizacion, hoyIso, onDelete, onEdit, onVerPdf, onCambiarEstado }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const badge = ESTADOS_COTIZACION_BADGE[cotizacion.estado || "pendiente"];
  const iniciales = (cotizacion.cliente || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-md)",
        padding: "10px 12px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: badge.bg,
            color: badge.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {iniciales}
        </span>
        <span style={{ fontWeight: 500, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cotizacion.cliente}
        </span>
        {cotizacion.total ? (
          <span style={{ fontSize: 14, fontWeight: 500, color: MARCA.azulOscuro, flexShrink: 0 }}>${formatCOP(cotizacion.total)}</span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7, paddingLeft: 36, flexWrap: "wrap" }}>
        {cotizacion.numeroFactura && (
          <span style={{ fontSize: 12, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)", borderRadius: "var(--border-radius-sm)", padding: "2px 7px" }}>
            Cotización {cotizacion.numeroFactura}
          </span>
        )}
        {cotizacion.fecha && <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{cotizacion.fecha}</span>}
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: "var(--border-radius-sm)",
            background: badge.bg,
            color: badge.text,
            marginLeft: "auto",
          }}
        >
          {badge.label}
        </span>
      </div>

      {cotizacion.productos && cotizacion.productos.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 7, paddingLeft: 36 }}>
          {cotizacion.productos.length === 1
            ? cotizacion.productos[0].descripcion
            : `${cotizacion.productos[0].descripcion} +${cotizacion.productos.length - 1} más`}
        </div>
      )}

      {cotizacion.fechaSeguimiento &&
        (() => {
          const vencido = (cotizacion.estado || "pendiente") === "pendiente" && cotizacion.fechaSeguimiento < hoyIso;
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12.5,
                color: vencido ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                fontWeight: vencido ? 500 : 400,
                marginBottom: 7,
                paddingLeft: 36,
              }}
            >
              <i
                className={vencido ? "ti ti-alert-triangle" : "ti ti-bell"}
                style={{ fontSize: 13, color: vencido ? "var(--color-text-danger)" : MARCA.azulMedio }}
                aria-hidden="true"
              ></i>
              {vencido ? "Seguimiento vencido: " : "Seguimiento: "}
              {cotizacion.fechaSeguimiento}
            </div>
          );
        })()}

      {cotizacion.estado === "rechazada" && cotizacion.motivoRechazo && (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-danger)",
            marginBottom: 8,
            marginLeft: 36,
            padding: "6px 8px",
            background: "var(--color-background-danger)",
            borderRadius: "var(--border-radius-sm)",
          }}
        >
          <i className="ti ti-info-circle" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Motivo: {cotizacion.motivoRechazo}
        </div>
      )}

      {cotizacion.notas && cotizacion.notas.trim() && (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            marginBottom: 8,
            marginLeft: 36,
            padding: "6px 8px",
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-sm)",
          }}
        >
          <i className="ti ti-note" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          {cotizacion.notas}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 36, flexWrap: "wrap" }}>
        {(cotizacion.tienePdf || cotizacion.pdfDataUrl) && (
          <button onClick={onVerPdf} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
            <i className="ti ti-file-text" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Ver documento
          </button>
        )}
        <button
          onClick={onEdit}
          style={{
            fontSize: 12.5,
            padding: "9px 12px",
            minHeight: 40,
            background: MARCA.azulClaro,
            color: MARCA.azulOscuro,
            border: `0.5px solid ${MARCA.azulMedio}`,
          }}
        >
          <i className="ti ti-edit" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Editar
        </button>

        {cotizacion.estado === "pendiente" && (
          <>
            <button
              onClick={() => onCambiarEstado("aceptada")}
              style={{
                flex: 1,
                minWidth: 90,
                minHeight: 40,
                border: "none",
                background: "#639922",
                color: "white",
                fontWeight: 500,
                fontSize: 13,
                borderRadius: "var(--border-radius-md)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <i className="ti ti-check" style={{ fontSize: 14 }} aria-hidden="true"></i>
              Aceptar
            </button>
            <button
              onClick={() => onCambiarEstado("rechazada")}
              style={{
                flex: 1,
                minWidth: 90,
                minHeight: 40,
                border: "none",
                background: "#A32D2D",
                color: "white",
                fontWeight: 500,
                fontSize: 13,
                borderRadius: "var(--border-radius-md)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
              Rechazar
            </button>
          </>
        )}

        {cotizacion.estado !== "pendiente" && (
          <button onClick={() => onCambiarEstado("pendiente")} style={{ fontSize: 12.5, padding: "9px 12px", minHeight: 40 }}>
            <i className="ti ti-clock" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Volver a pendiente
          </button>
        )}

        {confirmDelete ? (
          <button
            onClick={onDelete}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              background: "var(--color-background-danger)",
              color: "var(--color-text-danger)",
              border: "0.5px solid var(--color-border-danger)",
              fontWeight: 500,
            }}
          >
            <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Toca otra vez para eliminar
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              fontSize: 12.5,
              padding: "9px 12px",
              minHeight: 40,
              background: "var(--color-background-danger)",
              color: "var(--color-text-danger)",
              border: "0.5px solid var(--color-border-danger)",
            }}
          >
            <i className="ti ti-trash" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
            Eliminar
          </button>
        )}
      </div>
    </div>
  );
}

function ExtractReviewCardCotizacion({ data, onChange, onConfirm, onCancel }) {
  const [aviso, setAviso] = useState("");
  const confirmadoRef = useRef(false);
  const missing = [];
  if (!data.cliente) missing.push("cliente");
  if (!data.numeroFactura) missing.push("número");
  if (!data.total) missing.push("total");

  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1rem 1.25rem",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <i className="ti ti-file-text" style={{ fontSize: 18 }} aria-hidden="true"></i>
        <span style={{ fontWeight: 500, fontSize: 15 }}>Revisa los datos de la cotización</span>
      </div>

      {missing.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--color-text-warning)", marginBottom: 10 }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          No se detectó: {missing.join(", ")}. Complétalo a mano.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Field label="N° cotización" inputMode="numeric" spellCheck={false} value={data.numeroFactura || ""} onChange={(v) => onChange({ ...data, numeroFactura: v })} />
        <Field label="Cliente" value={data.cliente || ""} onChange={(v) => onChange({ ...data, cliente: v })} />
        <Field
          label="Teléfono"
          type="tel"
          value={data.telefono || ""}
          onChange={(v) => onChange({ ...data, telefono: v })}
        />
        <Field label="Vendedor" value={data.vendedor || ""} onChange={(v) => onChange({ ...data, vendedor: v })} />
      </div>

      {data.productos && data.productos.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            Productos detectados ({data.productos.length}) — precio con IVA incluido
          </div>
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden", maxHeight: 220, overflowY: "auto" }}>
            {data.productos.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 13,
                  padding: "6px 10px",
                  borderTop: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none",
                }}
              >
                <span>{p.cantidad} {p.unidad} — {p.descripcion}</span>
                <span style={{ color: "var(--color-text-secondary)", flexShrink: 0 }}>${formatCOP(parseInt(p.total))}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--color-text-warning)", marginBottom: 12 }}>
          No se detectaron productos en la tabla. Puedes seguir igual; el PDF queda adjunto como respaldo.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Total (incluye IVA)</span>
        <span style={{ fontSize: 18, fontWeight: 500 }}>{data.total ? `$${formatCOP(data.total)}` : "No detectado"}</span>
      </div>

      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
        <i className="ti ti-clock" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
        Esta cotización empieza en estado <b>Pendiente</b>. Después podrás marcarla como Aceptada o Rechazada.
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 6 }}>
          Fecha de seguimiento (opcional)
        </span>
        <input
          type="date"
          value={data.fechaSeguimiento || ""}
          onChange={(e) => onChange({ ...data, fechaSeguimiento: e.target.value })}
          style={{ width: "100%" }}
        />
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "block", marginTop: 4 }}>
          Para recordarte cuándo llamar al cliente y dar seguimiento.
        </span>
      </label>

      {aviso && (
        <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 8, textAlign: "right" }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 13, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          {aviso}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          onClick={() => {
            // Evita la cotización duplicada por doble clic mientras la tarjeta se cierra.
            if (confirmadoRef.current) return;
            if (!data.cliente || !data.cliente.trim()) {
              setAviso("Escribe el nombre del cliente antes de guardar");
              return;
            }
            setAviso("");
            confirmadoRef.current = true;
            onConfirm();
          }}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: "var(--color-background-info)",
            color: "var(--color-text-info)",
            border: "0.5px solid var(--color-border-info)",
          }}
        >
          <i className="ti ti-check" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Agregar cotización
        </button>
      </div>
    </div>
  );
}

const MOTIVOS_RECHAZO = [
  "Precio muy alto",
  "Compró con la competencia",
  "No respondió / se enfrió",
  "Cambio de planes del cliente",
];

function MotivoRechazoModal({ cotizacion, onClose, onConfirm }) {
  const [seleccionado, setSeleccionado] = useState(null);
  const [otroTexto, setOtroTexto] = useState("");

  const puedeConfirmar = seleccionado && (seleccionado !== "Otro" || otroTexto.trim());

  return (
    <ModalOverlay onClose={onClose} maxWidth={400}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontWeight: 500, fontSize: 15 }}>¿Por qué se rechazó?</span>
        <button onClick={onClose} aria-label="Cerrar" style={{ padding: 8, minWidth: 40, minHeight: 40 }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true"></i>
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
        Cotización de {cotizacion.cliente}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {MOTIVOS_RECHAZO.map((m) => (
          <button
            key={m}
            onClick={() => setSeleccionado(m)}
            aria-pressed={seleccionado === m}
            style={{
              textAlign: "left",
              fontSize: 13,
              padding: "8px 10px",
              border: seleccionado === m ? "2px solid var(--color-border-danger)" : "0.5px solid var(--color-border-tertiary)",
              background: seleccionado === m ? "var(--color-background-danger)" : "var(--color-background-primary)",
              color: seleccionado === m ? "var(--color-text-danger)" : "var(--color-text-primary)",
              borderRadius: "var(--border-radius-md)",
            }}
          >
            {m}
          </button>
        ))}
        <button
          onClick={() => setSeleccionado("Otro")}
          aria-pressed={seleccionado === "Otro"}
          style={{
            textAlign: "left",
            fontSize: 13,
            padding: "8px 10px",
            border: seleccionado === "Otro" ? "2px solid var(--color-border-danger)" : "0.5px solid var(--color-border-tertiary)",
            background: seleccionado === "Otro" ? "var(--color-background-danger)" : "var(--color-background-primary)",
            color: seleccionado === "Otro" ? "var(--color-text-danger)" : "var(--color-text-primary)",
            borderRadius: "var(--border-radius-md)",
          }}
        >
          Otro
        </button>
        {seleccionado === "Otro" && (
          <input
            type="text"
            placeholder="Escribe el motivo..."
            value={otroTexto}
            onChange={(e) => setOtroTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && otroTexto.trim()) onConfirm(otroTexto.trim());
            }}
            style={{ width: "100%" }}
            autoFocus={window.matchMedia("(pointer: fine)").matches}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13 }}>Cancelar</button>
        <button
          disabled={!puedeConfirmar}
          onClick={() => onConfirm(seleccionado === "Otro" ? otroTexto.trim() : seleccionado)}
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: "var(--color-background-danger)",
            color: "var(--color-text-danger)",
            border: "0.5px solid var(--color-border-danger)",
            opacity: puedeConfirmar ? 1 : 0.5,
          }}
        >
          <i className="ti ti-x" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true"></i>
          Rechazar cotización
        </button>
      </div>
    </ModalOverlay>
  );
}

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
