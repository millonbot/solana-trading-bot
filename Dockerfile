# Solana Institutional Trading Bot - Dockerfile
FROM node:18-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar código fuente
COPY src/ ./src/

# Crear usuario no-root por seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S botuser -u 1001

# Cambiar ownership de archivos
RUN chown -R botuser:nodejs /app
USER botuser

# Exponer puerto
EXPOSE 8080

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { host: 'localhost', port: process.env.PORT || 8080, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

# Comando de inicio
CMD ["npm", "start"]
