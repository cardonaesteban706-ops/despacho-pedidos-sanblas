-- ===========================================================================
-- LLEGADA DE PROVEEDORES  (módulo de Bodega)
-- ===========================================================================
-- Reemplaza la planilla en papel donde se anotaba cuándo llegaba mercancía.
-- Cada fila es UNA llegada de UN proveedor: cuándo, si llegó todo bien o con
-- novedad (faltantes, averías…), y opcionalmente la foto de su remisión.
-- Quién la recibió es opcional: el nombre del trabajador, escrito una vez y
-- después elegido de los ya usados.
--
-- La foto va comprimida (JPEG ~150 KB) en su propia columna y la app NO la trae
-- en la lista, solo al tocar "Ver foto" (igual que los PDF de pedidos, ver la
-- columna tiene_pdf). Se queda en Postgres por la misma decisión medida de los
-- PDF: hay margen de sobra en el plan.
--
-- Se aplica en Supabase: SQL Editor -> pegar -> Run. Es seguro correrlo varias
-- veces. RLS: acceso completo solo para usuarios autenticados.
-- ===========================================================================

create table if not exists public.llegadas (
  id           text primary key,
  proveedor    text not null,
  llego_en     timestamptz not null default now(),
  estado       text not null default 'todo_bien'
               check (estado in ('todo_bien', 'con_novedad')),
  -- Fichas rápidas: Faltantes, Averías, Producto equivocado…
  novedades    text[] not null default '{}',
  observacion  text,
  -- Nombre del trabajador que recibió (opcional).
  recibio      text,
  -- data:image/jpeg;base64,… (comprimida en el celular antes de subir).
  foto         text,
  tiene_foto   boolean generated always as (foto is not null) stored,
  creado_en    timestamptz not null default now()
);

-- Para bases creadas antes de que existiera el campo.
alter table public.llegadas add column if not exists recibio text;

create index if not exists llegadas_llego_en_idx on public.llegadas (llego_en desc);

alter table public.llegadas enable row level security;
alter table public.llegadas force row level security;

drop policy if exists "llegadas_authenticated_all" on public.llegadas;
create policy "llegadas_authenticated_all"
  on public.llegadas
  for all
  to authenticated
  using (true)
  with check (true);
