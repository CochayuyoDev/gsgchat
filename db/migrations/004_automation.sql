-- Automatizacion: respuestas automaticas, secuencias de seguimiento y
-- mensajes programados.
--
-- Los envios programados viven en la base y no solo en Redis para que el
-- panel pueda listarlos y cancelarlos, y para que sobrevivan a un reinicio
-- sin depender de la cola. El ticker del proceso los reclama por lotes con
-- `for update skip locked`, asi que varios procesos no se pisan.

-- Una secuencia es una lista ordenada de pasos con retardo. Fuera de la
-- ventana de 24 h solo puede salir una plantilla; los gates lo garantizan.
create table if not exists sequences (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  -- Si el contacto responde, se cancelan los pasos que quedaban.
  stop_on_reply  boolean not null default true,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists sequence_steps (
  id                bigserial primary key,
  sequence_id       uuid not null references sequences(id) on delete cascade,
  position          integer not null,
  -- Minutos desde el paso anterior (o desde la inscripcion para el primero).
  delay_minutes     integer not null default 0,
  kind              text not null default 'template',
  template_name     text,
  template_language text not null default 'es_MX',
  category          text not null default 'UTILITY',
  -- Array de strings; admiten {nombre}, {telefono} y {fecha}.
  variables         jsonb,
  text              text,
  unique (sequence_id, position)
);

create table if not exists enrollments (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references sequences(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  status        text not null default 'active',
  -- Posicion del ultimo paso ya programado.
  current_step  integer not null default 0,
  source        text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists enrollments_contact_idx on enrollments (contact_id, status);
create index if not exists enrollments_sequence_idx on enrollments (sequence_id, status);

create table if not exists scheduled_messages (
  id                bigserial primary key,
  contact_id        uuid not null references contacts(id) on delete cascade,
  -- Null si se programo a mano desde el panel.
  enrollment_id     uuid references enrollments(id) on delete cascade,
  step_position     integer,
  due_at            timestamptz not null,
  kind              text not null,
  category          text not null default 'UTILITY',
  template_name     text,
  template_language text,
  variables         jsonb,
  text              text,
  status            text not null default 'pending',
  delivery_id       bigint,
  detail            text,
  created_at        timestamptz not null default now(),
  processed_at      timestamptz
);
create index if not exists scheduled_messages_due_idx on scheduled_messages (status, due_at);
create index if not exists scheduled_messages_contact_idx on scheduled_messages (contact_id, due_at desc);

-- Reglas de respuesta automatica sobre los mensajes entrantes.
--   trigger = keyword       : coincide por palabra (equals | contains | starts)
--   trigger = first_message : primer mensaje del contacto (bienvenida)
--   trigger = any           : cualquier texto sin coordenadas que no caso con nada
create table if not exists auto_replies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  trigger      text not null default 'keyword',
  keyword      text,
  match        text not null default 'contains',
  reply        text,
  sequence_id  uuid references sequences(id) on delete set null,
  enabled      boolean not null default true,
  priority     integer not null default 100,
  created_at   timestamptz not null default now()
);
