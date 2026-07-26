-- ===========================================================================
-- CERRAR LA BASE DE DATOS  (despacho-pedidos-sanblas)
-- ===========================================================================
-- Aplica TODO este archivo en Supabase: Dashboard -> SQL Editor -> New query,
-- pega el contenido y ejecuta ("Run"). Es seguro correrlo varias veces.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTO ES URGENTE
-- ---------------------------------------------------------------------------
-- Hoy la tabla "pedidos" no tiene Row Level Security. Comprobado con la misma
-- llave pública que va en el bundle desplegado:
--
--   GET    /rest/v1/pedidos?select=id   -> 200, Content-Range: 0-0/175
--   PATCH  /rest/v1/pedidos?id=eq.(..)  -> 204   (escritura permitida)
--   DELETE /rest/v1/pedidos?id=eq.(..)  -> 204   (borrado permitido)
--
-- Es decir: cualquiera en internet puede leer los 175 pedidos —nombre,
-- teléfono, dirección, total facturado, quién quedó debiendo, y el PDF completo
-- de cada factura electrónica con NIT y CUFE— y borrarlos todos.
--
-- La llave pública NO es el problema (está diseñada para ser pública). El
-- problema es que sin RLS esa llave abre la puerta entera. RLS es la puerta.
--
-- Ojo: son datos personales de clientes -> Ley 1581 de 2012. La exposición no
-- es solo técnica.
--
-- ---------------------------------------------------------------------------
-- IMPORTANTE — ORDEN DE DESPLIEGUE
-- ---------------------------------------------------------------------------
-- Al correr esto, la app DEJA DE FUNCIONAR hasta que se despliegue la versión
-- con login (la de este mismo paquete), porque el visitante anónimo ya no podrá
-- leer nada. Los dos pasos van juntos:
--
--   1) Crear el usuario compartido en Supabase (Authentication -> Users ->
--      Add user -> Create new user; marca "Auto Confirm User").
--   2) Correr ESTE archivo.
--   3) Desplegar la app nueva.
--
-- Si te quedas a mitad de camino, para volver atrás temporalmente:
--   alter table public.pedidos      disable row level security;
--   alter table public.cotizaciones disable row level security;
-- ===========================================================================


-- 1) Columna para enlazar una cotización con el pedido que generó
-- ---------------------------------------------------------------------------
-- La usa el botón nuevo "Aceptar y despachar": deja constancia de que esa
-- cotización ya pasó a despacho, para no despacharla dos veces ni perderle el
-- rastro. Va primero porque la app nueva la necesita.

alter table public.cotizaciones
  add column if not exists pedido_id text;


-- 2) Borrar CUALQUIER política que ya exista en estas dos tablas
-- ---------------------------------------------------------------------------
-- Esto es lo que faltaba en la primera versión de este archivo, y por eso la
-- base seguía abierta después de correrlo.
--
-- Prender RLS no desactiva las políticas que ya estén creadas. Si en algún
-- momento se creó desde el panel de Supabase una política permisiva —las
-- plantillas de "Enable read access for all users" / "Enable all access" van al
-- rol "public", que INCLUYE al anónimo—, esa política sigue abriendo la puerta
-- aunque RLS esté prendido y aunque exista otra política más estricta al lado.
-- Con RLS, las políticas se SUMAN: basta con que una permita, para que pase.
--
-- Como en esta app el único acceso que debe existir es "autenticado = todo",
-- barremos con todas y volvemos a poner solo las dos que queremos. El bucle
-- recorre pg_policies, así que no hay que saberse los nombres de antemano.

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename in ('pedidos', 'cotizaciones')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
    raise notice 'Política borrada: % en %', pol.policyname, pol.tablename;
  end loop;
end $$;


-- 3) Prender Row Level Security
-- ---------------------------------------------------------------------------
-- Ya sin políticas viejas, RLS niega por defecto todo lo que ninguna política
-- permita explícitamente. El rol "anon" (el visitante sin login) queda fuera.

alter table public.pedidos      enable row level security;
alter table public.cotizaciones enable row level security;

-- Y por si acaso: "force" hace que RLS aplique incluso al dueño de la tabla.
-- No cambia nada para la app (usa el rol authenticated), pero cierra el caso de
-- que la tabla pertenezca a un rol que se saltaría las políticas.
alter table public.pedidos      force row level security;
alter table public.cotizaciones force row level security;


-- 4) Políticas: solo usuarios autenticados, y con acceso completo
-- ---------------------------------------------------------------------------
-- La operación es un mostrador de ferretería: quien entró con la credencial de
-- la casa necesita ver y mover todo. No hay datos por usuario que separar, así
-- que la política es "autenticado = acceso total" y punto. La frontera que
-- importa es autenticado vs. internet abierto.
--
-- "to authenticated" es la parte que hace el trabajo: excluye a "anon".
-- El "drop if exists" antes de cada "create" es lo que hace este archivo
-- re-ejecutable (Postgres no tiene "create or replace policy").

drop policy if exists "pedidos_authenticated_all" on public.pedidos;
create policy "pedidos_authenticated_all"
  on public.pedidos
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "cotizaciones_authenticated_all" on public.cotizaciones;
create policy "cotizaciones_authenticated_all"
  on public.cotizaciones
  for all
  to authenticated
  using (true)
  with check (true);


-- 5) Comprobación
-- ---------------------------------------------------------------------------
-- El editor SQL de Supabase muestra el resultado de la ÚLTIMA consulta, así que
-- va todo junto en una sola tabla. Debe salir exactamente esto:
--
--   tabla         | rls_prendido | politica                       | roles
--   --------------+--------------+--------------------------------+----------------
--   cotizaciones  | true         | cotizaciones_authenticated_all | {authenticated}
--   pedidos       | true         | pedidos_authenticated_all      | {authenticated}
--
-- DOS filas, ni una más. Si aparece una política de más, o alguna con roles
-- {public} o {anon}, la puerta sigue abierta.

select
  t.tablename                        as tabla,
  t.rowsecurity                      as rls_prendido,
  coalesce(p.policyname, '(ninguna)') as politica,
  p.roles::text                      as roles,
  p.cmd                              as operacion
from pg_tables t
left join pg_policies p
       on p.schemaname = t.schemaname
      and p.tablename  = t.tablename
where t.schemaname = 'public'
  and t.tablename in ('pedidos', 'cotizaciones')
order by t.tablename, p.policyname;

-- Y desde tu terminal, con la llave pública (debe pasar de 200 a 401):
--
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "https://TU-PROYECTO.supabase.co/rest/v1/pedidos?select=id&limit=1" \
--     -H "apikey: TU_LLAVE_PUBLICA"
--
-- 401 = cerrado. 200 = algo quedó mal, avísame.
