// ===================================
// SOLANA INSTITUTIONA
// ===================================

// Cargar variables de entorno
require('dotenv').config();

const { AzureOpenAI } = require("openai");
const { CosmosClient } = require("@azure/cosmos");
const { Connection, PublicKey } = require("@solana/web3.js");
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const WebSocket = require('ws');
const TokenMigrationScanner = require('./TokenMigrationScanner');
const TradingModeSelector = require('./TradingModeSelector');
const TelegramInterface = require('./TelegramInterface');

// ======== Función para conectarse a SolanaStreaming ========
function connectSolanaStreaming(apiKey, handleMessage) {
  const ws = new WebSocket('wss://api.solanastreaming.com/', {
    headers: { 'X-API-KEY': apiKey }
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'newPairSubscribe' }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    } catch (err) {
      console.error('Error al parsear mensaje de SolanaStreaming:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('Error en WebSocket de SolanaStreaming:', err);
  });

  ws.on('close', () => {
    console.log('WebSocket cerrado; reconectando en 5 segundos...');
    setTimeout(() => connectSolanaStreaming(apiKey, handleMessage), 5000);
  });
}

// ======== Clase principal del bot ========
class InstitutionalTradingBot {
  constructor() {
    // Azure OpenAI (GPT-5-mini)
    this.openAI = new AzureOpenAI({
      endpoint: process.env.ENDPOINT_URL,
      apiKey: process.env.AZURE_OPENAI_KEY,
      apiVersion: "2024-02-15-preview",
      deployment: process.env.DEPLOYMENT_NAME
    });

    // Cosmos DB
    this.cosmos = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
    this.database = this.cosmos.database("SolanaTrading");
    this.container = this.database.container("TradingData");

    // Inicializar TradingModeSelector
    this.tradingMode = new TradingModeSelector();

    // Usar la conexión de Solana del TradingModeSelector
    this.solanaConnection = this.tradingMode.solanaConnection;

    // Configuración institucional
    this.config = {
      MIN_LIQUIDITY_USD: 15000,
      MAX_SPREAD: 0.025,
      MAX_PRICE_IMPACT: 0.03,
      MIN_DELTA_BUY: 2.0,
      MIN_BUYERS_ZSCORE: 2.0,
      MIN_WHALE_COUNT: 2,
      WHALE_THRESHOLD_USD: 1000,
      STOP_LOSS: 0.12,
      TAKE_PROFITS: [0.25, 0.60, 1.60],
      TRAILING_STOP_CAP: 0.25,
      TIME_STOP_SECONDS: 120,
      MAX_POSITION_PCT: 0.007,
      MIN_POSITION_USD: 150,
      EQUITY_USD: parseInt(process.env.EQUITY_USD) || 10000
    };

    this.positions = new Map();
    this.isRunning = false;
    this.stats = { totalTrades: 0, winRate: 0, totalPnL: 0, lastAnalysis: null }; 

    // Inicializar TokenMigrationScanner avanzado
    this.migrationScanner = new TokenMigrationScanner({
      rpcUrl: process.env.SOLANA_RPC_URL,
      onMigrationDetected: (migrationData) => this.handleNewMigration(migrationData)
    });

    // ===== COMANDOS TELEGRAM BÁSICOS MANTENIDOS =====
    this.setupBasicTelegramCommands();
    this.startWebServer();
  }  // ===================================
  // AQUÍ VAN TODOS LOS MÉTODOS DEL BOT
  // (analyzeToken, getRealTimeOrderFlow, validateInstitutionalFilters,
  // calculateQuantMetrics, performInstitutionalGPTAnalysis, etc.)
  // ===================================
  // ⚡ Los mantengo igual que en tu versión anterior
  // ===================================

  async handleNewMigration(migrationData) {
    // Verificar que el bot esté configurado y corriendo
    if (!this.tradingMode.isConfigured()) {
      console.log('🔴 Bot no configurado - omitiendo migración:', migrationData.tokenData.address);
      return;
    }
    
    if (!this.tradingMode.isRunning()) {
      console.log('🔴 Bot pausado - omitiendo migración:', migrationData.tokenData.address);
      return;
    }

    console.log('🔥 Nueva migración detectada:', migrationData.tokenData.address);
    
    try {
      // Analizar el token con GPT-5 Mini
      const analysis = await this.analyzeToken(migrationData.tokenData.address, false);
      
      // Log del análisis
      console.log(`📊 Análisis completado para ${migrationData.tokenData.symbol}:`, {
        action: analysis.action,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning
      });

      // Si es una oportunidad de trading, notificar
      if (analysis.action === 'BUY' && analysis.confidence > 7) {
        await this.notifyTradingOpportunity(migrationData.tokenData, analysis);
      }

    } catch (error) {
      console.error('❌ Error analizando nueva migración:', error.message);
    }
  }

