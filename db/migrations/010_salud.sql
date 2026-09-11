-- Salud del número: todo lo que hace falta para no quemarlo.
--
-- Meta no banea por volumen: banea por bloqueos, reportes y patrones de
-- robot. Y con un cliente no oficial (Baileys, WAHA) el criterio es el mismo
-- pero sin aviso previo. Lo que había hasta ahora eran guardas estáticas
-- (opt-in, ventana, cupo diario). Lo que falta es la parte que MIRA lo que
-- pasa -errores de Meta, mensajes que no llegan, bajas, desconexiones- y
-- reacciona sola: frena, pausa, aparta contactos, deja descansar plantillas.
--
-- Cuatro cosas nuevas:
--   1. una bitácora de señales (`salud_eventos`) de la que salen las ventanas
--      móviles (última hora, últimas 24 h, últimos 50 envíos);
--   2. supresión por contacto: a quien Meta dice que no tiene WhatsApp, o que
--      ya recibió demasiado marketing, se le deja de escribir un tiempo;
--   3. plantillas con memoria de sus pausas (3 h, 6 h, deshabilitada);
--   4. el estado de riesgo del número: nivel, factor de frenado y hasta
--      cuándo está pausado solo.

-- 1. Señales. Una fila por cosa que pasó y que puede indicar riesgo: un error
--    de envío con su código, un `failed` del webhook, una baja, una
--    desconexión, una pausa automática. Se limpia sola (ver el monitor): a
--    los 30 días ya no dice nada útil.
create table if not exists salud_eventos (
  id              bigserial primary key,
  phone_number_id text not null default '',
  at              timestamptz not null default now(),
  -- error_envio | estado_fallido | baja | desconexion | rate_limit |
  -- calidad | plantilla | cuenta | pausa_auto | reanudacion | rampa |
  -- respuesta_negativa | supresion | nota
  tipo            text not null,
  -- Código de Meta (131026, 131049, ...) o de Baileys (403, 401, ...).
  codigo          text,
  detalle         text,
  contact_id      uuid references contacts(id) on delete set null,
  campaign_id     uuid references campaigns(id) on delete set null,
  payload         jsonb
);
create index if not exists salud_eventos_at_idx   on salud_eventos (phone_number_id, at desc);
create index if not exists salud_eventos_tipo_idx on salud_eventos (tipo, at desc);

-- 2. Supresión por contacto. `hasta` = null significa sin supresión. El
--    ámbito distingue "nada de nada" (no tiene WhatsApp) de "nada de
--    marketing" (Meta dice que ya recibió demasiado: 131049 / 131050).
alter table contacts add column if not exists suprimido_hasta    timestamptz;
alter table contacts add column if not exists suprimido_motivo   text;
alter table contacts add column if not exists suprimido_ambito   text;
-- Envíos iniciados por la empresa seguidos sin que el cliente conteste nada.
-- Es la fatiga: al tercero, insistir con marketing solo trae bloqueos.
alter table contacts add column if not exists sin_respuesta_seguidas integer not null default 0;
alter table contacts add column if not exists ultimo_envio_at    timestamptz;
-- Cuántos mensajes de negocio ha recibido en total: un contacto al que nunca
-- se le escribió es "nuevo", y los nuevos por día se cuentan aparte.
alter table contacts add column if not exists envios_iniciados   integer not null default 0;
-- El primero: define si hoy es "contacto nuevo" (los nuevos por día tienen cupo).
alter table contacts add column if not exists primer_envio_at    timestamptz;

create index if not exists contacts_suprimido_idx on contacts (suprimido_hasta) where suprimido_hasta is not null;

-- 3. Plantillas: memoria de pausas. Meta pausa 3 h la primera vez, 6 h la
--    segunda y la tercera la deshabilita. El webhook avisa de la pausa, pero
--    NO avisa de que terminó: hay que saber hasta cuándo.
alter table templates add column if not exists pausada_hasta timestamptz;
alter table templates add column if not exists pausas        integer not null default 0;
alter table templates add column if not exists motivo        text;
alter table templates add column if not exists aprobada_at   timestamptz;

-- 4. Estado de riesgo del número. `factor` es el multiplicador de velocidad
--    que aplica el marcapasos (1 = normal, 0.5 = mitad, 0 = parado).
alter table number_state add column if not exists estado          text not null default 'CONNECTED';
alter table number_state add column if not exists riesgo          integer not null default 0;
alter table number_state add column if not exists nivel           text not null default 'verde';
alter table number_state add column if not exists factor          double precision not null default 1;
alter table number_state add column if not exists motivos         jsonb;
alter table number_state add column if not exists pausada_hasta   timestamptz;
-- Cuándo empezó la rampa de vuelta tras una pausa: se sale despacio.
alter table number_state add column if not exists rampa_desde     timestamptz;
-- Límite numérico del tier (250, 2000, 10000...) por si Meta lo manda como
-- número (business_capability_update) y no como TIER_xxx.
alter table number_state add column if not exists limite_24h      integer;
alter table number_state add column if not exists ultima_evaluacion timestamptz;

-- Entregas: saber si el envío lo inició la empresa (fuera de ventana o con
-- plantilla) es lo que permite contar destinatarios únicos en 24 h, que es
-- exactamente lo que mide el límite de Meta.
alter table deliveries add column if not exists business_initiated boolean not null default false;
create index if not exists deliveries_sent_idx on deliveries (sent_at desc) where sent_at is not null;
create index if not exists deliveries_bi_idx on deliveries (business_initiated, sent_at desc) where business_initiated;

-- Campañas por goteo. Antes una campaña se volcaba entera en la cola y salía
-- a diez por segundo, que es exactamente el patrón que Meta castiga. Ahora
-- los destinatarios se guardan aquí y un ticker los va sacando al ritmo del
-- marcapasos, empezando por un grupo pequeño (el canario) cuyo resultado
-- decide si el resto sale o se para.
alter table campaigns add column if not exists ritmo_por_hora     integer;
alter table campaigns add column if not exists canario            integer not null default 0;
alter table campaigns add column if not exists canario_espera_min integer not null default 60;
alter table campaigns add column if not exists canario_enviado_at timestamptz;
alter table campaigns add column if not exists motivo_pausa       text;
alter table campaigns add column if not exists started_at         timestamptz;
alter table campaigns add column if not exists finished_at        timestamptz;

create table if not exists campaign_recipients (
  id            bigserial primary key,
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  phone         text not null,
  variables     jsonb,
  -- pendiente | enviado | bloqueado | fallido | cancelado
  estado        text not null default 'pendiente',
  -- Orden de salida: los más comprometidos primero, que son los que dan el
  -- feedback positivo que Meta mira en las primeras horas de una plantilla.
  orden         integer not null default 0,
  -- true para los del primer grupo, el que decide si el resto sale.
  canario       boolean not null default false,
  delivery_id   bigint,
  detalle       text,
  -- Un rechazo con espera (separacion por contacto, cupo) lo deja pendiente
  -- pero no antes de esta hora; sin esto el goteo lo reintentaria cada tick.
  posponer_hasta timestamptz,
  intentos      integer not null default 0,
  enviado_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (campaign_id, phone)
);
create index if not exists campaign_recipients_pend_idx on campaign_recipients (campaign_id, estado, orden);
