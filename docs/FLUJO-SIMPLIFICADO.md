# Flujo de pedidos sin gestión de motorizados

La web recibe pedidos de GSG, solicita la ubicación del cliente, recoge la confirmación y permite revisar los mensajes y atender incidencias desde Chats.

Hoy y Números del día comparten una vista con búsqueda, filtros, autorización del envío, acciones sobre varios pedidos, carga de listas, errores de mensajes y ajustes de ubicación y confirmación. Mapa muestra las ubicaciones de los pedidos.

La gestión de motorizados se retiró para superadmin, admin y operador: no hay menú, altas, asignaciones, reasignaciones, rutas, páginas con enlace ni segunda visita. Las rutas de esas funciones dejan de registrarse y responden 404. El motor no asigna pedidos ni interpreta respuestas de repartidores. La IA tampoco ofrece esas acciones.

Una ubicación y confirmación completas dejan el pedido registrado. Al cerrar el día, ese trámite pasa a `terminada` sin marcar una entrega física, escribir una fecha de entrega ni reportar a GSG una confirmación negativa.

Los registros y columnas históricos se conservan. Esta reducción no necesita una migración destructiva ni elimina pedidos, usuarios o conversaciones existentes. El código y tipos históricos que siguen siendo utilizados por repositorios y pruebas de compatibilidad no se exponen como funciones de la web.

Validación de esta revisión: compilación TypeScript y 68 pruebas relevantes, incluidas siete del flujo simplificado y pruebas de autenticación, servidor, recepción GSG y errores HTTP. También se revisó la vista con datos de ejemplo en navegador. Esta cifra no representa una ejecución completa de toda la suite histórica ni una validación de producción.
