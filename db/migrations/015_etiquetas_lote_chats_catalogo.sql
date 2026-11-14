-- El etiquetado de Chats: lo que proceso cada lote, chat por chat, y el
-- catalogo de etiquetas del negocio.
--
-- `chat_etiquetas_lote_chats`: una fila por lote y numero de WhatsApp. Al
-- empezar un lote se guarda aqui la copia de los mensajes de ese dia de cada
-- chat (`mensajes`, JSON) y el lote procesa ESA copia: un mensaje que entra
-- mientras corre no cambia lo que se esta clasificando. `estado` es como le
-- fue a ese chat en ese lote (pendiente, reutilizada, clasificada, error, o
-- solo_envio en un reintento) y `etiqueta`/`error` el resultado. La copia de
-- los mensajes se vacia (mensajes = null) cuando pasa la retencion del chat
-- (72 h), como los mensajes de la tabla `messages`.
--
-- `chat_etiquetas_catalogo`: los codigos, nombres y descripciones de las
-- etiquetas que usa el negocio. Vacia = el catalogo de fabrica
-- (src/archive/clasificar.ts). `otro` esta siempre.
--
-- Ver src/chat/etiquetar.ts y src/db/chat-etiquetas.ts.

create table if not exists `chat_etiquetas_lote_chats` (
  `lote_id` char(36) not null,
  `phone` varchar(40) not null,
  `dia` date not null,
  `nombre` varchar(191) null,
  `huella` char(64) not null,
  `total_mensajes` int not null default 0,
  `mensajes` json null,
  `estado` varchar(20) not null default 'pendiente',
  `etiqueta` varchar(60) null,
  `error` varchar(500) null,
  `procesado_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`lote_id`, `phone`),
  key `chat_etiquetas_lote_chats_phone_idx` (`phone`, `dia`),
  key `chat_etiquetas_lote_chats_creado_idx` (`created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `chat_etiquetas_catalogo` (
  `codigo` varchar(60) not null,
  `nombre` varchar(60) not null,
  `descripcion` varchar(200) not null,
  `orden` int not null default 0,
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`codigo`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
