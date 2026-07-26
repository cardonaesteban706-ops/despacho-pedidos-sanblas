-- ===========================================================================
-- TANDA 2: historial acotado, numeración de remisiones y enlace madre-remisión
-- ===========================================================================
-- Aplica TODO este archivo en Supabase: Dashboard -> SQL Editor -> New query,
-- pega el contenido y ejecuta ("Run"). Es seguro correrlo varias veces.
--
-- CORRE ESTE SQL **ANTES** DE DESPLEGAR EL CÓDIGO DE ESTA TANDA. Si desplegás
-- primero, la app muestra un aviso amarillo diciendo justo esto y sigue
-- funcionando, pero crear remisiones va a fallar hasta que lo corras.
-- ===========================================================================


-- 1) remision_de_id: el enlace REAL entre una remisión y su factura madre
-- ---------------------------------------------------------------------------
-- Hoy la remisión se enlaza a la factura por el NÚMERO (remision_de). Eso tiene
-- dos fallas:
--
--   a) Si alguien corrige el número de la factura madre en "Editar", todas sus
--      remisiones quedan huérfanas: el contador vuelve a "Sin remisiones" y la
--      factura se marca "Estancada" aunque se haya movido ayer.
--   b) Toda factura sin número guarda el texto "s/n", así que TODAS las
--      facturas sin número comparten sus remisiones — cruzando material entre
--      clientes distintos.
--
-- El id no cambia nunca y es único. remision_de se conserva porque es lo que se
-- imprime en la tirilla que firma el cliente.

alter table public.pedidos
  add column if not exists remision_de_id text;


-- 2) Rellenar remision_de_id en las remisiones que ya existen
-- ---------------------------------------------------------------------------
-- Solo se rellena cuando hay UNA sola factura madre con ese número. Si hubiera
-- dos facturas con el mismo número, no hay forma de saber cuál es la madre, y
-- adivinar sería peor que dejarlo nulo: la app cae al enlace viejo por número
-- para esas filas, que es exactamente como se comporta hoy.

update public.pedidos hija
   set remision_de_id = (
        select madre.id
          from public.pedidos madre
         where madre.numero_factura = hija.remision_de
           and madre.id <> hija.id
        limit 1
      )
 where hija.remision_de is not null
   and hija.remision_de <> 's/n'
   and hija.remision_de_id is null
   and (
        select count(*)
          from public.pedidos madre
         where madre.numero_factura = hija.remision_de
           and madre.id <> hija.id
       ) = 1;


-- 3) Unicidad del número de remisión
-- ---------------------------------------------------------------------------
-- El correlativo REM-0001, REM-0002... se calculaba con el máximo de lo que
-- hubiera CARGADO en la pantalla. Con dos dispositivos creando remisiones a la
-- vez salía el mismo número, y cuando el historial dejara de cargarse completo
-- (techo de 1.000 filas de PostgREST) los números se habrían reciclado: dos
-- tirillas firmadas por clientes distintos con el mismo REM.
--
-- La app ahora consulta el máximo real contra la base, pero eso no elimina la
-- carrera entre dos dispositivos en el mismo segundo. Este índice sí: la base
-- rechaza el duplicado y la app reintenta con el siguiente número.
--
-- Es un índice PARCIAL (solo sobre las filas REM-%): las facturas normales
-- pueden repetir número si hace falta, y de hecho hay casos legítimos.

create unique index if not exists pedidos_numero_remision_unico
  on public.pedidos (numero_factura)
  where numero_factura like 'REM-%';


-- 4) Índices para las consultas nuevas
-- ---------------------------------------------------------------------------
-- La app ya no trae el historial completo: lo pide por ventana de fecha
-- (entregado_en), busca contra el servidor por cliente/número, y cruza las
-- remisiones de una factura por remision_de_id. Sin índices, cada una de esas
-- consultas recorre la tabla entera.

create index if not exists pedidos_estado_entregado_en_idx
  on public.pedidos (estado, entregado_en desc);

create index if not exists pedidos_remision_de_id_idx
  on public.pedidos (remision_de_id)
  where remision_de_id is not null;


-- 5) Comprobación
-- ---------------------------------------------------------------------------
-- Debe salir una fila con las dos columnas nuevas en true y, en "remisiones
-- enlazadas", cuántas remisiones viejas quedaron conectadas a su factura.

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='pedidos' and column_name='remision_de_id') = 1
    as columna_remision_de_id_ok,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='cotizaciones' and column_name='pedido_id') = 1
    as columna_pedido_id_ok,
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='pedidos_numero_remision_unico') = 1
    as indice_remision_unico_ok,
  (select count(*) from public.pedidos where remision_de_id is not null)
    as remisiones_enlazadas,
  (select count(*) from public.pedidos where remision_de is not null and remision_de_id is null)
    as remisiones_sin_enlazar;

-- "remisiones_sin_enlazar" > 0 no es un problema: son remisiones cuya factura
-- madre ya no existe (se borró) o cuyo número está repetido. Esas siguen
-- funcionando con el enlace viejo por número, igual que hasta hoy.
