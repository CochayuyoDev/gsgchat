-- Tablero de Rutas: lecturas de varias solicitudes por lote y conteos de
-- casos que esperan intervención humana.
create index `rutas_sol_lote_phone_idx` on `rutas_solicitudes` (`lote_id`, `phone`);
create index `rutas_sol_humano_estado_idx` on `rutas_solicitudes` (`requiere_humano`, `estado`);
