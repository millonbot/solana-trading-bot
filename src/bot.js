// ===================================
// SOLANA INSTITUTIONAL TRADING BOT
// Lógica de Order Flow + GPT-5-mini + Azure Cloud
// ===================================

const { AzureOpenAI } = require("openai");
const { CosmosClient } = require("@azure/cosmos");
const { Connection, PublicKey } = require("@solana/web3.js");
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const WebSocket = require('ws');

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

    // Solana Connection
    this.solanaConnection = new Connection(process.env.SOLANA_RPC_URL, {
      commitment: "confirmed"
    });

    // Telegram Bot (📌 activado con polling en lugar de webhook)
    this.telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
      polling: true
    });

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

    // Conectar a SolanaStreaming
    const solanaApiKey = process.env.SOLANASTREAMING_API_KEY;
    connectSolanaStreaming(solanaApiKey, (event) => {
      const tokenAddress = event?.params?.pair?.baseToken?.account;
      if (tokenAddress) {
        this.analyzeToken(tokenAddress, false)
          .then((decision) => {
            console.log('Análisis automático de nuevo par:', tokenAddress, decision);
          })
          .catch((err) => {
            console.error('Error analizando nuevo par', tokenAddress, err);
          });
      }
    });

    this.setupTelegramCommands();
    this.startWebServer();
  }

  // ===================================
  // AQUÍ VAN TODOS LOS MÉTODOS DEL BOT
  // (analyzeToken, getRealTimeOrderFlow, validateInstitutionalFilters,
  // calculateQuantMetrics, performInstitutionalGPTAnalysis, etc.)
  // ===================================
  // ⚡ Los mantengo igual que en tu versión anterior
  // ===================================

  setupTelegramCommands() {
    this.telegramBot.onText(/\/analyze (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const tokenAddress = match[1];

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

    this.telegramBot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      const message = `
**ESTADÍSTICAS DEL BOT**
Estado: ${this.isRunning ? 'Activo' : 'Inactivo'}
Total Trades: ${this.stats.totalTrades}
Win Rate: ${this.stats.winRate}%
PnL Total: $${this.stats.totalPnL}
Equity: $${this.config.EQUITY_USD}
Última actualización: ${new Date().toLocaleString()}
      `;
      await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    this.telegramBot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const message = `
**SOLANA TRADING BOT**
Comandos:
\`/analyze [token]\`
\`/stats\`
\`/help\`
\`/start\`
\`/stop\`
      `;
      await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
  }

  startWebServer() {
    const app = express();
    app.use(express.json());
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', bot_running: this.isRunning, timestamp: new Date().toISOString() });
    });
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      console.log(`Bot server running on port ${port}`);
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
