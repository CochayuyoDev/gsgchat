-- Varias lineas de WhatsApp por tienda (hasta 8).
--
-- Es aditiva: no toca nada de lo que ya funciona. La conexion de hoy (la que
-- vive en `settings`) queda registrada como la linea PRINCIPAL; sus
-- credenciales siguen en `settings` y por eso su columna `credentials` va
-- vacia. Los mensajes y envios viejos se quedan con `whatsapp_number_id` en
-- null, que se lee como «la principal».
--
-- `linea_etiqueta` y `linea_numero` del mensaje son una copia de lo que decia
-- la linea al usarse: renombrarla despues no reescribe el historial.

create table if not exists `whatsapp_numbers` (
  `id` char(36) not null,
  `label` varchar(80) not null,
  `phone` varchar(40) not null default '',
  `provider` varchar(20) not null default 'local',
  `external_id` varchar(191) null,
  `status` varchar(20) not null default 'desconectado',
  `is_primary` tinyint(1) not null default 0,
  `enabled` tinyint(1) not null default 1,
  `credentials` longtext null,
  `position` int not null default 0,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  key `whatsapp_numbers_external_idx` (`provider`, `external_id`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

insert ignore into `whatsapp_numbers` (`id`, `label`, `provider`, `is_primary`, `position`)
values ('00000000-0000-0000-0000-000000000001', 'Principal', 'local', 1, 0);

set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'messages' and column_name = 'whatsapp_number_id') = 0, 'alter table messages add column whatsapp_number_id char(36) null', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;
set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'messages' and column_name = 'linea_etiqueta') = 0, 'alter table messages add column linea_etiqueta varchar(80) null', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;
set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'messages' and column_name = 'linea_numero') = 0, 'alter table messages add column linea_numero varchar(40) null', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;
set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'deliveries' and column_name = 'whatsapp_number_id') = 0, 'alter table deliveries add column whatsapp_number_id char(36) null', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;
