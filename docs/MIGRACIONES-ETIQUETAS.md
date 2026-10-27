# Migraciones del etiquetado de chats (013, 014 y 015): qué hacer al desplegar

## En corto

**No hay que ejecutar nada a mano.** Se despliega el código nuevo y se reinicia el servicio (`node dist/src/main.js`,
el `CMD` del Dockerfile). Al arrancar, GSGchat aplica solo las migraciones pendientes de `db/migrations/`:

- en la base de `DATABASE_URL`,
- y en la base de **cada tienda** del directorio (`<raíz>_t_<id>`), una por una, al abrirla.

Cada migración aplicada queda apuntada en la tabla `schema_migrations` de su base y no se vuelve a ejecutar.
Si arrancan varias instancias a la vez, se turnan con un `GET_LOCK` por base: no migran dos al mismo tiempo.

Las bases de reserva del banco (`<raíz>_banco_*`) no hay que tocarlas: si se prepararon con las migraciones de
antes, se descartan y se rehacen solas.

## Antes de desplegar

1. **Copia de seguridad** de las bases (la de `DATABASE_URL`, `<raíz>_plataforma` y las `<raíz>_t_*`), como en cualquier despliegue con migraciones.
2. El usuario de la base tiene que poder `CREATE TABLE`, `ALTER TABLE` y crear índices. Es el mismo permiso que ya usan las migraciones anteriores, así que no hay que cambiar nada.
3. Motor: MySQL 8 o MariaDB 10.4 o superior. Se probaron en MariaDB 10.4.32; la sintaxis es la misma en MySQL 8 (no usan `DEFAULT` en columnas `TEXT` ni `JSON`).
4. **No hay variables de entorno nuevas.**

`<raíz>` es el nombre de la base de `DATABASE_URL` (por ejemplo, con `mysql://…/gsgchat`: `gsgchat_plataforma`,
`gsgchat_t_<id>`, `gsgchat_banco_*`).

## Qué cambian

Las tres solo **añaden**: no modifican ni borran datos existentes. Tardan menos de un segundo por base.

| Migración | Qué hace |
|---|---|
| `013_etiquetas_chat.sql` | Crea la tabla `chat_etiquetas` (la etiqueta de cada conversación del día). |
| `014_etiquetas_chat_sync.sql` | Añade a `chat_etiquetas` las columnas del envío a GSG (`lote_id`, `sync_estado`, `sync_intentos`, `sync_error`, `sync_at`, `sync_huella`) y el índice `chat_etiquetas_sync_idx`. Crea las tablas `chat_etiquetas_lotes` y `chat_etiquetas_eventos`. |
| `015_etiquetas_lote_chats_catalogo.sql` | Crea `chat_etiquetas_lote_chats` (cada chat de cada lote, con la copia de sus mensajes en una columna `json` y su estado) y `chat_etiquetas_catalogo` (el catálogo de etiquetas del negocio; vacía = el de fábrica). |

La 014 altera una tabla que acaba de crear la 013 (vacía), así que el `ALTER` no bloquea nada.

**Datos personales:** `chat_etiquetas_lote_chats.mensajes` guarda una copia del texto de los mensajes del día que
se clasificaron. La propia aplicación la vacía (`mensajes = null`) a las 72 horas, la misma retención que los
mensajes del chat, cada vez que se lanza un lote. Si las copias de seguridad tienen otra política de retención,
conviene saberlo.

## Comprobar que se aplicaron

En cada base (la de `DATABASE_URL` y cada `<raíz>_t_<id>`):

```sql
select name, applied_at from schema_migrations
 where name in ('013_etiquetas_chat.sql', '014_etiquetas_chat_sync.sql', '015_etiquetas_lote_chats_catalogo.sql');
-- Deben salir las tres.

show tables like 'chat_etiquetas%';
-- chat_etiquetas, chat_etiquetas_catalogo, chat_etiquetas_eventos, chat_etiquetas_lote_chats, chat_etiquetas_lotes
```

