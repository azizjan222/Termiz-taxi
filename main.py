import asyncio
import json
import os
from datetime import datetime
from telegram import (
    Update, 
    KeyboardButton, 
    ReplyKeyboardMarkup, 
    ReplyKeyboardRemove,
    InlineKeyboardButton,
    InlineKeyboardMarkup
)
from telegram.ext import (
    ApplicationBuilder, 
    CommandHandler, 
    MessageHandler, 
    filters, 
    ContextTypes, 
    ConversationHandler,
    CallbackQueryHandler
)

# ================== ⚙️ SOZLAMALAR ==================
TOKEN = "8046769457:AAHYIPHxZ4fw6NKLBfW_3XOMZapmONK4a9g"
DRIVERS_GROUP_ID = -1002452524294 # Haydovchilar guruhi
ADMIN_ID = 5660204735 # Admin ID (Sizning ID raqamingiz)

KUTISH_VAQTI = 30 
OGOHLANTIRISH_VAQTI = 20
TOLOV_KUTISH_VAQTI = 20
DB_FILE = "/data/taksi_baza.json" # Ma'lumotlar saqlanadigan fayl

# Xotira va Statistika
haydovchilar = {}  
balanslar = {}     
yolovchilar = set() 
zakaslar = {}      
faol_zakaslar = {} 
pending_payments = {} 
bloklangan_haydovchilar = set()

stat_zakaslar = 0
stat_cheklar = 0
zakas_raqami = 0
zakaslar_tarixi = []

ISM, TELEFON, QAYERDAN, QAYERGA, ODAM_SONI, VAQT = range(6)

# ================== 📂 MA'LUMOTLARNI SAQLASH ==================
def load_data():
    global haydovchilar, balanslar, yolovchilar, stat_zakaslar, stat_cheklar, zakas_raqami, zakaslar_tarixi
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r") as f:
                d = json.load(f)
                haydovchilar.update({int(k): v for k, v in d.get("haydovchilar", {}).items()})
                balanslar.update({int(k): v for k, v in d.get("balanslar", {}).items()})
                yolovchilar.update([int(i) for i in d.get("yolovchilar", [])])
                stat_zakaslar = d.get("stat_zakaslar", 0)
                stat_cheklar = d.get("stat_cheklar", 0)
                zakas_raqami = d.get("zakas_raqami", 0)
                zakaslar_tarixi = d.get("zakaslar_tarixi", [])
        except: pass

def save_data():
    d = {
        "haydovchilar": haydovchilar,
        "balanslar": balanslar,
        "yolovchilar": list(yolovchilar),
        "stat_zakaslar": stat_zakaslar,
        "stat_cheklar": stat_cheklar,
        "zakas_raqami": zakas_raqami,
        "zakaslar_tarixi": zakaslar_tarixi
    }
    try:
        with open(DB_FILE, "w") as f:
            json.dump(d, f)
    except: pass

