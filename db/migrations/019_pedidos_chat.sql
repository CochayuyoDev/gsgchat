-- Pedidos tomados en el chat.
--
-- El asistente de IA (o una persona) cierra la venta en la conversacion:
-- que productos, cuantos, a quien, a donde y como paga. Queda aqui como
-- pedido con sus lineas, con los precios del catalogo (no los que diga el
-- modelo), y sale como evento `pedido.creado` para que la tienda lo reciba.
create table if not exists pedidos_chat (
  id            bigserial primary key,
  contact_id    uuid not null references contacts(id) on delete cascade,
  -- nuevo | confirmado | cancelado | enviado_tienda
  estado        text not null default 'nuevo',
  -- [{sku, nombre, cantidad, precio, subtotal, url}]
  items         jsonb not null default '[]',
  total         numeric(12,2) not null default 0,
  moneda        text not null default 'PEN',
  nombre        text,
  telefono      text,
  direccion     text,
  referencia    text,
  pago          text,
  notas         text,
  -- quien lo tomo: 'ia' o el id del usuario
  origen        text not null default 'ia',
  -- id que devolvio la tienda al recibirlo, si lo hizo
  externo_id    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pedidos_chat_por_contacto_idx on pedidos_chat (contact_id, id desc);
create index if not exists pedidos_chat_por_estado_idx on pedidos_chat (estado, id desc);
