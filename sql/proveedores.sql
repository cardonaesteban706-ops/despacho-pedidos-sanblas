-- ===========================================================================
-- CATÁLOGO DE PROVEEDORES  (sugerencias de Bodega)
-- ===========================================================================
-- Los nombres de los proveedores para el autocompletado de Llegadas y de
-- Agotados (asignar proveedor / "¿A quién se le pidió?"). Salen del estado de
-- cuentas por pagar (análisis por edades, cierre 24/08/2026), escritos igual
-- que en la contabilidad. Solo el nombre: ni NIT, ni saldos, ni correos.
--
-- Se dejó fuera una persona natural que aparece en ese informe por una deuda
-- (no es proveedor de mercancía).
--
-- Se aplica en Supabase: SQL Editor -> pegar -> Run. Es seguro correrlo varias
-- veces (no duplica). RLS: acceso completo solo para usuarios autenticados.
-- ===========================================================================

create table if not exists public.proveedores (
  id         text primary key,
  nombre     text not null,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

alter table public.proveedores enable row level security;
alter table public.proveedores force row level security;

drop policy if exists "proveedores_authenticated_all" on public.proveedores;
create policy "proveedores_authenticated_all"
  on public.proveedores for all to authenticated using (true) with check (true);

insert into public.proveedores (id, nombre) values
  ('cacharreria-mundial',       'CACHARRERIA MUNDIAL S.A.S'),
  ('ceramicas-castellon',       'CERAMICAS Y MATERIALES CASTELLON S.A.S'),
  ('agrohierros',               'COMERCIALIZADORA AGROHIERROS S.A'),
  ('copin',                     'COMPAÑÍA PRODUCTORA DE PINTURAS DEL CARIBE SAS COPIN'),
  ('copaques',                  'COPAQUES COMERCIAL DE EMPAQUES Y PAPELES S.A.S'),
  ('corbeta-alkosto',           'CORBETA COLOMBIANA DE COMERCIO S.A. Y/O ALKOSTO S.A'),
  ('coverfil',                  'COVERFIL S.A.S.'),
  ('fermetal',                  'DISTRIBUIDORA FERMETAL DE COLOMBIA S.A.S'),
  ('gyj-ferreterias',           'G Y J FERRETERIAS S A'),
  ('industria-de-ruedas',       'INDUSTRIA DE RUEDAS S.A.S.'),
  ('meico',                     'MEICO S.A.'),
  ('miguel-gomez',              'MIGUEL GOMEZ & CIA S.A.S.'),
  ('proveedores-de-pvc',        'PROVEEDORES DE PVC S.A.S'),
  ('repares',                   'REPARES SOCIEDAD ANONIMA'),
  ('rodillos-mastder',          'RODILLOS MASTDER S.A.S.'),
  ('sonepar-melexa',            'SONEPAR COLOMBIA S.A.S. / MELEXA'),
  ('tecnidecor',                'TECNIDECOR S.A.S'),
  ('texco',                     'TEXCOMERCIAL TEXCO S.A.S.'),
  ('unifel',                    'UNIFEL S.A')
on conflict (id) do nothing;