# ================== 1. START VA DEEP LINK MENYUSI ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    user_id = update.effective_user.id
    
    if text and len(text.split()) > 1:
        param = text.split()[1]
        if param.startswith("olish_"):
            zakas_id = int(param.split("_")[1])
            
            if user_id in haydovchilar:
                await zakasni_biriktirish(update, context, user_id, zakas_id)
                return
            else:
                context.user_data['kutilayotgan_zakas'] = zakas_id
                tugma = ReplyKeyboardMarkup(
                    [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
                    resize_keyboard=True, one_time_keyboard=True
                )
                await update.message.reply_text(
                    "👨‍✈️ Siz hali botdan ro'yxatdan o'tmagansiz.\nZakasni olish uchun bir marta telefon raqamingizni yuboring:", 
                    reply_markup=tugma
                )
                return

    tugmalar = [
        [KeyboardButton("🚕 Taksi buyurtma qilish")],
        [KeyboardButton("👨‍✈️ Haydovchi bo'lish"), KeyboardButton("💳 Kabinet (Balans)")],
        [KeyboardButton("📚 Yo'riqnoma")]
    ]
    menyular = ReplyKeyboardMarkup(tugmalar, resize_keyboard=True)

    await update.message.reply_text(
        "Assalomu alaykum! Termiz-Sariosiyo taksi xizmatiga xush kelibsiz.\n\n"
        "Iltimos, o'zingizga kerakli bo'limni tanlang:",
        reply_markup=menyular
    )

# ================== 🔥 ADMIN PANEL BUYRUG'I (/admin) ==================
async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return # Faqat admin ishlata oladi

    bugun_sana = datetime.now().strftime("%Y-%m-%d")
    bugungi_zakaslar = [z for z in zakaslar_tarixi if z.get("vaqt", "").startswith(bugun_sana)]
    
    # 🔥 YANGILANISH: Statistika hisoblari
    jami_balans = sum(balanslar.values())
    jami_balans_str = f"{jami_balans:,}".replace(",", " ")

    matn = "👑 <b>ADMIN PANEL</b>\n\n"
    matn += f"👨‍✈️ <b>Jami haydovchilar:</b> {len(haydovchilar)} ta\n"
    matn += f"👤 <b>Jami yo'lovchilar:</b> {len(yolovchilar)} ta\n"
    matn += f"💰 <b>Tizimdagi umumiy balans:</b> {jami_balans_str} so'm\n\n"
    matn += f"📅 <b>Bugun qabul qilingan zakaslar:</b> {len(bugungi_zakaslar)} ta\n"
    matn += f"📦 <b>Umumiy qabul qilingan zakaslar:</b> {len(zakaslar_tarixi)} ta\n\n"
    matn += "📜 <b>SO'NGGI 15 TA ZAKAS TARIXI:</b>\n\n"

    for z in zakaslar_tarixi[-15:]:
        matn += f"🚕 <b>{z['qayerdan']} -> {z['qayerga']}</b>\n"
        matn += f"👨‍✈️ Haydovchi: {z['haydovchi_user']} (Tel: {z.get('haydovchi_tel', '')})\n"
        matn += f"⏰ Qabul qilgan vaqti: {z['vaqt']}\n"
        matn += "〰️〰️〰️〰️〰️〰️\n"

    await update.message.reply_text(matn, parse_mode='HTML')

# ================== 🔥 YO'RIQNOMA (QOIDALAR) ==================
async def yoriqnoma(update: Update, context: ContextTypes.DEFAULT_TYPE):
    matn = (
        "📚 <b>HAYDOVCHILAR UCHUN TO'LIQ YO'RIQNOMA</b>\n\n"
        "Botimiz orqali ishlash tartibi juda oddiy va adolatli:\n\n"
        "<b>1️⃣ BALANS TIZIMI (Oldindan to'lov)</b>\n"
        "Zakas olishingiz uchun hisobingizda pul bo'lishi shart! Har bir mijoz uchun balansingizdan 10 000 so'm avtomatik yechiladi.\n"
        "👉 <i>Balansni to'ldirish uchun asosiy menyudagi «💳 Kabinet» tugmasini bosing va karta raqamiga pul o'tkazib, chekni yuboring.</i>\n\n"
        "<b>2️⃣ ZAKAS OLISH</b>\n"
        "Zakaslar haydovchilar guruhiga tashlanadi. «✅ Zakasni olish» tugmasini bossangiz, bot pulingizni tekshiradi. Pulingiz yetsa, zakas sizga beriladi va xizmat haqi yechiladi.\n\n"
        "<b>3️⃣ MIJOZ BILAN BOG'LANISH</b>\n"
        "Zakasni olgach, bot sizning lichkangizga mijoz raqami va lokatsiyasini tashlaydi. Zudlik bilan aloqaga chiqing!\n\n"
        "<b>4️⃣ ZAKASNI YOPISH</b>\n"
        "Mijozni manziliga oborib qo'ygach, botdagi «✅ Yopildi» tugmasini bosish esdan chiqmasin.\n\n"
        "<b>5️⃣ BEKOR QILISH VA VOZVRAT (Pul qaytishi)</b>\n"
        "Mabodo mijoz ketmaydigan bo'lib qolsa yoki o'zingiz borolmasangiz «❌ Bekor qilish» ni bosing. Yechib olingan pul 1 soniyada balansingizga to'liq qaytariladi!\n\n"
        "<i>⚠️ Oq yo'l, ishingizga baraka! Haydovchilar guruhida ortiqcha gap-so'z yozish taqiqlanadi.</i>"
    )
    await update.message.reply_text(matn, parse_mode='HTML')

# ================== 2. HAYDOVCHI RO'YXATDAN O'TISHI ==================
async def haydovchi_bolish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid in haydovchilar:
        await update.message.reply_text(
            f"✅ Siz allaqachon ro'yxatdan o'tgansiz!\n📞 Raqamingiz: {haydovchilar[uid]}\n\n"
            "⚠️ <b>Endi guruhdan zakas olish uchun «💳 Kabinet (Balans)» bo'limiga o'tib hisobingizni to'ldiring!</b>",
            parse_mode='HTML'
        )
        return
    tugma = ReplyKeyboardMarkup(
        [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
        resize_keyboard=True, one_time_keyboard=True
    )
    await update.message.reply_text("👨‍✈️ Haydovchi, guruhdan zakas olishingiz uchun telefon raqamingizni yuboring:", reply_markup=tugma)

async def haydovchi_raqamini_saqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if update.message.contact:
        haydovchilar[uid] = update.message.contact.phone_number
        if uid not in balanslar: balanslar[uid] = 0 
        save_data() 
        
        # 🔥 YANGILANISH: Ortiqcha gaplar olib tashlandi
        matn_yoriqnoma = (
            "🎉 <b>TABRIKLAYMIZ! Siz haydovchi sifatida ro'yxatdan o'tdingiz!</b>\n\n"
            "<b>1.</b> Zakas olish uchun balansingizda pul bo'lishi kerak (1 odam = 10 ming so'm).\n"
            "<b>2.</b> Balansni «💳 Kabinet» bo'limidan to'ldirasiz.\n"
            "<b>3.</b> Guruhdan «✅ Zakasni olish»ni bossangiz, pul yechilib raqam beriladi.\n"
            "<b>4.</b> Zakas bekor qilinsa, pulingiz darhol balansingizga qaytadi (Vozvrat tizimi mavjud).\n\n"
            "Asosiy menyuga o'tish uchun /start tugmasini bosing."
        )
        
        kutilayotgan_zakas = context.user_data.get('kutilayotgan_zakas')
        if kutilayotgan_zakas:
            del context.user_data['kutilayotgan_zakas'] 
            await update.message.reply_text(matn_yoriqnoma, parse_mode='HTML', reply_markup=ReplyKeyboardRemove())
            await zakasni_biriktirish(update, context, uid, kutilayotgan_zakas)
        else:
            await update.message.reply_text(matn_yoriqnoma, parse_mode='HTML', reply_markup=ReplyKeyboardRemove())

# ================== 3. KABINET VA BALANS ==================
async def kabinet(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid not in haydovchilar:
        await update.message.reply_text("❗ Siz hali haydovchi sifatida ro'yxatdan o'tmagansiz. '👨‍✈️ Haydovchi bo'lish' tugmasini bosing.")
        return
        
    balans = balanslar.get(uid, 0)
    balans_str = f"{balans:,}".replace(",", " ")
    
    matn = (
        "💳 <b>SHAXSIY KABINET</b>\n\n"
        f"👨‍✈️ Haydovchi: {haydovchilar[uid]}\n"
        f"💰 Joriy balans: <b>{balans_str} so'm</b>\n\n"
        "<i>Zakas olish uchun balansingizda yetarli mablag' bo'lishi shart.</i>"
    )
    
    tugma = InlineKeyboardMarkup([[InlineKeyboardButton("💰 Hisobni to'ldirish", callback_data="hisob_toldirish")]])
    await update.message.reply_text(matn, reply_markup=tugma, parse_mode='HTML')

async def hisob_toldirish_tugmasi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    context.user_data['topup_step'] = 'summa'
    await query.message.reply_text(
        "💰 Necha so'm to'lamoqchisiz?\n"
        "Iltimos, summani faqat raqamlar bilan yozing (masalan: 50000 yoki 100000)"
    )

async def umumiy_matn_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    
    if text == "💳 Kabinet (Balans)":
        context.user_data.pop('topup_step', None) 
        await kabinet(update, context)
        return
        
    if text == "📚 Yo'riqnoma":
        context.user_data.pop('topup_step', None)
        await yoriqnoma(update, context)
        return
        
    if context.user_data.get('topup_step') == 'summa':
        if not text.isdigit():
            await update.message.reply_text("❗ Iltimos, faqat raqam kiriting (masalan: 50000)")
            return
            
        summa = int(text)
        summa_str = f"{summa:,}".replace(",", " ")
        context.user_data['topup_summa'] = summa
        context.user_data['topup_step'] = 'chek'
        
        matn = (
            f"Kiritilgan summa: <b>{summa_str} so'm</b>\n\n"
            "💳 Karta raqami: <b>9860 1301 4778 5443</b>\n"
            "(K.A nomida)\n\n"
            "📸 Iltimos, to'lovni amalga oshirib, chekni (skrinshot) shu yerga tashlang."
        )
        await update.message.reply_text(matn, parse_mode='HTML')
        return

async def rasm_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if context.user_data.get('topup_step') == 'chek':
        user = update.effective_user
        uid = user.id
        summa = context.user_data['topup_summa']
        summa_str = f"{summa:,}".replace(",", " ")
        photo = update.message.photo[-1].file_id
        
        haydovchi_user = f"@{user.username}" if user.username else f"<a href='tg://user?id={uid}'>{user.first_name}</a>"

        global stat_cheklar
        stat_cheklar += 1
        save_data()
        
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"tasdiq_{uid}_{summa}")],
            [InlineKeyboardButton("❌ Rad etish", callback_data=f"rad_{uid}_{summa}")]
        ])
        
        await context.bot.send_photo(
            chat_id=ADMIN_ID, 
            photo=photo, 
            caption=f"🧾 <b>YANGI TO'LOV!</b>\n\n👨‍✈️ Haydovchi: {haydovchi_user}\n🆔 ID: <code>{uid}</code>\n📞 Tel: {haydovchilar.get(uid, 'Noma\'lum')}\n💰 Summa: <b>{summa_str} so'm</b>", 
            reply_markup=tugmalar,
            parse_mode='HTML'
        )
        await update.message.reply_text("✅ Chek adminga yuborildi. Hisobingiz tez orada to'ldiriladi.")
        context.user_data.pop('topup_step', None)
        context.user_data.pop('topup_summa', None)

