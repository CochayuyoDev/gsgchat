-- El entrenamiento del asistente de IA: lo que se le ensena, a gran escala.
--
-- El asistente no se "reentrena" como modelo (corre sobre modelos gratuitos
-- de Puter): se le ensena con LECCIONES. Cada leccion es una de tres cosas:
--   ejemplo  cuando el cliente diga X, contesta Y (con lo que dijo mal, si
--            es una correccion);
--   dato     un hecho del negocio (envios a Trujillo: 2 dias);
--   regla    como comportarse (nunca prometer plazos exactos).
-- Pueden ser miles: en cada turno el sistema elige las que vienen al caso
-- (indice en memoria, ver src/entrenamiento/indice.ts) y solo esas van en el
-- prompt. Entran a mano, por importacion masiva (Excel, CSV, JSON, un chat
-- exportado), aprendidas de las conversaciones reales (lo que una persona
-- del negocio contesto) o por la API. Las que llegan en masa pueden quedar
-- `pendiente` hasta que alguien las revise.
create table if not exists ia_lecciones (
  id             bigserial primary key,
  -- ejemplo | dato | regla
  tipo           text not null default 'ejemplo',
  -- ejemplo: lo que dice el cliente. dato/regla: un titulo corto (opcional).
  pregunta       text,
  -- ejemplo: lo que hay que contestar. dato: el hecho. regla: la regla.
  respuesta      text not null,
  -- En una correccion: lo que el asistente dijo mal (para que no lo repita).
  mala           text,
  tema           text,
  -- manual | importado | chat | correccion | ia | api
  origen         text not null default 'manual',
  origen_detalle text,
  -- activa | pendiente | descartada
  estado         text not null default 'activa',
  -- Huella de (pregunta, respuesta) normalizadas: la misma leccion no entra dos veces.
  huella         text not null unique,
  -- Cuantas veces fue al prompt de un turno real.
  usos           integer not null default 0,
  ultimo_uso_at  timestamptz,
  -- El ultimo examen de esta leccion: si el asistente respondio como se le enseno.
  examen_ok      boolean,
  examen_at      timestamptz,
  examen_nota    text,
  -- Una observacion libre: por que se descarto, que arreglo la IA al pulirla.
  nota           text,
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ia_lecciones_estado_idx on ia_lecciones (estado, tipo, id desc);
create index if not exists ia_lecciones_tema_idx on ia_lecciones (tema);
create index if not exists ia_lecciones_origen_idx on ia_lecciones (origen, origen_detalle);

-- Cada examen a gran escala: cuantas lecciones se preguntaron y cuantas
-- respondio bien. Queda el historico para ver si mejora con el tiempo.
create table if not exists ia_examenes (
  id            bigserial primary key,
  nombre        text,
  total         integer not null default 0,
  aprobados     integer not null default 0,
  fallados      integer not null default 0,
  errores       integer not null default 0,
  -- corriendo | terminado | cancelado
  estado        text not null default 'corriendo',
  detalle       jsonb,
  creado_por    text,
  empezado_at   timestamptz not null default now(),
  terminado_at  timestamptz
);

-- Cada pregunta del examen con lo que se esperaba, lo que contesto y por que
-- se dio por buena o por mala.
create table if not exists ia_examen_casos (
  id          bigserial primary key,
  examen_id   bigint not null references ia_examenes(id) on delete cascade,
  leccion_id  bigint references ia_lecciones(id) on delete set null,
  pregunta    text not null,
  esperada    text not null,
  respuesta   text,
  ok          boolean not null default false,
  motivos     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ia_examen_casos_examen_idx on ia_examen_casos (examen_id, ok, id);
