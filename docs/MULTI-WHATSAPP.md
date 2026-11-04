# Varias cuentas de WhatsApp por tienda

Una tienda puede tener hasta 8 líneas en una sola bandeja. Este documento dice qué número le escribe a cada cliente y cuándo puede cambiar.

## La regla

**Un cliente se queda con su número.** Su línea se guarda en `contacts.whatsapp_number_id`, así que se recuerda aunque el chat se borre a las 72 horas.

| Situación | Qué pasa |
|---|---|
| Cliente nuevo que nosotros contactamos | Entra por la línea más desahogada y se queda con ella |
| Cliente nuevo que nos escribe | Se queda con la línea a la que escribió |
| Cliente con línea | Sigue por ella, aunque otra esté más libre |
| Su línea se cae menos de lo configurado (30 min por defecto) | Se espera y se reintenta cada 2 minutos, sin cambiar de número |
| Su línea sigue caída pasado el plazo | Pasa a otra activa y se queda en ella, aunque la vieja regrese |
| Su línea se quita o se deshabilita | Pasa a otra activa en el acto |
| No hay ninguna otra activa | Conserva su línea y espera |
| Su línea gastó el cupo o tiene pausa de salud | No cambia: mover esos mensajes solo quemaría otro número |
| El cliente escribe a otro de nuestros números | Se le sigue por ese |
| Una persona elige otra línea en el chat | Sale por esa y queda como su línea; si no está conectada, no se sustituye |
| Grupo | Nunca se reparte ni se cambia: vive en la línea de la que es miembro |

## Cómo se reparte

`src/whatsapp/reparto-lineas.ts` elige, entre las líneas conectadas y sin pausa manual, la de menor `(mensajes de hoy + clientes nuevos de hoy) / cupo del día`. A igual carga decide quién lleva menos clientes y después el orden de las líneas. No hay azar.

Una línea recién conectada tiene poco cupo por el calentamiento y por eso recibe menos clientes que una veterana. Las que gastaron el cupo se saltan, salvo que lo hayan gastado todas.

## Dónde está cada cosa

- **Decisión de la línea:** `lineaDelTrabajo` en `src/outbound/sender.ts`.
- **Asignación y registro:** `src/db/lineas-contacto.ts`. Cada movimiento exige que el cliente siga en la línea de partida, así dos envíos a la vez no lo dejan en dos líneas.
- **Tiempo sin conexión:** `sinConexionDesde` en `src/whatsapp/registro.ts`. Vive en memoria a propósito: tras un reinicio toda línea tarda en reconectar y hay que darle el plazo completo.
- **Pantalla:** Conexión → Líneas de WhatsApp (reparto, espera y últimos cambios). Datos en `GET` y `PATCH /admin/lineas/reparto`.

## Al desplegar

1. Hacer copia de la base.
2. Aplicar las migraciones `016`, `017` y `018`. La `018` asigna a los clientes existentes la línea de su último mensaje o, si no tiene, la principal. Hay que aplicarla **antes de agregar líneas nuevas**: sin ella, esos clientes contarían como nuevos y podrían recibir un número desconocido.
3. Reiniciar el servicio. Las secundarias se reconectan solas si ya estaban vinculadas.

## Seguimiento en producción

Durante los primeros días, revisar en Conexión → Líneas de WhatsApp:

- **Reparto:** con todas las líneas conectadas, «Nuevos hoy» debe ir parejo en proporción al cupo.
- **Cambios:** «Últimos cambios de línea» debe estar casi vacío. Muchos cambios con motivo «su línea seguía sin conexión» indican una línea inestable o un plazo demasiado corto.

Y comprobar con un pedido real de un número propio:

1. El pedido entra y sale el primer mensaje.
2. Los recordatorios salen del mismo número.
3. El pin registra la ubicación y llega a GSG.
4. Un segundo pedido del mismo cliente sale del mismo número.

## Límites conocidos

- La ventana de 24 horas de Meta se calcula por cliente, no por línea. Si un cliente pasa a una línea de la API oficial, un texto libre puede ser rechazado por Meta hasta que conteste. Con líneas por QR no aplica.
- El ritmo de envío (marcapasos) es de toda la tienda, no por línea: agregar líneas reparte el riesgo y el cupo diario, pero no acelera los envíos por minuto.
- `/health`, el vigilante y el resumen del día siguen mirando solo la línea principal.
- Con la cola en memoria, lo encolado se pierde al reiniciar (ya era así). La asignación del cliente sí queda guardada.
