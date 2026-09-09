-- La ficha de preventa: lo que se averigua del cliente ANTES de la venta.
--
-- El sistema ya guardaba contactos (quien es), mensajes (que se dijo) y
-- ubicaciones (donde). Lo que no guardaba en ninguna parte es el resultado de
-- la conversacion de preventa: que quiere enviar, de donde a donde, cuando y
-- con que datos de facturacion. Eso vivia en la cabeza del operador y se
-- volvia a preguntar en cada turno.
--
-- Una fila por contacto: la preventa es un estado del cliente, no un historico.
-- Cuando se cierre y pase a Stoky, la venta vive alli; aqui queda la ficha con
-- su marca de enviada.

create table if not exists leads (
  id           bigserial primary key,
  contact_id   uuid not null unique references contacts(id) on delete cascade,

  -- Contacto
  nombre       text,
  origen       text,

  -- Recojo
  recojo_direccion   text,
  recojo_distrito    text,
  recojo_referencia  text,
  recojo_lat         double precision,
  recojo_lng         double precision,

  -- Entrega
  entrega_direccion  text,
  entrega_distrito   text,
  entrega_referencia text,
  entrega_lat        double precision,
  entrega_lng        double precision,

  -- Que se envia
  contenido    text,
  peso_kg      numeric(10,2),
  fragil       boolean not null default false,
  cuando       text,

  -- Facturacion
  documento_tipo   text,
  documento_numero text,
  razon_social     text,

  -- Estado de la preventa.
  -- nuevo | en_conversacion | calificado | enviado | descartado
  estado       text not null default 'nuevo',
  notas        text,

  -- Traspaso al sistema de ventas.
  crm_id       text,
  enviado_at   timestamptz,
  ultimo_error text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- La bandeja de preventa se ordena por estado y por lo ultimo tocado.
create index if not exists leads_estado_idx on leads (estado, updated_at desc);
