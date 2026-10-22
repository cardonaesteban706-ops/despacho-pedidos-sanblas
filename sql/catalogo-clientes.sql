-- ===========================================================================
-- CATÁLOGO DE CLIENTES (nombres de las facturas y cotizaciones)
-- ===========================================================================
-- Para el autocompletado del nombre del cliente (a quién se le entregó el
-- cemento, remisión manual). Sale de las facturas y cotizaciones leídas del
-- PDF, escritos como en World Office. No entran las remisiones manuales
-- (nombres escritos a mano).
--
-- Un nombre por cliente (sin importar mayúsculas ni espacios de más), con
-- cuántas veces ha comprado, para poner primero los de siempre.
--
-- security_invoker: la vista respeta el RLS de "pedidos" y "cotizaciones".
--
-- Se aplica en Supabase: SQL Editor -> pegar -> Run. Es seguro correrlo varias
-- veces.
-- ===========================================================================

create or replace view public.catalogo_clientes
with (security_invoker = true) as
select
  mode() within group (order by trim(cliente)) as nombre,
  count(*)::int                                as veces
from (
  select cliente from public.pedidos where tipo_documento in ('factura', 'cotizacion')
  union all
  select cliente from public.cotizaciones
) c
where length(trim(coalesce(cliente, ''))) >= 3
group by lower(regexp_replace(trim(cliente), '\s+', ' ', 'g'));

grant select on public.catalogo_clientes to authenticated;
revoke all on public.catalogo_clientes from anon;
