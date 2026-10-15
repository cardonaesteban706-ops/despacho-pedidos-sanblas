-- ===========================================================================
-- AGOTADOS Y SUGERENCIA DE PEDIDO  (módulo de Bodega)
-- ===========================================================================
-- Reemplaza el Excel donde se anotaban a diario los productos agotados o que se
-- están acabando. Cada fila es UN reporte de UN producto, con cuándo se
-- reportó y su recorrido Reportado -> Pedido -> Llegó.
--
-- Se aplica en Supabase: SQL Editor -> pegar -> Run. Es seguro correrlo varias
-- veces. Igual que pedidos y cotizaciones: RLS prendido y acceso completo solo
-- para usuarios autenticados (ver sql/rls-politicas.sql).
-- ===========================================================================

create table if not exists public.agotados (
  -- Mismo formato de id que el resto de la app (uid() de constants.js).
  id               text primary key,
  producto         text not null,
  -- Unidades que quedan en bodega. 0 = Agotado; > 0 = Pocas unidades.
  quedan           integer not null default 0 check (quedan >= 0),
  -- Cantidad sugerida a pedir (puede faltar si quien reporta no la sabe).
  pedir            numeric check (pedir is null or pedir >= 0),
  nota             text,
  -- No se guarda quién reporta: basta con cuándo.
  reportado_en     timestamptz not null default now(),
  -- Proveedores a los que se le puede pedir (uno o varios).
  proveedores      text[] not null default '{}',
  estado           text not null default 'reportado'
                   check (estado in ('reportado', 'pedido', 'llego')),
  -- A cuál de los proveedores se le pidió y cuándo.
  proveedor_pedido text,
  pedido_en        timestamptz,
  llego_en         timestamptz,
  actualizado_en   timestamptz not null default now()
);

-- La vista de Compras siempre filtra por estado; Reportar, por fecha de reporte.
create index if not exists agotados_estado_idx       on public.agotados (estado);
create index if not exists agotados_reportado_en_idx on public.agotados (reportado_en desc);

-- La primera versión guardaba el nombre de quien reportaba y de quien pedía.
-- Se quitó: no hace falta saber quién lo hizo.
alter table public.agotados drop column if exists reportado_por;
alter table public.agotados drop column if exists pedido_por;

alter table public.agotados enable row level security;
alter table public.agotados force row level security;

drop policy if exists "agotados_authenticated_all" on public.agotados;
create policy "agotados_authenticated_all"
  on public.agotados
  for all
  to authenticated
  using (true)
  with check (true);
