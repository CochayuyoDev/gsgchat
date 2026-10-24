-- Los mensajes que un usuario de GSG escribe a un cliente (POST /api/v1/chat).
--
-- GSG manda el tracking, el texto y el id que GSG le puso a ese mensaje
-- (`id_externo`). GSGchat lo envia por WhatsApp al numero de ese pedido y
-- apunta aqui quien lo escribio (usuario de GSG y su rol en ese momento) y
-- con que id: si GSG reintenta el mismo mensaje, el id ya esta y no se vuelve
-- a mandar al cliente. Ver src/db/mensajes-gsg.ts.
--
-- Una tabla aparte: la tabla `messages` no cambia. Se puede repetir sin riesgo.

create table if not exists `mensajes_gsg` (
  `id_externo` varchar(191) not null,
  `tracking` varchar(191) not null,
  `usuario_id` varchar(191) not null,
  `usuario_nombre` varchar(191) null,
  `rol` varchar(60) null,
  `phone` varchar(40) not null,
  `wamid` varchar(191) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  primary key (`id_externo`),
  key `mensajes_gsg_tracking_idx` (`tracking`, `created_at`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
