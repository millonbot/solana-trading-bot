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

    // Telegram Bot
    this.telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
      polling: false
    });

    // Trading Configuration (Institucional)
    this.config = {
      // Filtros críticos
      MIN_LIQUIDITY_USD: 15000,
      MAX_SPREAD: 0.025,
      MAX_PRICE_IMPACT: 0.03,
      MIN_DELTA_BUY: 2.0,
      MIN_BUYERS_ZSCORE: 2.0,
      MIN_WHALE_COUNT: 2,
      WHALE_THRESHOLD_USD: 1000,
      
      // Risk Management
      STOP_LOSS: 0.12,
      TAKE_PROFITS: [0.25, 0.60, 1.60],
      TRAILING_STOP_CAP: 0.25,
      TIME_STOP_SECONDS: 120,
      
      // Position Sizing
      MAX_POSITION_PCT: 0.007,
      MIN_POSITION_USD: 150,
      EQUITY_USD: parseInt(process.env.EQUITY_USD) || 10000
    };

    // Estado del bot
    this.positions = new Map();
    this.isRunning = false;
    this.stats = {
      totalTrades: 0,
      winRate: 0,
      totalPnL: 0,
      lastAnalysis: null
    };

    this.setupTelegramCommands();
    this.startWebServer();
  }

  // ===================================
  // ANÁLISIS INSTITUCIONAL PRINCIPAL
  // ===================================
  async analyzeToken(tokenAddress, forcedAnalysis = false) {
    try {
      console.log(`🧠 [INSTITUCIONAL] Analizando: ${tokenAddress}`);
      
      // 1. OBTENER DATOS REAL-TIME
      const realTimeData = await this.getRealTimeOrderFlow(tokenAddress);
      if (!realTimeData) {
        return { action: "SKIP", reason: "No data available" };
      }

      // 2. FILTROS INSTITUCIONALES (4 DIMENSIONES)
      const filterCheck = await this.validateInstitutionalFilters(realTimeData);
      if (!filterCheck.passed && !forcedAnalysis) {
        return { action: "SKIP", reason: filterCheck.reason };
      }

      // 3. MÉTRICAS CUANTITATIVAS
      const quantMetrics = await this.calculateQuantMetrics(realTimeData);
      
      // 4. GPT-5-MINI COMO ÁRBITRO INSTITUCIONAL
      const gptDecision = await this.performInstitutionalGPTAnalysis(quantMetrics);
      
      // 5. MÁQUINA DE ESTADOS (FSM)
      const finalDecision = await this.executeTradingFSM(gptDecision, quantMetrics);
      
      // 6. GUARDAR ANÁLISIS
      await this.saveAnalysis(tokenAddress, finalDecision, quantMetrics);
      
      return finalDecision;
      
    } catch (error) {
      console.error("❌ Error en análisis institucional:", error);
      return { action: "ERROR", reason: error.message };
    }
  }

  // ===================================
  // OBTENER DATOS DE ORDER FLOW REAL-TIME
  // ===================================
  async getRealTimeOrderFlow(tokenAddress) {
    try {
      // Obtener transacciones recientes
      const signatures = await this.solanaConnection.getSignaturesForAddress(
        new PublicKey(tokenAddress),
        { limit: 100 }
      );

      let buyVolume = 0;
      let sellVolume = 0;
      let uniqueBuyers = new Set();
      let uniqueSellers = new Set();
      let whaleTransactions = [];
      let totalVolume = 0;

      // Analizar últimas 20 transacciones
      for (const sig of signatures.slice(0, 20)) {
        try {
          const tx = await this.solanaConnection.getTransaction(sig.signature);
          if (!tx || !tx.meta) continue;

          const analysis = this.analyzeTx(tx, tokenAddress);
          
          if (analysis.type === 'BUY') {
            buyVolume += analysis.volume;
            uniqueBuyers.add(analysis.wallet);
          } else if (analysis.type === 'SELL') {
            sellVolume += analysis.volume;
            uniqueSellers.add(analysis.wallet);
          }

          totalVolume += analysis.volume;

          if (analysis.volume >= this.config.WHALE_THRESHOLD_USD) {
            whaleTransactions.push(analysis);
          }
        } catch (err) {
          continue;
        }
      }

      // Obtener precio actual desde Jupiter
      const priceData = await this.getCurrentPrice(tokenAddress);

      return {
        timestamp: Date.now(),
        token: tokenAddress,
        buy_usd_10s: buyVolume,
        sell_usd_10s: sellVolume,
        unique_buyers_10s: uniqueBuyers.size,
        unique_sellers_10s: uniqueSellers.size,
        whale_ins: whaleTransactions.filter(w => w.type === 'BUY').map(w => w.volume),
        total_volume: totalVolume,
        current_price: priceData.price,
        price_change_24h: priceData.priceChange24h || 0,
        liquidity_usd: priceData.liquidity || 0,
        spread: priceData.spread || 0.02,
        impact_estimate: this.estimatePriceImpact(totalVolume, priceData.liquidity)
      };
    } catch (error) {
      console.error("❌ Error obteniendo order flow:", error);
      return null;
    }
  }

  // ===================================
  // VALIDAR FILTROS INSTITUCIONALES
  // ===================================
  async validateInstitutionalFilters(data) {
    // Filtro A: Liquidez/Pool
    if (data.liquidity_usd < this.config.MIN_LIQUIDITY_USD) {
      return { passed: false, reason: "Liquidez insuficiente" };
    }
    
    if (data.impact_estimate > this.config.MAX_PRICE_IMPACT) {
      return { passed: false, reason: "Price impact alto" };
    }

    if (data.spread > this.config.MAX_SPREAD) {
      return { passed: false, reason: "Spread demasiado alto" };
    }

    // Verificar authorities del token
    const tokenInfo = await this.checkTokenAuthorities(data.token);
    if (tokenInfo.mintAuthority || tokenInfo.freezeAuthority) {
      return { passed: false, reason: "Authorities activas - riesgo de rug" };
    }

    return { passed: true, reason: "Todos los filtros pasaron" };
  }

  // ===================================
  // CALCULAR MÉTRICAS CUANTITATIVAS
  // ===================================
  async calculateQuantMetrics(data) {
    // Delta buy (ratio compra/venta)
    const delta_buy = data.buy_usd_10s / Math.max(1, data.sell_usd_10s);
    
    // Z-score de compradores únicos (simulado por ahora)
    const buyers_baseline = { mean: 20, std: 8 };
    const buyers_z = (data.unique_buyers_10s - buyers_baseline.mean) / buyers_baseline.std;
    
    // Actividad de whales
    const whale_count = data.whale_ins ? data.whale_ins.length : 0;
    
    // Evaluación de top wallet (simulado)
    const top_wallet_ok = whale_count > 0 && delta_buy > 1.5;
    
    return {
      delta_buy,
      buyers_z,
      whale_count,
      top_wallet_ok,
      whales_ok: whale_count >= this.config.MIN_WHALE_COUNT,
      flow_ok: delta_buy >= this.config.MIN_DELTA_BUY && buyers_z >= this.config.MIN_BUYERS_ZSCORE,
      signal_strength: this.calculateSignalStrength(delta_buy, buyers_z, whale_count)
    };
  }

  // ===================================
  // ANÁLISIS GPT-5-MINI INSTITUCIONAL
  // ===================================
  async performInstitutionalGPTAnalysis(metrics) {
    try {
      const prompt = this.buildInstitutionalPrompt(metrics);
      
      const response = await this.openAI.chat.completions.create({
        model: "gpt-4", // Usar el deployment name exacto
        messages: [
          {
            role: "system",
            content: `Eres TraderInstitucionalV1. Respondes SOLO JSON válido.
Reglas de entrada:
- Requiere (flow_ok AND whales_ok) OR signal_strength > 7.5
- Stop Loss: 12%, Take Profits: [25%, 60%, 120-200%]
- Position sizing: clamp(k*liquidity, 150, 0.7% equity)
Salida: {"action":"BUY|HOLD|SKIP","confidence":1-10,"reasoning":"...","position_size_usd":float}`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      const analysis = response.choices[0].message.content;
      
      try {
        return JSON.parse(analysis);
      } catch (parseError) {
        console.warn("⚠️ GPT response not valid JSON");
        return { 
          action: "HOLD", 
          confidence: 5, 
          reasoning: "GPT parsing error",
          position_size_usd: this.config.MIN_POSITION_USD
        };
      }
    } catch (error) {
      console.error("❌ Error en análisis GPT:", error);
      return { 
        action: "ERROR", 
        confidence: 0, 
        reasoning: error.message,
        position_size_usd: 0
      };
    }
  }

  // ===================================
  // CONFIGURAR COMANDOS TELEGRAM
  // ===================================
  setupTelegramCommands() {
    // Comando para analizar token
    this.telegramBot.onText(/\/analyze (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const tokenAddress = match[1];
      
      await this.telegramBot.sendMessage(chatId, `🧠 Analizando token: ${tokenAddress}...`);
      
      try {
        const analysis = await this.analyzeToken(tokenAddress, true);
        
        const message = `
📊 **ANÁLISIS INSTITUCIONAL**
Token: \`${tokenAddress}\`

🎯 **Decisión**: ${analysis.action}
📈 **Confianza**: ${analysis.confidence}/10
💰 **Tamaño posición**: $${analysis.position_size_usd || 0}

📝 **Razón**: ${analysis.reasoning}

🔢 **Métricas**:
• Delta Buy/Sell: ${analysis.delta_buy?.toFixed(2) || 'N/A'}
• Buyers Z-Score: ${analysis.buyers_z?.toFixed(2) || 'N/A'}  
• Whale Count: ${analysis.whale_count || 0}
• Signal Strength: ${analysis.signal_strength || 0}/10

⏱️ ${new Date().toLocaleString()}
        `;
        
        await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
      } catch (error) {
        await this.telegramBot.sendMessage(chatId, `❌ Error: ${error.message}`);
      }
    });

    // Comando de estadísticas
    this.telegramBot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      
      const message = `
📊 **ESTADÍSTICAS DEL BOT**

🤖 **Estado**: ${this.isRunning ? '🟢 Activo' : '🔴 Inactivo'}
📈 **Total Trades**: ${this.stats.totalTrades}
🎯 **Win Rate**: ${this.stats.winRate}%
💰 **PnL Total**: $${this.stats.totalPnL}
💼 **Equity**: $${this.config.EQUITY_USD}

🔧 **Configuración**:
• Min Liquidez: $${this.config.MIN_LIQUIDITY_USD}
• Stop Loss: ${this.config.STOP_LOSS * 100}%
• Max Position: ${this.config.MAX_POSITION_PCT * 100}%

⏱️ Última actualización: ${new Date().toLocaleString()}
      `;
      
      await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // Comando de help
    this.telegramBot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      
      const message = `
🤖 **SOLANA TRADING BOT INSTITUCIONAL**

📋 **Comandos disponibles**:

\`/analyze [token_address]\` - Analizar token específico
\`/stats\` - Ver estadísticas del bot  
\`/help\` - Mostrar ayuda
\`/start\` - Iniciar el bot
\`/stop\` - Detener el bot

🔥 **Estrategia**: Order Flow + GPT-5-mini
📊 **Mercado**: Solana recién migrados (Pump/Raydium)
⚡ **Ejecución**: Análisis institucional en tiempo real
      `;
      
      await this.telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
  }

  // ===================================
  // MÉTODOS AUXILIARES
  // ===================================
  analyzeTx(tx, tokenAddress) {
    // Análisis básico de transacción
    // En producción: implementar parser completo de logs
    return {
      wallet: tx.transaction.message.accountKeys[0].toString(),
      type: Math.random() > 0.5 ? 'BUY' : 'SELL',
      volume: Math.random() * 5000,
      timestamp: tx.blockTime
    };
  }

  async getCurrentPrice(tokenAddress) {
    try {
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenAddress}`);
      const data = response.data;
      
      return {
        price: data.data[tokenAddress]?.price || 0,
        priceChange24h: data.data[tokenAddress]?.priceChange24h || 0,
        liquidity: Math.random() * 100000, // Placeholder
        spread: Math.random() * 0.02
      };
    } catch (error) {
      return { price: 0, priceChange24h: 0, liquidity: 0, spread: 0.02 };
    }
  }

  estimatePriceImpact(volume, liquidity) {
    if (!liquidity || liquidity === 0) return 0.05;
    return Math.min(volume / liquidity, 0.1);
  }

  async checkTokenAuthorities(tokenAddress) {
    try {
      const tokenInfo = await this.solanaConnection.getParsedAccountInfo(new PublicKey(tokenAddress));
      // Simplificado - en producción implementar parsing completo
      return {
        mintAuthority: null,
        freezeAuthority: null
      };
    } catch (error) {
      return { mintAuthority: null, freezeAuthority: null };
    }
  }

  calculateSignalStrength(delta_buy, buyers_z, whale_count) {
    let strength = 0;
    
    if (delta_buy >= 2.0) strength += 3;
    if (buyers_z >= 2.0) strength += 2;
    if (whale_count >= 2) strength += 3;
    if (delta_buy >= 3.0) strength += 2;
    
    return Math.min(strength, 10);
  }

  buildInstitutionalPrompt(metrics) {
    return `
ANÁLISIS INSTITUCIONAL - SOLANA ORDER FLOW

MÉTRICAS:
- Delta Buy/Sell: ${metrics.delta_buy}
- Buyers Z-Score: ${metrics.buyers_z}
- Whale Count: ${metrics.whale_count}
- Flow OK: ${metrics.flow_ok}
- Whales OK: ${metrics.whales_ok}
- Signal Strength: ${metrics.signal_strength}/10

REGLAS:
- Entrada: (flow_ok AND whales_ok) OR signal_strength > 7.5
- SL: 12%, TP: [25%, 60%, 120%]
- Equity: $${this.config.EQUITY_USD}

Decide: BUY/HOLD/SKIP con razonamiento institucional.
    `;
  }

  async saveAnalysis(tokenAddress, decision, metrics) {
    try {
      const document = {
        id: `${tokenAddress}_${Date.now()}`,
        timestamp: Date.now(),
        token: tokenAddress,
        decision: decision,
        metrics: metrics,
        created_at: new Date().toISOString()
      };

      await this.container.items.create(document);
      console.log("✅ Análisis guardado en Cosmos DB");
    } catch (error) {
      console.error("❌ Error guardando análisis:", error);
    }
  }

  // ===================================
  // SERVIDOR WEB PARA WEBHOOK
  // ===================================
  startWebServer() {
    const app = express();
    app.use(express.json());

    // Health check
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        bot_running: this.isRunning,
        timestamp: new Date().toISOString()
      });
    });

    // Webhook para Telegram
    app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
      this.telegramBot.processUpdate(req.body);
      res.sendStatus(200);
    });

    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      console.log(`🚀 Bot server running on port ${port}`);
    });
  }
}

// ===================================
// INICIALIZAR BOT
// ===================================
async function startBot() {
  try {
    console.log("🚀 Iniciando Solana Institutional Trading Bot...");
    
    const bot = new InstitutionalTradingBot();
    
    // Configurar webhook de Telegram
    const webhookUrl = `${process.env.WEBHOOK_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    await bot.telegramBot.setWebHook(webhookUrl);
    
    console.log("✅ Bot iniciado correctamente");
    console.log("🔗 Webhook configurado:", webhookUrl);
    
  } catch (error) {
    console.error("❌ Error iniciando bot:", error);
    process.exit(1);
  }
}

// Iniciar el bot
if (require.main === module) {
  startBot();
}

module.exports = InstitutionalTradingBot;
