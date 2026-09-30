-- El panel del dueño, segunda ronda: la salud de cada tienda, los avisos
-- de vencimiento, como se cobra y las capturas de pago que mandan las tiendas.

-- El ultimo parte que mando la tienda al preguntar por su plan (cabecera
-- x-gsgchat-estado): WhatsApp conectado o caido, mensajes de hoy, fallos de
-- IA, entregas de hoy, version. Ver src/plan/servicio.ts (EstadoInstancia).
alter table tiendas add column if not exists estado jsonb;
alter table tiendas add column if not exists estado_at timestamptz;

-- Para no avisar dos veces del mismo vencimiento: un aviso por tienda y tipo
-- (tipo lleva la fecha de vencimiento: al renovar se vuelve a avisar).
create table if not exists tiendas_avisos (
  id         serial primary key,
  tienda_id  uuid not null references tiendas(id) on delete cascade,
  tipo       text not null,
  at         timestamptz not null default now()
);
create index if not exists tiendas_avisos_tienda_idx on tiendas_avisos (tienda_id, tipo);

-- Lo que el dueño configura desde la pantalla Tiendas (como me pagan, los
-- textos de los avisos): una fila por clave, en JSON.
create table if not exists tiendas_config (
  clave      text primary key,
  valor      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Las capturas de pago que manda cada tienda desde su pantalla /pagar. El
-- dueño las revisa en Tiendas: un clic apunta el pago (corre el vencimiento)
-- o lo rechaza con un motivo que la tienda lee en /pagar.
create table if not exists tiendas_pagos (
  id           serial primary key,
  tienda_id    uuid not null references tiendas(id) on delete cascade,
  meses        integer not null default 1,
  monto        numeric(12,2),
  moneda       text,
  nota         text,
  -- La captura, como data URL (base64). Pocas al mes y pequeñas: no hace falta disco.
  imagen       text,
  -- pendiente | aceptado | rechazado
  estado       text not null default 'pendiente',
  motivo       text,
  at           timestamptz not null default now(),
  resuelto_at  timestamptz,
  resuelto_por text
);
create index if not exists tiendas_pagos_tienda_idx on tiendas_pagos (tienda_id, estado);
