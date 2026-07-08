-- CORRER ESTO EN SUPABASE ANTES DE DESPLEGAR.
-- Si no, la app dara error 400 al guardar un pedido (columna inexistente).
--
-- Agrega a la tabla "pedidos":
--   entrega_pendiente   -> el pedido quedo debiendo material
--   nota_pendiente      -> que fue lo que quedo debiendo (texto libre)
--   vehiculo_secundario -> segundo vehiculo opcional donde tambien va el pedido

alter table pedidos
  add column if not exists entrega_pendiente boolean default false,
  add column if not exists nota_pendiente text,
  add column if not exists vehiculo_secundario text;
