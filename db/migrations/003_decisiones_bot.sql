-- Por que respondio (o se callo) el bot en cada turno (ver src/ia/decision.ts).
--
-- Cada turno de un cliente deja una fila: cuantos mensajes junto la rafaga,
-- que intencion se leyo, que dato util traia, como se decidio (reglas, IA,
-- boton o contexto) y que salio. El panel la pinta en el chat como nota
-- interna (el cliente no la ve), para ver por que el bot dijo lo que dijo y
-- corregir la regla sin volver a escribirle al cliente.
--
--   como: reglas | ia | boton | contexto
--
-- Se aplica igual en la base de cada tienda (gsgchat_t_<id>): el migrador
-- recorre las mismas migraciones en cada base. `create table if not exists`
-- deja repetirla sin dano si se corto a medias.

create table if not exists `decisiones_bot` (
  `id` bigint not null auto_increment,
  `contact_id` char(36) not null,
  `phone` varchar(191) not null,
  `mensajes` int not null default 1,
  `intencion` varchar(40) not null,
  `dato` varchar(200) null,
  `respuesta` varchar(200) not null,
  `como` varchar(20) not null,
  `esperaba` varchar(60) null,
  `detalle` varchar(500) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  constraint `decisiones_bot_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES contacts(`id`) on delete cascade,
  primary key (`id`),
  key `decisiones_bot_contact_idx` (`contact_id`, `created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