Las tiendas y sus bases:

```sql
select id, slug from <raíz>_plataforma.pl_tiendas;   -- base de cada una: <raíz>_t_<id>
```

En el log de arranque, un fallo de migración impide que esa tienda arranque y se ve el error de SQL.

## Si la política exige ejecutar el SQL a mano

Se puede, siempre **antes de arrancar el código nuevo**, base por base (la de `DATABASE_URL` y cada
`<raíz>_t_<id>`; **no** las `<raíz>_banco_*`), en este orden:

```sql
-- 1. El contenido de db/migrations/013_etiquetas_chat.sql
-- 2. El contenido de db/migrations/014_etiquetas_chat_sync.sql
-- 3. El contenido de db/migrations/015_etiquetas_lote_chats_catalogo.sql
-- 4. Apuntarlas, para que la aplicación no las repita al arrancar:
insert into schema_migrations (name) values
  ('013_etiquetas_chat.sql'), ('014_etiquetas_chat_sync.sql'), ('015_etiquetas_lote_chats_catalogo.sql');
```

Ojo: la 013 y la 015 se pueden repetir sin problema (`create table if not exists`), pero **la 014 no**: su
`ALTER TABLE … ADD COLUMN` falla con «Duplicate column name» si ya se aplicó. Por eso hay que apuntarlas en
`schema_migrations` justo después.

## Si una migración se quedó a medias

En MySQL/MariaDB cada `CREATE`/`ALTER` se confirma solo: si la 014 se corta a mitad (por ejemplo, se cayó la
conexión), la aplicación no la apunta y al volver a arrancar intentará el `ALTER` otra vez, que fallará con
«Duplicate column name». Para terminarla a mano en esa base:

```sql
-- ¿Qué quedó hecho?
show columns from chat_etiquetas like 'sync_%';
show tables like 'chat_etiquetas_%';
```

Ejecutar solo las partes de `014_etiquetas_chat_sync.sql` que falten (las columnas, o los `create table if not exists`
de `chat_etiquetas_lotes` y `chat_etiquetas_eventos`, que se pueden repetir) y después:

```sql
insert into schema_migrations (name) values ('014_etiquetas_chat_sync.sql');
```

Si la que se cortó es la 015, basta con volver a arrancar: sus dos `create table if not exists` se repiten sin problema.

## Volver atrás

Solo si se vuelve a la versión anterior del código (la anterior no usa estas tablas, así que también puede
quedarse con ellas sin problema). En cada base:

```sql
drop table if exists chat_etiquetas_lote_chats;
drop table if exists chat_etiquetas_catalogo;
drop table if exists chat_etiquetas_eventos;
drop table if exists chat_etiquetas_lotes;
drop table if exists chat_etiquetas;
delete from schema_migrations
 where name in ('013_etiquetas_chat.sql', '014_etiquetas_chat_sync.sql', '015_etiquetas_lote_chats_catalogo.sql');
```

Se pierden las etiquetas de los chats, su historial de envíos a GSG y el catálogo propio de cada negocio. No
afecta a pedidos, mensajes ni contactos.

## Después del despliegue (no es de base de datos)

Para que las etiquetas salgan hacia GSG, cada tienda tiene que tener:

- la IA conectada (Avanzado → Asistente IA),
- y en Conexión con GSG la «Ruta para etiquetas de chats» (por ejemplo `v1/gsgchat/labels`), cuando GSG tenga ese endpoint.

Sin esa ruta el etiquetado funciona igual, pero no se manda nada a GSG: los envíos quedan como fallidos con el
motivo y se pueden reintentar después desde Chats. Cada negocio puede ajustar su catálogo de etiquetas en
Chats → ⋮ → «Catálogo de etiquetas…»; si no lo toca, usa el de fábrica. El contrato del envío está en
`docs/CONEXION-GSG.md` → «Etiquetas de los chats».
