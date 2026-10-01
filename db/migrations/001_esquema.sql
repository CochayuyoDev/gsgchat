-- Esquema de GSGchat para MySQL 8 / MariaDB 10.4+.
-- Generado a partir de las 43 migraciones de Postgres; desde aqui, las nuevas van en ficheros aparte.
set foreign_key_checks = 0;

create table if not exists `actividad` (
  `id` bigint not null auto_increment,
  `at` datetime(3) not null default current_timestamp(3),
  `usuario_id` longtext null,
  `usuario` longtext not null,
  `accion` varchar(191) not null,
  `detalle` json null,
  `ip` longtext null,
  primary key (`id`),
  key `actividad_accion_idx` (`accion`, `at` desc),
  key `actividad_at_idx` (`at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `auto_replies` (
  `id` char(36) not null default (uuid()),
  `name` longtext not null,
  `trigger` longtext not null default ('keyword'),
  `keyword` longtext null,
  `match` longtext not null default ('contains'),
  `reply` longtext null,
  `sequence_id` char(36) null,
  `enabled` tinyint(1) not null default 1,
  `priority` int not null default 100,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  constraint `auto_replies_sequence_id_fkey` FOREIGN KEY (`sequence_id`) REFERENCES sequences(`id`) on delete set null
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `campaign_recipients` (
  `id` bigint not null auto_increment,
  `campaign_id` char(36) not null,
  `phone` varchar(191) not null,
  `variables` json null,
  `estado` varchar(191) not null default 'pendiente',
  `orden` int not null default 0,
  `canario` tinyint(1) not null default 0,
  `delivery_id` bigint null,
  `detalle` longtext null,
  `posponer_hasta` datetime(3) null,
  `intentos` int not null default 0,
  `enviado_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `campaign_recipients_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES campaigns(`id`) on delete cascade,
  unique key `campaign_recipients_campaign_id_phone_key` (`campaign_id`, `phone`),
  primary key (`id`),
  key `campaign_recipients_pend_idx` (`campaign_id`, `estado`, `orden`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `campaigns` (
  `id` char(36) not null default (uuid()),
  `name` longtext not null,
  `template_name` longtext not null,
  `template_language` longtext not null default ('es_MX'),
  `category` longtext not null default ('MARKETING'),
  `status` longtext not null default ('draft'),
  `created_at` datetime(3) not null default current_timestamp(3),
  `ritmo_por_hora` int null,
  `canario` int not null default 0,
  `canario_espera_min` int not null default 60,
  `canario_enviado_at` datetime(3) null,
  `motivo_pausa` longtext null,
  `started_at` datetime(3) null,
  `finished_at` datetime(3) null,
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `chat_archives` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `phone` varchar(191) not null,
  `name` longtext null,
  `file` longtext not null,
  `bytes` bigint not null default 0,
  `message_count` int not null default 0,
  `first_message_at` datetime(3) null,
  `last_message_at` datetime(3) null,
  `reason` longtext not null default ('manual'),
  `sha256` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `texto_busqueda` longtext null,
  `resumen` longtext null,
  `etiquetas` json not null default ('[]'),
  `pedido` varchar(191) null,
  `notas` longtext null,
  `cerrado_por` longtext null,
  `deleted_at` datetime(3) null,
  `adjuntos` json not null default ('[]'),
  `primera_respuesta_seg` int null,
  `origen` longtext null,
  constraint `chat_archives_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  primary key (`id`),
  key `chat_archives_contact_idx` (`contact_id`, `created_at` desc),
  key `chat_archives_created_idx` (`created_at` desc),
  key `chat_archives_deleted_idx` (`deleted_at`),
  key `chat_archives_pedido_idx` (`pedido`),
  key `chat_archives_phone_idx` (`phone`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `claves_api` (
  `id` char(36) not null default (uuid()),
  `nombre` longtext not null,
  `prefijo` longtext not null,
  `hash` varchar(191) not null,
  `creada_por` char(36) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `ultimo_uso_at` datetime(3) null,
  `revocada_at` datetime(3) null,
  `permisos` json not null default ('["*"]'),
  constraint `claves_api_creada_por_fkey` FOREIGN KEY (`creada_por`) REFERENCES usuarios(`id`) on delete set null,
  unique key `claves_api_hash_key` (`hash`),
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `codigos_conexion` (
  `id` char(36) not null default (uuid()),
  `codigo` varchar(191) not null,
  `para` longtext not null,
  `permisos` json not null default ('["*"]'),
  `caduca_at` datetime(3) not null,
  `usos_max` int not null default 1,
  `usos` int not null default 0,
  `estado` varchar(191) not null default 'activo',
  `creado_por` longtext null,
  `canjeado_por` longtext null,
  `canjeado_desde` longtext null,
  `canjeado_at` datetime(3) null,
  `clave_id` char(36) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  unique key `codigos_conexion_codigo_key` (`codigo`),
  primary key (`id`),
  key `codigos_conexion_vivos_idx` (`estado`, `caduca_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `conector_entradas` (
  `id` bigint not null auto_increment,
  `conector_id` char(36) not null,
  `evento` longtext not null,
  `evento_origen` longtext null,
  `pedido` longtext null,
  `telefono` longtext null,
  `resultado` longtext not null,
  `detalle` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `conector_entradas_conector_id_fkey` FOREIGN KEY (`conector_id`) REFERENCES conectores(`id`) on delete cascade,
  primary key (`id`),
  key `conector_entradas_por_conector_idx` (`conector_id`, `id` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `conectores` (
  `id` char(36) not null default (uuid()),
  `tipo` longtext not null,
  `nombre` longtext not null,
  `secreto` longtext not null,
  `activo` tinyint(1) not null default 1,
  `reglas` json not null default ('[]'),
  `creado_por` char(36) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `ultimo_evento_at` datetime(3) null,
  `eventos_recibidos` int not null default 0,
  constraint `conectores_creado_por_fkey` FOREIGN KEY (`creado_por`) REFERENCES usuarios(`id`) on delete set null,
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `contacts` (
  `id` char(36) not null default (uuid()),
  `phone` varchar(191) not null,
  `name` longtext null,
  `opt_in_at` datetime(3) null,
  `opt_in_source` longtext null,
  `opt_out_at` datetime(3) null,
  `last_inbound_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `chat_read_at` datetime(3) null,
  `suprimido_hasta` datetime(3) null,
  `suprimido_motivo` longtext null,
  `suprimido_ambito` longtext null,
  `sin_respuesta_seguidas` int not null default 0,
  `ultimo_envio_at` datetime(3) null,
  `envios_iniciados` int not null default 0,
  `primer_envio_at` datetime(3) null,
  `bot_pausado_at` datetime(3) null,
  `tipo` varchar(191) not null default 'persona',
  `chat_fijado_at` datetime(3) null,
  `chat_silenciado_at` datetime(3) null,
  `chat_apartado_at` datetime(3) null,
  `ia_cerrada_at` datetime(3) null,
  `ia_cerrada_motivo` longtext null,
  unique key `contacts_phone_key` (`phone`),
  primary key (`id`),
  -- en Postgres era parcial: WHERE (chat_fijado_at IS NOT NULL)
  key `contacts_chat_fijado_idx` (`chat_fijado_at` desc),
  -- en Postgres era parcial: WHERE (suprimido_hasta IS NOT NULL)
  key `contacts_suprimido_idx` (`suprimido_hasta`),
  key `contacts_tipo_idx` (`tipo`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `deliveries` (
  `id` bigint not null auto_increment,
  `campaign_id` char(36) null,
  `contact_id` char(36) not null,
  `wamid` varchar(191) null,
  `kind` longtext not null,
  `template_name` longtext null,
  `category` varchar(191) not null default 'UTILITY',
  `status` varchar(191) not null default 'queued',
  `error_code` longtext null,
  `error_title` longtext null,
  `variables` json null,
  `queued_at` datetime(3) not null default current_timestamp(3),
  `sent_at` datetime(3) null,
  `delivered_at` datetime(3) null,
  `read_at` datetime(3) null,
  `failed_at` datetime(3) null,
  `business_initiated` tinyint(1) not null default 0,
  constraint `deliveries_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES campaigns(`id`) on delete cascade,
  constraint `deliveries_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  primary key (`id`),
  unique key `deliveries_wamid_key` (`wamid`),
  -- en Postgres era parcial: WHERE business_initiated
  key `deliveries_bi_idx` (`business_initiated`, `sent_at` desc),
  key `deliveries_campaign_idx` (`campaign_id`, `status`),
  key `deliveries_contact_idx` (`contact_id`, `queued_at` desc),
  key `deliveries_marketing_idx` (`contact_id`, `category`, `queued_at` desc),
  -- en Postgres era parcial: WHERE (sent_at IS NOT NULL)
  key `deliveries_sent_idx` (`sent_at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `enrollments` (
  `id` char(36) not null default (uuid()),
  `sequence_id` char(36) not null,
  `contact_id` char(36) not null,
  `status` varchar(191) not null default 'active',
  `current_step` int not null default 0,
  `source` longtext null,
  `started_at` datetime(3) not null default current_timestamp(3),
  `finished_at` datetime(3) null,
  constraint `enrollments_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  primary key (`id`),
  constraint `enrollments_sequence_id_fkey` FOREIGN KEY (`sequence_id`) REFERENCES sequences(`id`) on delete cascade,
  key `enrollments_contact_idx` (`contact_id`, `status`),
  key `enrollments_sequence_idx` (`sequence_id`, `status`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `entregas` (
  `id` bigint not null auto_increment,
  `dia` date not null,
  `referencia` varchar(191) not null,
  `externo_id` longtext null,
  `phone` varchar(191) not null,
  `nombre` longtext null,
  `direccion` longtext null,
  `distrito` longtext null,
  `notas` longtext null,
  `ubicacion_estado` longtext not null default ('pendiente'),
  `lote_id` longtext null,
  `lat` double null,
  `lng` double null,
  `maps_url` longtext null,
  `ubicacion_fuente` longtext null,
  `ubicacion_at` datetime(3) null,
  `confirmacion_estado` longtext not null default ('pendiente'),
  `confirmacion_intentos` int not null default 0,
  `confirmacion_pedida_at` datetime(3) null,
  `confirmacion_proximo_at` datetime(3) null,
  `confirmacion_at` datetime(3) null,
  `confirmacion_respuesta` longtext null,
  `confirmacion_como` longtext null,
  `motorizado_id` bigint null,
  `motorizado_estado` varchar(191) not null default 'sin_asignar',
  `motorizado_intentos` int not null default 0,
  `motorizado_enviado_at` datetime(3) null,
  `motorizado_proximo_at` datetime(3) null,
  `motorizado_respuesta` longtext null,
  `motorizado_respondio_at` datetime(3) null,
  `minutos_motorizado` int null,
  `minutos_aviso` int null,
  `llega_aprox_at` datetime(3) null,
  `aviso_enviado_at` datetime(3) null,
  `motorizados_descartados` json not null default ('[]'),
  `estado` varchar(191) not null default 'pendiente',
  `incidencia` longtext null,
  `incidencia_detalle` longtext null,
  `requiere_humano` tinyint(1) not null default 0,
  `terminada_gsg_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  `entregada_at` datetime(3) null,
  `entregada_como` longtext null,
  `entregada_respuesta` longtext null,
  `cerrada_por_dia` tinyint(1) not null default 0,
  `prioridad` longtext not null default ('normal'),
  `visitas` int not null default 0,
  `segunda_visita` tinyint(1) not null default 0,
  `segunda_visita_pedida_at` datetime(3) null,
  `segunda_visita_vence_at` datetime(3) null,
  `cerca_avisado_at` datetime(3) null,
  `ubicacion_propuesta_at` datetime(3) null,
  `ubicacion_propuesta_lat` double null,
  `ubicacion_propuesta_lng` double null,
  `motorizado_tiempo_dudoso_at` datetime(3) null,
  `motorizado_tiempo_dudoso_min` int null,
  `contactado_at` datetime(3) null,
  `contactado_por` longtext null,
  `mensajes_pausados_at` datetime(3) null,
  `datos_envio` json null,
  `envio_retenido_at` datetime(3) null,
  `envio_liberado_at` datetime(3) null,
  `motorizado_sin_ubicacion_at` datetime(3) null,
  `pin_propuesto_lat` double null,
  `pin_propuesto_lng` double null,
  `pin_propuesto_at` datetime(3) null,
  `pin_propuesto_fuente` longtext null,
  `pin_propuesto_dudas` int not null default 0,
  `direccion_cliente` longtext null,
  `direccion_cliente_at` datetime(3) null,
  unique key `entregas_dia_referencia_key` (`dia`, `referencia`),
  constraint `entregas_motorizado_id_fkey` FOREIGN KEY (`motorizado_id`) REFERENCES motorizados(`id`) on delete set null,
  primary key (`id`),
  -- en Postgres era parcial: WHERE (envio_retenido_at IS NOT NULL)
  key `entregas_envio_retenido_idx` (`dia`),
  key `entregas_estado_idx` (`dia` desc, `estado`),
  key `entregas_motorizado_idx` (`motorizado_id`, `motorizado_estado`),
  -- en Postgres era parcial: WHERE (mensajes_pausados_at IS NOT NULL)
  key `entregas_pausadas_idx` (`phone`),
  key `entregas_phone_idx` (`phone`, `dia` desc),
  -- en Postgres era parcial: WHERE ((estado = 'entregada'::text) AND (llega_aprox_at IS NOT NULL))
  key `entregas_puntualidad_idx` (`motorizado_id`, `entregada_at`),
  -- en Postgres era parcial: WHERE (prioridad = 'urgente'::text)
  key `entregas_urgentes_idx` (`dia`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `entregas_eventos` (
  `id` bigint not null auto_increment,
  `entrega_id` bigint not null,
  `tipo` longtext not null,
  `detalle` longtext null,
  `payload` json null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `entregas_eventos_entrega_id_fkey` FOREIGN KEY (`entrega_id`) REFERENCES entregas(`id`) on delete cascade,
  primary key (`id`),
  key `entregas_eventos_idx` (`entrega_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `envio_automatico` (
  `id` bigint not null auto_increment,
  `phone` varchar(191) not null,
  `nombre` longtext null,
  `que` longtext not null default ('ubicacion'),
  `texto` longtext null,
  `hasta` longtext not null default ('ubicacion'),
  `referencia` longtext null,
  `origen` longtext not null,
  `origen_detalle` longtext null,
  `estado` varchar(191) not null default 'activo',
  `enviados` int not null default 0,
  `max_envios` int null,
  `respondio_at` datetime(3) null,
  `ultimo_envio_at` datetime(3) null,
  `proximo_envio_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  unique key `envio_automatico_phone_key` (`phone`),
  primary key (`id`),
  key `envio_automatico_turno_idx` (`estado`, `proximo_envio_at`, `created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `envio_automatico_movimientos` (
  `id` bigint not null auto_increment,
  `phone` longtext not null,
  `nombre` longtext null,
  `tipo` longtext not null,
  `motivo` longtext null,
  `origen` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  key `envio_automatico_movimientos_recientes_idx` (`id` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `geocodificacion_cache` (
  `consulta` varchar(191) not null,
  `encontrado` tinyint(1) not null,
  `lat` double null,
  `lng` double null,
  `precision` longtext null,
  `distrito` longtext null,
  `texto` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`consulta`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `ia_examen_casos` (
  `id` bigint not null auto_increment,
  `examen_id` bigint not null,
  `leccion_id` bigint null,
  `pregunta` longtext not null,
  `esperada` longtext not null,
  `respuesta` longtext null,
  `ok` tinyint(1) not null default 0,
  `motivos` json null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `ia_examen_casos_examen_id_fkey` FOREIGN KEY (`examen_id`) REFERENCES ia_examenes(`id`) on delete cascade,
  constraint `ia_examen_casos_leccion_id_fkey` FOREIGN KEY (`leccion_id`) REFERENCES ia_lecciones(`id`) on delete set null,
  primary key (`id`),
  key `ia_examen_casos_examen_idx` (`examen_id`, `ok`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `ia_examenes` (
  `id` bigint not null auto_increment,
  `nombre` longtext null,
  `total` int not null default 0,
  `aprobados` int not null default 0,
  `fallados` int not null default 0,
  `errores` int not null default 0,
  `estado` longtext not null default ('corriendo'),
  `detalle` json null,
  `creado_por` longtext null,
  `empezado_at` datetime(3) not null default current_timestamp(3),
  `terminado_at` datetime(3) null,
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `ia_lecciones` (
  `id` bigint not null auto_increment,
  `tipo` varchar(191) not null default 'ejemplo',
  `pregunta` longtext null,
  `respuesta` longtext not null,
  `mala` longtext null,
  `tema` varchar(191) null,
  `origen` varchar(191) not null default 'manual',
  `origen_detalle` varchar(191) null,
  `estado` varchar(191) not null default 'activa',
  `huella` varchar(191) not null,
  `usos` int not null default 0,
  `ultimo_uso_at` datetime(3) null,
  `examen_ok` tinyint(1) null,
  `examen_at` datetime(3) null,
  `examen_nota` longtext null,
  `nota` longtext null,
  `creado_por` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  unique key `ia_lecciones_huella_key` (`huella`),
  primary key (`id`),
  key `ia_lecciones_estado_idx` (`estado`, `tipo`, `id` desc),
  key `ia_lecciones_origen_idx` (`origen`, `origen_detalle`),
  key `ia_lecciones_tema_idx` (`tema`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `leads` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `nombre` longtext null,
  `origen` longtext null,
  `recojo_direccion` longtext null,
  `recojo_distrito` longtext null,
  `recojo_referencia` longtext null,
  `recojo_lat` double null,
  `recojo_lng` double null,
  `entrega_direccion` longtext null,
  `entrega_distrito` longtext null,
  `entrega_referencia` longtext null,
  `entrega_lat` double null,
  `entrega_lng` double null,
  `contenido` longtext null,
  `peso_kg` decimal(14,4) null,
  `fragil` tinyint(1) not null default 0,
  `cuando` longtext null,
  `documento_tipo` longtext null,
  `documento_numero` longtext null,
  `razon_social` longtext null,
  `estado` varchar(191) not null default 'nuevo',
  `notas` longtext null,
  `crm_id` longtext null,
  `enviado_at` datetime(3) null,
  `ultimo_error` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  `ultimas_opciones` json null,
  `pregunta_pendiente` longtext null,
  `servicio` longtext null,
  `intentos_fallidos` int not null default 0,
  `ultimo_producto` longtext null,
  constraint `leads_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  unique key `leads_contact_id_key` (`contact_id`),
  primary key (`id`),
  key `leads_estado_idx` (`estado`, `updated_at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `locations` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `lat` double not null,
  `lng` double not null,
  `source` longtext not null,
  `confidence` longtext not null,
  `precision_meters` double not null,
  `raw_input` longtext null,
  `resolved_url` longtext null,
  `confirmed` tinyint(1) not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `locations_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  primary key (`id`),
  key `locations_contact_idx` (`contact_id`, `created_at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `messages` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `direction` varchar(191) not null,
  `wamid` varchar(191) null,
  `kind` longtext not null default ('text'),
  `body` longtext null,
  `payload` json null,
  `status` longtext null,
  `delivery_id` bigint null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `messages_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  primary key (`id`),
  unique key `messages_wamid_key` (`wamid`),
  key `messages_contact_idx` (`contact_id`, `created_at` desc, `id` desc),
  key `messages_unread_idx` (`contact_id`, `direction`, `created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `motorizados` (
  `id` bigint not null auto_increment,
  `phone` varchar(191) not null,
  `nombre` longtext not null,
  `placa` longtext null,
  `zona` longtext null,
  `estado` longtext not null default ('activo'),
  `entregas_hoy` int not null default 0,
  `entregas_hoy_dia` date null,
  `ultimo_encargo_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  `ultima_lat` double null,
  `ultima_lng` double null,
  `ultima_posicion_at` datetime(3) null,
  `enlace_token` varchar(191) null,
  `enlace_vence_at` datetime(3) null,
  unique key `motorizados_phone_key` (`phone`),
  primary key (`id`),
  -- en Postgres era parcial: WHERE (enlace_token IS NOT NULL)
  unique key `motorizados_enlace_token_idx` (`enlace_token`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `number_state` (
  `phone_number_id` varchar(191) not null,
  `quality` longtext not null default ('GREEN'),
  `paused` tinyint(1) not null default 0,
  `paused_reason` longtext null,
  `warmup_started_on` date not null default (curdate()),
  `updated_at` datetime(3) not null default current_timestamp(3),
  `tier` longtext null,
  `estado` longtext not null default ('CONNECTED'),
  `riesgo` int not null default 0,
  `nivel` longtext not null default ('verde'),
  `factor` double not null default 1,
  `motivos` json null,
  `pausada_hasta` datetime(3) null,
  `rampa_desde` datetime(3) null,
  `limite_24h` int null,
  `ultima_evaluacion` datetime(3) null,
  primary key (`phone_number_id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `pedidos_chat` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `estado` varchar(191) not null default 'nuevo',
  `items` json not null default ('[]'),
  `total` decimal(14,4) not null default 0,
  `moneda` longtext not null default ('PEN'),
  `nombre` longtext null,
  `telefono` longtext null,
  `direccion` longtext null,
  `referencia` longtext null,
  `pago` longtext null,
  `notas` longtext null,
  `origen` longtext not null default ('ia'),
  `externo_id` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  constraint `pedidos_chat_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  primary key (`id`),
  key `pedidos_chat_por_contacto_idx` (`contact_id`, `id` desc),
  key `pedidos_chat_por_estado_idx` (`estado`, `id` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `proceso_corridas` (
  `id` bigint not null auto_increment,
  `proceso_id` bigint not null,
  `nombre` longtext not null,
  `estado` longtext not null default ('activa'),
  `origen` longtext not null default ('pegada'),
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  constraint `proceso_corridas_proceso_id_fkey` FOREIGN KEY (`proceso_id`) REFERENCES procesos(`id`) on delete cascade,
  key `proceso_corridas_proceso_idx` (`proceso_id`, `created_at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `proceso_eventos` (
  `id` bigint not null auto_increment,
  `persona_id` bigint not null,
  `tipo` longtext not null,
  `detalle` longtext null,
  `en` datetime(3) not null default current_timestamp(3),
  constraint `proceso_eventos_persona_id_fkey` FOREIGN KEY (`persona_id`) REFERENCES proceso_personas(`id`) on delete cascade,
  primary key (`id`),
  key `proceso_eventos_persona_idx` (`persona_id`, `id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `proceso_personas` (
  `id` bigint not null auto_increment,
  `corrida_id` bigint not null,
  `proceso_id` bigint not null,
  `phone` varchar(191) null,
  `telefono_crudo` longtext not null default (''),
  `nombre` longtext null,
  `datos` json not null default ('{}'),
  `estado` varchar(191) not null default 'pendiente',
  `paso` int not null default 0,
  `intentos` int not null default 0,
  `fallos` int not null default 0,
  `sub` longtext null,
  `proximo_at` datetime(3) null,
  `ultimo_envio_at` datetime(3) null,
  `respuestas` json not null default ('{}'),
  `ultimo` longtext null,
  `motivo` longtext null,
  `pausada` tinyint(1) not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  `terminada_at` datetime(3) null,
  constraint `proceso_personas_corrida_id_fkey` FOREIGN KEY (`corrida_id`) REFERENCES proceso_corridas(`id`) on delete cascade,
  primary key (`id`),
  constraint `proceso_personas_proceso_id_fkey` FOREIGN KEY (`proceso_id`) REFERENCES procesos(`id`) on delete cascade,
  key `proceso_personas_corrida_idx` (`corrida_id`, `id`),
  key `proceso_personas_phone_idx` (`phone`, `updated_at` desc),
  key `proceso_personas_toca_idx` (`estado`, `proximo_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `procesos` (
  `id` bigint not null auto_increment,
  `nombre` longtext not null,
  `plantilla` longtext null,
  `descripcion` longtext not null default (''),
  `pasos` json not null default ('[]'),
  `ritmo` json not null default ('{}'),
  `cierre` json not null default ('{}'),
  `estado` longtext not null default ('activo'),
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `rutas_eventos` (
  `id` bigint not null auto_increment,
  `solicitud_id` bigint not null,
  `tipo` longtext not null,
  `detalle` longtext null,
  `payload` json null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  constraint `rutas_eventos_solicitud_id_fkey` FOREIGN KEY (`solicitud_id`) REFERENCES rutas_solicitudes(`id`) on delete cascade,
  key `rutas_eventos_sol_idx` (`solicitud_id`, `created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `rutas_lotes` (
  `id` char(36) not null default (uuid()),
  `nombre` longtext not null,
  `origen` longtext not null default ('csv'),
  `estado` varchar(191) not null default 'preparado',
  `notas` longtext null,
  `externo_id` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  key `rutas_lotes_estado_idx` (`estado`, `created_at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `rutas_reportes` (
  `id` bigint not null auto_increment,
  `solicitud_id` bigint null,
  `lote_id` char(36) null,
  `tipo` varchar(191) not null,
  `payload` json not null,
  `estado` varchar(191) not null default 'pendiente',
  `intentos` int not null default 0,
  `ultimo_error` longtext null,
  `externo_id` longtext null,
  `enviado_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `rutas_reportes_lote_id_fkey` FOREIGN KEY (`lote_id`) REFERENCES rutas_lotes(`id`) on delete cascade,
  primary key (`id`),
  constraint `rutas_reportes_solicitud_id_fkey` FOREIGN KEY (`solicitud_id`) REFERENCES rutas_solicitudes(`id`) on delete cascade,
  key `rutas_reportes_estado_idx` (`estado`, `created_at`),
  key `rutas_reportes_lote_idx` (`lote_id`, `tipo`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `rutas_solicitudes` (
  `id` bigint not null auto_increment,
  `lote_id` char(36) not null,
  `contact_id` char(36) null,
  `telefono_crudo` longtext not null,
  `phone` varchar(191) null,
  `nombre` longtext null,
  `referencia` longtext null,
  `direccion` longtext null,
  `distrito` longtext null,
  `notas` longtext null,
  `estado` varchar(191) not null default 'pendiente',
  `intentos` int not null default 0,
  `ultimo_envio_at` datetime(3) null,
  `proximo_intento_at` datetime(3) null,
  `primera_respuesta_at` datetime(3) null,
  `resuelto_at` datetime(3) null,
  `lat` double null,
  `lng` double null,
  `precision_m` int null,
  `ubicacion_fuente` longtext null,
  `maps_url` longtext null,
  `incidencia` longtext null,
  `incidencia_detalle` longtext null,
  `requiere_humano` tinyint(1) not null default 0,
  `asignado_a` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  constraint `rutas_solicitudes_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete set null,
  constraint `rutas_solicitudes_lote_id_fkey` FOREIGN KEY (`lote_id`) REFERENCES rutas_lotes(`id`) on delete cascade,
  primary key (`id`),
  key `rutas_sol_contact_idx` (`contact_id`, `estado`),
  key `rutas_sol_lote_idx` (`lote_id`, `estado`),
  key `rutas_sol_pend_idx` (`estado`, `proximo_intento_at`),
  key `rutas_sol_phone_idx` (`phone`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `salud_eventos` (
  `id` bigint not null auto_increment,
  `phone_number_id` varchar(191) not null default '',
  `at` datetime(3) not null default current_timestamp(3),
  `tipo` varchar(191) not null,
  `codigo` longtext null,
  `detalle` longtext null,
  `contact_id` char(36) null,
  `campaign_id` char(36) null,
  `payload` json null,
  constraint `salud_eventos_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES campaigns(`id`) on delete set null,
  constraint `salud_eventos_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete set null,
  primary key (`id`),
  key `salud_eventos_at_idx` (`phone_number_id`, `at` desc),
  key `salud_eventos_tipo_idx` (`tipo`, `at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `scheduled_messages` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `enrollment_id` char(36) null,
  `step_position` int null,
  `due_at` datetime(3) not null,
  `kind` longtext not null,
  `category` longtext not null default ('UTILITY'),
  `template_name` longtext null,
  `template_language` longtext null,
  `variables` json null,
  `text` longtext null,
  `status` varchar(191) not null default 'pending',
  `delivery_id` bigint null,
  `detail` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `processed_at` datetime(3) null,
  constraint `scheduled_messages_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  constraint `scheduled_messages_enrollment_id_fkey` FOREIGN KEY (`enrollment_id`) REFERENCES enrollments(`id`) on delete cascade,
  primary key (`id`),
  key `scheduled_messages_contact_idx` (`contact_id`, `due_at` desc),
  key `scheduled_messages_due_idx` (`status`, `due_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `send_counters` (
  `phone_number_id` varchar(191) not null,
  `day` date not null,
  `category` varchar(191) not null,
  `sent` int not null default 0,
  primary key (`phone_number_id`, `day`, `category`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `sequence_steps` (
  `id` bigint not null auto_increment,
  `sequence_id` char(36) not null,
  `position` int not null,
  `delay_minutes` int not null default 0,
  `kind` longtext not null default ('template'),
  `template_name` longtext null,
  `template_language` longtext not null default ('es_MX'),
  `category` longtext not null default ('UTILITY'),
  `variables` json null,
  `text` longtext null,
  primary key (`id`),
  constraint `sequence_steps_sequence_id_fkey` FOREIGN KEY (`sequence_id`) REFERENCES sequences(`id`) on delete cascade,
  unique key `sequence_steps_sequence_id_position_key` (`sequence_id`, `position`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `sequences` (
  `id` char(36) not null default (uuid()),
  `name` longtext not null,
  `description` longtext null,
  `stop_on_reply` tinyint(1) not null default 1,
  `enabled` tinyint(1) not null default 1,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `settings` (
  `key` varchar(191) not null,
  `value` longtext not null,
  `encrypted` tinyint(1) not null default 0,
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`key`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `stickers` (
  `id` varchar(191) not null,
  `nombre` longtext not null,
  `uso` longtext not null default ('otro'),
  `archivo` varchar(191) not null,
  `bytes` int not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  unique key `stickers_archivo_key` (`archivo`),
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `templates` (
  `name` varchar(191) not null,
  `language` varchar(191) not null,
  `category` longtext not null,
  `status` longtext not null,
  `quality` longtext null,
  `variables` int not null default 0,
  `body` longtext null,
  `synced_at` datetime(3) not null default current_timestamp(3),
  `pausada_hasta` datetime(3) null,
  `pausas` int not null default 0,
  `motivo` longtext null,
  `aprobada_at` datetime(3) null,
  `propia` tinyint(1) not null default 0,
  `variables_doc` json null,
  `footer` longtext null,
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`name`, `language`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `tiendas` (
  `id` char(36) not null default (uuid()),
  `slug` varchar(191) not null,
  `nombre` longtext not null,
  `url` longtext null,
  `contacto` longtext null,
  `notas` longtext null,
  `membresia` json not null,
  `token_hash` longtext not null,
  `token_prefijo` longtext not null,
  `ultima_consulta_at` datetime(3) null,
  `ultima_consulta_ip` longtext null,
  `creado_por` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  `estado` json null,
  `estado_at` datetime(3) null,
  primary key (`id`),
  unique key `tiendas_slug_key` (`slug`),
  key `tiendas_nombre_idx` (`nombre`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `tiendas_avisos` (
  `id` int not null auto_increment,
  `tienda_id` char(36) not null,
  `tipo` varchar(191) not null,
  `at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  constraint `tiendas_avisos_tienda_id_fkey` FOREIGN KEY (`tienda_id`) REFERENCES tiendas(`id`) on delete cascade,
  key `tiendas_avisos_tienda_idx` (`tienda_id`, `tipo`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `tiendas_config` (
  `clave` varchar(191) not null,
  `valor` json not null,
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`clave`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `tiendas_pagos` (
  `id` int not null auto_increment,
  `tienda_id` char(36) not null,
  `meses` int not null default 1,
  `monto` decimal(14,4) null,
  `moneda` longtext null,
  `nota` longtext null,
  `imagen` longtext null,
  `estado` varchar(191) not null default 'pendiente',
  `motivo` longtext null,
  `at` datetime(3) not null default current_timestamp(3),
  `resuelto_at` datetime(3) null,
  `resuelto_por` longtext null,
  primary key (`id`),
  constraint `tiendas_pagos_tienda_id_fkey` FOREIGN KEY (`tienda_id`) REFERENCES tiendas(`id`) on delete cascade,
  key `tiendas_pagos_tienda_idx` (`tienda_id`, `estado`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `track_points` (
  `id` bigint not null auto_increment,
  `link_id` char(36) not null,
  `lat` double not null,
  `lng` double not null,
  `accuracy` double null,
  `heading` double null,
  `speed` double null,
  `recorded_at` datetime(3) not null default current_timestamp(3),
  constraint `track_points_link_id_fkey` FOREIGN KEY (`link_id`) REFERENCES tracking_links(`id`) on delete cascade,
  primary key (`id`),
  key `track_points_link_idx` (`link_id`, `recorded_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `tracking_links` (
  `id` char(36) not null default (uuid()),
  `contact_id` char(36) null,
  `label` longtext null,
  `expires_at` datetime(3) not null,
  `revoked_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `tracking_links_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete set null,
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `usuarios` (
  `id` char(36) not null default (uuid()),
  `usuario` varchar(191) not null,
  `nombre` longtext not null,
  `clave` longtext not null,
  `rol` longtext not null default ('operador'),
  `activo` tinyint(1) not null default 1,
  `sesion_version` int not null default 1,
  `ultimo_login_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  unique key `usuarios_usuario_key` (`usuario`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `webhook_entregas` (
  `id` bigint not null auto_increment,
  `webhook_id` char(36) not null,
  `evento` longtext not null,
  `payload` json not null,
  `estado` longtext not null default ('pendiente'),
  `intentos` int not null default 0,
  `proximo_intento_at` datetime(3) not null default current_timestamp(3),
  `respuesta_codigo` int null,
  `respuesta` longtext null,
  `error` longtext null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `enviada_at` datetime(3) null,
  primary key (`id`),
  constraint `webhook_entregas_webhook_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES webhooks(`id`) on delete cascade,
  -- en Postgres era parcial: WHERE (estado = 'pendiente'::text)
  key `webhook_entregas_pendientes_idx` (`proximo_intento_at`),
  key `webhook_entregas_por_webhook_idx` (`webhook_id`, `created_at` desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `webhooks` (
  `id` char(36) not null default (uuid()),
  `url` longtext not null,
  `descripcion` longtext not null default (''),
  `secreto` longtext not null,
  `eventos` json not null default ('["*"]'),
  `activo` tinyint(1) not null default 1,
  `motivo_pausa` longtext null,
  `creado_por` char(36) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `ultimo_ok_at` datetime(3) null,
  `ultimo_fallo_at` datetime(3) null,
  `fallos_seguidos` int not null default 0,
  constraint `webhooks_creado_por_fkey` FOREIGN KEY (`creado_por`) REFERENCES usuarios(`id`) on delete set null,
  primary key (`id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

set foreign_key_checks = 1;
