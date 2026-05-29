"""AI Assistant for drivers - answers FAQ via OpenAI or built-in fallback."""
import logging
from aiohttp import web
import aiohttp

from app import config
from app.api.drivers import require_driver

logger = logging.getLogger(__name__)


# System prompt - teaches the AI about Sarix Go
SYSTEM_PROMPT = """Sen Sarix Go taksi xizmati uchun yordamchisan. Termiz va Surxondaryo viloyati hududida ishlovchi taksi haydovchilariga yordam berasan.

XIZMAT HAQIDA:
- Sarix Go - Termiz Sariosiyo taksi xizmati
- Bot: @termizsariosiyotaxi_bot
- Hudud: Surxondaryo viloyati (Termiz, Sariosiyo, Uzun, Denov, Sho'rchi, Jarqo'rg'on, Qumqo'rg'on)

KOMISSIYA TIZIMI (haydovchi balansidan yechiladi):
- 1 yo'lovchi: 10,000 so'm
- 2 yo'lovchi: 20,000 so'm
- 3 yo'lovchi: 30,000 so'm
- Pochta (hujjat): 5,000 so'm
- Bo'sh mashina (4 o'rin): 30,000 so'm

BALANS QOIDALARI:
- Zakas qabul qilish uchun MINIMAL 20,000 so'm balans bo'lishi kerak
- Birinchi to'lovda 50% bonus
- Balansni to'ldirish: bot orqali chek yuborib, admin tasdiqlaydi
- Karta: 9860130147785443

ZAKAS BAJARILISHI:
1. Yangi zakas ilovaga keladi (yangi yo'lovchi yoki bot orqali)
2. "Qabul qilish" tugmasi - balansdan komissiya yechiladi
3. Yo'lovchiga qo'ng'iroq qiling, kelishib oling
4. Manzilga yetkazib bering
5. "Yopildi" tugmasini bosing
6. Agar bekor qilinsa - pul qaytariladi (30 daqiqa ichida)

BO'LIM TANLOVLARI:
- Avtomatik 30 daqiqa ichida yopilmasa bekor qilinadi
- 10 minut qolganda ogohlantirish keladi
- Yo'lovchi ham, haydovchi ham bekor qila oladi

NARXLAR (tavsiya - kelishish mumkin):
- Termiz ↔ Sariosiyo: 90,000 so'm
- Termiz ↔ Uzun: 90,000 so'm
- Termiz ↔ Denov: 80,000 so'm
- Termiz ↔ Sho'rchi: 70,000 so'm
- Sariosiyo ↔ Jarqo'rg'on: 80,000 so'm
- Sariosiyo ↔ Qumqo'rg'on: 70,000 so'm

JAVOB BERISH STILI:
- Qisqa va aniq javob ber (3-5 jumla)
- O'zbek tilida (lotin)
- Do'stona, lekin professional
- Emoji ishlatishing mumkin
- Agar savol xizmat haqida bo'lmasa, "Bu savolga javob bera olmayman, yordam uchun adminga murojaat qiling: @{support}" deb ayt
- Agar texnik muammo haqida bo'lsa, adminga murojaat qilishni tavsiya qil
"""


