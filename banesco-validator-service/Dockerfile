# Imagen base ligera con Node 20
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Instalar dependencias primero para aprovechar la caché de capas.
# Usa npm ci si existe package-lock.json; si no, npm install.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copiar el resto del código (propiedad del usuario node, no root)
COPY --chown=node:node . .

# Ejecutar como usuario no root (incluido en la imagen oficial de node)
USER node

# Cloud Run enruta tráfico al puerto definido por PORT (8080 por defecto)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
