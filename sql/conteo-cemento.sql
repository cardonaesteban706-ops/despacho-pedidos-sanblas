-- ===========================================================================
-- CONTEO DE CEMENTO  (módulo de Bodega)
-- ===========================================================================
-- Reemplaza el papel donde se anotaba a diario cuántos bultos de cemento hay en
-- bodega. Dos tablas:
--
--   tipos_cemento    los tipos que se cuentan (editable desde la app). Se
--                    "quitan" con activo = false para no perder su historial.
--   conteos_cemento  un registro por tipo y por día (único por fecha + tipo):
--                    corregir el conteo de hoy reescribe el mismo registro.
--
-- No se guarda quién contó: basta con la hora.
--
-- Se aplica en Supabase: SQL Editor -> pegar -> Run. Es seguro correrlo varias
-- veces. RLS: acceso completo solo para usuarios autenticados.
-- ===========================================================================

create table if not exists public.tipos_cemento (
  id         text primary key,
  nombre     text not null,
  orden      integer not null default 0,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create table if not exists public.conteos_cemento (
  -- id = "<fecha>_<tipo_id>": así el upsert de un mismo día reescribe el registro.
  id          text primary key,
  fecha       date not null,
  tipo_id     text not null references public.tipos_cemento (id),
  bultos      integer not null check (bultos >= 0),
  contado_en  timestamptz not null default now(),
  unique (fecha, tipo_id)
);

create index if not exists conteos_cemento_fecha_idx on public.conteos_cemento (fecha desc);
create index if not exists conteos_cemento_tipo_idx on public.conteos_cemento (tipo_id);

alter table public.tipos_cemento   enable row level security;
alter table public.tipos_cemento   force row level security;
alter table public.conteos_cemento enable row level security;
alter table public.conteos_cemento force row level security;

drop policy if exists "tipos_cemento_authenticated_all" on public.tipos_cemento;
create policy "tipos_cemento_authenticated_all"
  on public.tipos_cemento for all to authenticated using (true) with check (true);

drop policy if exists "conteos_cemento_authenticated_all" on public.conteos_cemento;
create policy "conteos_cemento_authenticated_all"
  on public.conteos_cemento for all to authenticated using (true) with check (true);
