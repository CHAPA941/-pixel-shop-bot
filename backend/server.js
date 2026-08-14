require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const db = require('./database');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function generateOrderCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'PX-';

    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return code;
}

// Создание заказа
app.post('/api/orders', (req, res) => {
    const { products, total } = req.body;

    if (!products || !products.length) {
        return res.status(400).json({
            error: 'Корзина пуста'
        });
    }

    const code = generateOrderCode();

    db.run(
        `INSERT INTO orders
        (code, products, total, status)
        VALUES (?, ?, ?, 'pending')`,
        [code, JSON.stringify(products), total],
        function(err) {
            if (err) {
                return res.status(500).json({
                    error: err.message
                });
            }

            res.json({
                success: true,
                code,
                total,
                status: 'pending'
            });
        }
    );
});

// Получение заказа
app.get('/api/orders/:code', (req, res) => {
    db.get(
        `SELECT * FROM orders WHERE code = ?`,
        [req.params.code],
        (err, row) => {
            if (err || !row) {
                return res.status(404).json({
                    error: 'Заказ не найден'
                });
            }

            row.products = JSON.parse(row.products);

            res.json(row);
        }
    );
});

// Проверка статуса заказа
app.get('/api/orders/:code/status', (req, res) => {
    db.get(
        `SELECT status, username, roblox_id
        FROM orders
        WHERE code = ?`,
        [req.params.code],
        (err, row) => {
            if (err || !row) {
                return res.status(404).json({
                    error: 'Заказ не найден'
                });
            }

            res.json(row);
        }
    );
});

// Поиск игрока Roblox
app.get('/api/users/search', async (req, res) => {
    const username = req.query.username;

    if (!username) {
        return res.status(400).json({
            error: 'Укажите ник'
        });
    }

    try {
        const response = await axios.post(
            'https://users.roblox.com/v1/usernames/users',
            {
                usernames: [username],
                excludeBannedUsers: true
            }
        );

        if (
            !response.data.data ||
            response.data.data.length === 0
        ) {
            return res.status(404).json({
                error: 'Игрок не найден'
            });
        }

        const user = response.data.data[0];

        let avatarUrl = '';

        try {
            const thumbRes = await axios.get(
                `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`
            );

            if (
                thumbRes.data.data &&
                thumbRes.data.data.length > 0
            ) {
                avatarUrl = thumbRes.data.data[0].imageUrl;
            }
        } catch (e) {
            console.log('Не удалось получить аватар');
        }

        res.json({
            success: true,
            username: user.name,
            displayName: user.displayName,
            id: user.id,
            avatar: avatarUrl
        });

    } catch (e) {
        console.error(e);

        res.status(500).json({
            error: 'Ошибка проверки Roblox API'
        });
    }
});

// Сохранение игрока в заказе
app.post('/api/orders/:code/username', (req, res) => {
    const { username, roblox_id } = req.body;

    if (!username || !roblox_id) {
        return res.status(400).json({
            error: 'Неверные данные игрока'
        });
    }

    db.run(
        `UPDATE orders
        SET username = ?, roblox_id = ?
        WHERE code = ?`,
        [username, roblox_id, req.params.code],
        function(err) {
            if (err) {
                return res.status(500).json({
                    error: err.message
                });
            }

            res.json({
                success: true
            });
        }
    );
});

// Вход администратора
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (password === ADMIN_PASSWORD) {
        res.json({
            success: true,
            token: 'admin-authorized-token'
        });
    } else {
        res.status(401).json({
            error: 'Неверный пароль'
        });
    }
});

// Получение заказов для админки
app.get('/api/admin/orders', (req, res) => {
    const authHeader = req.headers.authorization;

    if (
        !authHeader ||
        authHeader !== 'Bearer admin-authorized-token'
    ) {
        return res.status(403).json({
            error: 'Доступ запрещен'
        });
    }

    db.all(
        `SELECT * FROM orders
        ORDER BY created_at DESC`,
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({
                    error: err.message
                });
            }

            rows.forEach(row => {
                row.products = JSON.parse(row.products);
            });

            res.json(rows);
        }
    );
});

// Изменение статуса заказа
app.patch('/api/admin/orders/:code', (req, res) => {
    const authHeader = req.headers.authorization;

    if (
        !authHeader ||
        authHeader !== 'Bearer admin-authorized-token'
    ) {
        return res.status(403).json({
            error: 'Доступ запрещен'
        });
    }

    const { status } = req.body;

    const validStatuses = [
        'pending',
        'paid',
        'completed',
        'cancelled'
    ];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({
            error: 'Неверный статус'
        });
    }

    db.run(
        `UPDATE orders
        SET status = ?
        WHERE code = ?`,
        [status, req.params.code],
        function(err) {
            if (err) {
                return res.status(500).json({
                    error: err.message
                });
            }

            res.json({
                success: true
            });
        }
    );
});

// Главная проверка сервера
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Pixel Shop API работает!'
    });
});
app.post('/telegram/webhook', async (req, res) => {
    try {
        const update = req.body;

        if (!update.message || !update.message.text) {
            return res.sendStatus(200);
        }

        const chatId = update.message.chat.id;
        const text = update.message.text.trim();

        if (text === '/start') {
            await axios.post(
                `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
                {
                    chat_id: chatId,
                    text:
                        '👋 Добро пожаловать в Pixel Shop Bot!\n\n' +
                        'Введите код заказа, например:\n' +
                        'PX-7K42M9'
                }
            );

            return res.sendStatus(200);
        }

        if (!text.startsWith('PX-')) {
            return res.sendStatus(200);
        }

        db.get(
            `SELECT * FROM orders WHERE code = ?`,
            [text],
            async (err, order) => {
                if (err || !order) {
                    await axios.post(
                        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
                        {
                            chat_id: chatId,
                            text: '❌ Заказ с таким кодом не найден.'
                        }
                    );

                    return res.sendStatus(200);
                }

                const products = JSON.parse(order.products);

                const productList = products
                    .map(p => `🐾 ${p.name} × ${p.quantity}`)
                    .join('\n');

                let statusText = '🟡 Ожидает оплаты';

                if (order.status === 'paid') {
                    statusText = '🟢 Оплачено';
                } else if (order.status === 'completed') {
                    statusText = '🔵 Выполнено';
                } else if (order.status === 'cancelled') {
                    statusText = '🔴 Отменено';
                }

                const message =
                    `📦 Заказ: ${order.code}\n\n` +
                    `${productList}\n\n` +
                    `💫 Сумма: ${order.total} Stars\n` +
                    `📊 Статус: ${statusText}`;

                await axios.post(
                    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
                    {
                        chat_id: chatId,
                        text: message
                    }
                );

                res.sendStatus(200);
            }
        );
    } catch (error) {
        console.error('Telegram webhook error:', error);
        res.sendStatus(200);
    }
});
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
