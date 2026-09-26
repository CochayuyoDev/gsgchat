-- El pin tiene que tener sentido y la dirección escrita cuenta (pedido del
-- dueño, 25/09).
--
-- pin_propuesto_*: el cliente mandó un pin que cae lejos del distrito de su
-- pedido. No se da por bueno a ciegas: queda aquí, se le pregunta UNA vez si
-- es ahí (SÍ/NO) y, mientras tanto, el reparto no le recuerda nada.
-- pin_propuesto_dudas: cuántas veces contestó otra cosa (a la segunda cuenta
-- como SÍ).
alter table entregas add column if not exists pin_propuesto_lat double precision;
alter table entregas add column if not exists pin_propuesto_lng double precision;
alter table entregas add column if not exists pin_propuesto_at timestamptz;
alter table entregas add column if not exists pin_propuesto_fuente text;
alter table entregas add column if not exists pin_propuesto_dudas integer not null default 0;

-- direccion_cliente: la dirección que el cliente escribió en vez del pin
-- («Av. Larco 345, Miraflores»). Se ve en Hoy y la recibe el motorizado.
alter table entregas add column if not exists direccion_cliente text;
alter table entregas add column if not exists direccion_cliente_at timestamptz;

-- La caché de la búsqueda de direcciones en OpenStreetMap (Nominatim): la
-- misma dirección no se vuelve a preguntar. `encontrado = false` también se
-- guarda (lo que no existe no aparece mañana).
create table if not exists geocodificacion_cache (
  consulta text primary key,
  encontrado boolean not null,
  lat double precision,
  lng double precision,
  precision text,
  distrito text,
  texto text,
  created_at timestamptz not null default now()
);
