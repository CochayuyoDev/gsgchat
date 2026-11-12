-- Maximo de mensajes por dia de cada linea de WhatsApp, su consumo diario y la
-- reserva de cupo de cada envio.
--
-- `daily_limit` 0 = sin limite. El dia es el de America/Lima (lo calcula el
-- backend y llega ya como fecha en `dia`): a las 00:00 de Lima empieza un
-- contador nuevo sin borrar nada.
--
-- `whatsapp_number_uso` lleva cuantos mensajes aceptados o reservados tiene cada
-- linea ese dia; la reserva es un UPDATE condicionado (usados < limite), asi que
-- dos envios a la vez no pueden pasar del tope.
--
-- `whatsapp_number_reservas` es una fila por envio (clave de idempotencia):
-- reservado -> aceptado | liberado | incierto. Guarda la linea usada y por que
-- se eligio (asignacion_original, limite_alcanzado, original_no_disponible).

set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'whatsapp_numbers' and column_name = 'daily_limit') = 0, 'alter table whatsapp_numbers add column daily_limit int not null default 0', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;

create table if not exists `whatsapp_number_uso` (
  `linea_id` char(36) not null,
  `dia` date not null,
  `usados` int not null default 0,
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`linea_id`, `dia`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

create table if not exists `whatsapp_number_reservas` (
  `clave` varchar(200) not null,
  `linea_id` char(36) null,
  `dia` date null,
  `estado` varchar(12) not null,
  `motivo` varchar(30) null,
  `contact_id` char(36) null,
  `delivery_id` bigint null,
  `wamid` varchar(191) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`clave`),
  key `whatsapp_number_reservas_linea_idx` (`linea_id`, `dia`, `estado`),
  key `whatsapp_number_reservas_fecha_idx` (`created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'deliveries' and column_name = 'linea_motivo') = 0, 'alter table deliveries add column linea_motivo varchar(30) null', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;
