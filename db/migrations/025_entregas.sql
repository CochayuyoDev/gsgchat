-- Entregas del dia y motorizados (ver src/entregas).
--
-- Una entrega es un pedido de hoy que hay que llevar a un cliente. Le pasan
-- tres cosas, en este orden y cada una por separado:
--   1. la UBICACION: el cliente manda su pin (lo pide el reparto);
--   2. la CONFIRMACION: el cliente dice que si quiere el pedido hoy;
--   3. el MOTORIZADO: recibe el pin, dice en cuantos minutos entrega, y al
--      cliente se le avisa con una hora de margen encima.
-- Quien falta ubicacion y quien falta confirmar lo dice el sistema de GSG
-- (su lista del dia); cuando las dos cosas estan, GSG lo pasa a "terminados".

create table if not exists motorizados (
  id                bigserial primary key,
  -- Solo digitos, con el pais delante: 51999000001.
  phone             text not null unique,
  nombre            text not null,
  placa             text,
  -- Los distritos que suele cubrir, en texto libre ("Miraflores, Surco").
  zona              text,
  -- activo | descanso | baja
  estado            text not null default 'activo',
  -- Cuantas entregas lleva hoy (se reinicia al cambiar el dia).
  entregas_hoy      integer not null default 0,
  entregas_hoy_dia  date,
  ultimo_encargo_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists entregas (
  id                       bigserial primary key,
  -- El dia del reparto: la misma referencia otro dia es otra entrega.
  dia                      date not null,
  -- El pedido, tal como lo llama GSG.
  referencia               text not null,
  externo_id               text,
  phone                    text not null,
  nombre                   text,
  direccion                text,
  distrito                 text,
  notas                    text,

  -- Ubicacion: no_hace_falta (GSG ya la tiene) | pendiente | recibida
  ubicacion_estado         text not null default 'pendiente',
  -- El lote del reparto que le esta pidiendo la ubicacion, si hay uno.
  lote_id                  text,
  lat                      double precision,
  lng                      double precision,
  maps_url                 text,
  ubicacion_fuente         text,
  ubicacion_at             timestamptz,

  -- Confirmacion: no_hace_falta | pendiente | pedida | confirmada | rechazada
  confirmacion_estado      text not null default 'pendiente',
  confirmacion_intentos    integer not null default 0,
  confirmacion_pedida_at   timestamptz,
  confirmacion_proximo_at  timestamptz,
  confirmacion_at          timestamptz,
  confirmacion_respuesta   text,
  -- boton | reglas | ia | persona
  confirmacion_como        text,

  -- Motorizado: sin_asignar | enviado | respondio | sin_respuesta
  motorizado_id            bigint references motorizados(id) on delete set null,
  motorizado_estado        text not null default 'sin_asignar',
  motorizado_intentos      integer not null default 0,
  motorizado_enviado_at    timestamptz,
  motorizado_proximo_at    timestamptz,
  motorizado_respuesta     text,
  motorizado_respondio_at  timestamptz,
  -- Los que dijo el motorizado, y con el margen encima los que se le dicen al cliente.
  minutos_motorizado       integer,
  minutos_aviso            integer,
  llega_aprox_at           timestamptz,
  aviso_enviado_at         timestamptz,
  -- Motorizados que ya lo rechazaron o no contestaron: no se les vuelve a mandar.
  motorizados_descartados  jsonb not null default '[]'::jsonb,

  -- pendiente | esperando_ubicacion | esperando_confirmacion | lista |
  -- esperando_motorizado | avisada | terminada | cancelada | incidencia
  estado                   text not null default 'pendiente',
  incidencia               text,
  incidencia_detalle       text,
  requiere_humano          boolean not null default false,
  -- Cuando GSG dijo que la paso a "terminados".
  terminada_gsg_at         timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (dia, referencia)
);

create index if not exists entregas_phone_idx on entregas (phone, dia desc);
create index if not exists entregas_estado_idx on entregas (dia desc, estado);
create index if not exists entregas_motorizado_idx on entregas (motorizado_id, motorizado_estado);

-- La bitacora de cada entrega: es lo que responde "¿que paso con el pedido de Juan?".
create table if not exists entregas_eventos (
  id          bigserial primary key,
  entrega_id  bigint not null references entregas(id) on delete cascade,
  -- sincronizada | ubicacion | confirmacion_pedida | confirmada | rechazada |
  -- motorizado_enviado | motorizado_respondio | aviso | terminada | incidencia | nota | ia | reporte
  tipo        text not null,
  detalle     text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists entregas_eventos_idx on entregas_eventos (entrega_id, id);