# Built-in FAQ for fallback (when OpenAI not configured)
FAQ_PATTERNS = [
    {
        "keywords": ["balans", "to'ldir", "tuldir", "pul qo'sh", "pul qosh", "hisob"],
        "answer": (
            "💰 Balansni to'ldirish uchun:\n\n"
            "1. Botda /start bosing → 💳 Kabinet (Balans)\n"
            "2. \"Hisobni to'ldirish\" tugmasi\n"
            "3. Summani tanlang yoki yozing\n"
            "4. Karta: 9860130147785443\n"
            "5. To'lab, chekni botga rasm qilib yuboring\n"
            "6. Admin tasdiqlashi bilan balans to'ldiriladi\n\n"
            "🎁 Birinchi to'lovda 50% BONUS!"
        ),
    },
    {
        "keywords": ["minimal", "minimum", "20", "kamida", "qancha balans"],
        "answer": (
            "💸 Zakas qabul qilish uchun minimal **20,000 so'm** balans bo'lishi kerak.\n\n"
            "Komissiya esa zakas turiga qarab:\n"
            "• 1 yo'lovchi: 10,000 so'm\n"
            "• 2 yo'lovchi: 20,000 so'm\n"
            "• 3 yo'lovchi: 30,000 so'm\n"
            "• Bo'sh mashina: 30,000 so'm\n"
            "• Pochta: 5,000 so'm"
        ),
    },
    {
        "keywords": ["komiss", "yechib", "yechilad", "narx", "qancha to'la", "qancha tola"],
        "answer": (
            "💸 Komissiya tizimi (har zakas uchun balansdan yechiladi):\n\n"
            "• 1 yo'lovchi → 10,000 so'm\n"
            "• 2 yo'lovchi → 20,000 so'm\n"
            "• 3 yo'lovchi → 30,000 so'm\n"
            "• Pochta → 5,000 so'm\n"
            "• Bo'sh mashina → 30,000 so'm\n\n"
            "Zakas bekor qilinsa, pul qaytariladi."
        ),
    },
    {
        "keywords": ["zakas qabul", "qanday qabul", "buyurtma qabul", "olish"],
        "answer": (
            "🚕 Zakas qabul qilish:\n\n"
            "1. Onlayn rejimda bo'ling (yuqori o'ngda toggle)\n"
            "2. Yangi zakas kelganda ovoz va vibratsiya beradi\n"
            "3. Zakas kartasini bosing\n"
            "4. \"Qabul qilish\" tugmasini bosing\n"
            "5. Komissiya balansdan avtomatik yechiladi\n"
            "6. Yo'lovchi telefoniga qo'ng'iroq qiling, kelishib oling"
        ),
    },
    {
        "keywords": ["yopish", "yopildi", "tugatish", "tugat", "complete"],
        "answer": (
            "✅ Zakasni yopish:\n\n"
            "1. Yo'lovchini manzilga yetkazib bering\n"
            "2. \"Faol zakaslar\" bo'limiga o'ting\n"
            "3. Zakasni bosing\n"
            "4. \"Yopildi\" tugmasini bosing\n"
            "5. Tarix bo'limiga o'tadi\n\n"
            "⚠️ 30 daqiqa ichida yopmasangiz, avtomatik bekor qilinadi!"
        ),
    },
    {
        "keywords": ["bekor", "cancel", "qaytarish"],
        "answer": (
            "❌ Bekor qilish:\n\n"
            "Faol zakas → \"Bekor qilish\" tugmasi.\n\n"
            "💰 Komissiya balansga qaytariladi.\n\n"
            "⚠️ Tez-tez bekor qilmang - reytingingiz pasayadi!"
        ),
    },
    {
        "keywords": ["onlayn", "online", "oflayn", "offline"],
        "answer": (
            "🟢 Onlayn/Oflayn rejim:\n\n"
            "Yuqori o'ngdagi switch'ni bosing.\n\n"
            "• 🟢 Onlayn = yangi zakaslar keladi\n"
            "• ⚪ Oflayn = zakas kelmaydi (dam olish, ovqat va h.k.)"
        ),
    },
    {
        "keywords": ["bonus", "tovuz", "rag'bat", "ragbat"],
        "answer": (
            "🎁 Bonuslar:\n\n"
            "• 🎉 Birinchi to'lovda 50% BONUS\n"
            "• Bo'sh mashina zakasida -10,000 chegirma (30k komissiya o'rniga ham 30k)\n\n"
            "Tez-tez zakas oluvchi haydovchilarga maxsus bonuslar bor!"
        ),
    },
    {
        "keywords": ["telefon", "qo'ng'iroq", "qongiroq", "yo'lovchiga"],
        "answer": (
            "📞 Yo'lovchiga qo'ng'iroq:\n\n"
            "Faol zakas ekranida yashil 📞 tugmasini bosing.\n"
            "Telefon dasturi avtomatik ochiladi va yo'lovchi raqamiga qo'ng'iroq qilasiz."
        ),
    },
    {
        "keywords": ["xato", "ishlamayapti", "ishlamadi", "muammo", "problem"],
        "answer": (
            "🛠 Texnik muammo bo'lsa:\n\n"
            "1. Ilovani yopib, qayta oching\n"
            "2. Internet ulanishini tekshiring\n"
            "3. Ilovani yangilang (Play Market)\n\n"
            "Hal bo'lmasa adminga murojaat qiling: @{support}"
        ),
    },
]


