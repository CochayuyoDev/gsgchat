-- Esquema inicial de wa-locator.
--
-- Nota sobre geometria: se guardan lat/lng como double precision en vez de
-- geography(Point) para no obligar a PostGIS. Si mas adelante hacen falta
-- consultas por distancia, anadir la extension y una columna generada.

create extension if not exists pgcrypto;

-- Contactos y su estado de consentimiento. `opt_in_at` es el campo que
-- decide si un mensaje sale o no: sin el, el sender no envia.
create table if not exists contacts (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,
  name            text,
  opt_in_at       timestamptz,
  opt_in_source   text,
  opt_out_at      timestamptz,
  -- Ultimo mensaje entrante: abre la ventana de servicio de 24 h.
  last_inbound_at timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists locations (
  id               bigserial primary key,
  contact_id       uuid not null references contacts(id) on delete cascade,
  lat              double precision not null,
  lng              double precision not null,
  source           text not null,
  confidence       text not null,
  precision_meters double precision not null,
  raw_input        text,
  resolved_url     text,
  confirmed        boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists locations_contact_idx on locations (contact_id, created_at desc);

-- Espejo local de las plantillas de Meta. `status` y `quality` los actualizan
-- los webhooks message_template_status_update / _quality_update.
create table if not exists templates (
  name       text not null,
  language   text not null,
  category   text not null,
  status     text not null,
  quality    text,
  variables  integer not null default 0,
  body       text,
  synced_at  timestamptz not null default now(),
  primary key (name, language)
);

-- Estado del numero emisor. `quality` en YELLOW o RED frena marketing.
create table if not exists number_state (
  phone_number_id  text primary key,
  quality          text not null default 'GREEN',
  paused           boolean not null default false,
  paused_reason    text,
  warmup_started_on date not null default current_date,
  updated_at       timestamptz not null default now()
);

create table if not exists campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  template_name     text not null,
  template_language text not null default 'es_MX',
  category          text not null default 'MARKETING',
  status            text not null default 'draft',
  created_at        timestamptz not null default now()
);

-- Una fila por mensaje saliente. Es la tabla que alimenta las metricas de
-- calidad: ratio de failed, de read y de opt-out por campana.
create table if not exists deliveries (
  id            bigserial primary key,
  campaign_id   uuid references campaigns(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  wamid         text unique,
  kind          text not null,
  template_name text,
  category      text not null default 'UTILITY',
  status        text not null default 'queued',
  error_code    text,
  error_title   text,
  variables     jsonb,
  queued_at     timestamptz not null default now(),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  failed_at     timestamptz
);
create index if not exists deliveries_contact_idx on deliveries (contact_id, queued_at desc);
create index if not exists deliveries_campaign_idx on deliveries (campaign_id, status);
create index if not exists deliveries_marketing_idx
  on deliveries (contact_id, category, queued_at desc);

-- Sesiones de rastreo en vivo. Dos roles por sesion: quien publica su
-- posicion y quien la mira. Cada uno recibe un token distinto.
create table if not exists tracking_links (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references contacts(id) on delete set null,
  label       text,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists track_points (
  id          bigserial primary key,
  link_id     uuid not null references tracking_links(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  heading     double precision,
  speed       double precision,
  recorded_at timestamptz not null default now()
);
create index if not exists track_points_link_idx on track_points (link_id, recorded_at);

-- Contadores diarios por categoria: sostienen el warm-up y el techo por 24 h.
create table if not exists send_counters (
  phone_number_id text not null,
  day             date not null,
  category        text not null,
  sent            integer not null default 0,
  primary key (phone_number_id, day, category)
);
