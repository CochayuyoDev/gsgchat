-- El superadministrador y los codigos de conexion.
--
-- Hasta ahora habia dos roles: admin (configura el negocio, gestiona cuentas
-- y claves) y operador (atiende). Por encima falta quien PONE el sistema:
-- el superadministrador. Es quien gestiona la membresia (plan, hasta cuando
-- esta pagada, topes), quien crea los codigos con los que otros sistemas se
-- conectan, y quien crea y quita administradores. Un admin no puede tocar
-- nada de eso ni las cuentas de los superadministradores.
--
-- La primera cuenta que se creo en esta instalacion pasa a superadmin: es
-- quien la puso en marcha. Las que vengan despues nacen con el rol que se
-- les de.
update usuarios
   set rol = 'superadmin'
 where id = (select id from usuarios where rol = 'admin' order by created_at asc, id asc limit 1)
   and not exists (select 1 from usuarios where rol = 'superadmin');

-- Los codigos de conexion: en vez de copiar una clave larga de un sistema a
-- otro, se crea un codigo corto (WA-K7M3-9QXZ) con fecha limite y usos, se
-- dicta o se pega en el otro sistema, y ese sistema lo canjea por su clave
-- de API. El codigo caduca solo; la clave que sale del canje es la de
-- siempre (claves_api) y se puede revocar desde la pantalla.
create table if not exists codigos_conexion (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  -- Para quien es: "Stoky", "Tienda web"... Es el nombre que llevara la clave.
  para           text not null,
  -- Lo que podra hacer la clave que salga del canje. ['*'] = todo.
  permisos       jsonb not null default '["*"]'::jsonb,
  caduca_at      timestamptz not null,
  usos_max       integer not null default 1,
  usos           integer not null default 0,
  -- activo | anulado (los usados y caducados se deducen de usos y caduca_at)
  estado         text not null default 'activo',
  creado_por     text,
  -- Del ultimo canje: que sistema, desde donde y cuando; y la clave que salio.
  canjeado_por   text,
  canjeado_desde text,
  canjeado_at    timestamptz,
  clave_id       uuid,
  created_at     timestamptz not null default now()
);

create index if not exists codigos_conexion_vivos_idx on codigos_conexion (estado, caduca_at);
