# Solana Institutional Trading Bot

Un bot de trading institucional para Solana que utiliza análisis de order flow, inteligencia artificial y métricas cuantitativas para tomar decisiones de trading automatizadas.

## Características

### ✅ Funcionalidades Implementadas

- 🤖 **Bot de Telegram**: Control completo a través de comandos de Telegram
- 📊 **Análisis de Tokens**: Análisis técnico y fundamental automatizado
- 🔍 **Filtros Institucionales**: Validación de liquidez, volumen y métricas de calidad
- 📈 **Métricas Cuantitativas**: Scoring system para evaluar oportunidades de trading
- 🌐 **API de Solana**: Conexión directa a la blockchain de Solana
- 🔄 **Monitoreo en Tiempo Real**: Detección automática de nuevos pares (opcional)
- 🧠 **Integración con GPT**: Análisis con inteligencia artificial (opcional)
- 💾 **Persistencia de Datos**: Almacenamiento en Azure Cosmos DB (opcional)

### 🎯 Comandos de Telegram

- `/start` - Iniciar el bot de trading
- `/stop` - Detener el bot
- `/analyze <token_address>` - Analizar un token específico
- `/stats` - Ver estadísticas del bot
- `/help` - Mostrar ayuda y comandos disponibles

### 🔧 Configuración

El bot requiere las siguientes variables de entorno:

#### Obligatorias
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

#### Opcionales (para funcionalidades avanzadas)
```env
# Azure OpenAI para análisis con GPT
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
ENDPOINT_URL=https://your-resource.openai.azure.com/
DEPLOYMENT_NAME=your_gpt_deployment_name

# Azure Cosmos DB para persistencia
COSMOS_DB_CONNECTION_STRING=your_cosmos_db_connection_string

# SolanaStreaming para detección en tiempo real
SOLANASTREAMING_API_KEY=your_solanastreaming_api_key

# Configuración de trading
EQUITY_USD=10000
PORT=8080
```

### 🚀 Instalación y Uso

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/millonbot/solana-trading-bot.git
   cd solana-trading-bot
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**
   ```bash
   cp .env.example .env
   # Editar .env con tus configuraciones
   ```

4. **Ejecutar el bot**
   ```bash
   npm start
   ```

### 🐳 Docker

```bash
# Construir la imagen
docker build -t solana-trading-bot .

# Ejecutar el contenedor
docker run -d --env-file .env -p 8080:8080 solana-trading-bot
```

### 📋 Configuración de Trading

El bot incluye configuraciones institucionales predefinidas:

- **Liquidez mínima**: $15,000 USD
- **Spread máximo**: 2.5%
- **Impacto de precio máximo**: 3%
- **Stop Loss**: 12%
- **Take Profits**: 25%, 60%, 160%
- **Tamaño máximo de posición**: 0.7% del equity

### 🔍 Análisis de Tokens

El bot evalúa tokens basándose en:

1. **Filtros Institucionales**
   - Liquidez suficiente
   - Volumen de trading
   - Validación de precio y dirección

2. **Métricas Cuantitativas**
   - Score de liquidez
   - Score de volumen
   - Estabilidad de precio
   - Score de capitalización de mercado

3. **Análisis GPT** (opcional)
   - Análisis contextual con inteligencia artificial
   - Evaluación de viabilidad institucional

### 🛡️ Características de Seguridad

- ✅ Validación de variables de entorno
- ✅ Manejo robusto de errores
- ✅ Fallback para servicios opcionales
- ✅ Logging detallado
- ✅ Health check endpoint (`/health`)

### 📊 API REST

El bot expone un endpoint de salud:

```
GET /health
```

Respuesta:
```json
{
  "status": "healthy",
  "bot_running": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 🐛 Solución de Problemas

#### El bot no se inicia
- Verificar que `TELEGRAM_BOT_TOKEN` y `SOLANA_RPC_URL` estén configurados
- Revisar los logs para errores específicos

#### Comandos de Telegram no responden
- Verificar que el token de Telegram sea válido
- Confirmar conectividad a internet

#### Análisis GPT no funciona
- Es opcional - el bot funciona sin GPT
- Verificar configuración de Azure OpenAI si es necesario

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el repositorio
2. Crear una rama para tu feature
3. Commit tus cambios
4. Push a la rama
5. Crear un Pull Request

## 📄 Licencia

MIT License - ver el archivo LICENSE para detalles.

## ⚠️ Disclaimer

Este bot es para propósitos educativos y de investigación. El trading de criptomonedas conlleva riesgos significativos. Usa bajo tu propia responsabilidad.