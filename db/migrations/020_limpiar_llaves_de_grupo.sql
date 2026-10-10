-- Limpieza: las llaves de grupo que se guardaron como si fueran mensajes.
--
-- Durante unas horas del 16 de septiembre de 2026, el primer mensaje de un
-- participante en un grupo (que trae su llave junto al contenido) se guardo
-- en el hilo como "(mensaje de tipo senderkeydistribution)". No es un
-- mensaje: se borra. El traductor ya no vuelve a producirlo.
delete from messages
 where kind = 'unknown'
   and body like '(mensaje de tipo senderkeydistribution%';
