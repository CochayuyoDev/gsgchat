-- La linea de WhatsApp con la que se lleva la conversacion de cada cliente.
--
-- El chat es temporal (los mensajes caducan), pero el flujo con un cliente
-- sigue despues: si empezo por una linea, tiene que seguir y terminar por esa
-- misma linea. Por eso la linea se recuerda en el contacto y no solo en los
-- mensajes. Null = la principal.

set @linea_ddl = if((select count(*) from information_schema.columns where table_schema = database() and table_name = 'contacts' and column_name = 'whatsapp_number_id') = 0, 'alter table contacts add column whatsapp_number_id char(36) null', 'select 1');
prepare linea_stmt from @linea_ddl;
execute linea_stmt;
deallocate prepare linea_stmt;
