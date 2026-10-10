-- El primer mensaje de cada pedido, con su estado guardado (ver src/entregas/primer-mensaje.ts).
--
-- Antes, si el primer mensaje no salia (el reparto no se pudo cargar, WhatsApp
-- rechazo el envio, el servicio se reinicio a mitad) solo quedaba una linea en
-- el log: el pedido seguia en Hoy sin que nadie supiera que el cliente nunca
-- recibio nada, y no habia forma de reintentarlo sin crear el pedido otra vez.
--
--   mensaje_estado: no_aplica | retenido | pendiente | encolado | enviando |
--                   enviado | reintentando | fallido | incierto
--   mensaje_intentos: intentos reales de envio (los que llegaron a WhatsApp o
--                     quedaron inciertos); lo que una guarda propia freno no cuenta.
--   mensaje_reintentos_auto: reintentos automaticos seguidos desde el ultimo
--                     manual (el tope configurable se mide sobre este).
--
-- Un solo ALTER: en InnoDB entra entero o no entra, asi que no queda a medias.

alter table `entregas`
  add column `mensaje_estado` varchar(20) not null default 'no_aplica',
  add column `mensaje_via` varchar(20) null,
  add column `mensaje_intentos` int not null default 0,
  add column `mensaje_reintentos_auto` int not null default 0,
  add column `mensaje_ultimo_intento_at` datetime(3) null,
  add column `mensaje_proximo_at` datetime(3) null,
  add column `mensaje_error_codigo` varchar(64) null,
  add column `mensaje_error` varchar(500) null,
  add column `mensaje_permanente` tinyint(1) not null default 0,
  add column `mensaje_enviado_at` datetime(3) null,
  add column `mensaje_wamid` varchar(191) null,
  add key `entregas_mensaje_idx` (`mensaje_estado`, `mensaje_proximo_at`);

-- Lo que ya estaba: lo que espera «Confirmar y enviar» queda retenido; lo
-- demas, sin seguimiento (no_aplica). Ningun pedido viejo se reenvia por esto.
update `entregas` set `mensaje_estado` = 'retenido'
 where `envio_retenido_at` is not null and `estado` not in ('cancelada', 'entregada', 'terminada');
