-- ===========================================================================
-- MOVIMIENTOS DE CEMENTO  (saldo del día, módulo de Bodega)
-- ===========================================================================
-- Lo que se va sacando (o entrando) de cada tipo de cemento durante el día.
-- Con el conteo de la mañana da el saldo del momento:
--
--   saldo = conteo de hoy − salidas de hoy + entradas de hoy
--
-- y al día siguiente, el saldo esperado se compara con lo que se cuenta
-- ("Cuadra" / "Faltan N" / "Sobran N").
--
-- Regla: primero se cuenta y después se resta. Los movimientos de un día van
-- DESPUÉS del conteo de ese día.
--
-- Se aplica en Supabase: SQL Editor -> pegar -> Run. Es seguro correrlo varias
-- veces. RLS: acceso completo solo para usuarios autenticados.
-- ===========================================================================

create table if not exists public.movimientos_cemento (
  id          text primary key,
  fecha       date not null,
  tipo_id     text not null references public.tipos_cemento (id),
  -- "salida" resta del saldo; "entrada" suma (llegó cemento durante el día).
  clase       text not null default 'salida' check (clase in ('salida', 'entrada')),
  cantidad    integer not null check (cantidad > 0),
  creado_en   timestamptz not null default now()
);

create index if not exists movimientos_cemento_fecha_idx on public.movimientos_cemento (fecha desc);
create index if not exists movimientos_cemento_tipo_idx on public.movimientos_cemento (tipo_id);

alter table public.movimientos_cemento enable row level security;
alter table public.movimientos_cemento force row level security;

drop policy if exists "movimientos_cemento_authenticated_all" on public.movimientos_cemento;
create policy "movimientos_cemento_authenticated_all"
  on public.movimientos_cemento for all to authenticated using (true) with check (true);
