# Imagen de wa-locator: compila TypeScript y arranca el servidor + worker.
#
# La app no lleva MySQL/MariaDB ni Redis dentro: se los da docker-compose (o
# el entorno) por DATABASE_URL y REDIS_URL. Las migraciones se aplican solas
# al arrancar.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY saas ./saas
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# mysqldump, para la copia diaria de la base (sin el, se usa el volcado propio).
RUN apk add --no-cache mariadb-client
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
# El contrato para los programadores de GSG se descarga desde Conexion.
COPY docs ./docs
# .secrets.json (token de admin, clave de cifrado) se escribe aqui: montar
# un volumen para que sobreviva a un recreate del contenedor.
# Lo que debe sobrevivir a un recreate: secretos, la vinculacion del QR, los
# adjuntos, los respaldos de conversaciones y la carpeta de copias diarias.
VOLUME ["/app/data", "/app/.wa-auth", "/app/.wa-media", "/app/respaldos", "/app/copias"]
ENV SECRETS_DIR=/app/data
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