  async notifyTradingOpportunity(tokenData, analysis) {
    // Enviar notificación a Telegram si está configurado
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (chatId && this.telegramBot) {
      const message = `
🚨 **OPORTUNIDAD DE TRADING DETECTADA**

🪙 **Token:** ${tokenData.symbol} (${tokenData.name})
📍 **Contract:** \`${tokenData.address}\`
📊 **Confianza:** ${analysis.confidence}/10

💰 **Datos del Token:**
• Liquidez: $${tokenData.liquidityUSD?.toLocaleString()}
• Market Cap: $${tokenData.marketCap?.toLocaleString()}
• Holders: ${tokenData.holderCount}
• Riesgo: ${tokenData.riskScore}/100

🧠 **Análisis GPT-5:**
${analysis.reasoning}

⏰ **Detectado:** ${new Date().toLocaleString()}
      `;

      try {
        await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log('📱 Notificación enviada a Telegram');
      } catch (error) {
        console.error('❌ Error enviando notificación a Telegram:', error.message);
      }
    }
  }

  setupBasicTelegramCommands() {
    // Solo comandos básicos que no interfieren con TelegramInterface
    
    this.telegramBot.onText(/\/analyze (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const tokenAddress = match[1];

      if (!this.tradingMode.isConfigured()) {
        await this.telegramBot.sendMessage(chatId, 'Bot no configurado. Usar /start para configurar primero.');
        return;
      }

      await this.telegramBot.sendMessage(chatId, `Analizando token: ${tokenAddress}...`);

      try {
        const analysis = await this.analyzeToken(tokenAddress, true);

        const message = `
**ANÁLISIS INSTITUCIONAL**
Token: \`${tokenAddress}\`

**Decisión**: ${analysis.action}
**Confianza**: ${analysis.confidence}/10
**Tamaño posición**: $${analysis.position_size_usd || 0}

**Razón**: ${analysis.reasoning}
${new Date().toLocaleString()}
        `;

        await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

      } catch (error) {
        await this.telegramBot.sendMessage(chatId, `Error: ${error.message}`);
      }
    });

    this.telegramBot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const configured = this.tradingMode.isConfigured();
      const running = this.tradingMode.isRunning();
      
      const message = `
**SOLANA TRADING BOT INTERACTIVO**

**Estado actual:**
• Configurado: ${configured ? 'Si' : 'No'}
• Ejecutandose: ${running ? 'Si' : 'No'}
• Modo: ${this.tradingMode.getMode().isPaperTrading ? 'PAPEL' : 'REAL'}

**Comandos principales:**
\`/start\` - Configurar e iniciar bot (uso el menu interactivo)
\`/analyze [token]\` - Analizar token específico
\`/help\` - Mostrar esta ayuda

**Configuracion interactiva:**
Usa /start para acceder al menu completo de configuracion
donde puedes seleccionar modo trading, configurar parametros,
iniciar/detener el bot y mas.

**Version:** Bot con configuracion dinamica via Telegram
      `;
      await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
  }

  startWebServer() {
    const app = express();
    app.use(express.json());
    // Endpoint de webhook para Telegram si está habilitado
    if (process.env.TELEGRAM_MODE === 'webhook' && process.env.TELEGRAM_WEBHOOK_URL) {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
      app.post('/telegram/webhook', (req, res) => {
        if (secret) {
          const header = req.get('x-telegram-bot-api-secret-token');
          if (header !== secret) {
            return res.sendStatus(401);
          }
        }
        try {
          this.telegramBot.processUpdate(req.body);
        } catch (e) {
          console.error('Error procesando update de Telegram:', e.message || e);
        }
        res.sendStatus(200);
      });
    }
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', bot_running: this.isRunning, timestamp: new Date().toISOString() });
    });
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      console.log(`Bot server running on port ${port}`);
      // Configurar webhook al arrancar el servidor si aplica
      if (process.env.TELEGRAM_MODE === 'webhook' && process.env.TELEGRAM_WEBHOOK_URL) {
        const url = process.env.TELEGRAM_WEBHOOK_URL;
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
        this.telegramBot.setWebHook(url, secret ? { secret_token: secret } : undefined)
          .then(() => console.log(`Webhook de Telegram configurado: ${url}`))
          .catch((e) => console.error('No se pudo configurar webhook de Telegram:', e.message || e));
      }
    });
  }
}

// ===================================
// INICIALIZAR BOT
// ===================================
async function startBot() {
  try {
    console.log("Iniciando Solana Institutional Trading Bot...");
    new InstitutionalTradingBot();
    console.log("Bot iniciado con polling en Telegram ✅");
  } catch (error) {
    console.error("Error iniciando bot:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  startBot();
}

module.exports = InstitutionalTradingBot;
