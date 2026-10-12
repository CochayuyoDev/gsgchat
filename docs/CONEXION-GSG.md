# Conexión con GSG

Hay dos conexiones y dos claves distintas. No se mezclan.

| | Saliente: GSGchat → GSG | Entrante: GSG → GSGchat |
|---|---|---|
| Para qué | GSGchat le manda a GSG cada ubicación (y el resto de reportes) | GSG nos manda los pedidos del día |
| Quién genera la clave | **GSG** | **GSGchat** (Conexión → «Crear la clave para GSG») |
| Dónde se guarda | En GSGchat: pantalla Conexión (cifrada) o `GSG_API_KEY` en el `.env` de GSGchat | En el `.env` **de GSG**, no en el de GSGchat |
| Cabecera | `X-API-Key: <clave de GSG>` | `X-API-Key: <clave de GSGchat>` |

En las dos, la clave va en la cabecera `X-API-Key`. Nunca va en la URL ni en el cuerpo.

GSGchat **nunca le pide nada a GSG**: ni la lista del día (no existe `GET /reparto/pendientes`), ni de forma automática cada pocos minutos, ni con un botón, ni al probar la conexión, ni para verificar el contrato o cerrar el día. Los pedidos entran solo cuando GSG los manda a `POST /api/v1/entregas`. El primer mensaje a cada cliente es la plantilla de solicitud de ubicación rellenada con los datos que mandó GSG.

## Conexión saliente (GSGchat → GSG)

Tres campos, en Conexión (o en el `.env`):

| Pantalla | `.env` | Ejemplo |
|---|---|---|
| URL base de GSG | `GSG_URL` | `https://backend.developer.gsgcorp.pe/api/` |
| Ruta para enviar la ubicación | `GSG_LOCATION_PATH` | `v1/gsgchat/location` |
| API Key de GSG | `GSG_API_KEY` | (la da GSG) |

La URL final es la base + la ruta: `https://backend.developer.gsgcorp.pe/api/v1/gsgchat/location`.
La pantalla la enseña en vivo antes de guardar. Reglas (`unirUrlGsg` en `src/rutas/gsg.ts`):

- La base tiene que ser `http(s)://dominio...`, sin usuario ni clave, sin `?` ni `#`, sin segmentos `..`.
  Se conserva su camino (`/api/`) y se le pone barra final.
