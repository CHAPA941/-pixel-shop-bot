import os
import sqlite3
import secrets
import string

from fastapi import FastAPI
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    PreCheckoutQueryHandler,
    filters,
)

TOKEN = os.getenv("BOT_TOKEN")

app = FastAPI()

DB = "orders.db"


def init_db():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            code TEXT PRIMARY KEY,
            product TEXT NOT NULL,
            price INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'waiting',
            telegram_id INTEGER
        )
    """)

    conn.commit()
    conn.close()


def get_order(code):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cur.execute(
        "SELECT code, product, price, status FROM orders WHERE code = ?",
        (code,)
    )

    order = cur.fetchone()
    conn.close()

    return order


def create_demo_order():
    code = "PX-" + "".join(
        secrets.choice(string.ascii_uppercase + string.digits)
        for _ in range(6)
    )

    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cur.execute(
        """
        INSERT INTO orders (code, product, price)
        VALUES (?, ?, ?)
        """,
        (code, "Тестовый товар", 50)
    )

    conn.commit()
    conn.close()

    return code


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [
            InlineKeyboardButton(
                "🛒 Открыть магазин",
                url="https://pixelshop.makemysitelive.com/"
            )
        ]
    ]

    await update.message.reply_text(
        "Выберите действие:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def shop(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Введите код заказа, который вы получили на сайте."
    )


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    code = update.message.text.strip().upper()

    order = get_order(code)

    if not order:
        await update.message.reply_text(
            "❌ Заказ с таким кодом не найден."
        )
        return

    code, product, price, status = order

    if status == "paid":
        await update.message.reply_text(
            f"✅ Заказ {code} уже оплачен.\n\n"
            f"Товар: {product}\n"
            f"Статус: оплачено."
        )
        return

    keyboard = [
        [
            InlineKeyboardButton(
                f"💫 Оплатить {price} ⭐",
                callback_data=f"pay:{code}"
            )
        ]
    ]

    await update.message.reply_text(
        f"🧾 Заказ: {code}\n"
        f"📦 Товар: {product}\n"
        f"💫 Цена: {price} ⭐\n\n"
        f"Статус: 🟡 Ожидает оплаты",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def pay(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    code = query.data.split(":", 1)[1]
    order = get_order(code)

    if not order:
        await query.message.reply_text("❌ Заказ не найден.")
        return

    code, product, price, status = order

    if status == "paid":
        await query.message.reply_text("✅ Этот заказ уже оплачен.")
        return

    prices = [
        # Telegram Stars
        {
            "label": product,
            "amount": price
        }
    ]

    await context.bot.send_invoice(
        chat_id=query.from_user.id,
        title=f"Заказ {code}",
        description=f"Оплата заказа {code}: {product}",
        payload=code,
        currency="XTR",
        prices=prices,
    )


async def precheckout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.pre_checkout_query

    code = query.invoice_payload
    order = get_order(code)

    if not order:
        await query.answer(
            ok=False,
            error_message="Заказ не найден."
        )
        return

    await query.answer(ok=True)


async def successful_payment(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):
    payment = update.message.successful_payment

    code = payment.invoice_payload

    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cur.execute(
        """
        UPDATE orders
        SET status = 'paid',
            telegram_id = ?
        WHERE code = ?
        """,
        (update.effective_user.id, code)
    )

    conn.commit()
    conn.close()

    await update.message.reply_text(
        f"✅ ОПЛАЧЕНО!\n\n"
        f"Заказ: {code}\n"
        f"Оплата получена.\n\n"
        f"Теперь можно продолжить оформление заказа на сайте."
    )


@app.get("/")
def home():
    return {
        "status": "ok",
        "service": "Pixel Shop Bot"
    }


@app.get("/orders/{code}")
def order_status(code: str):
    order = get_order(code.upper())

    if not order:
        return {
            "found": False
        }

    code, product, price, status = order

    return {
        "found": True,
        "code": code,
        "product": product,
        "price": price,
        "status": status
    }


def main():
    init_db()

    application = Application.builder().token(TOKEN).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("shop", shop))

    application.add_handler(
        CallbackQueryHandler(pay, pattern=r"^pay:")
    )

    application.add_handler(
        PreCheckoutQueryHandler(precheckout)
    )

    application.add_handler(
        MessageHandler(
            filters.SUCCESSFUL_PAYMENT,
            successful_payment
        )
    )

    application.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            message_handler
        )
    )

    application.run_polling()


if __name__ == "__main__":
    main()
