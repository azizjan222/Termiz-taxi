"""AI Assistant for drivers and passengers - answers FAQ via OpenAI or built-in fallback."""
import logging

import aiohttp
from aiohttp import web

from app import config
from app.api.drivers import _get_driver_from_request
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)


def _get_authenticated_user(request: web.Request):
    """Returns dict with role and info, or None."""
    driver = _get_driver_from_request(request)
    if driver:
        return {"role": "driver", "name": driver.first_name or "Haydovchi"}
    user = get_current_user(request)
    if user:
        return {"role": "passenger", "name": user.first_name or "Yo'lovchi"}
    return None


# System prompt - teaches the AI about Sarix Go
SYSTEM_PROMPT_DRIVER = """Sen Sarix Go taksi xizmati uchun yordamchisan. Termiz va Surxondaryo viloyati hududida ishlovchi taksi haydovchilariga yordam berasan.

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


# Passenger system prompt
SYSTEM_PROMPT_PASSENGER = """Sen Sarix Go taksi xizmati uchun yordamchisan. Termiz va Surxondaryo viloyatidagi yo'lovchilarga yordam berasan.

XIZMAT HAQIDA:
- Sarix Go - Termiz Sariosiyo taksi xizmati
- Bot: @termizsariosiyotaxi_bot
- Hudud: Surxondaryo viloyati (Termiz, Sariosiyo, Uzun, Denov, Sho'rchi, Jarqo'rg'on, Qumqo'rg'on)

YO'NALISHLAR VA NARXLAR (1 yo'lovchi uchun):
- Termiz ↔ Sariosiyo: 90,000 so'm
- Termiz ↔ Uzun: 90,000 so'm
- Termiz ↔ Denov: 80,000 so'm
- Termiz ↔ Sho'rchi: 70,000 so'm
- Sariosiyo ↔ Jarqo'rg'on: 80,000 so'm
- Sariosiyo ↔ Qumqo'rg'on: 70,000 so'm

XIZMAT TURLARI:
- 🚕 Taksi - 1, 2, 3 yo'lovchi (har biri uchun narx ko'paytiriladi)
- 📦 Pochta - hujjat va dokumentlarni boshqa shaharga yuborish (narx haydovchi bilan kelishiladi)
- 🚗 Bo'sh mashina - butun mashinani band qilish (4 o'rin); narx 4 kishilik tarif bo'yicha hisoblanadi (masalan Termiz↔Sariosiyo: 4×90,000 = 360,000 so'm)

BUYURTMA BERISH:
1. Telefon raqam orqali kiring
2. Qayerdan va qayerga ekanini tanlang
3. Tarif va odam sonini tanlang
4. Buyurtmani tasdiqlang
5. Haydovchi tez orada topiladi - sizga xabar beriladi
6. Haydovchining telefoni va mashinasini ko'rasiz

TO'LOV:
- Naqd pul - haydovchiga to'g'ridan-to'g'ri to'lanadi
- Karta - kelajakda qo'shiladi

BEKOR QILISH:
- Haydovchi tayinlanmagunga qadar - tekin
- Tayinlangandan keyin - haydovchiga sabab bilan tushuntiring

