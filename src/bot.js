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
    // Azure OpenAI
    this.openAI = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview",
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

    // Configuración
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
    this.stats = {
      totalTrades: 0,
      winRate: 0,
      totalPnL: 0,
      lastAnalysis: null
    };

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
  // ANÁLISIS PRINCIPAL
  // ===================================
  async analyzeToken(tokenAddress, forcedAnalysis = false) {
    try {
      console.log(`[INSTITUCIONAL] Analizando: ${tokenAddress}`);

      const realTimeData = await this.getRealTimeOrderFlow(tokenAddress);
      if (!realTimeData) {
        return { action: "SKIP", reason: "No data available" };
      }

      const filterCheck = await this.validateInstitutionalFilters(realTimeData);
      if (!filterCheck.passed && !forcedAnalysis) {
        return { action: "SKIP", reason: filterCheck.reason };
      }

      const quantMetrics = await this.calculateQuantMetrics(realTimeData);

      const gptDecision = await this.performInstitutionalGPTAnalysis(quantMetrics);

      const finalDecision = await this.executeTradingFSM(gptDecision, quantMetrics);

      await this.saveAnalysis(tokenAddress, finalDecision, quantMetrics);

      return finalDecision;
    } catch (error) {
      console.error("Error en análisis institucional:", error);
      return { action: "ERROR", reason: error.message };
    }
  }

  // ===================================
  // GPT-5-mini ANÁLISIS
  // ===================================
  async performInstitutionalGPTAnalysis(metrics) {
    try {
      const prompt = this.buildInstitutionalPrompt(metrics);

      const response = await this.openAI.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        messages: [
          {
            role: "system",
            content: `Eres TraderInstitucionalV1. Respondes SOLO JSON válido.`
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 200,
        top_p: 0.9,
        reasoning: "none",
        response_format: { type: "json_object" },
        stop: ["\n\n"]
      });

      const analysis = response.choices[0].message.content;

      try {
        return JSON.parse(analysis);
      } catch {
        console.warn("Respuesta GPT no es JSON válido");
        return {
          action: "HOLD",
          confidence: 5,
          reasoning: "GPT parsing error",
          position_size_usd: this.config.MIN_POSITION_USD
        };
      }
    } catch (error) {
      console.error("Error en análisis GPT:", error);
      return {
        action: "ERROR",
        confidence: 0,
        reasoning: error.message,
        position_size_usd: 0
      };
    }
  }

  // ===================================
  // Resto de métodos (igual que antes)
  // ===================================
  // ... (mantén el resto de métodos tal como los tienes: getRealTimeOrderFlow, validateInstitutionalFilters, calculateQuantMetrics, etc.)
}

// ===================================
// INICIALIZAR BOT
// ===================================
async function startBot() {
  try {
    console.log("Iniciando Solana Institutional Trading Bot...");

    const bot = new InstitutionalTradingBot();

    const webhookUrl = `${process.env.WEBHOOK_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    await bot.telegramBot.setWebHook(webhookUrl);

    console.log("Bot iniciado correctamente");
    console.log("Webhook configurado:", webhookUrl);
  } catch (error) {
    console.error("Error iniciando bot:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  startBot();
}

module.exports = InstitutionalTradingBot;
