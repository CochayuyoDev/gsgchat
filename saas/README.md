# El SaaS: una instancia por tienda

Cada cliente tiene **su** wa-locator: su contenedor, su base de datos, su
Redis, su numero de WhatsApp y sus ficheros. Nada se comparte. Lo unico
comun es Postgres (una base por tienda) y Caddy, que enruta por subdominio
y saca el HTTPS solo.

```
tienda1.wa.tuservicio.com  →  wa-tienda1  →  base wa_tienda1  →  su WhatsApp
tienda2.wa.tuservicio.com  →  wa-tienda2  →  base wa_tienda2  →  su WhatsApp
maestro.wa.tuservicio.com  →  tu panel para dar de alta y de baja
```

## Requisitos

- Un servidor Linux con Docker y Node 20+.
- Un DNS comodin: `*.wa.tuservicio.com → IP del servidor`. Caddy pide los
  certificados solo (puertos 80 y 443 abiertos).
- Para probar en tu maquina: `DOMINIO_BASE=localhost:8080` y nada mas;
  `*.localhost` resuelve solo en el navegador.

## Puesta en marcha

```bash
cp saas/.env.example saas/.env      # DOMINIO_BASE, POSTGRES_PASSWORD, MAESTRO_CLAVE
npm install
npm run saas:base                   # construye la imagen y levanta Caddy + Postgres
npm run saas:alta -- tienda1 --nombre "Zapateria Lima"
```

Al terminar imprime la URL de la tienda. Ahi el cliente entra a `/login`,
crea su primera cuenta y conecta su WhatsApp en `/setup` (QR, Meta o WAHA),
como en cualquier instalacion. Desde ese momento tiene su API, sus
webhooks, sus conectores y su chat embebido, todos suyos.

| Comando | Que hace |
|---|---|
| `npm run saas:base` | construye la imagen y levanta lo comun; se puede repetir (tambien para actualizar la imagen) |
| `npm run saas:alta -- <slug> [--nombre "..."] [--proveedor local\|cloud\|waha] [--pais peru\|mexico\|generico]` | crea base, ficheros, contenedor y subdominio |
| `npm run saas:baja -- <slug>` | para el contenedor; **conserva** base y volumenes |
| `npm run saas:baja -- <slug> --borrar-datos` | y borra base, volumenes y ficheros |
| `npm run saas:estado` | que instancias hay y si responden |
| `npm run saas:maestro` | el panel maestro antiguo (usuario y contrasena de `saas/.env`). **Hoy lo mismo esta dentro del panel del sistema, en Mi negocio → Tiendas (superadministrador)**: alta con plan, pagos, suspender, token, y si este panel corre en este servidor, "Crear tambien su instalacion" levanta el contenedor y el subdominio sin consola |
| `npm run saas:prueba [-- --limpiar]` | la prueba de punta a punta: crea tres tiendas de prueba y comprueba todo (cuentas, claves, webhooks firmados, conectores, chat web, embebido y aislamiento) |

El `slug` es el subdominio: minusculas, numeros y guiones, de 2 a 30.

## Actualizar todas las tiendas

```bash
git pull
npm run saas:base                                          # imagen nueva
for d in saas/instancias/*/; do docker compose -f "$d/compose.yml" up -d; done
```

Cada instancia aplica sus migraciones al arrancar. Los volumenes (datos,
vinculacion de WhatsApp, adjuntos, respaldos) sobreviven.

## Que hay en cada instancia

`saas/instancias/<slug>/`:

- `.env`: su `PUBLIC_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, proveedor, pais.
  Se puede editar (por ejemplo `GOOGLE_MAPS_API_KEY` o `STOKY_URL`) y
  `docker compose -f .../compose.yml up -d` para aplicarlo.
- `compose.yml`: la app y su Redis, colgados de la red `wa-saas`.
- `instancia.json`: lo basico para el maestro.
- `plan.json`: su plan, hasta cuando esta pagado, los pagos apuntados y el
  token con el que la instancia pregunta por su plan (ver *Planes y cobro*).

`saas/caddy/instancias/<slug>.caddy`: su subdominio. Se recarga solo.

## Como se conecta cada proyecto a su tienda

Igual que con una instalacion suelta, pero contra su subdominio:

- Stoky de la tienda 1: `https://tienda1.wa…/api/v1` con una clave creada en
  *esa* instancia (`/panel#integraciones`).
- Su WooCommerce o Shopify: pega `https://tienda1.wa…/conectores/<id>`.
- Su web: `<script src="https://tienda1.wa…/embed.js">` y `WA.montar(...)` o
  `WA.flotante(...)`.

Una clave de la tienda 1 no abre nada de la tienda 2: son servidores
distintos.

## Planes y cobro

Los planes viven en `saas/planes.ts` (precios y limites se cambian ahi):

| Plan | Precio | IA | Campañas | Conectores | Usuarios |
|---|---|---|---|---|---|
| Prueba | gratis, 14 dias | 300 respuestas/mes | si | si | 2 |
| Basico | S/ 49/mes | 2.000 respuestas/mes | no | si | 3 |
| Pro | S/ 149/mes | sin limite | si | si | sin limite |

Como funciona:

1. Cada tienda nace en **Prueba** con 14 dias. Su `.env` lleva `PLAN_URL`
   (el maestro, `http://host.docker.internal:3900/api/plan/<slug>`) y
   `PLAN_TOKEN`. Con eso la instancia pregunta por su plan al arrancar y
   cada 15 minutos; guarda la respuesta, asi que un reinicio o un maestro
   caido no la dejan a ciegas ni la paran.
2. **Cobras tu**, como quieras. En el maestro, en la tienda → *Apuntar
   pago*: plan, meses, monto cobrado (o el de lista) y una nota. El
   vencimiento corre desde lo que quede (si aun no vencio) o desde hoy.
   Tambien se puede cambiar el vencimiento a mano (una cortesia) y escribir
   que ve la tienda para renovar ("Escríbenos al ...").
3. Una semana antes de vencer, la tienda ve una franja naranja en todas sus
   pantallas. **Vencido**: franja roja, el asistente IA calla y no se crean
   campañas; los chats, el reparto y todo lo demas siguen, para que la tienda
   no pierda clientes mientras renueva. En su *Configuración* ve su plan,
   cuanto lleva de IA este mes y hasta cuando esta pagado.
4. El tope de respuestas de IA se cuenta por mes en la propia instancia; al
   llegar, la IA se para hasta el mes siguiente y el panel lo dice.

El maestro ensena el cobro mensual con los planes vigentes. La API (con el
usuario del maestro): `POST /api/instancias/:slug/pagos {plan, meses,
monto?, nota?}`, `PATCH /api/instancias/:slug/plan {plan?, vencimiento?,
contacto?}`, `GET /api/instancias/:slug/pagos`. Una instalacion suelta (sin
`PLAN_URL`) no tiene plan: todo permitido.

## Recursos

Unos 150–250 MB de RAM por instancia (Node + su Redis + la sesion de
Baileys si usa QR). Un servidor de 8 GB atiende 25–30 tiendas. Cuando
pasen de unas 50, es momento de pensar en multi-tenant dentro del codigo.

## Copias de seguridad

Lo que importa esta en tres sitios: la base de cada tienda (`pg_dump` en
`wa-saas-postgres`), sus volumenes (`docker volume ls | grep wa-<slug>`) y
`saas/instancias/`. Un `pg_dumpall` del contenedor de Postgres mas una copia
de los volumenes lo cubre todo.
