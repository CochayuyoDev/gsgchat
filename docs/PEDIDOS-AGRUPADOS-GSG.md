# Pedidos agrupados de GSG

El primer pedido de ubicación reúne los pedidos activos del mismo teléfono, cuenta, lote y día. Cada tracking conserva sus datos, método de pago y monto. Un importe cero se muestra como S/ 0.00; no se infiere que está pagado.

Por QR/WAHA se entrega una burbuja con un bloque por pedido y una única solicitud de ubicación. El registro de ubicación conserva un reporte por tracking.

Por Meta, el catálogo contiene `solicitud_ubicacion_pedidos_gsg` (UTILITY, español) con tres parámetros: nombre, cantidad y detalle de los pedidos. Aparece en Plantillas y se selecciona automáticamente para el primer mensaje agrupado. Debe darse de alta y aprobarse en Meta; si no está aprobada, los pedidos quedan con error visible y no se sustituye el mensaje por uno que oculte pedidos. Los límites del proveedor se validan y nunca se recorta el detalle para fingir un envío completo.

Los trackings recibidos antes del primer envío se incorporan al grupo, aunque lleguen por llamadas distintas. Si se reciben con la solicitud ya enviada y la ubicación aún pendiente, tienen un aviso propio con su monto y seguimiento de errores/reintentos. No se atribuye al pedido nuevo un mensaje anterior. Si ya hay una ubicación válida del día, se conserva el flujo existente que reutiliza esa ubicación para el nuevo tracking.

Validación automatizada: `tests/pedidos-agrupados-gsg.test.ts` cubre 0 + 200, tres pedidos, separación entre teléfonos, llamadas independientes, un tracking recibido durante un envío, duplicados, coordenadas por tracking, reintentos del grupo y del aviso posterior, Meta con y sin aprobación y la validación del catálogo. Estas pruebas usan WhatsApp y GSG simulados; no envían mensajes reales.

Resultado de verificación: compilación correcta, 537 pruebas de `test:release` aprobadas y catálogo de plantillas sin errores de lint. La prueba histórica de confirmación manual en `recepcion-mensajes.test.ts` espera un estado retenido; falla también con los archivos originales de HEAD (`encolado` frente a `retenido`). No forma parte de este cambio ni de la suite de release; no se ha ocultado ni modificado esa prueba.

## Ubicación recibida después de los intentos

La incidencia `sin_respuesta` o `respondio_sin_ubicacion` pendiente en la cola se vuelve `superado` si su solicitud ya está resuelta con coordenadas. Así un reporte antiguo no puede salir después de la ubicación y volver a marcar el pedido como problemático. No se inventa una confirmación de recepción del problema: `superado` es distinto de `enviado` y no cuenta como fallo ni como pendiente. Los reportes que ya se enviaron se conservan como historial.

La prueba `ubicacion-tardia-gsg.test.ts` reproduce dos trackings del mismo teléfono, tres solicitudes, derivación y un pin tardío. Verifica los dos pedidos resueltos, el envío de ambas coordenadas y que las incidencias anteriores no se reintenten. El contador de intentos se conserva; la web lo muestra como mensajes anteriores a la ubicación cuando la solicitud está resuelta.

Para un problema que GSG ya recibió, su backend debe actualizar el estado vigente al aceptar el posterior `send-location`. GSGchat no puede garantizar que la interfaz de un backend externo quite una etiqueta antigua; se requiere verificar su respuesta y la lógica de estado en ese sistema. La recepción del pin local y la aceptación HTTP de sus coordenadas por GSG son estados separados.
