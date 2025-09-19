const { Connection, clusterApiUrl } = require('@solana/web3.js');

class TradingModeSelector {
    constructor() {
        this.mode = {
            isPaperTrading: true,
            isRunning: false,
            isConfigured: true
        };
        
        // Inicializar conexión Solana
        this.solanaConnection = new Connection(
            process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
        );
    }

    setMode(mode) {
        this.mode = { ...this.mode, ...mode };
    }

    getMode() {
        return this.mode;
    }

    isConfigured() {
        return this.mode.isConfigured;
    }

    isRunning() {
        return this.mode.isRunning;
    }

    start() {
        this.mode.isRunning = true;
    }

    stop() {
        this.mode.isRunning = false;
    }
}

module.exports = TradingModeSelector;