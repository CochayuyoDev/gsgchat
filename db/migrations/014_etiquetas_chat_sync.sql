-- La sincronizacion de las etiquetas de Chats con GSG, sus lotes y su registro.
--
-- Cada conversacion etiquetada (chat_etiquetas, migracion 013) lleva ahora el
-- estado de su envio a GSG: se identifica por el numero de WhatsApp, no por
-- un tracking. `sync_huella` es la huella que se mando: si la conversacion se
-- vuelve a clasificar, la nueva etiqueta queda pendiente de enviar. Reintentar
-- un envio fallido manda la etiqueta guardada: no vuelve a pasar por la IA.
--
-- `chat_etiquetas_lotes`: cada pulsacion de «Etiquetar» (analisis + envio) y
-- cada reintento de los envios fallidos, con su estado y sus cifras.
-- `chat_etiquetas_eventos`: lo que paso en cada lote (inicio, fin, fallos de
-- la IA, rechazos de GSG...), para seguir el flujo y saber por que fallo algo.
-- Nunca guarda la API Key de GSG ni el texto de los mensajes.
--
-- Ver src/chat/etiquetar.ts y src/db/chat-etiquetas.ts.

alter table chat_etiquetas
  add column `lote_id` char(36) null,
  add column `sync_estado` varchar(20) not null default 'pendiente',
  add column `sync_intentos` int not null default 0,
  add column `sync_error` varchar(500) null,
  add column `sync_at` datetime(3) null,
  add column `sync_huella` char(64) null,
  add index `chat_etiquetas_sync_idx` (`sync_estado`, `dia`);

create table if not exists `chat_etiquetas_lotes` (
  `id` char(36) not null,
  `dia` date not null,
  `tipo` varchar(20) not null,
  `estado` varchar(30) not null,
  `total` int not null default 0,
  `reutilizadas` int not null default 0,
  `clasificadas` int not null default 0,
  `por_ia` int not null default 0,
  `sin_clasificar` int not null default 0,
  `sync_enviadas` int not null default 0,
  `sync_fallidas` int not null default 0,
  `sync_pendientes` int not null default 0,
  `error` varchar(500) null,
  `iniciado_por` varchar(191) null,
  `empezo_at` datetime(3) not null default current_timestamp(3),
  `termino_at` datetime(3) null,
  primary key (`id`),
  key `chat_etiquetas_lotes_empezo_idx` (`empezo_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `chat_etiquetas_eventos` (
  `id` bigint not null auto_increment,
  `lote_id` char(36) null,
  `phone` varchar(40) null,
  `fase` varchar(20) not null,
  `nivel` varchar(10) not null,
  `codigo` varchar(60) not null,
  `detalle` varchar(500) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  key `chat_etiquetas_eventos_lote_idx` (`lote_id`, `id`),
  key `chat_etiquetas_eventos_fecha_idx` (`created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
