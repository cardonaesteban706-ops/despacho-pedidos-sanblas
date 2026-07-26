-- ===========================================================================
-- DIAGNÓSTICO (solo lectura, no cambia nada)
-- ===========================================================================
-- Supabase -> SQL Editor -> New query -> pegar TODO -> Run, y me pasas el
-- resultado. Devuelve UNA fila con todo (el editor solo muestra la última
-- consulta, por eso va junto).
--
-- No trae ni un nombre, ni un teléfono, ni una dirección: solo conteos. Sirve
-- para validar contra datos REALES las decisiones de las tandas 2 y 3 sin que
-- yo tenga que entrar a la base.
-- ===========================================================================

select
  -- ---------------- Tamaño y ventana del historial (tanda 2 / E1) ----------
  -- Cuánto historial hay y cuánto queda fuera de la precarga de 90 días. Si
  -- "entregados_mas_viejos_90d" es alto, la ventana está haciendo su trabajo.
  (select count(*) from public.pedidos where estado = 'entregado')
    as entregados_total,
  (select count(*) from public.pedidos where estado = 'entregado'
     and entregado_en >= now() - interval '90 days')
    as entregados_ultimos_90d,
  (select count(*) from public.pedidos where estado = 'entregado'
     and entregado_en < now() - interval '90 days')
    as entregados_mas_viejos_90d,
  -- Filas viejas sin entregado_en: las incluyo SIEMPRE en la carga porque su
  -- fecha es texto y no se puede comparar en SQL. Necesito saber cuántas son
  -- para confirmar que ese conjunto es chico y cerrado.
  (select count(*) from public.pedidos where estado = 'entregado'
     and entregado_en is null)
    as entregados_sin_fecha_iso,
  (select count(*) from public.pedidos where estado = 'activo')
    as activos_total,

  -- ---------------- Remisiones (tanda 2 / B5 y B4) -------------------------
  (select count(*) from public.pedidos where numero_factura like 'REM-%')
    as remisiones_total,
  -- Si esto da > 0, YA hay números de remisión repetidos y el índice único del
  -- SQL de la tanda 2 va a fallar al crearse. Avísame antes de correrlo.
  (select count(*) from (
      select numero_factura from public.pedidos
       where numero_factura like 'REM-%'
       group by numero_factura having count(*) > 1) d)
    as remisiones_con_numero_repetido,
  -- Remisiones cuya factura madre ya no existe o tiene número repetido: esas
  -- quedan con el enlace viejo por número (es lo que pasa hoy, no empeora).
  (select count(*) from public.pedidos h
     where h.remision_de is not null and h.remision_de <> 's/n'
       and not exists (select 1 from public.pedidos m
                        where m.numero_factura = h.remision_de and m.id <> h.id))
    as remisiones_huerfanas,
  (select count(*) from public.pedidos where remision_de = 's/n')
    as remisiones_con_s_n,

  -- ---------------- Números de factura repetidos (B2) ---------------------
  -- Cuántas facturas comparten número. Es lo que dispara el aviso de
  -- "documento ya cargado": si es alto, el aviso va a salir seguido y hay que
  -- afinarlo.
  (select count(*) from (
      select numero_factura from public.pedidos
       where numero_factura is not null and numero_factura <> ''
         and numero_factura not like 'REM-%'
       group by numero_factura having count(*) > 1) d)
    as facturas_con_numero_repetido,

  -- ---------------- Formas del saldo por producto (tanda 1 / B1) ----------
  -- Esto es lo que más me sirve: valida saldo.js contra los datos de verdad.
  -- Cuenta LÍNEAS de producto según qué campos traen.
  (select count(*) from public.pedidos p, jsonb_array_elements(p.productos) it
     where p.productos is not null and jsonb_typeof(p.productos) = 'array')
    as lineas_producto_total,
  (select count(*) from public.pedidos p, jsonb_array_elements(p.productos) it
     where jsonb_typeof(p.productos) = 'array'
       and it ? 'cantidadRestante' and it ? 'cantidadEntregada')
    as lineas_con_AMBOS_campos,
  (select count(*) from public.pedidos p, jsonb_array_elements(p.productos) it
     where jsonb_typeof(p.productos) = 'array'
       and it ? 'cantidadRestante' and not (it ? 'cantidadEntregada'))
    as lineas_solo_cantidadRestante,
  (select count(*) from public.pedidos p, jsonb_array_elements(p.productos) it
     where jsonb_typeof(p.productos) = 'array'
       and it ? 'cantidadEntregada' and not (it ? 'cantidadRestante'))
    as lineas_solo_cantidadEntregada,
  (select count(*) from public.pedidos p, jsonb_array_elements(p.productos) it
     where jsonb_typeof(p.productos) = 'array'
       and not (it ? 'cantidadEntregada') and not (it ? 'cantidadRestante'))
    as lineas_sin_marcas,
  -- El estado incoherente que arreglé en la tanda 1: líneas donde el saldo y lo
  -- marcado a mano suman MÁS de lo facturado. Si sale > 0, hay filas que
  -- quedaron torcidas antes del arreglo y toca decidir qué hacer con ellas.
  (select count(*) from public.pedidos p, jsonb_array_elements(p.productos) it
     where jsonb_typeof(p.productos) = 'array'
       and it ? 'cantidadRestante' and it ? 'cantidadEntregada'
       and (
         coalesce((it->>'cantidadRestante')::numeric, 0)
         + coalesce((it->>'cantidadEntregada')::numeric, 0)
       ) > coalesce(nullif(replace(replace(it->>'cantidad', '.', ''), ',', '.'), '')::numeric, 0) + 0.01)
    as lineas_INCOHERENTES,

  -- ---------------- Peso de los PDF (tanda 3 / E2) ------------------------
  -- Para planear la migración a Storage: cuántos PDF hay y cuánto pesan de
  -- verdad en base64. Es el número que me falta para dimensionar las tandas.
  (select count(*) from public.pedidos where pdf_data_url is not null)
    as pedidos_con_pdf,
  (select pg_size_pretty(coalesce(sum(length(pdf_data_url)), 0)::bigint)
     from public.pedidos)
    as peso_total_pdf_pedidos,
  (select pg_size_pretty(coalesce(max(length(pdf_data_url)), 0)::bigint)
     from public.pedidos)
    as pdf_mas_grande,
  (select pg_size_pretty(coalesce(avg(length(pdf_data_url)), 0)::bigint)
     from public.pedidos where pdf_data_url is not null)
    as pdf_promedio,
  (select pg_size_pretty(pg_total_relation_size('public.pedidos')))
    as tamano_tabla_pedidos,
  (select count(*) from public.cotizaciones where pdf_data_url is not null)
    as cotizaciones_con_pdf,
  (select pg_size_pretty(coalesce(sum(length(pdf_data_url)), 0)::bigint)
     from public.cotizaciones)
    as peso_total_pdf_cotizaciones;
