-- Grupos de WhatsApp en el chat.
--
-- Un grupo se guarda como un contacto mas, con `tipo = 'grupo'` y su jid
-- (`120363...@g.us`) en `phone`: asi la pantalla de chat, el hilo, los no
-- leidos y el envio a mano funcionan igual que con una persona, sin una
-- segunda tabla ni una segunda pantalla. Lo que cambia es lo que NO se hace
-- con ellos: no entran en la libreta, ni en los grupos de envio, ni en el
-- reparto, y ningun automatismo contesta dentro de un grupo.
alter table contacts add column if not exists tipo text not null default 'persona';
create index if not exists contacts_tipo_idx on contacts (tipo);
