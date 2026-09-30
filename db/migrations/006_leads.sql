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

-- Las opciones que se le ofrecieron al cliente en el ultimo mensaje.
--
-- Sin botones nativos -no se pintan con una cuenta personal, ver
-- WHATSAPP_NATIVE_BUTTONS- las opciones van como lista numerada y el cliente
-- responde "2". Para saber que es "2" hay que recordar que se ofrecio; si no,
-- habria que adivinarlo por el estado de la conversacion, que es justo como se
-- rompen estas cosas.
alter table leads add column if not exists ultimas_opciones jsonb;

-- Que pregunta esta esperando respuesta.
--
-- Sin esto, el flujo trata CUALQUIER mensaje como la respuesta a la siguiente
-- pregunta pendiente, aunque nunca la haya hecho: el cliente escribe "1" para
-- elegir del menu y ese "1" acaba guardado como su distrito de recojo. Hay que
-- distinguir "estoy esperando el distrito" de "todavia no lo he preguntado".
alter table leads add column if not exists pregunta_pendiente text;

-- Que servicio o courier eligio el cliente.
--
-- La lista de opciones la pone cada tienda desde /panel: aqui solo se guarda
-- lo que eligio. Texto libre y no una referencia a otra tabla porque la lista
-- cambia (se anaden couriers, se retiran) y una ficha vieja tiene que seguir
-- diciendo lo que se acordo entonces.
alter table leads add column if not exists servicio text;

-- Cuantas veces seguidas no se entendio la respuesta a la pregunta en curso.
--
-- Repetir la misma pregunta indefinidamente es lo que hace que la gente cierre
-- el chat. A la tercera se deja de insistir y se pasa a una persona.
alter table leads add column if not exists intentos_fallidos integer not null default 0;
