-- Reparto de clientes entre lineas de WhatsApp y registro de cada cambio.
--
-- Un cliente se queda con su linea. `linea_asignada_at` dice desde cuando: sirve
-- para repartir (cuantos clientes nuevos recibio hoy cada linea) y para que un
-- mensaje viejo (el historial que llega al vincular un numero) no le cambie la
-- linea a nadie. `contacto_linea_cambios` guarda por que se movio cada cliente.

set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'contacts' and column_name = 'linea_asignada_at') = 0, 'alter table contacts add column linea_asignada_at datetime(3) null', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;

set @linea_ddl = if((select count(*) from information_schema.statistics where table_schema = database() and table_name = 'contacts' and index_name = 'contacts_linea_idx') = 0, 'alter table contacts add key contacts_linea_idx (whatsapp_number_id, linea_asignada_at)', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;

create table if not exists `contacto_linea_cambios` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `desde_linea_id` char(36) null,
  `desde_etiqueta` varchar(80) null,
  `a_linea_id` char(36) not null,
  `a_etiqueta` varchar(80) null,
  `motivo` varchar(30) not null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  key `contacto_linea_cambios_contacto_idx` (`contact_id`, `created_at`),
  key `contacto_linea_cambios_fecha_idx` (`created_at`),
  constraint `contacto_linea_cambios_contact_fkey` foreign key (`contact_id`) references contacts (`id`) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

-- Los clientes de antes siguen por donde se les venia escribiendo: la linea de
-- su ultimo mensaje o, si sus mensajes son anteriores a las lineas, la principal.
-- Sin esto, al agregar una linea nueva les tocaria un numero que no conocen.
update contacts c
   set c.whatsapp_number_id = (select m.whatsapp_number_id from messages m where m.contact_id = c.id and m.whatsapp_number_id is not null order by m.created_at desc, m.id desc limit 1)
 where c.whatsapp_number_id is null
   and exists (select 1 from messages m where m.contact_id = c.id and m.whatsapp_number_id is not null);

update contacts c
   set c.whatsapp_number_id = '00000000-0000-0000-0000-000000000001'
 where c.whatsapp_number_id is null
   and (c.last_inbound_at is not null or c.primer_envio_at is not null or c.ultimo_envio_at is not null
        or exists (select 1 from messages m where m.contact_id = c.id));

-- La fecha es la de su ultimo contacto, no la de hoy: no son clientes nuevos de hoy.
update contacts
   set linea_asignada_at = greatest(coalesce(ultimo_envio_at, created_at), coalesce(last_inbound_at, created_at))
 where whatsapp_number_id is not null and linea_asignada_at is null;
