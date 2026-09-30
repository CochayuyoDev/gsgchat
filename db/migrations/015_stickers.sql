-- Stickers propios: los que se mandan tras un saludo, un "gracias" o una
-- despedida, o a mano desde el chat. El fichero (WebP 512x512) vive en la
-- carpeta de medios; aquí solo el nombre, para qué es y cuánto pesa.
create table if not exists stickers (
  id          text primary key,
  nombre      text not null,
  -- inicio | gracias | despedida | otro: solo una etiqueta para ordenarlos.
  uso         text not null default 'otro',
  -- Nombre del fichero en la carpeta de medios (st-<hash>.webp).
  archivo     text not null unique,
  bytes       integer not null default 0,
  created_at  timestamptz not null default now()
);
