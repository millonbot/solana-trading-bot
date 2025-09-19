class TelegramInterface {
    constructor(token) {
        this.token = token;
    }
    
    async sendMessage(chatId, text) {
        console.log(`Sending: ${text}`);
    }
}
module.exports = TelegramInterface;