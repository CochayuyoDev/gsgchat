-- Entregas: el "entregado" del motorizado, el cierre del dia y la ultima
-- posicion conocida de cada motorizado (para darle el pedido al mas cercano).
alter table entregas add column if not exists entregada_at timestamptz;
-- reglas | ia | foto | persona | cierre
alter table entregas add column if not exists entregada_como text;
alter table entregas add column if not exists entregada_respuesta text;
-- true = la cerro el cierre del dia (quedo sin terminar ayer).
alter table entregas add column if not exists cerrada_por_dia boolean not null default false;

alter table motorizados add column if not exists ultima_lat double precision;
alter table motorizados add column if not exists ultima_lng double precision;
alter table motorizados add column if not exists ultima_posicion_at timestamptz;
