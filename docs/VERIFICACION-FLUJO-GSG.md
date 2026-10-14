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
