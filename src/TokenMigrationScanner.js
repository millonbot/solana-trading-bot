class TokenMigrationScanner {
    constructor() {
        this.isScanning = false;
    }
    
    async startScanning() {
        this.isScanning = true;
        console.log('Token migration scanning started');
    }
    
    async stopScanning() {
        this.isScanning = false;
    }
}
module.exports = TokenMigrationScanner;