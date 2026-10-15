-- La limpieza diaria avanza por fecha en lotes, sin recorrer toda la tabla.
alter table messages add index messages_day_idx (created_at, id);
