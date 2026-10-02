# Recepcion de pedidos de GSG Courier

La API ya existia en el repositorio. Esta ampliacion conserva POST /api/v1/entregas y agrega los campos de Courier que faltaban. No publica ni despliega el servidor.

## Enviar

POST <URL_DEL_SERVIDOR>/api/v1/entregas
Content-Type: application/json
Authorization: Bearer <CLAVE_API>

Crear una clave en el panel con permiso entregas:gestionar. No enviar pedidos sin HTTPS en produccion.
Usar el JSON de pedido-gsg-ejemplo.json. Se acepta uno, una lista o {"pedidos": [...]}.
Hasta 500 pedidos por llamada: 600 se dividen en 500 + 100. Limite existente: 120 llamadas/minuto/clave.

## Campos

Codigo de tracking -> tracking (o codigoTracking). Si no viene referencia, tracking es el identificador.
Driver -> driver (texto o {nombre, telefono}); tambien se acepta motorizado.
Distrito -> distrito
Cost Serv -> costServ
Empresa -> empresa (texto o {codigo, nombre})
Cliente -> cliente (o nombre)
Telefono -> telefono
Direccion -> direccion
Referencia opcional de la direccion -> referenciaDireccion. El campo referencia existente identifica el pedido; no usarlo para indicaciones de direccion.
Fec Registro -> fecRegistro
Fec Ruta -> fecRuta
Observacion del cliente -> observacionCliente
Detalle del Producto -> detalleProducto
Telefono 2 -> telefono2
Producto -> producto
Tamano -> tamano
Cant Bultos -> cantBultos (entero no negativo o texto numerico)
Metodo de pago -> metodoPago
Monto Cobrar -> montoCobrar (o monto)
Cliente Paga Delivery -> clientePagaDelivery
SEDE -> sede
Tipo de Ruta -> tipoRuta
Nro de documento -> nroDocumento (enviar texto para conservar ceros iniciales)
Agencia nombre -> agenciaNombre
Agencia direccion/destino -> agenciaDestino
Pago en destino -> pagoEnDestino

Los campos adicionales son opcionales para mantener compatibilidad. Textos adicionales: hasta 200 caracteres. Costo y monto numericos se guardan con dos decimales; los demas datos adicionales se conservan como texto. Booleanos de pago se normalizan a si/no. Fechas se conservan como datos del pedido; fecRuta no programa por si sola el envio futuro. Los nombres JSON son los de arriba, sin espacios ni tildes.

## Recepcion y cola

Se guardan pedidos en el repositorio de entregas y sus datos en datosEnvio (columna JSON existente; no se necesita otra migracion). La respuesta separa creadas, repetidas y descartadas. 201 indica al menos una creacion; 200 puede significar que todos eran repetidos o descartados: revisar siempre esas listas. 400 significa cuerpo invalido; 401/403 autenticacion/permisos; 429 limite por minuto.

Los duplicados se detectan por referencia y dia, segun el comportamiento existente. No es una cola independiente de Redis: es la cola operativa persistente del sistema. El procesamiento y los mensajes los hace el motor existente. Con confirmarListaGsg activado (valor predeterminado), los pedidos quedan retenidos hasta confirmar el envio en el panel. Con ese ajuste desactivado, el sistema puede activar el reparto automaticamente. La ampliacion no cambia esa politica.

Para probar localmente: npm ci --ignore-scripts; npm run typecheck; npm test -- tests/gsg-recepcion-campos.test.ts tests/api-v1.test.ts tests/gsg-datos-envio.test.ts tests/confirmar-envio-gsg.test.ts.
