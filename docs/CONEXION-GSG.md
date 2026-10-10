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
