-- Deduplicación del webhook desacoplada de messages (24 h).
-- Conserva únicamente proveedor, wamid, estado y fechas; nunca el contenido.
create table if not exists whatsapp_inbound_receipts (
  provider varchar(24) not null,
  wamid varchar(191) not null,
  estado enum('procesando','aceptado','incierto') not null default 'procesando',
  recibido_at datetime(3) not null,
  expires_at datetime(3) not null,
  primary key (provider, wamid),
  key whatsapp_inbound_receipts_expiry_idx (expires_at)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

-- Evita que una ubicación repetida vuelva a confirmar el mismo conjunto de
-- pedidos después de expirar el cuerpo de los mensajes.
create table if not exists whatsapp_action_controls (
  action_key char(64) not null primary key,
  tipo varchar(40) not null,
  referencia_operativa varchar(500) not null,
  estado enum('procesando','aceptado','fallido','incierto') not null default 'procesando',
  wamid_saliente varchar(191) null,
  creado_at datetime(3) not null,
  actualizado_at datetime(3) not null,
  expires_at datetime(3) not null,
  key whatsapp_action_controls_expiry_idx (expires_at)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