# ================== ADMIN TO'LOVNI TASDIQLASHI ==================
async def admin_tasdiqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data.split('_')
    amal = data[0]
    uid = int(data[1])
    summa = int(data[2])

    if amal == "tasdiq":
        balanslar[uid] = balanslar.get(uid, 0) + summa
        save_data()
        await query.edit_message_caption(caption=f"{query.message.caption}\n\n✅ TASDIQLANDI", parse_mode='HTML')
        await context.bot.send_message(chat_id=uid, text=f"✅ Hisobingiz {summa} so'mga to'ldirildi! Joriy balans: {balanslar[uid]} so'm.")
    elif amal == "rad":
        await query.edit_message_caption(caption=f"{query.message.caption}\n\n❌ RAD ETILDI", parse_mode='HTML')
        await context.bot.send_message(chat_id=uid, text=f"❌ To'lovingiz rad etildi. Iltimos adminga murojaat qiling.")

# ================== 4. YO'LOVCHI ANKETASI ==================
async def zakas_boshlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    yolovchilar.add(update.effective_user.id)
    save_data()
    await update.message.reply_text("👤 Ismingizni yozing:", reply_markup=ReplyKeyboardRemove())
    return ISM

async def ism_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ism'] = update.message.text
    tugma = ReplyKeyboardMarkup(
        [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
        resize_keyboard=True, one_time_keyboard=True
    )
    await update.message.reply_text("📱 Telefon raqamingizni yuboring:", reply_markup=tugma)
    return TELEFON

async def telefon_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.contact:
        context.user_data['telefon'] = update.message.contact.phone_number
    else:
        context.user_data['telefon'] = update.message.text
        
    tugma = ReplyKeyboardMarkup(
        [[KeyboardButton("📍 Lokatsiyani yuborish", request_location=True)]],
        resize_keyboard=True, one_time_keyboard=True
    )
    await update.message.reply_text("📍 Qayerdan ketasiz?", reply_markup=tugma)
    return QAYERDAN

async def qayerdan_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.location:
        context.user_data['qayerdan'] = "Lokatsiya 📍"
        context.user_data['lat'] = update.message.location.latitude
        context.user_data['lon'] = update.message.location.longitude
    else:
        context.user_data['qayerdan'] = update.message.text
        context.user_data['lat'] = None
        context.user_data['lon'] = None
        
    await update.message.reply_text("📍 Qayerga borasiz?", reply_markup=ReplyKeyboardRemove())
    return QAYERGA

async def qayerga_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['qayerga'] = update.message.text
    await update.message.reply_text("👥 Nechta odam ketadi? (Faqat raqam kiriting, masalan: 2)")
    return ODAM_SONI

async def odam_soni_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message.text.isdigit():
        await update.message.reply_text("❗ Iltimos, odam sonini faqat raqamda yozing (masalan: 1, 2, 3)")
        return ODAM_SONI
    context.user_data['odam_soni'] = int(update.message.text)
    await update.message.reply_text("⏰ Qaysi vaqtda ketiladi? (Masalan: Hozir yoki 14:30 da)")
    return VAQT

async def vaqt_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global zakas_raqami, stat_zakaslar
    zakas_raqami += 1
    stat_zakaslar += 1
    save_data() 
    
    context.user_data['vaqt'] = update.message.text
    m = context.user_data
    bot_username = context.bot.username 
    
    tugma_yolovchi = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_raqami}")]])
    await update.message.reply_text(
        "✅ Buyurtmangiz qabul qilindi va haydovchilarga yuborildi!\nHaydovchi topilishi bilan xabar beramiz.",
        reply_markup=tugma_yolovchi
    )
    
    guruh_xabari = (
        "🚕 YANGI BUYURTMA\n\n"
        f"👤 Ism: {m['ism']}\n"
        f"📍 Qayerdan: {m['qayerdan']}\n"
        f"📍 Qayerga: {m['qayerga']}\n"
        f"👥 {m['odam_soni']} ta odam | ⏰ {m['vaqt']}"
    )
    url_link = f"https://t.me/{bot_username}?start=olish_{zakas_raqami}"
    tugma_guruh = InlineKeyboardMarkup([[InlineKeyboardButton("✅ Zakasni olish", url=url_link)]])
    
    msg = await context.bot.send_message(chat_id=DRIVERS_GROUP_ID, text=guruh_xabari, reply_markup=tugma_guruh)
    
    try:
        await context.bot.pin_chat_message(chat_id=DRIVERS_GROUP_ID, message_id=msg.message_id, disable_notification=False)
    except: pass 
    
    zakaslar[zakas_raqami] = {
        "yolovchi_id": update.effective_user.id, "telefon": m['telefon'], "ism": m['ism'],
        "qayerdan": m['qayerdan'], "qayerga": m['qayerga'], "odam_soni": m['odam_soni'],
        "vaqt": m['vaqt'], "lat": m.get('lat'), "lon": m.get('lon'), "guruh_xabar_id": msg.message_id 
    }
    return ConversationHandler.END

