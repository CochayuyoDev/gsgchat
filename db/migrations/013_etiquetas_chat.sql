-- La etiqueta que la IA le pone a la conversacion de un dia en Chats.
--
-- Una fila por numero de WhatsApp normalizado y dia (en la zona del negocio):
-- los mensajes de ese numero se juntan aunque esten en mas de un contacto.
-- `huella` es el sha256 de los mensajes que se clasificaron: si al volver a
-- pulsar «Etiquetar» los mensajes siguen igual, se reutiliza la etiqueta y no
-- se llama a la IA. `etiqueta` null = no se pudo clasificar (la IA fallo y
-- las reglas no reconocieron nada); `motivo` dice por que.
--
-- Una tabla aparte: `messages` y `contacts` no cambian. Ver src/db/chat-etiquetas.ts.

create table if not exists `chat_etiquetas` (
  `phone` varchar(40) not null,
  `dia` date not null,
  `etiqueta` varchar(60) null,
  `origen` varchar(20) not null default 'ia',
  `huella` char(64) not null,
  `mensajes` int not null default 0,
  `motivo` varchar(255) null,
  `updated_at` datetime(3) not null default current_timestamp(3),
  primary key (`phone`, `dia`),
  key `chat_etiquetas_dia_idx` (`dia`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
