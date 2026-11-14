-- Lo que un cliente pide sobre sus propios datos por WhatsApp: que no le
-- escriban mas (BAJA) o que borren sus datos.
--
-- El sistema NO lo ejecuta solo (regla del dueño, 09/11): lo reconoce (reglas
-- o IA), lo apunta aqui, avisa en la campana y en Chats, y una persona lo
-- atiende desde la web (dar de baja, eliminar los datos o descartarlo).
--
-- Cuando se eliminan los datos del cliente, esta fila se queda como constancia
-- de que se cumplio, pero sin el numero completo ni el texto del cliente.
-- Ver src/privacidad. Se puede repetir sin riesgo.

create table if not exists `solicitudes_privacidad` (
  `id` bigint not null auto_increment,
  `phone` varchar(40) not null,
  `contact_id` char(36) null,
  `tipo` varchar(20) not null,
  `texto` varchar(500) null,
  `como` varchar(20) not null default 'reglas',
  `estado` varchar(20) not null default 'pendiente',
  `atendida_como` varchar(20) null,
  `atendida_por` varchar(191) null,
  `atendida_at` datetime(3) null,
  `created_at` datetime(3) not null default current_timestamp(3),
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`id`),
  key `solicitudes_privacidad_estado_idx` (`estado`, `created_at`),
  key `solicitudes_privacidad_phone_idx` (`phone`, `estado`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
