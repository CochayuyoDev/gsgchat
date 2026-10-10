-- El enlace del motorizado: una pagina sin instalar nada (/m/<token>) con
-- sus pedidos del dia y botones grandes. El token se crea o renueva desde
-- Motorizados y caduca a los 7 dias.
alter table motorizados add column if not exists enlace_token text;
alter table motorizados add column if not exists enlace_vence_at timestamptz;
create unique index if not exists motorizados_enlace_token_idx on motorizados (enlace_token) where enlace_token is not null;
