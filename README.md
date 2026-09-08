# wa-locator

Conecta tu cuenta de WhatsApp Business (API oficial de Meta) y automatiza
mensajes y seguimientos: respuestas por palabra clave, secuencias de varios
pasos, envios programados, campanas con plantilla, ubicacion en vivo y
extraccion de coordenadas desde cualquier link de mapa. Con las guardas
anti-bloqueo cableadas para no quemar el numero.

```bash
docker compose up -d          # app + postgres + redis, todo junto
```

O sin Docker:

```bash
docker compose up -d postgres redis
npm install
npm run dev                   # aplica migraciones y arranca
```

Abre `http://localhost:3000`. El token de administracion sale en la consola al
arrancar; la web lo pide una vez.

Sin credenciales de Meta se puede ver todo funcionando con datos de ejemplo:

```bash
npm run demo                  # servidor real, capa de datos en memoria
```

Y el geo core corre sin nada montado:

```bash
npm test
npm run extract -- "https://maps.app.goo.gl/AbCdEf"
npm run templates:lint
```

---

## Como se conecta una cuenta

Todo desde `/setup`, sin editar ficheros.

1. **Consigue las credenciales en Meta.** App de tipo Empresa en
   [developers.facebook.com](https://developers.facebook.com/apps) con el
   producto WhatsApp, numero registrado en WhatsApp Manager y un token
   permanente de usuario del sistema con `whatsapp_business_messaging` y
   `whatsapp_business_management`. **El numero no puede estar activo en la app
   normal de WhatsApp ni en WhatsApp Business**; si lo esta, borra antes esa
   cuenta desde la app. Meta regala un numero de prueba para empezar.
2. **Pegalas en `/setup`.** Se guardan cifradas (AES-256-GCM) en la tabla
   `settings` y ganan sobre las variables de entorno. Cambiar un token no
   obliga a reiniciar.
3. **Copia de `/setup` la URL y el token del webhook a Meta**, y suscribe
   `messages`, `message_template_status_update`,
   `message_template_quality_update` y `phone_number_quality_update`.
4. **Pulsa "Suscribir app"**. Sin ese paso Meta no manda ni un webhook aunque
   la URL este perfecta: es el olvido mas comun.
5. **Registra el numero** con su PIN de seis digitos (solo la primera vez).
6. **Mandate un mensaje de prueba** con la plantilla `hello_world`.

"Comprobar estado" responde las cuatro preguntas de golpe: si el token vale, si
el numero responde y con que calidad y tier, si la app esta suscrita y si el
webhook esta completo.

En local Meta necesita una URL publica:
`npx cloudflared tunnel --url http://localhost:3000`, y esa URL en
`PUBLIC_BASE_URL`.

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
| Responder texto libre | ✅ solo dentro de las 24 h desde el ultimo mensaje del cliente |

El "tiempo real" se resuelve con una pagina propia: WhatsApp solo transporta el
link. A cambio se gana caducidad controlada, varios espectadores e historico.

---

## Automatizacion

Tres piezas, todas configurables desde `/panel` sin tocar codigo.

**Reglas de respuesta.** Se evaluan sobre lo que escribe el cliente, despues de
BAJA/ALTA y antes de buscar coordenadas:

| Disparador | Cuando |
|---|---|
| `keyword` | el texto contiene, empieza por o es exactamente una palabra |
| `first_message` | el primer mensaje que manda ese contacto (bienvenida) |
| `any` | cualquier texto sin coordenadas que no caso con nada |

Una regla responde, inscribe en una secuencia, o las dos cosas. En los textos
valen `{nombre}`, `{telefono}` y `{fecha}`.

**Secuencias de seguimiento.** Una lista ordenada de pasos con retardo (minutos,
horas o dias desde el paso anterior). Cada paso es una plantilla aprobada o un
texto libre. Al inscribir a un contacto se programa el primer paso; cuando ese
sale, se programa el siguiente.

Si el contacto responde, la secuencia se cancela (configurable por secuencia).
Es lo que evita mandar "no hemos sabido de ti" a quien acaba de contestar.

**Mensajes programados.** Un envio suelto a una fecha y hora. Los pasos de las
secuencias viven en la misma tabla, asi que se ven y se cancelan igual.

Un ticker procesa lo vencido cada 10 segundos. Ningun camino se salta las
guardas: un paso bloqueado con espera (cupo diario, calidad en amarillo) se
reprograma sin avanzar la secuencia; uno bloqueado en firme (baja, sin opt-in)
la cierra, porque insistir solo suma bloqueos.

---

## Arquitectura

```
WhatsApp Cloud API
      │  webhook (firma X-Hub-256, responde 200, procesa despues, deduplica)
      ▼
 handlers/inbound ──▶ geo core (extract)   ──▶ locations
      │            └─▶ automation (reglas) ──▶ enrollments
      ▼
 outbound/sender ◀── gates (opt-in · ventana 24 h · calidad · frecuencia · cupo)
      │                       ▲
      │                       │
      ├─▶ outbound/queue      └── automation/engine (ticker de programados)
      └─▶ whatsapp/client (API oficial)

 tracking/ ── token firmado ─▶ /t/:token ─▶ WebSocket ─▶ Google Maps o Leaflet
```

| Modulo | Que hace |
|---|---|
| `src/geo/` | extraccion de lat/lng, sin dependencias externas |
| `src/whatsapp/` | firma del webhook, cliente de la Graph API, router de eventos |
| `src/handlers/` | conversacion: ubicacion, confirmacion, alta, baja y reglas |
| `src/automation/` | reglas, secuencias, programados y su ticker |
| `src/templates/` | catalogo, linter, registro local y sincronizacion con Meta |
| `src/outbound/` | gates, warm-up, sender y cola |
| `src/tracking/` | tokens, hub de posiciones y paginas de rastreo |
| `src/admin/` | API de operacion |
| `src/web/` | `/setup` y `/panel` |
| `src/runtime.ts` | arranque comun del servidor y de los CLIs |

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
`message_template_quality_update` y `phone_number_quality_update`. Del ultimo se
traduce el evento real (`FLAGGED`, `UNFLAGGED`, `DOWNGRADE`, `UPGRADE`), que es
lo que Meta manda de verdad: no viene un color. `FLAGGED` pausa la cola;
`UNFLAGGED` la reanuda **solo si fue el sistema quien pauso**, nunca una pausa
manual. El boton "Sincronizar con Meta" del panel pregunta la calidad y el tier
directamente, que es la unica forma de enterarse de un estado anterior a la
suscripcion del webhook.

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
real lo mantienen la sincronizacion y los webhooks. Desde el panel se hace lo
mismo sin terminal.

```bash
npm run templates:lint    # revisa sin tocar nada
npm run templates:push    # revisa y da de alta en Meta (se niega si hay errores)
npm run templates:sync    # trae estado y calidad desde Meta
```

Los tres usan las credenciales vigentes, incluidas las que pegaste en `/setup`.

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
ultimo guardado, aunque al mapa se reparten todos. El panel lista las sesiones
vigentes, cuanta gente las mira y permite revocarlas.

Rastrear a una persona requiere su consentimiento explicito y registrado (en
Mexico, LFPDPPP). El token con caducidad y revocacion cubre parte de eso por
diseno.

---

## La web

Nada de esto necesita editar ficheros ni usar la terminal.

| Ruta | Que es |
|---|---|
| `/setup` | credenciales, estado de la conexion, suscribir la app, registrar el numero y mandar un mensaje de prueba |
| `/panel` | diez pestanas: estado, enviar, contactos, ubicaciones, en vivo, campanas, automatizacion, plantillas, historial y extraer |
| `/t/<token>` | pagina de rastreo (Google Maps si hay clave; si no, OpenStreetMap) |

El token de administracion se genera solo en el primer arranque, se guarda en
`.secrets.json` y se imprime en consola. La web lo pide una vez y lo deja en
`sessionStorage`.

---

## API de operacion

Todas bajo `Authorization: Bearer $ADMIN_TOKEN`.

| Metodo | Ruta | |
|---|---|---|
| GET | `/admin/health` | calidad, tier, cupo, enviados hoy, estado de la cola |
| POST | `/admin/number/sync` | pregunta a Meta la calidad y el tier reales |
| POST | `/admin/pause` | freno de emergencia (pausa numero y cola) |
| GET | `/admin/contacts` | lista con busqueda, filtro y ultima ubicacion |
| POST | `/admin/contacts/import` | alta masiva con opt-in y su origen |
| POST | `/admin/contacts/opt-in` · `/opt-out` | consentimiento individual |
| GET | `/admin/locations` | ubicaciones recibidas |
| GET | `/admin/deliveries` | historial de envios con el motivo de cada bloqueo |
| POST | `/admin/campaigns` · GET `/admin/campaigns` | lanzar y listar con conteos |
| GET | `/admin/campaigns/:id/stats` | conteo por estado de entrega |
| GET | `/admin/templates` · `/templates/catalog` | registro local y catalogo con lint |
| POST | `/admin/templates/sync` · `/templates/push` | sincronizar y dar de alta |
| GET/POST/DELETE | `/admin/automation/rules` | reglas de respuesta |
| GET/POST/PUT/DELETE | `/admin/automation/sequences` | secuencias y sus pasos |
| POST | `/admin/automation/sequences/:id/enroll` | inscribir telefonos |
| GET | `/admin/automation/enrollments` | inscripciones y su proximo envio |
| GET/POST | `/admin/automation/scheduled` | mensajes programados |
| POST | `/admin/automation/run` | procesar ahora lo vencido |
| GET/POST | `/admin/automation/prefs` | preferencias del bot |
| GET/POST/DELETE | `/admin/tracking` | sesiones de rastreo |
| POST | `/admin/messages/text` · `/location` · `/ask-location` | envios sueltos |
| POST | `/admin/geo/extract` | extrae lat/lng sin enviar nada |
| GET/POST | `/admin/settings` | credenciales: leer enmascaradas / guardar y probar |
| GET | `/admin/settings/status` | radiografia de la conexion |
| POST | `/admin/settings/subscribe` · `/register` · `/test-message` | activar la cuenta |

Publicas: `GET /webhooks/whatsapp` (verificacion), `POST /webhooks/whatsapp`,
`GET /t/:token`, `WS /ws/track/:token`, `GET /health`.

---

## Puesta en marcha

1. `docker compose up -d`. Arranca aunque no haya credenciales y aplica las
   migraciones solo.
2. Conecta la cuenta en `/setup` siguiendo los seis pasos de arriba.
3. `npm run templates:push` (o el boton del panel) y esperar aprobacion.
4. `npm run templates:sync`.
5. Cargar contactos **con su opt-in y su origen** desde la pestana Contactos.
6. Crear las reglas y secuencias que hagan falta en Automatizacion.
7. Primera campana pequena. Mirar el estado del numero antes de subir volumen.

Restringir la key de Google Maps por referrer HTTP: viaja al navegador dentro de
la pagina de rastreo.

## Tests

234 tests. La mayoria no necesita nada montado: los repositorios tienen dobles
en memoria (`tests/fakes.ts`). Los de `tests/postgres.test.ts` corren el SQL de
verdad —migraciones incluidas— sobre PGlite, que es Postgres compilado a
WebAssembly, asi que tampoco hacen falta Docker ni un servidor.

```bash
npm test
npm run typecheck
```
