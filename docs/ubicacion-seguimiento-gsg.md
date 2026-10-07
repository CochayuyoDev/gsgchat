# Ubicación y seguimiento entre GSG y GSGchat

GSG gestiona el reparto, sus motorizados, puntos y horarios. GSGchat recibe pedidos, conversa por WhatsApp y devuelve las ubicaciones confirmadas. La autenticación entre ambos es `X-API-Key`; la clave de Google es independiente.

## Ubicación

1. GSG entrega dirección, distrito y tracking. La plantilla distingue una dirección completa de una zona sin puerta.
2. Una dirección escrita necesita número de puerta o manzana/lote y un distrito conocido (escrito o del pedido). La IA analiza la numeración cuando está configurada; las reglas conservadoras quedan como respaldo. No se geocodifica un distrito como dirección de entrega.
3. Google Geocoding se utiliza con `GOOGLE_MAPS_API_KEY`. Una coincidencia parcial, ambigua o sin puerta exacta no se registra. Sin esa clave se conserva el geocodificador gratuito existente; si no hay resultado seguro se pide el pin actual de WhatsApp.
4. La dirección localizada y los enlaces de Maps quedan como propuesta persistente. Se muestra el mapa y se pregunta SÍ/NO. Un SÍ registra las coordenadas y encola el envío a GSG; un NO descarta la propuesta. El pin nativo actual de WhatsApp sigue siendo una ubicación enviada explícitamente por el cliente.
5. El POST saliente mantiene el contrato existente `{ "tracking": "GSG-001", "lat": -12.12, "lng": -77.03 }`. El endpoint se configura con `GSG_URL` y `GSG_LOCATION_PATH`. Sin API key no se llama a GSG; el reporte queda pendiente.

## Horario por distrito

GSG adjunta el horario correspondiente al distrito en cada pedido, tanto en `/reparto/pendientes` como en el POST a `/api/v1/entregas`. Puede actualizarlo por PATCH del pedido. Las horas corresponden a la zona horaria de la tienda y son aproximadas; el inicio debe ser anterior al final.

```json
{
  "tracking": "GSG-001",
  "cliente": "Rosa",
  "telefono": "51987654321",
  "empresa": "Tienda de ejemplo",
  "metodoPago": "YAPE",
  "montoCobrar": 45.50,
  "direccion": "Av. Los Pinos 345",
  "distrito": "Ancón",
  "horarioEntrega": { "desde": "18:00", "hasta": "20:00" }
}
```

Ese horario se guarda con el pedido y se utiliza en sus mensajes y en el contexto del asistente. Si GSG no lo proporciona, se usa el horario general configurado. No se crean rangos inventados por distrito.

## Contrato propuesto de seguimiento, pendiente de confirmar con GSG

GSGchat hace `GET <GSG_URL>/reparto/seguimiento/{tracking}` con `X-API-Key`. Este endpoint pertenece al sistema GSG externo: este cambio no lo implementa dentro de GSGchat. Debe devolver solo los datos del tracking solicitado y las paradas pendientes hasta el cliente, sin información personal de otros destinatarios.

```json
{
  "tracking": "GSG-001",
  "distrito": "Ancón",
  "horario": { "desde": "18:00", "hasta": "20:00" },
  "posicion": { "lat": -12.10, "lng": -77.03, "actualizadaAt": "2026-10-07T17:00:00Z" },
  "puntoActual": 2,
  "puntoCliente": 5,
  "paradas": [
    { "orden": 3, "lat": -12.11, "lng": -77.04, "servicioMinutos": 5 },
    { "orden": 4, "lat": -12.12, "lng": -77.05, "servicioMinutos": 5 },
    { "orden": 5, "lat": -12.13, "lng": -77.06, "servicioMinutos": 0 }
  ]
}
```

Si el motorizado va por el punto 2 y el cliente está en el 10, el contrato anterior exige las ocho paradas 3–10 en orden. GSG puede declarar `secuenciaCompleta:true` y enviar solo las paradas todavía pendientes, con índices crecientes y destino final correcto. Se rechazan otro tracking, coordenadas inválidas y posiciones de más de diez minutos. Se aceptan hasta cien paradas y Google Routes calcula tramos de máximo veintiséis destinos sin reorganizarlos. Si falta algún tiempo de atención antes del cliente, se comunica tiempo de conducción, sin presentarlo como tiempo completo de llegada.

GSGchat contesta los puntos actual y del cliente, paradas previas, kilómetros, minutos aproximados y horario cuando existe. No revela direcciones de otros clientes. Si falla Google, se conserva la información válida de GSG sin inventar kilómetros/minutos. Si falla GSG o la posición es antigua, se usa la respuesta existente sobre el estado y horario del pedido.

## Configuración y validación

- GSG saliente: `GSG_URL`, `GSG_LOCATION_PATH`, `GSG_API_KEY`, o los campos equivalentes de Conexión WhatsApp.
- Google: `GOOGLE_MAPS_API_KEY` con Geocoding API y Routes API habilitadas.
- IA: configurar y activar el proveedor existente del asistente.
- Idempotencia: `GSG_IDEMPOTENCY_SUPPORTED=true` solo cuando GSG confirme soporte de `Idempotency-Key`. Sin ese soporte, un POST de ubicación incierto queda para revisión, sin reintento automático.
- El panel continúa usando sesión de usuario; la integración de pedidos usa API key.

## Confirmación persistente y estados

Una propuesta confirmada se compara con su fecha y coordenadas bajo bloqueo de fila en MySQL. La ubicación y su reporte se guardan en una transacción. Los reportes se reservan condicionalmente antes del envío; una interrupción deja visible un resultado incierto. Los mensajes citados se contrastan con el id saliente, fecha y coordenadas persistidos. Tras sustituir una propuesta enviada, un SÍ textual aislado solicita confirmación mediante botón o cita vigente.

El seguimiento admite `estado`: pendiente, en_reparto, llegando, entregado, cancelado e incidencia. Los estados terminales pueden omitir posición y paradas. `versionRuta` aparece en el diagnóstico y `secuenciaCompleta` declara que no faltan paradas pendientes. La caché de treinta segundos se invalida al sincronizar o recargar ajustes; no es una suscripción instantánea a la ruta.

## Horarios nocturnos y actualizaciones

Para cruzar medianoche se requieren `fechaDesde`, `fechaHasta` y `zonaHoraria`, además de desde/hasta. Ejemplo: `{ "desde":"22:00", "hasta":"02:00", "fechaDesde":"2026-10-07", "fechaHasta":"2026-10-08", "zonaHoraria":"America/Lima" }`. Sin fechas sigue siendo obligatorio desde anterior a hasta. Un horario nuevo sustituye las fechas anteriores y PATCH con `horarioEntrega:null` borra la ventana. Estos campos están documentados en OpenAPI.

El cálculo sigue el contrato oficial de [Google Geocoding](https://developers.google.com/maps/documentation/geocoding/requests-geocoding) y [Google Routes computeRoutes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes).
