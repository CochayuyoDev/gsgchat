# wa-locator

WhatsApp + Google Maps: extrae coordenadas de links de mapas, comparte ubicacion
en vivo y manda plantillas masivas con las guardas anti-bloqueo cableadas.

```bash
docker compose up -d          # postgres + redis
cp .env.example .env          # rellenar credenciales
npm install
npm run migrate
npm run dev
```

Sin credenciales de Meta el geo core funciona igual:

```bash
npm test
npm run extract -- "https://maps.app.goo.gl/AbCdEf"
npm run templates:lint
```

---

## Lo que se puede y lo que no

| | |
|---|---|
| Recibir ubicacion nativa | ✅ el webhook trae lat/lng exactas |
| Recibir un link de mapa | ✅ 11 formatos, ver abajo |
| Enviar un pin de ubicacion | ✅ `type: location` |
| Enviar **live location** | ❌ **la Cloud API no lo soporta**: es una funcion de la app de consumidor |
| Pedir la ubicacion con un boton | ✅ `location_request_message` |
| Envio masivo | ✅ con plantilla aprobada + opt-in |

El "tiempo real" se resuelve con una pagina propia: WhatsApp solo transporta el
link. A cambio se gana caducidad controlada, varios espectadores y historico.

---

## Arquitectura

```
WhatsApp Cloud API
      │  webhook (firma X-Hub-256, responde 200 y procesa despues)
      ▼
 handlers/inbound ──▶ geo core ──▶ locations
      │                (extract)
      ▼
 outbound/sender ◀── gates (opt-in · ventana 24 h · calidad · frecuencia · cupo)
      │
      ├─▶ outbound/queue (BullMQ: ritmo constante, freno en seco)
      └─▶ whatsapp/client (API oficial)

 tracking/ ── token firmado ─▶ /t/:token ─▶ WebSocket ─▶ Google Maps JS
```

| Modulo | Que hace |
|---|---|
| `src/geo/` | extraccion de lat/lng (Fase 1, sin dependencias externas) |
| `src/whatsapp/` | firma del webhook, cliente de la Graph API, router de eventos |
| `src/handlers/` | conversacion: ubicacion, confirmacion, alta y baja |
| `src/templates/` | catalogo, linter, registro local y sincronizacion con Meta |
| `src/outbound/` | gates, warm-up, sender y cola |
| `src/tracking/` | tokens, hub de posiciones y paginas de rastreo |
| `src/admin/` | API de operacion: campanas, salud, enlaces, opt-in/out |

---

## Geo core: formatos soportados

| Fuente | Ejemplo |
|---|---|
| `whatsapp_native` | mensaje de ubicacion del webhook |
| `data_3d4d` | `/data=!8m2!3d19.43!4d-99.13` |
| `path_coords` | `/maps/place/19.43,-99.13` |
| `query_param` | `?q=` `?query=` `?destination=` `?daddr=` |
| `ll_param` | `?ll=` `?center=` `?mlat=&mlon=` (Waze, Apple, OSM) |
| `geo_uri` | `geo:19.43,-99.13` |
| `osm_hash` | `#map=17/19.43/-99.13` |
| `dms` | `19°25'57.4"N 99°07'59.5"W` |
| `plus_code` | `8FVC2222+22` (solo codigos completos) |
| `at_viewport` | `@19.43,-99.13,17z` — **baja confianza** |
| `bare_text` | `19.4326, -99.1332` pegado en el chat |

Acortadores (`maps.app.goo.gl`, `goo.gl`) se resuelven siguiendo redirects.

**Dos decisiones que conviene no tocar sin querer:**

1. **`!3d/!4d` gana sobre `@lat,lng`.** El `@` es el centro de la camara, no el
   lugar: si el usuario arrastro el mapa antes de compartir, apunta a cientos de
   metros. Cuando solo hay `@`, el resultado sale con `needsConfirmation: true`
   y el bot pregunta antes de que alguien salga a repartir. Orden en `PARSERS`
   (`src/geo/parsers.ts`).
2. **Los acortadores se resuelven con allowlist.** Abrir una URL que llego de
   fuera es un SSRF: bastaria un link que redirija a `169.254.169.254`.
   `src/util/net-guard.ts` limita hosts, exige IP publica en cada salto y corta
   a 5 redirecciones.

---

## Que evita realmente que bloqueen el numero

Meta no mide el volumen: mide **cuanta gente te bloquea y te reporta**. Una
plantilla aprobada mandada a una lista comprada tumba el numero igual. Por eso
las guardas van cableadas en `outbound/gates.ts` y no hay forma de saltarselas:

| Guarda | Regla |
|---|---|
| `opt_out` | una baja bloquea todo, sin excepciones ni override |
| `no_opt_in` | sin `opt_in_at` no sale nada iniciado por la empresa |
| `window_closed` | fuera de las 24 h solo se puede mandar plantilla |
| `template_not_approved` | solo plantillas APPROVED en el registro local |
| `template_quality` | plantilla en rojo (o amarillo si es marketing) se frena |
| `number_quality` | numero en rojo corta todo; en amarillo corta marketing |
| `frequency_cap` | maximo N mensajes de marketing por contacto cada 7 dias |
| `daily_cap` | warm-up: arranca en 50/dia y crece x1.5, con techo duro |

Tres webhooks alimentan esto: `message_template_status_update`,
`message_template_quality_update` y `phone_number_quality_update`. El ultimo
pausa la cola solo cuando Meta reporta rojo.

Un rechazo con espera (cupo, amarillo) se reprograma; uno definitivo (baja, sin
opt-in) se descarta. Todo intento —salga o no— deja fila en `deliveries`: los
bloqueos son la senal mas util para saber que una lista esta sucia antes de
quemar el numero con ella.

