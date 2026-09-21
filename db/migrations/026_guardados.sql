-- Conversaciones guardadas: lo que hace falta para que sean un modulo de
-- verdad y no un fichero en una carpeta (ver src/archive y /guardados).
--
--  - texto_busqueda: el texto de los mensajes, plano y recortado, para poder
--    buscar DENTRO de lo guardado ("reclamo", "no llego") sin abrir los ficheros.
--  - resumen y etiquetas: lo que la IA entendio de la conversacion al
--    guardarla (que pidio, que se resolvio, que quedo pendiente) y sus
--    etiquetas (entrega, reclamo, consulta, venta, cancelacion...).
--  - pedido: la referencia del pedido de GSG al que pertenece, si la habia.
--  - notas: lo que apunta una persona ("se quejo del motorizado").
--  - cerrado_por: quien la cerro (una cuenta, "inactividad", "entrega").
--  - deleted_at: la papelera. Borrar una conversacion guardada la deja 30
--    dias aqui antes de borrar el fichero de verdad.
alter table chat_archives add column if not exists texto_busqueda text;
alter table chat_archives add column if not exists resumen text;
alter table chat_archives add column if not exists etiquetas jsonb not null default '[]'::jsonb;
alter table chat_archives add column if not exists pedido text;
alter table chat_archives add column if not exists notas text;
alter table chat_archives add column if not exists cerrado_por text;
alter table chat_archives add column if not exists deleted_at timestamptz;

create index if not exists chat_archives_pedido_idx on chat_archives (pedido);
create index if not exists chat_archives_deleted_idx on chat_archives (deleted_at);
