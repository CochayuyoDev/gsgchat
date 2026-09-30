-- Entregas, segunda ronda: la segunda visita cuando no habia nadie, la
-- prioridad (urgente) y el aviso de "estoy cerca" al cliente.

-- normal | urgente. Los urgentes salen primero hacia el motorizado.
alter table entregas add column if not exists prioridad text not null default 'normal';
-- Veces que el motorizado fue a la puerta sin poder entregar (0 o 1).
alter table entregas add column if not exists visitas integer not null default 0;
-- true = esta en su segunda visita (el cliente dijo que si vuelva hoy).
alter table entregas add column if not exists segunda_visita boolean not null default false;
-- Cuando se le pregunto al cliente si volvemos hoy, y hasta cuando se espera su respuesta.
alter table entregas add column if not exists segunda_visita_pedida_at timestamptz;
alter table entregas add column if not exists segunda_visita_vence_at timestamptz;
-- Cuando se le aviso al cliente que el motorizado esta cerca (una sola vez).
alter table entregas add column if not exists cerca_avisado_at timestamptz;

create index if not exists entregas_urgentes_idx on entregas (dia) where prioridad = 'urgente';
