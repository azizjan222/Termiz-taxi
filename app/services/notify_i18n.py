"""Localized push-notification text (uz / uz-cyrl / ru / en).

Push notification titles/bodies were previously hardcoded in Uzbek regardless of the
recipient's chosen language. This module renders every push in the recipient's language
(``User.language`` / ``Driver.language``) with an Uzbek fallback.

Each helper returns a ``(title, body)`` tuple already formatted with the given values.
City names are proper nouns and are intentionally NOT translated.
"""

from typing import Optional

LANGS = ("uz", "uz-cyrl", "ru", "en")


def norm_lang(lang: Optional[str]) -> str:
    """Return a supported language code, falling back to Uzbek."""
    return lang if lang in LANGS else "uz"


# Currency word per language.
_CCY = {"uz": "so'm", "uz-cyrl": "сўм", "ru": "сум", "en": "soʻm"}


def currency(lang: str) -> str:
    return _CCY[norm_lang(lang)]


def subject(lang: str, service_type: str, person_count: int) -> str:
    """Short, service-aware description (parcel / full car / N passengers)."""
    lang = norm_lang(lang)
    if service_type == "parcel":
        return {"uz": "Pochta 📦", "uz-cyrl": "Почта 📦", "ru": "Посылка 📦", "en": "Parcel 📦"}[lang]
    if service_type == "full_car":
        return {
            "uz": "To'liq mashina", "uz-cyrl": "Тўлиқ машина",
            "ru": "Вся машина", "en": "Full car",
        }[lang]
    return {
        "uz": f"{person_count} kishi",
        "uz-cyrl": f"{person_count} киши",
        "ru": f"{person_count} чел.",
        "en": f"{person_count} pax",
    }[lang]


def new_order(lang: str, *, service_type: str, from_city: str, to_city: str,
              subject_str: str, price_str: str) -> tuple[str, str]:
    lang = norm_lang(lang)
    if service_type == "parcel":
        title = {"uz": "📦 Yangi pochta!", "uz-cyrl": "📦 Янги почта!",
                 "ru": "📦 Новая посылка!", "en": "📦 New parcel!"}[lang]
    else:
        title = {"uz": "🚕 Yangi zakas!", "uz-cyrl": "🚕 Янги заказ!",
                 "ru": "🚕 Новый заказ!", "en": "🚕 New order!"}[lang]
    body = f"{from_city} → {to_city} · {subject_str} · {price_str} {currency(lang)}"
    return title, body


def recommended_order(lang: str, *, from_city: str, to_city: str,
                      subject_str: str, time_str: str) -> tuple[str, str]:
    lang = norm_lang(lang)
    title = {"uz": "⭐ Sizga maxsus zakas!", "uz-cyrl": "⭐ Сизга махсус заказ!",
             "ru": "⭐ Персональный заказ!", "en": "⭐ A special order for you!"}[lang]
    body = f"{from_city} → {to_city} · {subject_str} · {time_str}"
    return title, body


def order_accepted(lang: str, *, driver_name: str, car: str) -> tuple[str, str]:
    lang = norm_lang(lang)
    title = {"uz": "✅ Haydovchi topildi!", "uz-cyrl": "✅ Ҳайдовчи топилди!",
             "ru": "✅ Водитель найден!", "en": "✅ Driver found!"}[lang]
    body = {
        "uz": f"{driver_name} ({car}) tez orada siz bilan bog'lanadi",
        "uz-cyrl": f"{driver_name} ({car}) тез орада сиз билан боғланади",
        "ru": f"{driver_name} ({car}) скоро свяжется с вами",
        "en": f"{driver_name} ({car}) will contact you shortly",
    }[lang]
    return title, body


def order_completed(lang: str) -> tuple[str, str]:
    lang = norm_lang(lang)
    title = {"uz": "🏁 Manzilga yetib keldingiz!", "uz-cyrl": "🏁 Манзилга етиб келдингиз!",
             "ru": "🏁 Вы прибыли!", "en": "🏁 You've arrived!"}[lang]
    body = {"uz": "Sayohatingizni baholang ⭐", "uz-cyrl": "Саёҳатингизни баҳоланг ⭐",
            "ru": "Оцените поездку ⭐", "en": "Rate your trip ⭐"}[lang]
    return title, body