- La ruta es relativa: se quitan las barras del principio y del final y se juntan las dobles.
  Se rechaza una ruta absoluta (`http://…`, cualquier `esquema:`, `//host`), con `..` o `.`, con `?` o `#`, con espacios o con `\`.
- Si la configuración no vale, no se envía nada: los reportes se quedan pendientes con el error a la vista.

Tras guardar, la clave solo se ve enmascarada (`••••` y los últimos 4).

### Prueba de conexión

«Probar» no hace ninguna llamada a GSG. Revisa sin red que la URL base y la ruta sean válidas (las mismas
reglas de arriba) y que la API Key tenga buena forma (sin espacios, al menos 8 caracteres), y explica el
modelo: GSG manda los pedidos a `POST /api/v1/entregas` y GSGchat le manda la ubicación (`POST` a base + ruta,
con `X-API-Key`) y los demás reportes. Si GSG rechaza la clave (401/403), se ve en la cola de reportes.

### Cola de reportes

| Respuesta de GSG | Qué pasa |
|---|---|
| 2xx | `enviado` (solo con 2xx) |
| 401 / 403 | `fallido` con el motivo; la cola se para y no se reintenta sola hasta que cambie la configuración (URL, ruta o clave) o alguien pulse «Enviar ahora» / «Enviar a GSG» |
| 429, 408, 5xx, timeout, sin red | sigue `pendiente` y se reintenta en la siguiente pasada (cada minuto) |
| otro 4xx | `fallido` (las ubicaciones las vuelve a poner en cola el reenvío automático, hasta 10 intentos) |
| configuración no válida | sigue `pendiente` con el error; no sale nada |

Ningún error guardado contiene la clave.

### Compatibilidad con lo configurado antes

- La clave: si no hay `GSG_API_KEY` se lee `GSG_TOKEN`; si no hay `gsg.apiKey` guardada se lee `gsg.token`
  (cifrada). Al guardar una nueva desde la pantalla, `gsg.token` se borra.
- La URL completa de antes (`urlUbicacion` guardada o `GSG_SEND_LOCATION_URL`) se convierte a base + ruta
  solo si es inequívoco (`migrarUbicacionAntigua`):
  1. Sin URL antigua: base = la dirección (sin `/sendLocation` si lo tenía), ruta = `sendLocation`. Sale a la misma URL de siempre.
  2. La URL antigua empieza por la dirección + `/`: base = la dirección, ruta = el resto.
  3. Si no, se parte por `/api/` cuando aparece una sola vez y la dirección no apunta a otro sitio.
  En otro caso, la pantalla y el estado muestran el error y no se envía nada hasta escribir la base y la ruta.

## Números reportados (para GSG)

Cuando un pedido que manda GSG trae un teléfono o un tracking que no sirve, GSGchat lo guarda con su error
concreto en su bandeja de números reportados. Se guarda **una sola vez por tracking + error**: no en cada reintento
ni en cada pasada del motor. Si GSG lo corrige y el mismo error vuelve después, se guarda otra vez.

GSGchat **no** le manda nada a GSG por esto (no hay POST ni ruta que configurar): Luis (GSG) lee la bandeja con
`GET /api/v1/reportados` y corrige con `POST /api/v1/reportados/{tracking}/correccion` (o `PATCH`). Además, cada
respuesta de `POST /api/v1/entregas` y `GET /api/v1/trackings` trae los avisos `reportado` / `corregido`.

### Errores

| `error` | Cuándo |
|---|---|
| `telefono_invalido` | El teléfono no es un número válido (o no vino). El pedido no se guarda. |
| `sin_whatsapp` | El número no tiene WhatsApp. |
| `envio_fallido` | WhatsApp rechazó el mensaje y ya no se reintenta solo. |
| `tracking_falta` | El pedido llegó sin tracking (la llamada da 400). |
| `tracking_invalido` | El tracking tiene más de 60 caracteres o caracteres de control (la llamada da 400). |
| `tracking_duplicado` | El mismo tracking vino dos veces en la misma llamada con teléfonos distintos. Se guarda solo el primero. |
| `tracking_de_otro_pedido` | El tracking ya es de otro pedido de hoy con otro teléfono. Este no se guarda. |
| `telefono_de_motorizado` | El teléfono es de un motorizado registrado, no de un cliente. No se guarda. |
| `no_soy_yo` | El cliente contestó que no es él (no hizo el pedido o el número no es suyo). |

### La bandeja: `GET /api/v1/reportados`

Es como GSG se entera de los números malos. Con la clave de GSGchat (`entregas:leer`). Filtros: `?estado=pendiente|corregido`, `?tracking=GSG-123`.
Cada elemento trae `clave`, `tracking`, `referencia`, `telefono`, `error`, `titulo`, `mensaje`, `detalle`,
`reportadoAt`, `estado` (`pendiente` o `corregido`), `corregidoAt` y `correccion`. Sale de la base de GSGchat:
GSG la lee cuando quiere. En el panel está en Pedidos GSG → «Números reportados», junto a la bandeja de errores.

### Corregir (GSG → GSGchat)

- `POST /api/v1/reportados/{tracking}/correccion` con `{ "telefono": "987654321" }`, `{ "tracking": "GSG-124" }`
  o los dos (`entregas:gestionar`). Sin tracking, se usa la `clave` que da la bandeja.
- O `PATCH /api/v1/entregas/{referencia}` con `{ "telefono": "987654321" }` (y el `tracking` como siempre).

Al corregir: lo pendiente de ese tracking pasa a `corregido`, el pedido cambia y, si aún falta la ubicación, se le
pide al número nuevo por el flujo normal (si «Confirmar y enviar» está encendido, espera a que una persona lo
confirme). Si el pedido no se llegó a guardar (teléfono inválido, de un motorizado, tracking malo), se crea ahora con
lo corregido. Respuestas: 200; 400 si lo corregido tampoco vale; 404 si no hay nada reportado; 409 si ya estaba
corregido o el tracking nuevo ya es de otro pedido de hoy.

### Lo que ya se hizo por WhatsApp

Cada respuesta a `POST /api/v1/entregas`, `PATCH /api/v1/entregas/{referencia}` y a la corrección trae `whatsapp`:
por pedido, lo que **ya** se hizo **hoy** con ese tracking o ese teléfono. Al cliente ya contactado no se le manda
otro mensaje.

| `codigo` | Ejemplo de `mensaje` |
|---|---|
| `ya_contactado` | Este tracking ya se le envió mensaje por WhatsApp el 10/10/2026 a las 09:15. No se le manda otro. |
| `agrupado_con` | Este teléfono ya tiene hoy el tracking «GSG-122»: va agrupado con ese y el cliente recibe un solo mensaje por los dos. (`con`: el otro tracking) |
| `ubicacion_pedida` | Ya se pidió la ubicación (2 veces, la última el ...). (`veces`) |
| `ubicacion_registrada` | Ubicación registrada el ... |
| `ubicacion_cambiada` | El cliente cambió su ubicación el ... |
| `confirmado` | El cliente confirmó el pedido el ... |
| `reportado` / `corregido` | Lo reportado de ese tracking y si ya se corrigió (`error`). |

Solo cuenta **el mismo día**: si GSG manda el mismo cliente (mismo teléfono, incluso el mismo tracking) otro día,
es un intento de entrega nuevo y se le vuelve a escribir. Dos trackings con el mismo teléfono el mismo día reciben
un solo mensaje, y la ubicación se le manda a GSG para los dos trackings.

### El mapa de trackings: `GET /api/v1/trackings?dia=AAAA-MM-DD`

Con `entregas:leer`; sin `dia`, hoy. Por tracking: `mensaje` (estado y `enviadoEn`), `contactado`/`contactadoEn`,
`agrupadoCon`, `ubicacion` (`estado`: pendiente, registrada, cambiada o no_hace_falta; `pedida`, `pedidaEn`,
`ultimaPeticionEn`, `veces`, `registradaEn`, `cambiadaEn`), `confirmacion`, `reportes` y `avisos` (los mismos
códigos de arriba). GSG lo lee cuando quiere; GSGchat nunca lo empuja ni le pregunta nada a GSG.
