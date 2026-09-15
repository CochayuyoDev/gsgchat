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
| `npm run saas:maestro` | el panel maestro (usuario y contrasena de `saas/.env`) |
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

## Recursos

Unos 150–250 MB de RAM por instancia (Node + su Redis + la sesion de
Baileys si usa QR). Un servidor de 8 GB atiende 25–30 tiendas. Cuando
pasen de unas 50, es momento de pensar en multi-tenant dentro del codigo.

## Copias de seguridad

Lo que importa esta en tres sitios: la base de cada tienda (`pg_dump` en
`wa-saas-postgres`), sus volumenes (`docker volume ls | grep wa-<slug>`) y
`saas/instancias/`. Un `pg_dumpall` del contenedor de Postgres mas una copia
de los volumenes lo cubre todo.
