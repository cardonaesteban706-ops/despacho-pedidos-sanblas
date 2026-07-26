-- ===========================================================================
-- PASO 1: VER cuál número de remisión está repetido (solo lectura)
-- ===========================================================================
-- ⚠️ OJO: el editor SQL de Supabase muestra el resultado de la ÚLTIMA consulta
-- que corras. NO pegues todo este archivo de una: SELECCIONA con el mouse solo
-- el bloque del paso que estés haciendo y dale Run (Supabase ejecuta lo
-- seleccionado). Si pegas todo, el conteo del paso 3 tapa esta tabla.
--
-- Corre SOLO la consulta de abajo y mírala. NO sigas hasta decidir cuál de las
-- dos filas se renumera: son tirillas que un cliente ya firmó en papel.
--
-- Hay que hacerlo ANTES de sql/tanda2-historial-remisiones.sql, porque el índice
-- único que crea ese archivo falla si ya existe un número duplicado.
-- ===========================================================================

select
  p.numero_factura,
  p.id,
  p.cliente,
  p.remision_de       as viene_de_factura,
  p.total,
  p.fecha_despacho,
  p.fecha_entrega,
  p.estado,
  p.entregado_en
from public.pedidos p
where p.numero_factura in (
  select numero_factura
    from public.pedidos
   where numero_factura like 'REM-%'
   group by numero_factura
  having count(*) > 1
)
order by p.numero_factura, p.entregado_en nulls last, p.id;


-- ===========================================================================
-- PASO 2: renumerar UNA de las dos (correr después de decidir)
-- ===========================================================================
-- Cómo decidir cuál renumerar:
--
--   * Si una de las dos NO se ha entregado todavía (estado = 'activo'), esa es
--     la que se renumera: su tirilla probablemente no ha salido, o se puede
--     reimprimir sin líos.
--   * Si las dos ya están entregadas, renumera la MÁS RECIENTE y anota a mano
--     en tu copia física el número nuevo. La vieja se queda como está para que
--     cuadre con el papel que el cliente tiene.
--
-- El número nuevo es el siguiente libre (máximo + 1), calculado numéricamente y
-- no por texto (por texto, "REM-9999" iría después de "REM-10000").
--
-- Reemplaza 'PEGA_AQUI_EL_ID' por el id de la fila que decidiste renumerar,
-- copiándolo del resultado del paso 1. Descomenta el bloque y córrelo.

-- update public.pedidos
--    set numero_factura = 'REM-' || lpad(((
--          select coalesce(max((regexp_replace(numero_factura, '^REM-', ''))::int), 0)
--            from public.pedidos
--           where numero_factura ~ '^REM-\d+$'
--        ) + 1)::text, 4, '0')
--  where id = 'PEGA_AQUI_EL_ID';


-- ===========================================================================
-- PASO 3: comprobar que ya no hay repetidos (debe dar 0)
-- ===========================================================================
-- Selecciona SOLO estas líneas y dale Run (si corres todo el archivo de una,
-- este conteo tapa la tabla del paso 1):
--
--   select count(*) as remisiones_con_numero_repetido
--     from (select numero_factura
--             from public.pedidos
--            where numero_factura like 'REM-%'
--            group by numero_factura
--           having count(*) > 1) d;
--
-- Cuando dé 0, ya puedes correr sql/tanda2-historial-remisiones.sql.
--
-- Se deja COMENTADO a propósito: así la consulta del paso 1 es la única que se
-- ejecuta si alguien pega el archivo completo, y se ve lo que hay que ver.
