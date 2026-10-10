-- Conversaciones guardadas, segunda tanda (ver src/archive y /guardados).
--
--  - adjuntos: las fotos, audios y documentos que se copiaron junto al
--    respaldo, con su tipo y tamano: [{id, kind, mimeType, bytes, nombre}].
--    Lo que no se pudo copiar (no estaba, era muy grande) queda anotado con
--    `omitido` para que la pantalla lo diga en vez de ensenar un hueco.
--  - primera_respuesta_seg: cuantos segundos tardo una persona del negocio en
--    contestar el primer mensaje del cliente. Es la cifra de las estadisticas.
--  - origen: de donde salio el respaldo cuando no salio del chat vivo
--    (null = del chat; 'importado_txt' = un .txt exportado del telefono).
alter table chat_archives add column if not exists adjuntos jsonb not null default '[]'::jsonb;
alter table chat_archives add column if not exists primera_respuesta_seg integer;
alter table chat_archives add column if not exists origen text;
