-- Las tiendas que controla el superadministrador.
--
-- Cada tienda (cada negocio al que se le puso el sistema) tiene su propia
-- instalacion del sistema de WhatsApp: su numero, su base, sus usuarios. Lo
-- que las une es quien las vende y las mantiene: el superadministrador.
-- Desde su panel (Tiendas) las da de alta, les pone plan y vencimiento,
-- apunta los pagos, las suspende o las reactiva, y ve si estan en linea.
--
-- La tienda pregunta por su plan a este servidor (GET /api/plan/<slug> con
-- su token, el mismo contrato que tenia el maestro del SaaS) y con eso se
-- decide alla que se puede hacer. Aqui solo se guarda el hash del token.
create table if not exists tiendas (
  id                  uuid primary key default gen_random_uuid(),
  -- Solo minusculas, numeros y guiones: es lo que va en la URL del plan.
  slug                text not null unique,
  nombre              text not null,
  -- Donde vive su sistema de WhatsApp (para abrir su panel); puede faltar.
  url                 text,
  contacto            text,
  notas               text,
  -- La membresia de esa tienda: la misma forma que plan.local (ver src/plan).
  membresia           jsonb not null,
  token_hash          text not null,
  token_prefijo       text not null,
  -- La ultima vez que su sistema pregunto por el plan: es como se sabe que esta en linea.
  ultima_consulta_at  timestamptz,
  ultima_consulta_ip  text,
  creado_por          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists tiendas_nombre_idx on tiendas (lower(nombre));
