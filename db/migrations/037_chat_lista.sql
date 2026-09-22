-- La conversacion tal como se ve en la lista de chats: fijada arriba,
-- silenciada o apartada. Son ajustes de quien atiende, no del cliente, y por
-- eso viven en `contacts` junto a `chat_read_at` (el puntero de lectura) y no
-- en una tabla aparte: hay uno por conversacion, nunca mas.
--
-- Ojo con las palabras: aqui "archivar" ya significa otra cosa (guardar el
-- hilo en `chat_archives` y vaciarlo). Lo de la lista se llama APARTAR, que
-- es lo que hace: quita el chat de la vista sin tocar ni un mensaje.

-- Fijado arriba del todo. Guarda CUANDO se fijo para poder ordenar entre
-- varios fijados: el ultimo que fijaste es el que mas te importa ahora.
alter table contacts add column if not exists chat_fijado_at timestamptz;
-- Silenciado: sigue contando los no leidos, pero no grita (sin negrita ni
-- globo de color). No se le deja de escribir ni de guardar nada.
alter table contacts add column if not exists chat_silenciado_at timestamptz;
-- Apartado de la lista: no sale en "Todos", sale en su propio filtro y vuelve
-- solo en cuanto el cliente escribe (eso lo decide la consulta, no la columna).
alter table contacts add column if not exists chat_apartado_at timestamptz;

-- La lista ordena por fijado y luego por el ultimo mensaje. Sin este indice
-- parcial, los fijados obligaban a recorrer toda la libreta en cada refresco.
create index if not exists contacts_chat_fijado_idx on contacts (chat_fijado_at desc) where chat_fijado_at is not null;
