# Verificación del flujo GSG — 14/10/2026

- Compilación TypeScript correcta y revisión del catálogo de Meta sin errores.
- `test:release`: 670 pruebas aprobadas, 39 archivos, sin fallos ni pruebas omitidas. Se amplió el perfil con las pruebas de ubicaciones, transporte, reportes y ajustes relevantes.
- Integración de producción con MySQL real y endpoint HTTP simulado: 11 pruebas aprobadas, incluyendo coordenadas, reintentos, duplicados y conexión cifrada persistente tras reiniciar. Se actualizó el filtro del mock SQL de `/sendLocation` a `/send-location`, que es la ruta del contrato actual.
- Comprobación directa de SQL: una incidencia antigua queda `superado`, sin incrementar intentos ni inventar recepción de GSG. Sus coordenadas se envían correctamente.
- Corregido: HTTP 200 con `ok: false` o `success: false` ya no se considera aceptación de GSG.
- Corregido: el contador de Pedidos GSG ya no lleva `/3` fijo; con ubicación recibida muestra los intentos anteriores como historial.
- Regresión: pin después del tope, dos trackings, importes 0 y 200, avisos posteriores, fallos de Meta, límites del detalle, respuestas 400/401/403/429/503, ausencia de reenvío del problema antiguo y separación entre recepción local y aceptación de GSG.

La revisión histórica adicional encontró 13 fallos. La comparación con los archivos originales de HEAD reprodujo exactamente los mismos 13, sin regresiones nuevas en esa ejecución. Esas pruebas esperan la confirmación manual y comportamientos anteriores del reparto; se conservaron sin ocultarlas ni cambiar el flujo actual para satisfacerlas.

No se ha accedido al backend ni al WhatsApp reales de GSG. El usuario confirmó que no tiene acceso al backend de GSG. Por ello no se certifica la eliminación del estado rojo en su interfaz: su backend debe dar prioridad a las coordenadas aceptadas frente al problema anterior. Estos cambios siguen locales y no se han desplegado.

## Confirmación al cliente y bloqueo por otro lote

La confirmación de ubicación ahora comprueba el resultado del sender. Solo registra «UBI REGISTRADA enviada: aceptada por WhatsApp» si existe un envío real con identificador del proveedor. Una omisión por silencio, una guarda, un rechazo o un resultado incierto no se presentan como enviados. Un fallo temporal explícito admite un reintento; no se reintenta automáticamente un resultado incierto. La ubicación y el reporte a GSG siguen guardados aunque falle esta respuesta al cliente.

El chat se cierra tras una confirmación aceptada o tras comprobar que ya fue enviada. La marca de confirmación se conserva en el mensaje saliente y evita repetirla durante el mismo día del negocio. Si el acuse falla, otro pin del cliente puede volver a intentar la confirmación; no se descarta como copia sin respuesta.

Los trackings distintos no se bloquean como solicitudes duplicadas de otro lote. Las entregas solo se agrupan en una solicitud activa del mismo día con su lote en marcha. Un lote pausado, terminado o de otro día no recibe el pedido nuevo. El motor recupera los pedidos pendientes que una versión anterior dejó bloqueados con `ya_en_curso`, conservando el registro histórico y respetando las pausas.

Pruebas específicas: `confirmacion-ubicacion.test.ts` y `pedido-nuevo-otro-lote.test.ts`. Incluyen confirmación tras tres intentos, nota real, fallo de WhatsApp, un reintento temporal, ausencia de duplicados, protección ante silencio/resultado incierto, ventana de servicio, recuperación de cierres antiguos, día de Lima y recuperación de solicitudes canceladas por otro lote. No se han enviado mensajes a clientes reales.
# Silencio mientras falta la ubicación

Los saludos, consultas por la hora, preguntas sobre por qué se pide la ubicación y cualquier otro mensaje sin ubicación quedan guardados sin respuesta automática. No cambian el próximo intento ni consumen intentos: solo el motor envía solicitudes según el intervalo y máximo configurados. Se aplica antes de las plantillas y la IA, en ambos modos. Los números equivocados siguen reportándose internamente, sin responder al cliente.

