-- El ultimo seguimiento que GSG empujo de cada tracking (POST /api/v1/seguimiento).
-- GSGchat nunca se lo pide: solo guarda lo que llega y lo valida al leerlo
-- (ver src/entregas/seguimiento-recibido.ts). `create table if not exists`
-- deja repetirla sin dano si se corto a medias.

create table if not exists `seguimientos_gsg` (
  `tracking` varchar(191) not null,
  `cuerpo` json not null,
  `recibido_at` datetime(3) not null,
  primary key (`tracking`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
