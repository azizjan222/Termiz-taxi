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

# Shown instead of an amount when the price is still to be agreed.
_NEGOTIABLE = {
    "uz": "Kelishiladi", "uz-cyrl": "Келишилади",
    "ru": "Договорная", "en": "Negotiable",
}


def currency(lang: str) -> str:
    return _CCY[norm_lang(lang)]


def price_text(lang: str, price) -> str:
    """Localized price, or the "to be agreed" wording when there is no amount.

    ``price = 0`` is how the app encodes "to be agreed" — parcel orders are created that
    way on purpose (see ``app/api/orders.py``), because the sender and driver settle the
    fee between themselves. Rendering that literally produced push notifications reading
    "Pochta · 0 so'm", which looks like a free delivery.

    Formatting lives here rather than at the call site so a caller cannot forget the rule.
    """
    lang = norm_lang(lang)
    if not price:
        return _NEGOTIABLE[lang]
    return f"{price:,}".replace(",", " ") + f" {currency(lang)}"


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
              subject_str: str, price) -> tuple[str, str]:
    lang = norm_lang(lang)
    if service_type == "parcel":
        title = {"uz": "📦 Yangi pochta!", "uz-cyrl": "📦 Янги почта!",
                 "ru": "📦 Новая посылка!", "en": "📦 New parcel!"}[lang]
    else:
        title = {"uz": "🚕 Yangi zakas!", "uz-cyrl": "🚕 Янги заказ!",
                 "ru": "🚕 Новый заказ!", "en": "🚕 New order!"}[lang]
    body = f"{from_city} → {to_city} · {subject_str} · {price_text(lang, price)}"
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


def bonus_earned(lang: str, *, amount_str: str, balance_str: str) -> tuple[str, str]:
    """Passenger earned bonus (loyalty and/or the invited-passenger referral bonus).

    Sent when a ride completes. Before this existed the wallet simply grew in silence, so
    passengers had no idea they had money to spend — the balance was only discoverable by
    opening the referral screen on a hunch.
    """
    lang = norm_lang(lang)
    ccy = currency(lang)
    title = {"uz": "🎁 Bonus qo'shildi!", "uz-cyrl": "🎁 Бонус қўшилди!",
             "ru": "🎁 Бонус начислен!", "en": "🎁 Bonus added!"}[lang]
    body = {
        "uz": f"+{amount_str} {ccy}. Bonus hisobingiz: {balance_str} {ccy}. Keyingi safarda chegirma sifatida ishlating.",
        "uz-cyrl": f"+{amount_str} {ccy}. Бонус ҳисобингиз: {balance_str} {ccy}. Кейинги сафарда чегирма сифатида ишлатинг.",
        "ru": f"+{amount_str} {ccy}. Бонусный счёт: {balance_str} {ccy}. Используйте как скидку в следующей поездке.",
        "en": f"+{amount_str} {ccy}. Bonus balance: {balance_str} {ccy}. Use it as a discount on your next ride.",
    }[lang]
    return title, body


def referral_reward(lang: str, *, amount_str: str, balance_str: str) -> tuple[str, str]:
    """The REFERRER earned their reward because an invited friend completed a first ride.

    This recipient is not part of the request that triggers it, so a push is the only way
    they learn about it. A referral programme whose payouts are invisible stops spreading.
    """
    lang = norm_lang(lang)
    ccy = currency(lang)
    title = {"uz": "🎉 Do'stingiz safarni tugatdi!", "uz-cyrl": "🎉 Дўстингиз сафарни тугатди!",
             "ru": "🎉 Ваш друг завершил поездку!", "en": "🎉 Your friend completed a ride!"}[lang]
    body = {
        "uz": f"Taklif mukofoti: +{amount_str} {ccy}. Bonus hisobingiz: {balance_str} {ccy}.",
        "uz-cyrl": f"Таклиф мукофоти: +{amount_str} {ccy}. Бонус ҳисобингиз: {balance_str} {ccy}.",
        "ru": f"Награда за приглашение: +{amount_str} {ccy}. Бонусный счёт: {balance_str} {ccy}.",
        "en": f"Referral reward: +{amount_str} {ccy}. Bonus balance: {balance_str} {ccy}.",
    }[lang]
    return title, body


