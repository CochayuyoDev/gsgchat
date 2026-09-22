-- Entregas, refinado: el cliente recurrente (se le propone la direccion de
-- la ultima vez), el tiempo dudoso del motorizado (se le repregunta una vez)
-- y lo que hace falta para medir la puntualidad de cada motorizado.

-- Cuando se le propuso al cliente su ultima direccion en vez de pedirle el pin, y cual era.
alter table entregas add column if not exists ubicacion_propuesta_at timestamptz;
alter table entregas add column if not exists ubicacion_propuesta_lat double precision;
alter table entregas add column if not exists ubicacion_propuesta_lng double precision;
-- Cuando se le pregunto al motorizado "¿seguro?" por un tiempo que no cuadra con la distancia (una sola vez), y lo que dijo.
alter table entregas add column if not exists motorizado_tiempo_dudoso_at timestamptz;
alter table entregas add column if not exists motorizado_tiempo_dudoso_min integer;

-- La puntualidad se calcula sobre las entregadas con hora avisada.
create index if not exists entregas_puntualidad_idx on entregas (motorizado_id, entregada_at) where estado = 'entregada' and llega_aprox_at is not null;
