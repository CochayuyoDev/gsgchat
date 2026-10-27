# Postman: etiquetas de chats y su envío a GSG

Prueba de punta a punta, contra un GSGchat de verdad, del etiquetado de Chats con IA y su sincronización con GSG
por número de WhatsApp (contrato en `docs/CONEXION-GSG.md` → «Etiquetas de los chats»).

| Archivo | Qué es |
|---|---|
| `GSGchat-etiquetas.postman_collection.json` | La colección: 31 peticiones con sus `pm.test` |
| `local.postman_environment.json` | El entorno: servidor, tienda, cuenta, mock y la API Key de GSG de prueba |
| `mock-externos.mjs` | La IA (compatible con OpenAI) y el endpoint de GSG, simulados, con un panel de control para forzar fallos |
| `sembrar.ts` | Crea en la tienda los chats de hoy que la colección espera |

## Qué comprueba

1. **Preparación**: sin sesión da 401; entra; conecta la IA (mock) y GSG (mock) con una API Key equivocada; una ruta de etiquetas inválida da 400.
2. **Lote con la clave rechazada**: 3 conversaciones (Luis está guardado dos veces y cuenta una), las 3 por la IA. GSG responde 401 al primer envío: no se insiste con las demás, quedan fallidas, el lote termina `completado_con_errores` y el registro lo apunta sin la clave.
3. **Reintentar solo lo fallido**: con la clave buena, Ana falla con 503 → 2 enviadas, 1 fallida. Luego Ana vuelve → el reintento manda solo a Ana, con la misma `Idempotency-Key`. La IA no se vuelve a llamar en ningún reintento. Lo que recibe GSG va por número, sin tracking. Sin nada fallido: `{ nada: true }`. Un día mal escrito da 400.
4. **Sin cambios**: otro lote reutiliza las 3 etiquetas, sin IA y sin GSG.
5. **Bandeja, lotes y registro**: la etiqueta junto a cada chat (también en el segundo contacto de Luis), el orden y el estado de los lotes, el registro filtrado por número (con 9 dígitos), por fase, un nivel que no existe da 400 y un lote que no existe da 404.

## Cómo correrla

Con el servidor levantado (`npm run quick`, aquí con `DATABASE_URL=mysql://root@127.0.0.1:3306/gsgnotas`):

```powershell
# 1. El mock de IA y GSG (puerto 3999)
node docs/postman/etiquetas/mock-externos.mjs 3999

# 2. La tienda de pruebas (una sola vez)
Invoke-RestMethod -Method Post -Uri http://localhost:3000/registro -ContentType 'application/json' `
  -Body '{"tienda":"Pruebas etiquetas","nombre":"Postman","usuario":"pruebas.etiquetas","clave":"Etiquetas-2026-prueba"}'

# 3. Los chats de hoy (antes de cada corrida: deja las etiquetas de esos números a cero)
npx tsx docs/postman/etiquetas/sembrar.ts pruebas-etiquetas mysql://root@127.0.0.1:3306/gsgnotas

# 4. La colección (local: no sube nada a la nube de Postman)
postman collection run docs/postman/etiquetas/GSGchat-etiquetas.postman_collection.json `
  -e docs/postman/etiquetas/local.postman_environment.json --timeout-request 30000
```

También se puede importar la colección y el entorno en Postman de escritorio y correrla con el Runner, en orden.

## Tienda de demostración (para probar a mano en el navegador)

`sembrar.ts <slug> [DATABASE_URL] --demo` llena una tienda con 24 clientes de hoy: uno por cada etiqueta del
catálogo, y además una conversación con varias peticiones (ya resuelta la primera), un cliente guardado dos
veces, uno que no contestó, uno con el que la IA falla («Sin clasificar») y uno que ya recibió. Después de
conectar la IA y GSG de la tienda al mock (como en la carpeta «0 · Preparación» de la colección), para que GSG
falle una sola vez con dos números y se pueda probar «Reintentar envíos»:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3999/control/gsg -ContentType 'application/json' `
  -Body '{"fallarUnaVez":["51987651021","51987651022"]}'
```

Ojo: correr la colección de Postman reinicia el mock (`/control/reset`) y quita esos fallos.

La tienda de pruebas es independiente: no toca las demás tiendas ni su WhatsApp. La colección configura su IA
y su conexión con GSG apuntando al mock.