XAVFSIZLIK:
- Faqat tasdiqlangan haydovchilar
- Haydovchi ma'lumotlari ko'rinadi (ism, telefon, reyting)
- Ayollar uchun maxsus filtr ham bor (ayol haydovchi yoki ayol yo'lovchi bilan)

JAVOB BERISH STILI:
- Qisqa va aniq javob ber (3-5 jumla)
- O'zbek tilida (lotin)
- Do'stona va xushmuomala
- Emoji ishlatishing mumkin
- Mijoz bo'lganligini hisobga ol
- Agar savol xizmat haqida bo'lmasa: "Bu savolga javob bera olmayman, yordam uchun adminga murojaat qiling: @{support}"
"""


# Use driver prompt as default for backward compat
SYSTEM_PROMPT = SYSTEM_PROMPT_DRIVER


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
        "keywords": ["minimal", "minimum", "kamida", "qancha balans"],
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
            "• Tez-tez zakas oluvchi haydovchilarga maxsus bonuslar bor!\n\n"
            "Batafsil ma'lumot uchun adminga murojaat qiling: @{support}"
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


async def _ask_openai(messages: list, support_username: str, role: str = "driver") -> str:
    """Ask OpenAI; returns response text or raises."""
    api_key = config.OPENAI_API_KEY
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    if role == "passenger":
        system_template = SYSTEM_PROMPT_PASSENGER
    else:
        system_template = SYSTEM_PROMPT_DRIVER
    system = system_template.replace("{support}", support_username)

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
            f"{config.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
            headers=headers,
            json=payload,
            # Keep this BELOW the mobile client's HTTP timeout (20s) so that, if OpenAI
            # is slow/unreachable, we still fail fast and deliver the FAQ fallback before
            # the app gives up and shows a network error.
            timeout=aiohttp.ClientTimeout(total=12),
        ) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise RuntimeError(f"OpenAI HTTP {resp.status}: {data}")
            return data["choices"][0]["message"]["content"]


# Passenger-specific FAQ
FAQ_PATTERNS_PASSENGER = [
    {
        "keywords": ["narx", "qancha", "summa"],
        "answer": (
            "💰 Yo'nalish narxlari (1 yo'lovchi uchun):\n\n"
            "• Termiz ↔ Sariosiyo: 90,000 so'm\n"
            "• Termiz ↔ Uzun: 90,000 so'm\n"
            "• Termiz ↔ Denov: 80,000 so'm\n"
            "• Termiz ↔ Sho'rchi: 70,000 so'm\n"
            "• Sariosiyo ↔ Jarqo'rg'on: 80,000 so'm\n"
            "• Sariosiyo ↔ Qumqo'rg'on: 70,000 so'm\n\n"
            "👥 Bir nechta yo'lovchi uchun narx ko'paytiriladi"
        ),
    },
    {
        "keywords": ["pochta", "hujjat", "dokument", "yuborish"],
        "answer": (
            "📦 Pochta xizmati:\n\n"
            "• Hujjat va dokumentlarni boshqa shaharga yuborish\n"
            "• Narx: haydovchi bilan kelishiladi\n"
            "• Buyurtma berishda \"Pochta\" tanlang\n"
            "• Qabul qiluvchi ma'lumotlarini kiriting\n"
            "• Kim to'lashini ko'rsating (yuboruvchi yoki qabul qiluvchi)"
        ),
    },
    {
        "keywords": ["bo'sh", "bosh mashina", "to'liq", "tolik"],
        "answer": (
            "🚗 Bo'sh mashina:\n\n"
            "• Butun mashinani 4 o'rin to'liq band qilish\n"
            "• Narx: 4 kishilik tarif bo'yicha hisoblanadi\n"
            "  (masalan Termiz↔Sariosiyo: 4×90,000 = 360,000 so'm)\n"
            "• Boshqa yo'lovchilar bo'lmaydi\n"
            "• Yuk uchun ham qulay\n"
            "• Tarif tanlashda \"Bo'sh mashina\" ni tanlang"
        ),
    },
    {
        "keywords": ["bekor", "cancel"],
        "answer": (
            "❌ Buyurtmani bekor qilish:\n\n"
            "• Haydovchi topilmaguncha — bemalol bekor qiling\n"
            "• Haydovchi tayinlangach — agar muammo bo'lsa qo'ng'iroq qilib gaplashing\n"
            "• Bekor qilish haydovchi va o'zingiz uchun yomon, iloji boricha bekor qilmang"
        ),
    },
    {
        "keywords": ["xavfsiz", "ayol", "ishonch"],
        "answer": (
            "🔒 Xavfsizlik:\n\n"
            "• Faqat tasdiqlangan haydovchilar\n"
            "• Haydovchi ismi, telefoni, reytingi ko'rinadi\n"
            "• Mashina raqami va modeli ko'rinadi\n"
            "• Ayol yo'lovchi uchun maxsus filtr (ayol haydovchi yoki ayol yo'lovchi bor mashina)\n"
            "• Tashvish bo'lsa: @SarixGo_support_bot ga yozing"
        ),
    },
    {
        "keywords": ["bonus", "ball", "promo"],
        "answer": (
            "🎁 Bonus va Promo:\n\n"
            "• Do'stlaringizni taklif qiling - ball oling\n"
            "• Promo kodlar bilan chegirma\n"
            "• Profil → \"Promokodlarim\" bo'limida ko'ring\n"
            "• Yangi aksiyalardan xabardor bo'lish uchun bildirishnomalar yoqing"
        ),
    },
]


async def chat(request: web.Request) -> web.Response:
    """POST /api/ai/chat
    Body: {"messages": [{"role": "user", "content": "Salom"}, ...]}
    Works for both authenticated drivers and passengers.
    """
    auth = _get_authenticated_user(request)
    if not auth:
        # Helps diagnose driver/passenger auth issues from server logs (e.g. when only
        # one of the apps can reach the AI assistant).
        has_bearer = request.headers.get("Authorization", "").startswith("Bearer ")
        logger.warning(
            "AI chat unauthorized (Authorization header present: %s)", has_bearer
        )
        return web.json_response(
            {"error": "Avtorizatsiya talab qilinadi"}, status=401
        )

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    messages = body.get("messages", [])
    if not messages or not isinstance(messages, list):
        return web.json_response({"error": "messages array required"}, status=400)

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
    role = auth["role"]

    if config.OPENAI_API_KEY:
        try:
            answer = await _ask_openai(messages, support, role=role)
            return web.json_response({"answer": answer, "source": "ai"})
        except Exception as e:
            logger.warning(f"OpenAI failed for role={role}, falling back to FAQ: {e}")
    else:
        logger.info("OPENAI_API_KEY not set; using built-in FAQ for role=%s", role)

    # FAQ fallback - role-specific
    patterns = FAQ_PATTERNS_PASSENGER if role == "passenger" else FAQ_PATTERNS
    q_lower = question.lower()
    for faq in patterns:
        if any(kw in q_lower for kw in faq["keywords"]):
            return web.json_response({
                "answer": faq["answer"].replace("{support}", support),
                "source": "faq",
            })

    # Also check the other set (general questions)
    for faq in (FAQ_PATTERNS if role == "passenger" else FAQ_PATTERNS_PASSENGER):
        if any(kw in q_lower for kw in faq["keywords"]):
            return web.json_response({
                "answer": faq["answer"].replace("{support}", support),
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
        "email": config.SUPPORT_EMAIL,
    })
