# Imagen de wa-locator: compila TypeScript y arranca el servidor + worker.
#
# La app no lleva Postgres ni Redis dentro: se los da docker-compose (o el
# entorno) por DATABASE_URL y REDIS_URL. Las migraciones se aplican solas
# al arrancar.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
# .secrets.json (token de admin, clave de cifrado) se escribe aqui: montar
# un volumen para que sobreviva a un recreate del contenedor.
VOLUME ["/app/data"]
ENV SECRETS_DIR=/app/data
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
