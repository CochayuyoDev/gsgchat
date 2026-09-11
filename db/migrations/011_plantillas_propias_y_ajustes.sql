-- Plantillas propias y ajustes del reparto desde el panel.
--
-- Hasta ahora las plantillas vivían en el código (src/templates/catalog.ts)
-- y los ajustes del reparto en variables de entorno. Quien opera el sistema
-- quiere decidir qué se manda, con qué palabras, a qué hora y cuántas veces
-- sin tocar ficheros. Lo de abajo es lo mínimo para eso.

-- Una plantilla creada desde el panel se marca como propia: se puede editar
-- y borrar desde ahí (las del catálogo no). Para subirla a Meta hacen falta
-- las descripciones de sus variables (los ejemplos que ve el revisor).
alter table templates add column if not exists propia        boolean not null default false;
alter table templates add column if not exists variables_doc jsonb;
alter table templates add column if not exists footer        text;
alter table templates add column if not exists updated_at    timestamptz not null default now();

-- Los ajustes del reparto van en `settings` con la clave `rutas.ajustes`,
-- como las preferencias del bot: un JSON con pausas, espera, intentos,
-- horario y las plantillas y textos de cada paso. No hace falta tabla.
