// ===================================
// SOLANA INSTITUTIONAL TRADING BOT
// Lógica de Order Flow + GPT-5-mini + Azure Cloud
// ===================================

require('dotenv').config();

const { AzureOpenAI } = require("openai");
const { CosmosClient } = require("@azure/cosmos");
const { Connection, PublicKey } = require("@solana/web3.js");
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const WebSocket = require('ws');

// ======== Validación de variables de entorno ========
function validateEnvironmentVariables() {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'SOLANA_RPC_URL'
  ];
  
  const optional = [
    'AZURE_OPENAI_API_KEY',
    'ENDPOINT_URL',
    'DEPLOYMENT_NAME',
    'COSMOS_DB_CONNECTION_STRING',
    'SOLANASTREAMING_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const missingOptional = optional.filter(key => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn(`Warning: Missing optional environment variables: ${missingOptional.join(', ')}`);
    console.warn('Some features may be limited without these variables.');
  }
}

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
    // Validate environment variables first
    validateEnvironmentVariables();

    // Azure OpenAI (GPT-5-mini) - Optional
    this.openAI = null;
    if (process.env.AZURE_OPENAI_API_KEY && process.env.ENDPOINT_URL && process.env.DEPLOYMENT_NAME) {
      try {
        this.openAI = new AzureOpenAI({
          endpoint: process.env.ENDPOINT_URL,
          apiKey: process.env.AZURE_OPENAI_API_KEY,
          apiVersion: "2024-02-15-preview",
          deployment: process.env.DEPLOYMENT_NAME
        });
        console.log('✅ Azure OpenAI configured successfully');
      } catch (error) {
        console.warn('⚠️ Azure OpenAI configuration failed:', error.message);
      }
    } else {
      console.warn('⚠️ Azure OpenAI not configured - GPT analysis will be unavailable');
    }

    // Cosmos DB - Optional
    this.cosmos = null;
    this.database = null;
    this.container = null;
    if (process.env.COSMOS_DB_CONNECTION_STRING) {
      try {
        this.cosmos = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
        this.database = this.cosmos.database("SolanaTrading");
        this.container = this.database.container("TradingData");
        console.log('✅ Cosmos DB configured successfully');
      } catch (error) {
        console.warn('⚠️ Cosmos DB configuration failed:', error.message);
      }
    } else {
      console.warn('⚠️ Cosmos DB not configured - data persistence will be unavailable');
    }

    // Solana Connection
    this.solanaConnection = new Connection(process.env.SOLANA_RPC_URL, {
      commitment: "confirmed"
    });
    console.log('✅ Solana connection configured');

    // Telegram Bot (📌 activado con polling en lugar de webhook)
    this.telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
      polling: {
        interval: 1000,
        autoStart: true,
        params: {
          timeout: 10
        }
      }
    });
    
    // Handle polling errors gracefully
    this.telegramBot.on('polling_error', (error) => {
      console.warn('⚠️ Telegram polling error (this is normal in testing environments):', error.message);
    });
    
    console.log('✅ Telegram bot configured');

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

    // Conectar a SolanaStreaming - Optional
    if (process.env.SOLANASTREAMING_API_KEY) {
      try {
        connectSolanaStreaming(process.env.SOLANASTREAMING_API_KEY, (event) => {
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
        console.log('✅ SolanaStreaming configured successfully');
      } catch (error) {
        console.warn('⚠️ SolanaStreaming connection failed:', error.message);
      }
    } else {
      console.warn('⚠️ SolanaStreaming not configured - real-time pair detection unavailable');
    }

    this.setupTelegramCommands();
    this.startWebServer();
    
    console.log('🚀 Institutional Trading Bot initialized successfully');
  }

  // ===================================
  // CORE TRADING METHODS
  // ===================================

  async analyzeToken(tokenAddress, detailed = false) {
    try {
      console.log(`🔍 Analyzing token: ${tokenAddress}`);
      
      // Basic token validation
      if (!tokenAddress || tokenAddress.length < 32) {
        throw new Error('Invalid token address');
      }

      // Get basic token info
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      
      // Perform institutional filters
      const filters = await this.validateInstitutionalFilters(tokenAddress, tokenInfo);
      
      // Calculate metrics
      const metrics = await this.calculateQuantMetrics(tokenAddress, tokenInfo);
      
      // GPT Analysis (if available)
      let gptAnalysis = null;
      if (this.openAI) {
        gptAnalysis = await this.performInstitutionalGPTAnalysis(tokenAddress, tokenInfo, metrics);
      }

      // Make trading decision
      const decision = this.makeInstitutionalDecision(filters, metrics, gptAnalysis);
      
      // Store analysis if database is available
      if (this.container) {
        await this.storeAnalysis(tokenAddress, decision, metrics);
      }

      return decision;
    } catch (error) {
      console.error(`❌ Error analyzing token ${tokenAddress}:`, error.message);
      return {
        action: 'HOLD',
        confidence: 0,
        reasoning: `Analysis failed: ${error.message}`,
        position_size_usd: 0
      };
    }
  }

  async getTokenInfo(tokenAddress) {
    try {
      // Simulate getting token info - in real implementation, this would call DexScreener API
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        return {
          address: tokenAddress,
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          name: pair.baseToken?.name || 'Unknown Token',
          price: parseFloat(pair.priceUsd) || 0,
          liquidity: parseFloat(pair.liquidity?.usd) || 0,
          volume24h: parseFloat(pair.volume?.h24) || 0,
          priceChange24h: parseFloat(pair.priceChange?.h24) || 0,
          fdv: parseFloat(pair.fdv) || 0
        };
      }
      
      throw new Error('Token not found');
    } catch (error) {
      console.warn(`⚠️ Could not fetch token info for ${tokenAddress}:`, error.message);
      return {
        address: tokenAddress,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        price: 0,
        liquidity: 0,
        volume24h: 0,
        priceChange24h: 0,
        fdv: 0
      };
    }
  }

  async validateInstitutionalFilters(tokenAddress, tokenInfo) {
    const filters = {
      liquidityCheck: tokenInfo.liquidity >= this.config.MIN_LIQUIDITY_USD,
      volumeCheck: tokenInfo.volume24h > 0,
      priceValidation: tokenInfo.price > 0,
      addressValidation: tokenAddress.length >= 32
    };

    filters.passed = Object.values(filters).every(check => check === true);
    
    return filters;
  }

  async calculateQuantMetrics(tokenAddress, tokenInfo) {
    // Simplified metrics calculation
    const metrics = {
      liquidityScore: Math.min(tokenInfo.liquidity / this.config.MIN_LIQUIDITY_USD, 10),
      volumeScore: Math.min(tokenInfo.volume24h / 10000, 10),
      priceStability: Math.max(0, 10 - Math.abs(tokenInfo.priceChange24h)),
      marketCapScore: tokenInfo.fdv > 0 ? Math.min(tokenInfo.fdv / 1000000, 10) : 0
    };

    metrics.overallScore = (metrics.liquidityScore + metrics.volumeScore + metrics.priceStability + metrics.marketCapScore) / 4;
    
    return metrics;
  }

  async performInstitutionalGPTAnalysis(tokenAddress, tokenInfo, metrics) {
    if (!this.openAI) {
      return null;
    }

    try {
      const prompt = `
Analyze this Solana token for institutional trading:

Token: ${tokenInfo.symbol} (${tokenInfo.name})
Address: ${tokenAddress}
Price: $${tokenInfo.price}
Liquidity: $${tokenInfo.liquidity}
24h Volume: $${tokenInfo.volume24h}
24h Change: ${tokenInfo.priceChange24h}%
FDV: $${tokenInfo.fdv}

Metrics:
- Liquidity Score: ${metrics.liquidityScore}/10
- Volume Score: ${metrics.volumeScore}/10
- Price Stability: ${metrics.priceStability}/10
- Market Cap Score: ${metrics.marketCapScore}/10

Provide a brief analysis (max 200 words) focusing on institutional viability.
`;

      const response = await this.openAI.chat.completions.create({
        model: process.env.DEPLOYMENT_NAME,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      });

      return response.choices[0]?.message?.content || 'GPT analysis unavailable';
    } catch (error) {
      console.warn('⚠️ GPT analysis failed:', error.message);
      return 'GPT analysis failed';
    }
  }

  makeInstitutionalDecision(filters, metrics, gptAnalysis) {
    let action = 'HOLD';
    let confidence = 0;
    let reasoning = 'Insufficient data for trading decision';
    let positionSize = 0;

    if (!filters.passed) {
      return {
        action: 'REJECT',
        confidence: 0,
        reasoning: 'Failed institutional filters',
        position_size_usd: 0
      };
    }

    // Scoring system
    const score = metrics.overallScore;
    
    if (score >= 7) {
      action = 'BUY';
      confidence = Math.min(score, 10);
      positionSize = Math.min(this.config.EQUITY_USD * this.config.MAX_POSITION_PCT, this.config.EQUITY_USD * 0.05);
      reasoning = `Strong institutional signals detected. Score: ${score.toFixed(1)}/10`;
    } else if (score >= 5) {
      action = 'WATCH';
      confidence = score;
      reasoning = `Moderate signals. Monitoring recommended. Score: ${score.toFixed(1)}/10`;
    } else {
      action = 'HOLD';
      confidence = score;
      reasoning = `Weak institutional signals. Score: ${score.toFixed(1)}/10`;
    }

    return {
      action,
      confidence: Math.round(confidence),
      reasoning: gptAnalysis ? `${reasoning}\n\nGPT Analysis: ${gptAnalysis}` : reasoning,
      position_size_usd: Math.round(positionSize)
    };
  }

  async storeAnalysis(tokenAddress, decision, metrics) {
    if (!this.container) return;

    try {
      await this.container.items.create({
        id: `${tokenAddress}_${Date.now()}`,
        tokenAddress,
        decision,
        metrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.warn('⚠️ Failed to store analysis:', error.message);
    }
  }

  async startBot() {
    this.isRunning = true;
    console.log('🟢 Bot started and monitoring markets');
  }

  async stopBot() {
    this.isRunning = false;
    console.log('🔴 Bot stopped');
  }

  // ===================================
  // TELEGRAM COMMANDS
  // ===================================

  setupTelegramCommands() {
    // Start command
    this.telegramBot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      await this.startBot();
      const message = `
🚀 **SOLANA TRADING BOT INICIADO**

Estado: ✅ Activo
Equity: $${this.config.EQUITY_USD}
Configuración:
- Min Liquidity: $${this.config.MIN_LIQUIDITY_USD}
- Max Position: ${(this.config.MAX_POSITION_PCT * 100).toFixed(1)}%
- Stop Loss: ${(this.config.STOP_LOSS * 100).toFixed(1)}%

El bot está monitoreando el mercado automáticamente.
Usa /help para ver comandos disponibles.
      `;
      await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // Stop command
    this.telegramBot.onText(/\/stop/, async (msg) => {
      const chatId = msg.chat.id;
      await this.stopBot();
      const message = `
🛑 **BOT DETENIDO**

El bot ha sido detenido y ya no monitoreará nuevos tokens.
Las posiciones abiertas se mantienen.

Usa /start para reactivar el bot.
      `;
      await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

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
    console.log("🚀 Iniciando Solana Institutional Trading Bot...");
    validateEnvironmentVariables();
    const bot = new InstitutionalTradingBot();
    console.log("✅ Bot iniciado exitosamente");
  } catch (error) {
    console.error("❌ Error iniciando bot:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startBot();
}

module.exports = InstitutionalTradingBot;
