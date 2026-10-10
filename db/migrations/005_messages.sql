-- Conversaciones: lo que se lee en la pantalla de chat.
--
-- `deliveries` ya guardaba cada intento de envio, pero con metadatos: a quien,
-- de que tipo y si salio. No guardaba el TEXTO, y de los mensajes entrantes no
-- guardaba nada. Sin eso no hay chat que mostrar: solo una lista de intentos.
--
-- Aqui va una fila por mensaje, entrante o saliente, con su cuerpo tal como se
-- lee. `payload` queda para el detalle que no es texto (coordenadas, botones).

create table if not exists messages (
  id          bigserial primary key,
  contact_id  uuid not null references contacts(id) on delete cascade,
  -- in = lo escribio el cliente; out = lo mando el negocio.
  direction   text not null,
  wamid       text unique,
  -- text | location | interactive | template | image | audio | video | document | sticker
  kind        text not null default 'text',
  body        text,
  payload     jsonb,
  -- Solo salientes: queued | sent | delivered | read | failed.
  status      text,
  delivery_id bigint,
  created_at  timestamptz not null default now()
);

create index if not exists messages_contact_idx on messages (contact_id, created_at desc, id desc);
create index if not exists messages_unread_idx on messages (contact_id, direction, created_at);

-- Hasta donde leyo el operador: lo que llego despues sale como no leido.
alter table contacts add column if not exists chat_read_at timestamptz;
