-- Solicitud de ubicación por lotes: el trabajo de GSG.
--
-- El reparto sale con direcciones que no siempre son direcciones: "por el
-- mercado, casa de portón verde". Antes de que el motorizado se suba a la
-- moto hay que conseguir el pin del cliente, y eso son cientos de mensajes al
-- día que hoy manda una persona a mano, uno por uno.
--
-- Este módulo es esa tarea, entera: a quién hay que pedirle ubicación, qué se
-- le mandó y cuándo, qué contestó, qué salió mal exactamente y qué queda para
-- una persona. Tres tablas y ninguna magia: el lote (el trabajo del día), la
-- solicitud (una por cliente) y la bitácora (todo lo que le pasó a esa
-- solicitud, para poder documentar la incidencia con fecha y hora).

-- El trabajo del día. Viene de un CSV mientras GSG no tenga API; cuando la
-- tenga, el mismo lote entra por `origen = 'api'` y nada más cambia.
create table if not exists rutas_lotes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  origen      text not null default 'csv',
  -- preparado: cargado y validado, sin escribir a nadie todavía.
  -- enviando:  el motor está trabajando.
  -- pausado:   alguien lo paró (o se paró solo por un problema del número).
  -- terminado: no queda nada pendiente que hacer solo.
  estado      text not null default 'preparado',
  notas       text,
  -- Referencia del lote en el sistema de GSG, cuando venga de allí.
  externo_id  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists rutas_lotes_estado_idx on rutas_lotes (estado, created_at desc);

-- Una fila por cliente al que hay que pedirle la ubicación.
create table if not exists rutas_solicitudes (
  id            bigserial primary key,
  lote_id       uuid not null references rutas_lotes(id) on delete cascade,
  -- Se rellena en cuanto hay con quién hablar. Null mientras el número sea
  -- inválido: no se crea contacto para algo que no se puede marcar.
  contact_id    uuid references contacts(id) on delete set null,

  -- Tal como vino en el fichero, sin tocar. Es lo que hay que enseñarle a
  -- quien tenga que corregirlo: "51 987 65432" y "987654321" se ven distinto.
  telefono_crudo text not null,
  -- Normalizado y marcable. Null = no se pudo.
  phone         text,
  nombre        text,
  -- El número de pedido, guía o cliente en GSG: sin esto, un reporte de
  -- vuelta no se puede casar con nada.
  referencia    text,
  direccion     text,
  distrito      text,
  notas         text,

  -- pendiente | enviado | respondio | resuelto | supervision | derivado |
  -- incidencia | cancelado. Ver src/rutas/estados.ts.
  estado        text not null default 'pendiente',
  intentos      integer not null default 0,
  ultimo_envio_at    timestamptz,
  -- Cuándo toca volver a intentarlo. El motor ordena por esta columna.
  proximo_intento_at timestamptz,
  primera_respuesta_at timestamptz,
  resuelto_at   timestamptz,

  lat           double precision,
  lng           double precision,
  precision_m   integer,
  ubicacion_fuente text,
  maps_url      text,

  -- El código exacto de lo que pasó (numero_corto, sin_whatsapp, ...) y el
  -- detalle en cristiano. Documentar la incidencia es media tarea.
  incidencia        text,
  incidencia_detalle text,
  -- true = aquí ya no puede hacer nada el bot.
  requiere_humano   boolean not null default false,
  asignado_a        text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rutas_sol_lote_idx    on rutas_solicitudes (lote_id, estado);
create index if not exists rutas_sol_pend_idx    on rutas_solicitudes (estado, proximo_intento_at);
create index if not exists rutas_sol_contact_idx on rutas_solicitudes (contact_id, estado);
create index if not exists rutas_sol_phone_idx   on rutas_solicitudes (phone);

-- La bitácora. Cada envío, cada respuesta, cada incidencia y cada derivación,
-- con su hora. Es lo que se le enseña a GSG cuando pregunte "¿y a este
-- cliente le escribieron?", y lo que permite reconstruir un caso entero.
create table if not exists rutas_eventos (
  id            bigserial primary key,
  solicitud_id  bigint not null references rutas_solicitudes(id) on delete cascade,
  -- envio | respuesta | ubicacion | incidencia | derivacion | reporte | nota
  tipo          text not null,
  detalle       text,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists rutas_eventos_sol_idx on rutas_eventos (solicitud_id, created_at);

-- Lo que hay que contarle al sistema de GSG.
--
-- Existe como tabla y no como una llamada directa a propósito: hoy no hay API
-- que llamar. Cada cosa reportable se apunta aquí y queda 'pendiente'; el día
-- que GSG publique su endpoint se rellena GSG_URL y esta misma cola se vacía
-- contra él, incluido lo acumulado. Nada que reportar se pierde por no haber
-- tenido la integración lista.
create table if not exists rutas_reportes (
  id            bigserial primary key,
  solicitud_id  bigint references rutas_solicitudes(id) on delete cascade,
  lote_id       uuid references rutas_lotes(id) on delete cascade,
  -- ubicacion | incidencia | resumen
  tipo          text not null,
  payload       jsonb not null,
  -- pendiente | enviado | fallido
  estado        text not null default 'pendiente',
  intentos      integer not null default 0,
  ultimo_error  text,
  -- Id que devolvió GSG al aceptarlo.
  externo_id    text,
  enviado_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists rutas_reportes_estado_idx on rutas_reportes (estado, created_at);
create index if not exists rutas_reportes_lote_idx   on rutas_reportes (lote_id, tipo);
