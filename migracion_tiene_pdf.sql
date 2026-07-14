-- ============================================================================
-- Migración: carga de PDF bajo demanda (tiene_pdf) + destino del pedido
-- ----------------------------------------------------------------------------
-- Ferromateriales San Blas — ERP de despacho
--
-- CONTEXTO
--   La app dejó de traer el PDF (base64, 1–3 MB por pedido) en cada carga.
--   Ahora las listas solo consultan la columna generada "tiene_pdf" (booleano)
--   para saber si mostrar el botón "Ver documento", y el PDF se descarga bajo
--   demanda al abrir el visor (cargarPdfPedido / cargarPdfCotizacion).
--
--   "tiene_pdf" es una columna GENERADA: la calcula la base de datos sola a
--   partir de pdf_data_url. La app NUNCA la escribe.
--
-- SEGURIDAD PARA CORRERLA
--   Todo este script es IDEMPOTENTE (usa IF NOT EXISTS). Correrlo sobre la base
--   que ya está en producción NO rompe ni borra nada: si el objeto ya existe,
--   simplemente lo salta. Sirve tanto para dejar la migración versionada como
--   para recrear la base en otro entorno.
--
-- CÓMO CORRERLA
--   Supabase → tu proyecto → SQL Editor → pega todo → Run.
-- ============================================================================


-- 1) Destino del pedido (zona: Corozal / Morroa / u otro escrito a mano) --------
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS destino text;


-- 2) tiene_pdf en PEDIDOS -----------------------------------------------------
--    true cuando el pedido tiene un PDF guardado. Se backfillea sola en las
--    filas que ya existen.
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS tiene_pdf boolean
  GENERATED ALWAYS AS (pdf_data_url IS NOT NULL) STORED;


-- 3) tiene_pdf en COTIZACIONES ------------------------------------------------
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS tiene_pdf boolean
  GENERATED ALWAYS AS (pdf_data_url IS NOT NULL) STORED;


-- 4) Índices (opcional, recomendado) ------------------------------------------
--    Aceleran las consultas reales de la app. Seguros de correr (IF NOT EXISTS).
--    Si ya creaste índices equivalentes con OTRO nombre, podés omitir esta
--    sección (crearlos duplicados no rompe, pero es innecesario).
--
--    - pedidos se consulta filtrando por estado ('activo' / 'entregado').
--    - cotizaciones se ordena por created_at descendente.
CREATE INDEX IF NOT EXISTS idx_pedidos_estado
  ON pedidos (estado);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_created_at
  ON cotizaciones (created_at DESC);


-- ============================================================================
-- Fin de la migración.
-- ============================================================================
