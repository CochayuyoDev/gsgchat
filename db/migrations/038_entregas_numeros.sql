-- «Números del día»: las marcas que pone una persona sobre cada número de
-- la lista de GSG, desde esa pantalla (ver src/web/numeros-page.ts).
--
-- Donde va cada número (falta pedirle la ubicación, falta su ubicación,
-- falta confirmar, ya contactado, necesita a alguien) lo dice el estado de
-- la entrega y del reparto, y cambia solo con cada mensaje que llega. Lo que
-- se guarda aquí es lo único que no se puede deducir de eso:

-- «Ya contactado», puesto a mano (se le llamó por teléfono, se habló por
-- otro lado). Quién lo marcó, para la bitácora de la pantalla.
alter table entregas add column if not exists contactado_at timestamptz;
alter table entregas add column if not exists contactado_por text;

-- Los mensajes automáticos a este número en pausa: mientras tenga fecha no se
-- le pide la ubicación ni la confirmación. Sus respuestas se siguen leyendo.
alter table entregas add column if not exists mensajes_pausados_at timestamptz;

create index if not exists entregas_pausadas_idx on entregas (phone) where mensajes_pausados_at is not null;
