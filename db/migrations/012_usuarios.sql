-- Usuarios con contraseña: el panel deja de pedir el token de administración.
--
-- El token (ADMIN_TOKEN) sigue existiendo para las integraciones por API
-- (GSG, curl); las personas entran con usuario y contraseña en /login. La
-- contraseña se guarda con scrypt y sal propia; nunca en claro.
create table if not exists usuarios (
  id              uuid primary key default gen_random_uuid(),
  usuario         text not null unique,
  nombre          text not null,
  -- "scrypt$<sal hex>$<hash hex>"
  clave           text not null,
  -- admin: todo, incluido crear usuarios. operador: todo menos usuarios.
  rol             text not null default 'operador',
  activo          boolean not null default true,
  -- Sube al cambiar la contraseña: las sesiones anteriores dejan de valer.
  sesion_version  integer not null default 1,
  ultimo_login_at timestamptz,
  created_at      timestamptz not null default now()
);
