-- ===========================================================================
-- CATÁLOGO DE PRODUCTOS (nombres de World Office)
-- ===========================================================================
-- El buscador de Agotados debe sugerir los MISMOS nombres de World Office, no
-- los que se escriben a mano en las remisiones manuales. Esta vista saca los
-- nombres de los productos que leyó el lector de PDF (facturas y cotizaciones)
-- y deja fuera tipo_documento = 'remision' (remisión manual, nombres a mano).
--
-- Un nombre por producto (sin importar mayúsculas ni espacios de más), con
-- cuántas veces se ha vendido, para poner primero lo que más se mueve.
--
-- security_invoker: la vista respeta el RLS de "pedidos" (solo autenticados).
-- Sin esto, una vista corre con los permisos de su dueño y se saltaría el RLS.
--
-- Se aplica en Supabase: SQL Editor -> pegar -> Run. Es seguro correrlo varias
-- veces.
-- ===========================================================================

create or replace view public.catalogo_productos
with (security_invoker = true) as
select
  mode() within group (order by trim(prod->>'descripcion')) as descripcion,
  count(*)::int                                            as veces
from public.pedidos p,
     jsonb_array_elements(coalesce(p.productos, '[]'::jsonb)) prod
where p.tipo_documento in ('factura', 'cotizacion')
  and length(trim(coalesce(prod->>'descripcion', ''))) >= 3
group by lower(regexp_replace(trim(prod->>'descripcion'), '\s+', ' ', 'g'));

grant select on public.catalogo_productos to authenticated;
revoke all on public.catalogo_productos from anon;