def no_driver(lang: str, *, from_city: str, to_city: str) -> tuple[str, str]:
    lang = norm_lang(lang)
    title = {"uz": "⏰ Haydovchi topilmadi", "uz-cyrl": "⏰ Ҳайдовчи топилмади",
             "ru": "⏰ Водитель не найден", "en": "⏰ No driver found"}[lang]
    tail = {
        "uz": "Afsuski, hozircha haydovchi topilmadi. Qaytadan urinib ko'ring.",
        "uz-cyrl": "Афсуски, ҳозирча ҳайдовчи топилмади. Қайтадан уриниб кўринг.",
        "ru": "К сожалению, водитель не найден. Попробуйте ещё раз.",
        "en": "Sorry, no driver was found. Please try again.",
    }[lang]
    return title, f"{from_city} → {to_city} · {tail}"


def order_cancelled(lang: str, *, by: str, from_city: str, to_city: str) -> tuple[str, str]:
    lang = norm_lang(lang)
    titles = {
        "passenger": {"uz": "❌ Yo'lovchi bekor qildi", "uz-cyrl": "❌ Йўловчи бекор қилди",
                      "ru": "❌ Пассажир отменил", "en": "❌ Passenger cancelled"},
        "driver": {"uz": "❌ Haydovchi bekor qildi", "uz-cyrl": "❌ Ҳайдовчи бекор қилди",
                   "ru": "❌ Водитель отменил", "en": "❌ Driver cancelled"},
        "system": {"uz": "⏰ Vaqt tugadi", "uz-cyrl": "⏰ Вақт тугади",
                   "ru": "⏰ Время вышло", "en": "⏰ Timed out"},
        "admin": {"uz": "⚠️ Admin bekor qildi", "uz-cyrl": "⚠️ Админ бекор қилди",
                  "ru": "⚠️ Отменено администратором", "en": "⚠️ Cancelled by admin"},
    }
    default = {"uz": "❌ Buyurtma bekor qilindi", "uz-cyrl": "❌ Буюртма бекор қилинди",
               "ru": "❌ Заказ отменён", "en": "❌ Order cancelled"}
    title = titles.get(by, default)[lang]
    return title, f"{from_city} → {to_city}"


def balance_topup(lang: str, *, amount_str: str, bonus_str: Optional[str] = None) -> tuple[str, str]:
    lang = norm_lang(lang)
    title = {"uz": "💰 Balans to'ldirildi!", "uz-cyrl": "💰 Баланс тўлдирилди!",
             "ru": "💰 Баланс пополнен!", "en": "💰 Balance topped up!"}[lang]
    body = f"+{amount_str} {currency(lang)}"
    if bonus_str:
        bonus_line = {
            "uz": f"🎁 Bonus: +{bonus_str} {currency(lang)}",
            "uz-cyrl": f"🎁 Бонус: +{bonus_str} {currency(lang)}",
            "ru": f"🎁 Бонус: +{bonus_str} {currency(lang)}",
            "en": f"🎁 Bonus: +{bonus_str} {currency(lang)}",
        }[lang]
        body += "\n" + bonus_line
    return title, body


def commission_soon(lang: str, *, from_city: str, to_city: str,
                    minutes: int, amount_str: str) -> tuple[str, str]:
    lang = norm_lang(lang)
    title = {"uz": "⏳ Komissiya tez orada yechiladi", "uz-cyrl": "⏳ Комиссия тез орада ечилади",
             "ru": "⏳ Скоро спишется комиссия", "en": "⏳ Commission will be charged soon"}[lang]
    ccy = currency(lang)
    body = {
        "uz": f"{from_city} → {to_city} · {minutes} daqiqadan so'ng {amount_str} {ccy} komissiya balansingizdan yechiladi",
        "uz-cyrl": f"{from_city} → {to_city} · {minutes} дақиқадан сўнг {amount_str} {ccy} комиссия балансингиздан ечилади",
        "ru": f"{from_city} → {to_city} · через {minutes} мин. с баланса спишется комиссия {amount_str} {ccy}",
        "en": f"{from_city} → {to_city} · in {minutes} min, {amount_str} {ccy} commission will be charged from your balance",
    }[lang]
    return title, body


def admin_title(lang: str) -> str:
    lang = norm_lang(lang)
    return {"uz": "📢 Admin xabari", "uz-cyrl": "📢 Админ хабари",
            "ru": "📢 Сообщение от администрации", "en": "📢 Message from admin"}[lang]
