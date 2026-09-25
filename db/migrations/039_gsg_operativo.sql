-- GSGchat operativo (GSG Courier): los datos del envio que GSG manda por la
-- API y el cierre del agente operativo en cada chat.

-- Lo que el primer mensaje le cuenta al cliente (producto, empresa, codigo de
-- seguimiento, numero de pedido, metodo de pago, monto y quien firma). Todo
-- opcional: lo que no venga no sale en el mensaje. Ver src/entregas/textos.ts.
alter table entregas add column if not exists datos_envio jsonb;

-- El agente operativo ya mando su mensaje de cierre en este chat y dejo de
-- contestar (pasa a una persona). El sistema sigue con lo automatico
-- (confirmacion, hora de llegada, entregado). Ver src/ia/agente-operativo.ts.
alter table contacts add column if not exists ia_cerrada_at timestamptz;
alter table contacts add column if not exists ia_cerrada_motivo text;
