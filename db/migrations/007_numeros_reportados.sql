-- Los numeros (y trackings) que GSGchat le reporta a GSG por estar mal:
-- telefono invalido, sin WhatsApp, envio fallido, tracking que falta, no
-- vale, se repite o es de otro pedido, telefono de un motorizado, o el
-- cliente que dice «no soy yo». Ver src/entregas/reportados.ts.
--
-- Una fila por tracking + error: se reporta UNA vez (no en cada reintento ni
-- en cada pasada del motor). `clave` es el tracking (o, sin tracking, la
-- referencia o el telefono tal como llego). Cuando GSG lo corrige pasa a
-- `corregido`; si el mismo error vuelve despues, la fila se reabre y se
-- reporta otra vez.
--
--   estado: pendiente | corregido
--   pedido: el pedido tal como lo mando GSG (para crearlo al corregirlo si
--           no se llego a guardar: telefono invalido, de un motorizado...)
--
-- `create table if not exists` deja repetirla sin dano si se corto a medias.

create table if not exists `numeros_reportados` (
  `id` bigint not null auto_increment,
  `clave` varchar(191) not null,
  `error` varchar(40) not null,
  `dia` date not null,
  `tracking` varchar(191) null,
  `referencia` varchar(191) null,
  `telefono` varchar(191) null,
  `mensaje` varchar(500) not null,
  `detalle` varchar(500) null,
  `entrega_id` bigint null,
  `pedido` json null,
  `estado` varchar(20) not null default 'pendiente',
  `reportado_at` datetime(3) not null,
  `corregido_at` datetime(3) null,
  `correccion` json null,
  `veces` int not null default 1,
  primary key (`id`),
  unique key `numeros_reportados_clave_error_key` (`clave`, `error`),
  key `numeros_reportados_estado_idx` (`estado`, `reportado_at`),
  key `numeros_reportados_dia_idx` (`dia`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
