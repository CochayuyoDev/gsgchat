-- La lista de envio automatico: a quien le escribe el sistema por su cuenta.
--
-- El sistema no le escribe solo a nadie que no este aqui (o en un lote del
-- reparto, que es la otra forma de darle numeros). A cada numero se le manda
-- un mensaje cada pocas horas -como lo haria una persona-, en horario, hasta
-- que se consigue lo que se buscaba (su ubicacion, una respuesta) o se
-- agotan los intentos; entonces sale de la lista solo. Los numeros entran a
-- mano, por el asistente de IA o por el ayudante del panel, y siempre queda
-- apuntado quien los puso y por que salieron.
create table if not exists envio_automatico (
  id             bigserial primary key,
  -- Solo digitos, con el pais delante: 51987654321.
  phone          text not null unique,
  nombre         text,
  -- ubicacion | mensaje
  que            text not null default 'ubicacion',
  -- Con `mensaje`, lo que se manda. Con `ubicacion`, una redaccion propia
  -- opcional; vacio = las del reparto (solicitud, recordatorio, insistencia).
  texto          text,
  -- Cuando deja de escribirsele: ubicacion | respuesta | envios
  hasta          text not null default 'ubicacion',
  -- Un pedido o motivo para rellenar {pedido} en el texto.
  referencia     text,
  -- manual | ia | ayudante | api
  origen         text not null,
  origen_detalle text,
  -- activo | pausado
  estado         text not null default 'activo',
  enviados       integer not null default 0,
  -- null = el maximo general (ajustes del reparto).
  max_envios     integer,
  -- Cuando contesto algo (sin ser lo que se buscaba) desde el ultimo envio.
  respondio_at   timestamptz,
  ultimo_envio_at timestamptz,
  proximo_envio_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists envio_automatico_turno_idx
  on envio_automatico (estado, proximo_envio_at, created_at);

-- Cada entrada y salida de la lista, y cada mensaje que salio por ella: es
-- lo que responde "¿por que ya no esta Juan en la lista?".
create table if not exists envio_automatico_movimientos (
  id          bigserial primary key,
  phone       text not null,
  nombre      text,
  -- entro | salio | envio | pausa | reanudo | fallo
  tipo        text not null,
  motivo      text,
  -- Quien lo hizo: manual (con el usuario), ia, ayudante, reparto, sistema.
  origen      text,
  created_at  timestamptz not null default now()
);

create index if not exists envio_automatico_movimientos_recientes_idx
  on envio_automatico_movimientos (id desc);