def discount_reimbursed(lang: str, *, amount_str: str, order_id: int) -> tuple[str, str]:
    """Driver's balance was credited for a passenger discount on a free-trial ride.

    The driver collected less cash than the fare because the passenger spent bonus, and no
    commission was charged that could have compensated them — so the platform credits the
    difference. Without this message the credit would just appear in their balance
    unannounced, which reads like a bug.
    """
    lang = norm_lang(lang)
    ccy = currency(lang)
    title = {"uz": "💚 Chegirma qoplandi", "uz-cyrl": "💚 Чегирма қопланди",
             "ru": "💚 Скидка компенсирована", "en": "💚 Discount reimbursed"}[lang]
    body = {
        "uz": f"Zakas #{order_id}: yo'lovchi bonus chegirmasidan foydalandi. Balansingizga +{amount_str} {ccy} qo'shildi — siz hech narsa yo'qotmaysiz.",
        "uz-cyrl": f"Заказ #{order_id}: йўловчи бонус чегирмасидан фойдаланди. Балансингизга +{amount_str} {ccy} қўшилди — сиз ҳеч нарса йўқотмайсиз.",
        "ru": f"Заказ #{order_id}: пассажир использовал бонусную скидку. На баланс зачислено +{amount_str} {ccy} — вы ничего не теряете.",
        "en": f"Order #{order_id}: the passenger used a bonus discount. +{amount_str} {ccy} was added to your balance — you lose nothing.",
    }[lang]
    return title, body


def reimbursement_reversed(lang: str, *, amount_str: str, order_id: int) -> tuple[str, str]:
    """The discount reimbursement was taken back because the ride was cancelled.

    The counterpart to :func:`discount_reimbursed`. That message promises the driver they
    lose nothing; when the ride is cancelled the passenger's bonus goes back to their
    wallet, so the credit has to go back too. Without this the driver would just see an
    unexplained deduction right after being told the opposite.
    """
    lang = norm_lang(lang)
    ccy = currency(lang)
    title = {"uz": "↩️ Chegirma qoplamasi qaytarildi",
             "uz-cyrl": "↩️ Чегирма қопламаси қайтарилди",
             "ru": "↩️ Компенсация скидки возвращена",
             "en": "↩️ Discount reimbursement returned"}[lang]
    body = {
        "uz": f"Zakas #{order_id} bekor qilindi, shuning uchun {amount_str} {ccy} qoplama balansingizdan qaytarildi. Yo'lovchining bonusi ham unga qaytarildi.",
        "uz-cyrl": f"Заказ #{order_id} бекор қилинди, шунинг учун {amount_str} {ccy} қоплама балансингиздан қайтарилди. Йўловчининг бонуси ҳам унга қайтарилди.",
        "ru": f"Заказ #{order_id} отменён, поэтому компенсация {amount_str} {ccy} снята с баланса. Бонус пассажира также возвращён ему.",
        "en": f"Order #{order_id} was cancelled, so the {amount_str} {ccy} reimbursement was taken back. The passenger's bonus was returned to them too.",
    }[lang]
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


# Sarlavha sifatida ko'rsatiladigan ilova nomlari. app.json dagi `name` bilan bir xil
# bo'lishi SHART: sarix-go-app -> "Sarix Go", sarix-go-driver -> "Sarix Driver".
PASSENGER_APP_NAME = "Sarix Go"
DRIVER_APP_NAME = "Sarix Driver"


def app_title(recipient_type: Optional[str]) -> str:
    """Return the app name to use as an announcement's notification title.

    Broadcasts used to arrive titled "📢 Admin xabari", which told the passenger
    nothing about *which* app woke their phone — both apps are installed on many
    devices. The title is now the sending app's own name, so the notification
    shade reads "Sarix Go" or "Sarix Driver".

    ``recipient_type`` is the same discriminator the push layer uses (see
    ``app/services/push.py``): a "driver" recipient holds a driver-app Expo token,
    anything else ("user"/"passenger") is the passenger app.

    Deliberately NOT localized — an app name is a brand and stays identical in
    uz/uz-cyrl/ru/en, unlike every other helper in this module.
    """
    return DRIVER_APP_NAME if (recipient_type or "").strip().lower() == "driver" else PASSENGER_APP_NAME
