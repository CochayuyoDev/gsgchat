-- Procesos: lo que GSGchat automatiza por WhatsApp para cualquier empresa
-- (pedir y validar datos, confirmaciones y recordatorios, avisos al personal
-- de campo, cobranza y tramites; y las entregas de courier de GSG como una
-- plantilla mas). Ver src/procesos.

-- Un proceso: nombre, pasos, ritmo y cierre. Los pasos van en jsonb porque
-- se editan enteros desde la pantalla (tarjetas por paso) y se leen enteros.
create table if not exists procesos (
  id bigserial primary key,
  nombre text not null,
  plantilla text,
  descripcion text not null default '',
  pasos jsonb not null default '[]'::jsonb,
  ritmo jsonb not null default '{}'::jsonb,
  cierre jsonb not null default '{}'::jsonb,
  estado text not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una corrida: un proceso aplicado a una lista de personas.
create table if not exists proceso_corridas (
  id bigserial primary key,
  proceso_id bigint not null references procesos(id) on delete cascade,
  nombre text not null,
  estado text not null default 'activa',
  origen text not null default 'pegada',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists proceso_corridas_proceso_idx on proceso_corridas (proceso_id, created_at desc);

-- Cada persona de una corrida: en que paso va, cuantas veces se le escribio y
-- todo lo que respondio (por paso, en `respuestas`).
create table if not exists proceso_personas (
  id bigserial primary key,
  corrida_id bigint not null references proceso_corridas(id) on delete cascade,
  proceso_id bigint not null references procesos(id) on delete cascade,
  phone text,
  telefono_crudo text not null default '',
  nombre text,
  datos jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente',
  paso integer not null default 0,
  intentos integer not null default 0,
  fallos integer not null default 0,
  sub text,
  proximo_at timestamptz,
  ultimo_envio_at timestamptz,
  respuestas jsonb not null default '{}'::jsonb,
  ultimo text,
  motivo text,
  pausada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminada_at timestamptz
);
create index if not exists proceso_personas_corrida_idx on proceso_personas (corrida_id, id);
create index if not exists proceso_personas_phone_idx on proceso_personas (phone, updated_at desc);
create index if not exists proceso_personas_toca_idx on proceso_personas (estado, proximo_at);

-- La bitacora de cada persona: que se le mando, que respondio, que se decidio.
create table if not exists proceso_eventos (
  id bigserial primary key,
  persona_id bigint not null references proceso_personas(id) on delete cascade,
  tipo text not null,
  detalle text,
  en timestamptz not null default now()
);
create index if not exists proceso_eventos_persona_idx on proceso_eventos (persona_id, id);