async def bekor_qilish_anketa(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Buyurtma bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END

# ================== GURUHDAN XABAR O'CHIRISH ==================
async def guruh_xabarini_ochirish(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    try: await context.bot.delete_message(chat_id=d['chat_id'], message_id=d['msg_id'])
    except: pass

# ================== 5. ZAKASNI BIRIKTIRISH ==================
async def zakasni_biriktirish(update: Update, context: ContextTypes.DEFAULT_TYPE, haydovchi_id: int, zakas_id: int):
    if zakas_id not in zakaslar:
        await context.bot.send_message(chat_id=haydovchi_id, text="❌ Kechirasiz, bu zakas allaqachon boshqa haydovchi tomonidan olindi yoki bekor qilindi.")
        return
        
    z = zakaslar[zakas_id]
    narx = z['odam_soni'] * 10000
    haydovchi_balansi = balanslar.get(haydovchi_id, 0)
    
    if haydovchi_balansi >= narx:
        z = zakaslar.pop(zakas_id)
        z["haydovchi_id"] = haydovchi_id
        faol_zakaslar[zakas_id] = z
        
        balanslar[haydovchi_id] -= narx
        
        user = update.effective_user
        haydovchi_user = f"@{user.username}" if user.username else f"<a href='tg://user?id={haydovchi_id}'>{user.first_name}</a>"
        vaqt_hozir = datetime.now().strftime("%Y-%m-%d %H:%M")
        
        zakaslar_tarixi.append({
            "vaqt": vaqt_hozir,
            "haydovchi_id": haydovchi_id,
            "haydovchi_user": haydovchi_user,
            "haydovchi_tel": haydovchilar.get(haydovchi_id, ""),
            "qayerdan": z['qayerdan'],
            "qayerga": z['qayerga']
        })
        save_data() 
        
        try:
            await context.bot.edit_message_text(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id'], text="✅ Zakas yopildi")
            context.job_queue.run_once(guruh_xabarini_ochirish, when=60, data={'chat_id': DRIVERS_GROUP_ID, 'msg_id': z['guruh_xabar_id']})
            await context.bot.unpin_chat_message(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id']) 
        except: pass 
        
        tugma_yolovchi = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_id}")]])
        await context.bot.send_message(chat_id=z["yolovchi_id"], text=f"✅ Haydovchi topildi!\n\n👨‍✈️ Haydovchi: {haydovchi_user}\n📞 {haydovchilar[haydovchi_id]}\n\nTez orada siz bilan bog‘lanadi.", parse_mode='HTML', reply_markup=tugma_yolovchi)
        
        if z.get('lat') and z.get('lon'):
            await context.bot.send_location(chat_id=haydovchi_id, latitude=z['lat'], longitude=z['lon'])
            
        haydovchi_xabari = (
            "🚕 BUYURTMA OLINDI\n\n"
            f"👤 Yo‘lovchi: {z['ism']}\n📞 Tel: {z['telefon']}\n📍 {z['qayerdan']} → {z['qayerga']}\n"
            f"👥 {z['odam_soni']} ta odam | ⏰ {z['vaqt']}\n\n"
            f"📉 <i>Xizmat haqi ({narx} so'm) balansingizdan yechildi. Qoldiq: {balanslar[haydovchi_id]} so'm</i>\n\n"
            "❗️ Iltimos, yo'lovchi bilan bog'laning. Zakas yakunlangach «✅ Yopildi» tugmasini bosishni unutmang!"
        )
        tugmalar_haydovchi = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Yopildi", callback_data=f"yopish_{zakas_id}")],
            [InlineKeyboardButton("❌ Bekor qilish", callback_data=f"hbekor_{zakas_id}")]
        ])
        await context.bot.send_message(chat_id=haydovchi_id, text=haydovchi_xabari, reply_markup=tugmalar_haydovchi, parse_mode='HTML')

        context.job_queue.run_once(ogohlantirish_10_min, OGOHLANTIRISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"warn_{zakas_id}")
        context.job_queue.run_once(avto_bekor_qilish, KUTISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"avto_{zakas_id}")
    else:
        narx_str = f"{narx:,}".replace(",", " ")
        qoldiq_str = f"{haydovchi_balansi:,}".replace(",", " ")
        await context.bot.send_message(chat_id=haydovchi_id, text=f"❌ <b>Hisobingizda mablag' yetarli emas!</b>\n\nBu zakas xizmat haqi: {narx_str} so'm.\nSizning balansingiz: {qoldiq_str} so'm.\n\nIltimos, Kabinet orqali hisobingizni to'ldiring.", parse_mode='HTML')

# ================== 6. TAYMER JOB LARI VA AMALLAR ==================
async def ogohlantirish_10_min(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        await context.bot.send_message(chat_id=d['h_id'], text="⏰ 10 minut qoldi!\nYo‘lovchi sizni kutmoqda.\nIltimos zakasni yoping.")

async def avto_bekor_qilish(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        z = faol_zakaslar.pop(d['z_id'])
        await context.bot.send_message(chat_id=z['yolovchi_id'], text="❌ Buyurtma bekor qilindi (vaqt tugadi).")
        await context.bot.send_message(chat_id=z['haydovchi_id'], text="❌ Buyurtma avtomatik yopildi (vaqt tugadi). Keyingi safar tugmani bosishni unutmang.")

def taymerni_toxtatish(context, zakas_id):
    for job in context.job_queue.get_jobs_by_name(f"warn_{zakas_id}"): 
        job.schedule_removal()
    for job in context.job_queue.get_jobs_by_name(f"avto_{zakas_id}"): 
        job.schedule_removal()

async def zakas_amallari(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data.split('_')
    amal = data[0]
    z_id = int(data[1])

    if amal == "yopish":
        if z_id in faol_zakaslar:
            z = faol_zakaslar.pop(z_id)
            taymerni_toxtatish(context, z_id)
            save_data()
            await query.edit_message_text(f"{query.message.text}\n\n✅ ZAKAS YOPILDI")
            await context.bot.send_message(chat_id=z['yolovchi_id'], text="✅ Manzilga yetib keldingiz. Xizmatimizdan foydalanganingiz uchun rahmat!")
    
    elif amal == "hbekor":
        if z_id in faol_zakaslar:
            z = faol_zakaslar.pop(z_id)
            h_id = z['haydovchi_id']
            taymerni_toxtatish(context, z_id)
            narx = z['odam_soni'] * 10000
            balanslar[h_id] = balanslar.get(h_id, 0) + narx
            save_data()
            await query.edit_message_text(f"{query.message.text}\n\n❌ ZAKAS BEKOR QILINDI\nPul qaytarildi.")
            await context.bot.send_message(chat_id=z['yolovchi_id'], text="❌ Uzr, haydovchi buyurtmani bekor qildi. Iltimos, qaytadan buyurtma bering.")
    
    elif amal == "ybekor":
        if z_id in zakaslar:
            z = zakaslar.pop(z_id)
            save_data()
            await query.edit_message_text("❌ Buyurtma bekor qilindi.")
            try: await context.bot.delete_message(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id'])
            except: pass
        elif z_id in faol_zakaslar:
            z = faol_zakaslar.pop(z_id)
            h_id = z['haydovchi_id']
            taymerni_toxtatish(context, z_id)
            narx = z['odam_soni'] * 10000
            balanslar[h_id] = balanslar.get(h_id, 0) + narx
            save_data()
            await query.edit_message_text("❌ Buyurtma bekor qilindi.")
            await context.bot.send_message(chat_id=h_id, text="❌ Yo'lovchi buyurtmani bekor qildi. Pulingiz balansingizga qaytarildi.")

# ================== 🔥 GURUHGA REKLAMA ESLATMASI ==================
async def guruhga_eslatma_xabar(context: ContextTypes.DEFAULT_TYPE):
    eslatma_matni = (
        "🚕 Termiz Sariosiyo Boti — tez va qulay taksi xizmati.\n\n"
        "📲 Bir necha soniyada buyurtma berish\n"
        "🚗 Haydovchilar tomonidan tezkor qabul\n"
        "Botni sinab ko'ring 👇👇👇\n"
        "@termizsariosiyotaxi_bot\n"
        "@termizsariosiyotaxi_bot"
    )
    try:
        await context.bot.send_message(chat_id=DRIVERS_GROUP_ID, text=eslatma_matni)
    except Exception as e:
        print(f"Eslatma xabar yuborishda xatolik: {e}")

# ================== 7. ASOSIY QISM (MAIN) ==================
def main():
    load_data()
    app = ApplicationBuilder().token(TOKEN).build()

    conv_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^🚕 Taksi buyurtma qilish$"), zakas_boshlash)],
        states={
            ISM: [MessageHandler(filters.TEXT & ~filters.COMMAND, ism_qabul_qilish)],
            TELEFON: [MessageHandler(filters.CONTACT | (filters.TEXT & ~filters.COMMAND), telefon_qabul_qilish)],
            QAYERDAN: [MessageHandler(filters.LOCATION | (filters.TEXT & ~filters.COMMAND), qayerdan_qabul_qilish)],
            QAYERGA: [MessageHandler(filters.TEXT & ~filters.COMMAND, qayerga_qabul_qilish)],
            ODAM_SONI: [MessageHandler(filters.TEXT & ~filters.COMMAND, odam_soni_qabul_qilish)],
            VAQT: [MessageHandler(filters.TEXT & ~filters.COMMAND, vaqt_qabul_qilish)],
        },
        fallbacks=[CommandHandler("cancel", bekor_qilish_anketa), MessageHandler(filters.Regex("^❌ Bekor qilish$"), bekor_qilish_anketa)]
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin_panel))
    app.add_handler(MessageHandler(filters.Regex("^👨‍✈️ Haydovchi bo'lish$"), haydovchi_bolish))
    app.add_handler(MessageHandler(filters.CONTACT, haydovchi_raqamini_saqlash))
    app.add_handler(conv_handler)
    
    app.add_handler(MessageHandler(filters.PHOTO, rasm_qabul_qilish))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, umumiy_matn_qabul_qilish))

    app.add_handler(CallbackQueryHandler(hisob_toldirish_tugmasi, pattern="^hisob_toldirish$"))
    app.add_handler(CallbackQueryHandler(admin_tasdiqlash, pattern="^(tasdiq|rad)_"))
    app.add_handler(CallbackQueryHandler(zakas_amallari, pattern="^(yopish|hbekor|ybekor)_"))

    app.job_queue.run_repeating(guruhga_eslatma_xabar, interval=21600, first=10)

    print("Bot ishga tushdi...")
    app.run_polling()

if __name__ == '__main__':
    main()
