-- «Revisar y confirmar antes de enviar»: la lista del día que manda GSG
-- (sincronización, POST /api/v1/entregas o el simulador) no sale sola. Queda
-- en «Números del día» como «Por confirmar el envío» hasta que una persona
-- pulsa «Confirmar y enviar». Ver src/entregas/servicio.ts (liberarEnvio).
--
-- envio_retenido_at: desde cuándo espera la confirmación (null = no espera).
-- Mientras tenga fecha no se le pide la ubicación, ni la confirmación, ni va
-- al motorizado, y no cuenta como «el sistema escribió primero».
-- envio_liberado_at: cuándo se confirmó su envío (para el segundo aviso,
-- «Llegaron M más», cuando ya se confirmó una tanda ese día).
alter table entregas add column if not exists envio_retenido_at timestamptz;
alter table entregas add column if not exists envio_liberado_at timestamptz;

create index if not exists entregas_envio_retenido_idx on entregas (dia) where envio_retenido_at is not null;
