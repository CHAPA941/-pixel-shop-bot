require('dotenv').config();

const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

const dbPath = path.resolve(__dirname, '../backend/pixelshop.db');
const db = new sqlite3.Database(dbPath);

bot.start((ctx) => {
    ctx.reply(
        '👋 Добро пожаловать в Pixel Shop Bot!\n\n' +
        'Введите ваш уникальный код заказа, например:\n' +
        'PX-7K42M9'
    );
});

bot.on('text', (ctx) => {
    const text = ctx.message.text.trim();

    if (!text.startsWith('PX-')) {
        return;
    }

    db.get(
        `SELECT * FROM orders WHERE code = ?`,
        [text],
        (err, order) => {
            if (err || !order) {
                return ctx.reply(
                    '❌ Заказ с таким кодом не найден. Проверьте правильность ввода.'
                );
            }

            const products = JSON.parse(order.products);

            const productList = products
                .map(p => `🐾 ${p.name} × ${p.quantity}`)
                .join('\n');

            let statusText = '🟡 Ожидает оплаты';

            if (order.status === 'paid') {
                statusText = '🟢 Оплачено';
            }

            if (order.status === 'completed') {
                statusText = '🔵 Выполнено';
            }

            if (order.status === 'cancelled') {
                statusText = '🔴 Отменено';
            }

            const message =
                `📦 Ваш заказ: ${order.code}\n\n` +
                `${productList}\n\n` +
                `💫 Сумма: ${order.total} Stars\n` +
                `📊 Статус: ${statusText}`;

            ctx.reply(message);
        }
    );
});

bot.launch();

console.log('Pixel Shop Bot запущен.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