Los pins y enlaces de mapa siguen su validación y confirmación; un SÍ/NO explícito solo pasa si ya hay un pin pendiente de validar. `tests/silencio-esperando-ubicacion.test.ts` verifica el silencio, los 15 minutos, el tope, los reportes internos y la confirmación por pin y mapa.

## Chat diario y consultas reducidas

- `test:release`: 773 pruebas aprobadas, sin fallos. Compilación TypeScript y JavaScript de las pantallas correctos.
- SQL real en una instancia privada de MariaDB: 12 pruebas aprobadas (11 del flujo GSG y una del chat diario). Se verificaron además búsqueda, destacados e índice de limpieza diaria en la última revisión del caso SQL del chat.
- El chat refresca cada 15 segundos y trae mensajes y notas internas juntos. Se retiró el sondeo automático de presencia. Las consultas iguales pendientes se comparten, los sondeos esperan la respuesta anterior y se suspenden al ocultar la pestaña. Tras fallos se aumenta la espera; se respetan `Retry-After` y la sesión terminada.
- `read=false` ya no escribe el estado de lectura. El historial ignora respuestas anteriores a un cambio de filtro y aprovecha la misma protección de consultas.
- Desde la próxima vinculación por QR se persiste `chat.vistaDesde`. Se excluyen historial personal, mensajes propios del teléfono y conversaciones que el sistema no inició. Las respuestas de los clientes contactados siguen entrando y su ubicación se confirma. Un reinicio no reinicia esta vista.
- Al cambiar de día en la zona configurada (Lima por defecto), la vista se vacía; los mensajes anteriores se eliminan en lotes de 1000, con una pasada por minuto. Se conservan contactos, pedidos, coordenadas y auditoría de API/envíos. Se retiraron importación automática, importación desde el chat, guardar conversaciones, acceso a Chats guardados y el archivador automático.
- `008_chat_diario.sql` añade el índice por fecha para la limpieza. Debe aplicarse al desplegar.
- «Desvincular cuenta» aparece en la tarjeta principal de WhatsApp y usa la desvinculación real de local/WAHA; sus pruebas cubren cancelación, fallo, cierre y necesidad de un QR nuevo.

La ejecución adicional de `panel.test.ts`, anterior a retirar Chats guardados, encontró cinco expectativas antiguas sobre campañas, rastreo, `/rutas`, enlaces a módulos retirados y las pestañas anteriores de plantillas. Ese perfil histórico todavía requiere adaptación a los módulos retirados. Las pruebas específicas de la conexión y del botón, incluidas en el perfil activo, sí pasan.

## Solo texto y ubicación; menor transferencia

Los archivos entrantes (audio, video, foto, documento, sticker) se descartan antes de crear contactos, registrar mensajes o consultar IA/transcripción. El socket local filtra antes de resolver contactos y descargar adjuntos. Se retiraron los controles multimedia y de grabación del chat, las descargas automáticas de archivos y vistas previas, y los stickers automáticos del bot. La IA responde por escrito incluso si había una configuración antigua de voz. Los servicios de envío multimedia explícito de la API se conservan por compatibilidad; no se invocan automáticamente en este flujo.

Chat, lista de conversaciones e historial de recepciones/envíos usan ETag: una respuesta sin cambios lleva HTTP 304 sin cuerpo, y el navegador reutiliza la copia de la vista actual (máximo ocho URLs). Las consultas de base de datos siguen necesarias para comprobar cambios; esto reduce transferencia, no elimina toda consulta. Las pruebas comprueban reutilización, recepción de mensajes nuevos, descarte de archivos y ausencia de transcripción/respuesta a audio. Informe: `outputs/texto-pin-final.json`.

Pendiente para producción: aplicar la migración 008, desplegar y volver a vincular WhatsApp para activar el corte del historial personal. Las pruebas usaron proveedores simulados; no se certificó envío con una cuenta real ni el estado mostrado en el backend externo de GSG. Estos cambios siguen locales.
