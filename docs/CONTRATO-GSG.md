# Contrato de GSGchat con GSG

## Recepción y consulta

Endpoint global: POST /api/v1/entregas. La clave Bearer determina la tienda. No anteponer /tienda/<nombre>. GET /api/v1/entregas y GET /api/v1/entregas/<tracking> también seleccionan la tienda por la clave, sin depender de cookies.

Cabeceras: Authorization: Bearer <clave> y Content-Type: application/json. Permisos: entregas:gestionar para crear, modificar o cancelar; entregas:leer para consultar.

Se acepta un objeto, una lista de objetos o { "pedidos": [...] }, hasta 600 pedidos por llamada y 4 MiB. Tope: 120 llamadas por minuto y clave.

Ejemplo de pedido:

```json
{
  "tracking": "GSG-000001",
  "cliente": "Nombre del cliente",
  "telefono": "987654321",
  "empresa": "Empresa del pedido",
  "metodoPago": "Efectivo",
  "montoCobrar": 0
}
```

Los seis campos son obligatorios. Empresa puede ser texto o {codigo, nombre}. montoCobrar admite número no negativo o texto decimal. Teléfono peruano admite 9 dígitos o el prefijo 51. Tracking identifica el pedido del día; repetirlo no crea otra fila. Se conservan los datos adicionales admitidos por el esquema, como direccion, distrito, producto, telefono2, fecRuta y cantBultos. fecRuta es información del pedido, no una programación de envío.

Los alias cliente/nombre, montoCobrar/monto y tracking/codigoTracking/referencia siguen admitidos. Si referencia y tracking difieren, sendLocation conserva el tracking original.

Los campos marcados como necesarios, pero sin «sí o sí», son opcionales: distrito, direccion, fecRuta, telefono2, producto y cantBultos. Driver no participa en el flujo. Luis es GSG, el sistema que envía estos pedidos.

Si falta un obligatorio, se devuelve 400 y no se guarda ningún pedido de esa llamada. Cada detalle incluye campo, mensaje, pedido (posición empezando en 1), cliente y tracking; cuando falta un identificador se devuelve null. Por ejemplo, si Luis envía el pedido de Ana sin empresa ni método de pago:

```json
{
  "ok": false,
  "codigo": "VALIDACION",
  "error": "cliente \"Ana\", tracking \"GSG-000001\": empresa falta (es obligatorio); metodoPago falta (es obligatorio). No se guardó ninguno.",
  "detalles": [
    { "campo": "empresa", "mensaje": "falta (es obligatorio)", "pedido": 1, "cliente": "Ana", "tracking": "GSG-000001" },
    { "campo": "metodoPago", "mensaje": "falta (es obligatorio)", "pedido": 1, "cliente": "Ana", "tracking": "GSG-000001" }
  ]
}
```

## Respuesta HTTP

| HTTP | Significado |
| --- | --- |
| 201 | Al menos un pedido nuevo se guardó y se volvió a leer de la base. creadas incluye su id real y el estado del primer mensaje. |
| 200 | Los pedidos ya existían; repetidas y existentes identifican las filas guardadas. |
| 400 | Cuerpo inválido, campos faltantes o ningún teléfono utilizable. detalles identifica cada error. |
| 401 | Falta la clave, es desconocida o fue revocada. Incluye WWW-Authenticate. |
| 403 | La clave no tiene el permiso requerido o la tienda está suspendida. |
| 404 | Ruta, tienda o pedido inexistente. POST con prefijo de tienda tampoco es válido. |
| 405 | Método no permitido; incluye Allow. La colección admite GET, HEAD y POST. |
| 409 | Clave registrada en más de una tienda o conflicto de estado. |
| 413 | Cuerpo mayor que 4 MiB. |
| 415 | Content-Type no admitido. Para recibir pedidos debe ser application/json. |
| 429 | Tope de peticiones excedido; incluye Retry-After. |
| 500 | Fallo interno; repetir la misma llamada permite recuperar sin duplicar lo guardado. |
| 503 | Base no disponible; incluye Retry-After. Repetir el mismo cuerpo y tracking. |

No se usa 402 para errores de clave o permisos. Todos los errores de recepción se devuelven en JSON con ok:false, codigo y error. Puede haber detalles por campo y guardados en fallos parciales.

Si algunos teléfonos se descartan y otros pedidos se guardan, la respuesta 201 separa creadas y descartadas. No interpretar 201 como que todos los pedidos se guardaron ni como confirmación de envío por WhatsApp.

## Flujo de ubicación

1. Se guarda el pedido en la base de su tienda y aparece en Hoy/Números del día.
2. Por defecto se solicita ubicación automáticamente, respetando conexión de WhatsApp, horario y ritmo. confirmarListaGsg está apagado por defecto; si una cuenta guardó explícitamente la revisión manual, sus pedidos siguen esperando autorización.
3. El cliente puede enviar un pin o un enlace de Maps válido. Se validan y registran sus coordenadas.
4. Se hacen como máximo tres solicitudes automáticas de ubicación por cliente. Varios pedidos del mismo teléfono comparten la solicitud. Sin ubicación, el caso pasa a pendientes de atención. El filtro Necesitan atención y el contador de intentos permiten revisarlo.
5. Al recibir ubicación se detienen los recordatorios. La confirmación comercial solo se pide cuando el pedido trae faltaConfirmar:true; por defecto no se pide.
6. La ubicación se encola de forma persistente y se intenta devolver inmediatamente a GSG.

## Devolución a GSG

POST <GSG_URL>/sendLocation, con Authorization: Bearer <GSG_TOKEN> y application/json:

```json
{
  "tracking": "GSG-000001",
  "latitud": -12.1211,
  "longitud": -77.0301
}
```

GSG debe guardar o actualizar la ubicación asociada al tracking. Una corrección vuelve a enviar las nuevas coordenadas con el mismo tracking. GSG_URL es la base del backend; GSG_SEND_LOCATION_URL permite indicar una URL completa de devolución diferente. La URL y los nombres definitivos deben coincidir con el contrato real del backend.

Cualquier 2xx confirma aceptación del reporte. 5xx, 408, 429, timeout o falta de red dejan el reporte pendiente para reintentar. Otros 4xx quedan fallidos y visibles; no se ocultan como enviados. Hoy muestra enviados, pendientes y fallidos. La cola se conserva aunque el backend no esté configurado.

La clave con la que GSG envía pedidos a GSGchat y el token con el que GSGchat devuelve ubicaciones a GSG son credenciales de servicios diferentes.

La consulta opcional de pendientes sigue en GET <GSG_URL>/reparto/pendientes. Si GSG solo empuja pedidos, no hace falta que esa consulta responda para que POST /api/v1/entregas guarde pedidos.

## Aplicación normal

El modo demostración, los accesos al simulador y el modo de prueba por lista de números fueron retirados. Iniciar con npm run quick o npm start, con MySQL/MariaDB. Las pruebas automatizadas usan dependencias controladas y bases separadas del uso normal.
