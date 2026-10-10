-- Bitácora: quién hizo qué y cuándo.
--
-- Cada acción que cambia algo (entrar, crear un usuario, pausar los envíos,
-- cargar un lote, guardar ajustes...) deja una fila. Se escribe sola desde
-- un hook del servidor (src/auth/actividad.ts): no hay que acordarse de
-- anotarla en cada ruta. Sin contraseñas ni tokens en `detalle`.
create table if not exists actividad (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  -- id de usuario, "clave:<id>" para una clave de API, o null si nadie (login fallido).
  usuario_id  text,
  -- Nombre para mostrar tal como era en ese momento.
  usuario     text not null,
  -- Código corto: "entrar", "usuario.crear", "envios.pausar", "lote.crear"...
  accion      text not null,
  detalle     jsonb,
  ip          text
);
create index if not exists actividad_at_idx on actividad (at desc);
create index if not exists actividad_accion_idx on actividad (accion, at desc);
