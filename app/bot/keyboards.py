"""Reusable Telegram keyboards.

All button LABELS stay in Uzbek on purpose — they are shown to end users. Only the
Python identifiers are English.
"""
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from app import car_models

# Button labels (single source so handlers match on the same strings the keyboard uses).
BTN_ORDER_TAXI = "🚕 Taksi buyurtma qilish"
BTN_BECOME_DRIVER = "👨‍✈️ Haydovchi bo'lish"
BTN_CABINET = "💳 Kabinet (Balans)"
BTN_GUIDE = "📚 Yo'riqnoma"
BTN_CANCEL = "❌ Bekor qilish"
BTN_SHARE_PHONE = "📞 Telefon raqamni yuborish"
BTN_SHARE_CONTACT_LOGIN = "📲 Raqamni ulashib kirish"
BTN_SHARE_LOCATION = "📍 Lokatsiyani yuborish"
BTN_OTHER_MODEL = "✏️ Boshqa model"

# Admin menu labels.
BTN_ADMIN_STATS = "📊 Statistika"
BTN_ADMIN_BROADCAST = "📢 Rassilka"
BTN_ADMIN_EXPORT = "📄 Excel Export"
BTN_ADMIN_BAN = "🚫 Ban"
BTN_ADMIN_UNBAN = "♻️ Unban"
BTN_ADMIN_MAINTENANCE = "🛠 Maintenance"
BTN_ADMIN_LINKS = "🌐 Saytlar"
BTN_ADMIN_BACK = "🔙 Foydalanuvchi menyusi"


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(BTN_ORDER_TAXI)],
            [KeyboardButton(BTN_BECOME_DRIVER), KeyboardButton(BTN_CABINET)],
            [KeyboardButton(BTN_GUIDE)],
        ],
        resize_keyboard=True,
    )


def admin_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(BTN_ADMIN_STATS), KeyboardButton(BTN_ADMIN_BROADCAST)],
            [KeyboardButton(BTN_ADMIN_EXPORT), KeyboardButton(BTN_ADMIN_BAN)],
            [KeyboardButton(BTN_ADMIN_UNBAN), KeyboardButton(BTN_ADMIN_MAINTENANCE)],
            # Admin-only on purpose: this keyboard is only ever sent from admin_panel(),
            # which is behind is_admin(). The panel URL must not reach main_menu().
            [KeyboardButton(BTN_ADMIN_LINKS)],
            [KeyboardButton(BTN_ADMIN_BACK)],
        ],
        resize_keyboard=True,
    )


def share_phone() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton(BTN_SHARE_PHONE, request_contact=True)]],
        resize_keyboard=True, one_time_keyboard=True,
    )


def share_contact_login() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton(BTN_SHARE_CONTACT_LOGIN, request_contact=True)]],
        resize_keyboard=True, one_time_keyboard=True,
    )


def share_phone_or_cancel() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton(BTN_SHARE_PHONE, request_contact=True)],
         [KeyboardButton(BTN_CANCEL)]],
        resize_keyboard=True, one_time_keyboard=True,
    )


def share_location() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton(BTN_SHARE_LOCATION, request_location=True)]],
        resize_keyboard=True, one_time_keyboard=True,
    )


def cancel_only() -> ReplyKeyboardMarkup:
    """Just a cancel button, for free-text steps that otherwise show no keyboard.

    The passenger order form used ReplyKeyboardRemove on its text steps, so there was no
    way to back out of a half-filled order except by typing /cancel — which is not shown
    anywhere in the bot.
    """
    return ReplyKeyboardMarkup(
        [[KeyboardButton(BTN_CANCEL)]], resize_keyboard=True,
    )


def share_location_or_cancel() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton(BTN_SHARE_LOCATION, request_location=True)],
         [KeyboardButton(BTN_CANCEL)]],
        resize_keyboard=True, one_time_keyboard=True,
    )


def car_model_picker() -> ReplyKeyboardMarkup:
    popular = car_models.get_popular_models()
    rows = [[KeyboardButton(m) for m in popular[i:i + 2]] for i in range(0, len(popular), 2)]
    rows.append([KeyboardButton(BTN_OTHER_MODEL)])
    rows.append([KeyboardButton(BTN_CANCEL)])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def topup_amounts() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("10 000 so'm", callback_data="topup_amount_10000"),
         InlineKeyboardButton("20 000 so'm", callback_data="topup_amount_20000")],
        [InlineKeyboardButton("50 000 so'm", callback_data="topup_amount_50000"),
         InlineKeyboardButton("100 000 so'm", callback_data="topup_amount_100000")],
        [InlineKeyboardButton(BTN_OTHER_MODEL.replace("model", "summa"),
                              callback_data="topup_amount_other")],
    ])


def cabinet_topup_button() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("💰 Hisobni to'ldirish", callback_data="cabinet_topup")]])


def passenger_cancel(order_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton(BTN_CANCEL, callback_data=f"passenger_cancel_{order_id}")]])


def driver_order_actions(order_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Yopildi", callback_data=f"order_close_{order_id}")],
        [InlineKeyboardButton(BTN_CANCEL, callback_data=f"driver_cancel_{order_id}")],
    ])
