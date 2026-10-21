# ---------- Compilación ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- Ejecución ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY database ./database
USER node
EXPOSE 3000
# Prepara la base (crea, carga el respaldo si está vacía y completa el esquema) y arranca la API.
CMD ["sh", "-c", "node dist/scripts/init-db.js && node dist/server.js"]
