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


-- 2) Prender Row Level Security
-- ---------------------------------------------------------------------------
-- Con RLS prendido y sin política que aplique, el rol "anon" (el visitante sin
-- login) no ve ni escribe NADA. No hace falta revocar nada a mano: RLS niega
-- por defecto todo lo que ninguna política permita explícitamente.

alter table public.pedidos      enable row level security;
alter table public.cotizaciones enable row level security;


-- 3) Políticas: solo usuarios autenticados, y con acceso completo
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


-- 4) Comprobación
-- ---------------------------------------------------------------------------
-- Debe devolver rowsecurity = true en las dos filas, y una política por tabla
-- con roles = {authenticated}.

select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in ('pedidos', 'cotizaciones');

select tablename, policyname, roles, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('pedidos', 'cotizaciones');

-- Y desde tu terminal, con la llave pública (debe pasar de 200 a 401):
--
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "https://TU-PROYECTO.supabase.co/rest/v1/pedidos?select=id&limit=1" \
--     -H "apikey: TU_LLAVE_PUBLICA"
--
-- 401 = cerrado. 200 = algo quedó mal, avísame.
