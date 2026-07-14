-- Cambios de base de datos para despacho-pedidos-sanblas
-- ===========================================================================
-- Aplica TODO este archivo en Supabase: Dashboard -> SQL Editor -> New query,
-- pega el contenido y ejecuta (botón "Run"). Es seguro correrlo varias veces
-- (usa IF NOT EXISTS). Hazlo en este orden: primero las columnas, luego los
-- índices.
--
-- IMPORTANTE: la app ya quedó actualizada para NO cargar el PDF completo de
-- cada pedido al abrir (antes traía megas y megas en base64 en cada carga).
-- Para eso necesita la columna generada "tiene_pdf" de abajo. Mientras no
-- corras este SQL, el botón "Ver documento" no aparecerá.
-- ===========================================================================


-- 1) Columna generada "tiene_pdf"
-- ---------------------------------------------------------------------------
-- Es un booleano que Postgres calcula solo a partir de pdf_data_url. La app la
-- usa para saber si mostrar el botón "Ver documento" SIN tener que descargar
-- el PDF entero. No ocupa espacio de datos real y se mantiene sola.

alter table public.pedidos
  add column if not exists tiene_pdf boolean
  generated always as (pdf_data_url is not null and pdf_data_url <> '') stored;

alter table public.cotizaciones
  add column if not exists tiene_pdf boolean
  generated always as (pdf_data_url is not null and pdf_data_url <> '') stored;


-- 2) Índices en las columnas por las que se filtra/ordena
-- ---------------------------------------------------------------------------
-- La app filtra pedidos por "estado" ('activo' | 'entregado') en cada carga y
-- ordena cotizaciones por "created_at". Sin índice, Postgres recorre toda la
-- tabla (sequential scan). Con índice va directo a las filas.
-- Ref: skill supabase-postgres-best-practices / query-missing-indexes
--      (impacto CRITICAL: 100-1000x más rápido en tablas grandes).
--
-- Nota: el editor SQL de Supabase corre todo dentro de una transacción, y ahí
-- NO se permite CREATE INDEX CONCURRENTLY (da "cannot run inside a transaction
-- block"). Por eso van sin CONCURRENTLY: con pocos datos el bloqueo es de
-- milisegundos. Si algún día la tabla es enorme y no quieres ningún bloqueo,
-- corre los índices con CONCURRENTLY desde psql (fuera de transacción).

create index if not exists pedidos_estado_idx
  on public.pedidos (estado);

create index if not exists cotizaciones_created_at_idx
  on public.cotizaciones (created_at desc);


-- Nota sobre volumen: con pocas filas (decenas), Postgres puede ignorar el
-- índice porque el scan completo es igual de rápido — es normal y correcto.
-- El beneficio crece a medida que el historial se acumula (cientos/miles).
