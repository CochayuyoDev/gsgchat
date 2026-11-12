-- Webhook de estados de rutas (pedido de GSG, 12/11).
--
-- El sistema de rutas de GSG avisa cuando una ruta cambia de estado. Si pasa a
-- inactiva o finalizada, los chats de sus clientes se cierran: no sale ningun
-- mensaje mas (ni automatico ni a mano) y no se gasta. Si vuelve a estar en
-- ruta / activa (o cualquier otro estado), se vuelven a abrir solos.
--
-- La «ruta» es SOLO el codigo de ruta que GSG manda en cada pedido (campo
-- `ruta` de la API 1). Ver src/rutas-gsg. Se puede repetir sin riesgo.

-- El ultimo estado conocido de cada ruta (lo que dijo el webhook).
create table if not exists `rutas_gsg_estado` (
  `ruta` varchar(160) not null,
  `estado` varchar(60) not null,
  `activa` tinyint(1) not null default 1,
  `cambiado_at` datetime(3) not null,
  `recibido_at` datetime(3) not null,
  primary key (`ruta`),
  key `rutas_gsg_estado_activa_idx` (`activa`, `recibido_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

-- El «indicador de estado» de cada chat: una fila por chat y ruta que lo
-- cierra. El chat esta cerrado mientras tenga alguna fila; cuando su ruta
-- vuelve a estar activa, se borra la suya.
create table if not exists `chats_bloqueo_ruta` (
  `contact_id` char(36) not null,
  `ruta` varchar(160) not null,
  `estado` varchar(60) not null,
  `desde` datetime(3) not null,
  primary key (`contact_id`, `ruta`),
  key `chats_bloqueo_ruta_ruta_idx` (`ruta`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

-- Bitacora de lo que llego por el webhook y que se hizo con cada aviso.
create table if not exists `rutas_webhook_eventos` (
  `id` bigint not null auto_increment,
  `recibido_at` datetime(3) not null,
  `ruta` varchar(160) null,
  `estado` varchar(60) null,
  `cambiado_at` datetime(3) null,
  `resultado` varchar(30) not null,
  `detalle` longtext null,
  `chats` int not null default 0,
  `prueba` tinyint(1) not null default 0,
  primary key (`id`),
  key `rutas_webhook_eventos_recibido_idx` (`recibido_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

-- El secreto del header x-webhook-secret: solo su huella (sha-256) y los
-- ultimos 4 caracteres para reconocerlo. El secreto completo se ve una vez.
create table if not exists `rutas_webhook_secreto` (
  `id` tinyint not null,
  `hash` char(64) not null,
  `ultimos` varchar(8) not null,
  `creado_at` datetime(3) not null,
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