**Lo que este proyecto no hace:** rotacion de numeros para evadir limites,
proxies, envio sin opt-in o clientes no oficiales (Baileys, whatsapp-web.js).
Ademas de estar fuera de los terminos, es lo que provoca el baneo permanente.

---

## Plantillas

El catalogo (`src/templates/catalog.ts`) es lo que se manda a aprobar; el estado
real lo mantienen la sincronizacion y los webhooks.

```bash
npm run templates:lint    # revisa sin tocar nada
npm run templates:push    # revisa y da de alta en Meta (se niega si hay errores)
npm run templates:sync    # trae estado y calidad desde Meta
```

El linter (`src/templates/lint.ts`) implementa las reglas de aprobacion como
codigo: opt-out obligatorio en marketing, deteccion de marketing disfrazado de
utility, lexico que dispara los filtros de spam, mayusculas sostenidas, y las
reglas de variables de Meta (numeracion sin saltos, no empezar ni terminar con
variable, no dos seguidas).

Vienen cuatro listas y sin errores: `confirmacion_pedido`,
`seguimiento_entrega`, `recuperacion_carrito` (marketing, con BAJA) y
`recordatorio_cita`.

---

## Rastreo en vivo

Cada sesion emite **dos** tokens firmados: uno para quien publica su posicion y
otro para quien la mira. Que sean distintos es lo que impide que quien recibe el
link pueda falsear la posicion.

```bash
curl -X POST localhost:3000/admin/tracking \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"phone":"5215512345678","label":"Pedido A-1024","notify":true}'
```

Devuelve `publishUrl` (para el repartidor) y `viewUrl` (para el cliente). Los
puntos se persisten filtrados: solo si hubo 15 m de movimiento o 10 s desde el
ultimo guardado, aunque al mapa se reparten todos.

Rastrear a una persona requiere su consentimiento explicito y registrado (en
Mexico, LFPDPPP). El token con caducidad y revocacion cubre parte de eso por
diseno.

---

## API de operacion

Todas bajo `Authorization: Bearer $ADMIN_TOKEN`.

| Metodo | Ruta | |
|---|---|---|
| GET | `/admin/health` | calidad del numero, cupo, enviados hoy, estado de la cola |
| GET | `/admin/templates` | registro local con estado y calidad |
| POST | `/admin/pause` | freno de emergencia (pausa numero y cola) |
| POST | `/admin/campaigns` | crea campana y encola (a los opt-in si no das lista) |
| GET | `/admin/campaigns/:id/stats` | conteo por estado de entrega |
| POST | `/admin/tracking` | crea sesion de rastreo |
| DELETE | `/admin/tracking/:id` | revoca una sesion |
| POST | `/admin/messages/text` | mensaje de texto suelto |
| POST | `/admin/messages/location` | pin desde un link de mapa o coordenadas |
| POST | `/admin/messages/ask-location` | boton nativo para pedir la ubicacion |
| POST | `/admin/geo/extract` | extrae lat/lng sin enviar nada |
| GET/POST | `/admin/settings` | credenciales: leer enmascaradas / guardar y probar |
| POST | `/admin/contacts/opt-in` | registra consentimiento con su origen |
| POST | `/admin/contacts/opt-out` | baja manual |

Publicas: `GET /webhooks/whatsapp` (verificacion), `POST /webhooks/whatsapp`,
`GET /t/:token`, `WS /ws/track/:token`, `GET /health`.

---

## La web

Nada de esto necesita editar ficheros ni usar la terminal.

| Ruta | Que es |
|---|---|
| `/setup` | pegas las credenciales de Meta, prueba la conexion contra la Graph API y te da la URL y el token del webhook para copiar |
| `/panel` | enviar texto, mandar un pin desde un link de mapa, pedir la ubicacion al cliente, crear sesiones de rastreo, lanzar campanas y ver la salud del numero |
| `/t/<token>` | pagina de rastreo (Google Maps si hay clave; si no, OpenStreetMap) |

El token de administracion se genera solo en el primer arranque, se guarda en
`.secrets.json` y se imprime en consola. La web lo pide una vez y lo deja en
`sessionStorage`.

Las credenciales que guardes en `/setup` van cifradas (AES-256-GCM) a la tabla
`settings` y ganan sobre las variables de entorno. Cambiar un token no obliga a
reiniciar: el cliente de la API y el webhook leen siempre las vigentes.

Para verlo sin Postgres, Redis ni credenciales: `npm run demo` levanta el
servidor real con la capa de datos en memoria.

## Puesta en marcha

1. `docker compose up -d`, `npm run migrate` y `npm run dev`. Arranca aunque no
   haya credenciales.
2. Abre `/setup` con el token que sale en consola y sigue los pasos: crear la
   app en Meta, registrar el numero y pegar aqui token, IDs y app secret.
   **Ese numero no puede estar activo en la app normal de WhatsApp ni en
   WhatsApp Business**; si lo esta, borra antes esa cuenta desde la app.
3. Copia de `/setup` la URL y el token del webhook a Meta, y suscribe
   `messages`, `message_template_status_update`,
   `message_template_quality_update` y `phone_number_quality_update`.
4. `npm run templates:push` y esperar aprobacion.
5. `npm run templates:sync`.
6. Cargar contactos **con su opt-in y su origen** (`POST /admin/contacts/opt-in`).
7. Primera campana pequena. Mirar `/admin/health` antes de subir volumen.

Restringir la key de Google Maps por referrer HTTP: viaja al navegador dentro de
la pagina de rastreo.

## Tests

173 tests, sin Postgres ni Redis: los repositorios tienen dobles en memoria
(`tests/fakes.ts`).

```bash
npm test
npm run typecheck
```
