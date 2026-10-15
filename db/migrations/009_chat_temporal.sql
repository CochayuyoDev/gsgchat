-- Retención móvil sin cambiar la fecha original que muestra WhatsApp/GSG.
alter table messages
  add column stored_at datetime(3) null,
  add index messages_stored_idx (stored_at, id);

-- Para filas ya existentes, created_at es la única fecha disponible que
-- representa su incorporación histórica. Las nuevas escrituras usan NOW(3).
update messages set stored_at = created_at where stored_at is null;
