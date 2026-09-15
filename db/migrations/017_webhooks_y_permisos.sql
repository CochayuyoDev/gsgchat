-- Integrar otros sistemas: permisos por clave y webhooks salientes.
--
-- Hasta ahora una clave de API lo podia todo (rol admin). Para darle una a
-- Stoky, a GSG o a un script sin entregarles el sistema entero, cada clave
-- lleva su lista de permisos. Las que ya existian se quedan con '*' (todo),
-- que es exactamente lo que tenian.
alter table claves_api add column if not exists permisos text[] not null default '{*}';

-- Un webhook saliente: la URL de otro sistema que quiere enterarse de lo que
-- pasa aqui (llego un mensaje, se entrego, mando su ubicacion...). Sigue el
-- mismo patron que la cola hacia GSG (rutas_reportes): se encola, se manda,
-- se reintenta y queda constancia de cada entrega.
create table if not exists webhooks (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,
  -- Para reconocerlo en la lista: "Stoky", "ERP de ventas".
  descripcion   text not null default '',
  -- Con esto firma cada entrega (HMAC sha256 del cuerpo). Se ensena una sola
  -- vez al crearlo; el otro sistema lo guarda y comprueba la firma.
  secreto       text not null,
  -- Que eventos quiere: 'mensaje.recibido', 'mensaje.estado', ... o '*'.
  eventos       text[] not null default '{*}',
  activo        boolean not null default true,
  -- Por que se apago solo (24 h de fallos seguidos), si fue el caso.
  motivo_pausa  text,
  creado_por    uuid references usuarios(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Ultimo exito y ultimo fallo, para verlo de un vistazo en el panel.
  ultimo_ok_at  timestamptz,
  ultimo_fallo_at timestamptz,
  fallos_seguidos integer not null default 0
);

create table if not exists webhook_entregas (
  id            bigserial primary key,
  webhook_id    uuid not null references webhooks(id) on delete cascade,
  evento        text not null,
  payload       jsonb not null,
  -- pendiente | enviada | fallida
  estado        text not null default 'pendiente',
  intentos      integer not null default 0,
  proximo_intento_at timestamptz not null default now(),
  -- Lo que contesto el otro lado la ultima vez (codigo HTTP y un trozo del cuerpo).
  respuesta_codigo integer,
  respuesta     text,
  error         text,
  created_at    timestamptz not null default now(),
  enviada_at    timestamptz
);

create index if not exists webhook_entregas_pendientes_idx
  on webhook_entregas (proximo_intento_at) where estado = 'pendiente';
create index if not exists webhook_entregas_por_webhook_idx
  on webhook_entregas (webhook_id, created_at desc);
