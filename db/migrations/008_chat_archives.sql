-- Respaldo de conversaciones cerradas.
--
-- El historial de WhatsApp vive en el teléfono, y el teléfono se pierde: si
-- Meta borra el número, si alguien reinstala, si la cuenta cae. Lo que se
-- habló con cada cliente es la prueba de lo que se acordó, así que antes de
-- vaciar un chat el hilo entero se escribe en un fichero propio y aquí queda
-- la ficha que dice dónde está y qué contiene.
--
-- El hilo NO se guarda en esta tabla a propósito: el objetivo de cerrar una
-- conversación es que la base deje de crecer. Aquí va el índice -una fila por
-- respaldo, unos cientos de bytes- y el contenido a disco, comprimido.
create table if not exists chat_archives (
  id            bigserial primary key,
  contact_id    uuid not null references contacts(id) on delete cascade,
  -- El teléfono y el nombre se copian: si el contacto se borra de la libreta,
  -- el respaldo tiene que seguir diciendo de quién era.
  phone         text not null,
  name          text,
  -- Ruta relativa al directorio de respaldos, no absoluta: mover la carpeta
  -- (o montarla en otro sitio en Docker) no debe invalidar el índice.
  file          text not null,
  bytes         bigint not null default 0,
  message_count integer not null default 0,
  first_message_at timestamptz,
  last_message_at  timestamptz,
  -- Qué lo disparó: manual | lead | inactividad.
  reason        text not null default 'manual',
  -- sha256 del fichero, para detectar que se corrompió o lo tocaron.
  sha256        text,
  created_at    timestamptz not null default now()
);

create index if not exists chat_archives_contact_idx on chat_archives (contact_id, created_at desc);
create index if not exists chat_archives_created_idx on chat_archives (created_at desc);
create index if not exists chat_archives_phone_idx   on chat_archives (phone);
