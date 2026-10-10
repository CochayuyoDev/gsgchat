-- El cliente que cambia su ubicacion («quiero cambiar mi ubicacion», «me
-- equivoque de direccion», «te mando otra»...). Antes solo quedaba un evento
-- «ubicacion corregida por el cliente»; ahora el pedido lo guarda y las
-- pantallas (Hoy, Numeros del dia, la ficha) muestran «cambio su ubicacion».
--
--   ubicacion_cambio_pedido_at: cuando pidio cambiarla (antes de la hora
--                     limite). El pin siguiente cuenta como el cambio aunque
--                     su ubicacion aun no estuviera registrada.
--   ubicacion_cambiada_at: cuando llego la ubicacion nueva.
--   ubicacion_cambios: cuantas veces la cambio (0 = nunca).
--   ubicacion_anterior_lat / _lng: la que tenia antes del ultimo cambio.
--
-- Un solo ALTER: en InnoDB entra entero o no entra, asi que no queda a medias.

alter table `entregas`
  add column `ubicacion_cambio_pedido_at` datetime(3) null,
  add column `ubicacion_cambiada_at` datetime(3) null,
  add column `ubicacion_cambios` int not null default 0,
  add column `ubicacion_anterior_lat` double null,
  add column `ubicacion_anterior_lng` double null;
