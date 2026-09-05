-- Credenciales y ajustes editables desde la web.
--
-- Existe para no obligar a editar .env ni reiniciar el proceso cada vez que
-- cambia un token. Los valores sensibles se guardan cifrados (AES-256-GCM) y
-- la clave vive fuera de la base, en .secrets.json.

create table if not exists settings (
  key        text primary key,
  value      text not null,
  encrypted  boolean not null default false,
  updated_at timestamptz not null default now()
);
