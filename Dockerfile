FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install production deps first for better caching
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the source code
COPY . .

# Expose HTTP port
EXPOSE 3000

# Start the bot
CMD ["node","src/bot.js"]
