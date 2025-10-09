require ('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

/**
 * @param {object} principalInfo - Los datos de la información principal.
 * @param {Array<object>} formattedMovements - Los datos de los movimientos.
 */

async function sendNotification(principalInfo, formattedMovements) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if(!token || !chatId){
        console.log('Error: TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID deben estar en el archivo .env');
        return;
    }
    const bot = new TelegramBot(token);
    console.log('Credenciales de Telegram cargadas. Preparando para enviar mensaje...');

    try {
        let message = `*🔔 Resumen de tu Cuenta 🔔*\n\n`;
        message += `*--- Información del Encargo ---*\n`;
        for (const [key, value] of Object.entries(principalInfo)) {
            message += `*${key}:* ${value}\n`;
        }

        message += `\n*--- Últimos Movimientos (Total: ${formattedMovements.length}) ---*\n`;
        
        // Tomamos solo los 5 movimientos más recientes para un mensaje más limpio
        formattedMovements.slice(0, 5).forEach(movement => {
            message += `-------------------------------\n`;
            message += `*Fecha Mov.:* ${movement['Fecha Mov.']}\n`;
            message += `*Tipo Mov.:* ${movement['Tipo Mov.']}\n`;
            message += `*Valor:* ${movement['Valor']}\n`;
        });
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log('Notification sent successfully!');

    } catch (error) {
        console.error('Error al enviar la notificación de Telegram:', error);
    }
}

module.exports = {sendNotification};