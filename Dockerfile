# Solana Institutional Trading Bot - Dockerfile
FROM node:20-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm install --production

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

# Health check (corregido)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node","-e","const http=require('http'); const port=process.env.PORT||8080; const req=http.request({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, res => { process.exit(res.statusCode===200?0:1); }); req.on('error', () => process.exit(1)); req.end(); setTimeout(() => process.exit(1), 2500);"]

# Comando de inicio
CMD ["node", "src/bot.js"]
