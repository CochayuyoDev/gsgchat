-- Conectores de tiendas: WooCommerce y Shopify sin tocar su codigo.
--
-- Esas plataformas ya mandan webhooks solas (pedido creado, pagado,
-- enviado...). Un conector es la URL que se les pega y el secreto con el que
-- firman; las reglas dicen que mensaje de WhatsApp sale con cada evento.
create table if not exists conectores (
  id            uuid primary key default gen_random_uuid(),
  -- woocommerce | shopify
  tipo          text not null,
  nombre        text not null,
  -- Con esto firma la tienda cada envio. En WooCommerce lo eliges tu (se
  -- genera aqui y se pega alla); en Shopify lo da su panel y se pega aqui.
  secreto       text not null,
  activo        boolean not null default true,
  -- [{evento, activo, plantilla: {nombre, idioma} | null, variables: [], texto}]
  reglas        jsonb not null default '[]',
  creado_por    uuid references usuarios(id) on delete set null,
  created_at    timestamptz not null default now(),
  ultimo_evento_at timestamptz,
  eventos_recibidos integer not null default 0
);

-- Cada webhook que llego de la tienda y que se hizo con el: es lo que se
-- mira cuando "no llego el mensaje del pedido".
create table if not exists conector_entradas (
  id            bigserial primary key,
  conector_id   uuid not null references conectores(id) on delete cascade,
  -- El evento ya traducido (pedido.creado...) y el original de la tienda.
  evento        text not null,
  evento_origen text,
  pedido        text,
  telefono      text,
  -- enviado | bloqueado | sin_regla | sin_telefono | ignorado | error
  resultado     text not null,
  detalle       text,
  created_at    timestamptz not null default now()
);

create index if not exists conector_entradas_por_conector_idx
  on conector_entradas (conector_id, id desc);
