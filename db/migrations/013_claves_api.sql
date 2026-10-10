-- Claves de API para integraciones: adiós al ADMIN_TOKEN fijo.
--
-- Una persona entra con su cuenta (012_usuarios). Un programa (el sistema
-- de GSG, un script) entra con una clave que un administrador crea desde
-- el panel, con nombre, y que puede revocar cuando quiera. La clave se
-- enseña una sola vez al crearla; aquí solo queda su hash.
create table if not exists claves_api (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  -- Los primeros caracteres, para reconocerla en la lista ("wak_3f9a…").
  prefijo       text not null,
  -- sha256 en hex de la clave completa.
  hash          text not null unique,
  creada_por    uuid references usuarios(id) on delete set null,
  created_at    timestamptz not null default now(),
  ultimo_uso_at timestamptz,
  revocada_at   timestamptz
);