def _find_faq_answer(question: str, support_username: str) -> str | None:
    """Match question against built-in FAQ patterns."""
    q = question.lower()
    for faq in FAQ_PATTERNS:
        if any(kw in q for kw in faq["keywords"]):
            return faq["answer"].replace("{support}", support_username)
    return None


def _default_response(support_username: str) -> str:
    return (
        "Bu savolga aniq javob bera olmayman 🤔\n\n"
        "Quyidagilar haqida so'rashingiz mumkin:\n"
        "• Balansni qanday to'ldirish\n"
        "• Zakasni qanday qabul qilish\n"
        "• Komissiya tizimi\n"
        "• Onlayn/oflayn rejim\n"
        "• Texnik muammolar\n\n"
        f"Yoki adminga murojaat qiling: @{support_username}"
    )


async def _ask_openai(messages: list, support_username: str) -> str:
    """Ask OpenAI; returns response text or raises."""
    api_key = config.OPENAI_API_KEY
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    system = SYSTEM_PROMPT.replace("{support}", support_username)

    payload = {
        "model": config.AI_MODEL,
        "messages": [{"role": "system", "content": system}] + messages,
        "temperature": 0.5,
        "max_tokens": 400,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with aiohttp.ClientSession() as http:
        async with http.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise RuntimeError(f"OpenAI error: {data}")
            return data["choices"][0]["message"]["content"]


@require_driver
async def chat(request: web.Request) -> web.Response:
    """POST /api/ai/chat
    Body: {"messages": [{"role": "user", "content": "Salom"}, ...]}
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    messages = body.get("messages", [])
    if not messages or not isinstance(messages, list):
        return web.json_response({"error": "messages array required"}, status=400)

    # Get last user question
    last_user = next(
        (m for m in reversed(messages) if m.get("role") == "user"),
        None,
    )
    if not last_user:
        return web.json_response({"error": "No user message"}, status=400)

    question = (last_user.get("content") or "").strip()
    if not question:
        return web.json_response({"error": "Empty question"}, status=400)

    support = config.SUPPORT_TELEGRAM

    # Try OpenAI first
    if config.OPENAI_API_KEY:
        try:
            answer = await _ask_openai(messages, support)
            return web.json_response({
                "answer": answer,
                "source": "ai",
            })
        except Exception as e:
            logger.warning(f"OpenAI failed, falling back to FAQ: {e}")

    # Fallback to built-in FAQ
    faq_answer = _find_faq_answer(question, support)
    if faq_answer:
        return web.json_response({
            "answer": faq_answer,
            "source": "faq",
        })

    return web.json_response({
        "answer": _default_response(support),
        "source": "default",
    })


async def get_support_info(request: web.Request) -> web.Response:
    """GET /api/support - returns Telegram support contact (public, no auth)."""
    return web.json_response({
        "telegram_username": config.SUPPORT_TELEGRAM,
        "telegram_url": f"https://t.me/{config.SUPPORT_TELEGRAM}",
        "bot_username": "termizsariosiyotaxi_bot",
        "bot_url": "https://t.me/termizsariosiyotaxi_bot",
    })
