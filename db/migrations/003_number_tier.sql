-- Tier de envio que reporta Meta para el numero (TIER_250, TIER_1K, ...).
-- Lo actualizan el webhook phone_number_quality_update y la sincronizacion
-- manual desde el panel; sirve para no fijar un techo por encima del real.
alter table number_state add column if not exists tier text;
