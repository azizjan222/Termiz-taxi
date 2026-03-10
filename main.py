import asyncio
import json
import os
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
DB_FILE = "taksi_baza.json" # Ma'lumotlar saqlanadigan fayl

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

ISM, TELEFON, QAYERDAN, QAYERGA, ODAM_SONI, VAQT = range(6)

# ================== 📂 MA'LUMOTLARNI SAQLASH ==================
def load_data():
    global haydovchilar, balanslar, yolovchilar, stat_zakaslar, stat_cheklar, zakas_raqami
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
        except: pass

def save_data():
    d = {
        "haydovchilar": haydovchilar,
        "balanslar": balanslar,
        "yolovchilar": list(yolovchilar),
        "stat_zakaslar": stat_zakaslar,
        "stat_cheklar": stat_cheklar,
        "zakas_raqami": zakas_raqami
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

    # 🔥 YANGI TUGMA QO'SHILDI: "📚 Yo'riqnoma"
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
            f"✅ Siz allaqachon ro'yxatdan o'tgansiz!\n📞 Raqamingiz: {haydovchilar[uid]}\n\nEndi guruhdan bemalol zakas olishingiz mumkin.",
            reply_markup=ReplyKeyboardRemove()
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
        
        # 🔥 RO'YXATDAN O'TGAN ZAHOTI YO'RIQNOMANI YUBORAMIZ
        matn_yoriqnoma = (
            "🎉 <b>TABRIKLAYMIZ! Siz haydovchi sifatida ro'yxatdan o'tdingiz!</b>\n\n"
            "Endi siz guruhdagi zakaslarni olishingiz mumkin. Ishni boshlashdan oldin qoidalar bilan tanishib chiqing:\n\n"
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
        uid = update.effective_user.id
        summa = context.user_data['topup_summa']
        summa_str = f"{summa:,}".replace(",", " ")
        photo = update.message.photo[-1].file_id
        
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
            caption=f"🧾 <b>YANGI TO'LOV!</b>\n\nHaydovchi ID: {uid}\nTel: {haydovchilar.get(uid, 'Noma\'lum')}\nSumma: <b>{summa_str} so'm</b>", 
            reply_markup=tugmalar,
            parse_mode='HTML'
        )
        await update.message.reply_text("✅ Chek adminga yuborildi. Hisobingiz tez orada to'ldiriladi.")
        context.user_data.pop('topup_step', None)
        context.user_data.pop('topup_summa', None)

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
        save_data()
        
        try:
            await context.bot.edit_message_text(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id'], text="✅ Zakas yopildi")
            context.job_queue.run_once(guruh_xabarini_ochirish, when=60, data={'chat_id': DRIVERS_GROUP_ID, 'msg_id': z['guruh_xabar_id']})
        except: pass 
        
        user = update.effective_user
        username_str = f"@{user.username}" if user.username else user.first_name
        
        tugma_yolovchi = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_id}")]])
        await context.bot.send_message(chat_id=z["yolovchi_id"], text=f"✅ Haydovchi topildi!\n\n👤 {username_str}\n📞 {haydovchilar[haydovchi_id]}\n\nTez orada siz bilan bog‘lanadi.", reply_markup=tugma_yolovchi)
        
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

# ================== 6. TAYMER JOB LARI ==================
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
    for job in context.job_queue.get_jobs_by_name(f"warn_{zakas_id}"): job.schedule_removal()
    for job in context.job_queue.get_jobs_by_name(f"avto_{zakas_id}"): job.schedule_removal()

# ================== 7. YOPISH VA VOZVRAT ==================
async def zakas_yopish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    zakas_id = int(query.data.split("_")[1])
    await query.message.edit_reply_markup(reply_markup=None)
    if zakas_id in faol_zakaslar:
        faol_zakaslar.pop(zakas_id)
        taymerni_toxtatish(context, zakas_id) 
        await query.message.reply_text("✅ Zakas muvaffaqiyatli yakunlandi! Safaringiz bexatar bo'lsin.")

async def zakas_bekor_haydovchi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    zakas_id = int(query.data.split("_")[1])
    haydovchi_id = query.from_user.id
    await query.message.edit_reply_markup(reply_markup=None)
    
    if zakas_id in faol_zakaslar:
        z = faol_zakaslar.pop(zakas_id)
        taymerni_toxtatish(context, zakas_id)
        
        narx = z['odam_soni'] * 10000
        balanslar[haydovchi_id] = balanslar.get(haydovchi_id, 0) + narx
        save_data()
        
        await query.message.reply_text(f"❌ Siz zakasni bekor qildingiz.\n💰 Xizmat haqi ({narx} so'm) balansingizga qaytarildi.")
        await context.bot.send_message(chat_id=z['yolovchi_id'], text="⚠️ Uzr, haydovchi kutilmaganda zakasni bekor qildi.\nIltimos boshqattan buyurtma bering.")

async def zakas_bekor_yolovchi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    zakas_id = int(query.data.split("_")[1])
    await query.message.edit_reply_markup(reply_markup=None)
    await query.message.reply_text("❌ Siz buyurtmani bekor qildingiz.")
    
    if zakas_id in zakaslar:
        z = zakaslar.pop(zakas_id)
        try:
             await context.bot.edit_message_text(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id'], text="❌ Bu zakas yo'lovchi tomonidan bekor qilindi.")
             context.job_queue.run_once(guruh_xabarini_ochirish, when=60, data={'chat_id': DRIVERS_GROUP_ID, 'msg_id': z['guruh_xabar_id']})
        except: pass
    elif zakas_id in faol_zakaslar:
        z = faol_zakaslar.pop(zakas_id)
        taymerni_toxtatish(context, zakas_id)
        
        haydovchi_id = z['haydovchi_id']
        narx = z['odam_soni'] * 10000
        balanslar[haydovchi_id] = balanslar.get(haydovchi_id, 0) + narx
        save_data()
        
        await context.bot.send_message(chat_id=haydovchi_id, text=f"⚠️ Diqqat! Yo'lovchi ({z['ism']}) buyurtmani bekor qildi.\n💰 Xizmat haqi ({narx} so'm) balansingizga qaytarildi.")

# ================== 8. ADMIN ==================
async def admin_tasdiqlash_rad(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    qismlar = query.data.split("_")
    action = qismlar[0]
    uid = int(qismlar[1])
    summa = int(qismlar[2])
    summa_str = f"{summa:,}".replace(",", " ")
    
    if action == "tasdiq":
        balanslar[uid] = balanslar.get(uid, 0) + summa
        save_data() 
        await query.message.edit_caption(caption=query.message.caption + f"\n\n✅ <b>{summa_str} so'm TASDIQLANDI</b>", parse_mode='HTML')
        await context.bot.send_message(chat_id=uid, text=f"✅ <b>Tabriklaymiz!</b>\nTo'lov tasdiqlandi. Balansingizga {summa_str} so'm qo'shildi.\n\nHozirgi balans: {balanslar[uid]} so'm", parse_mode='HTML')
    elif action == "rad":
        await query.message.edit_caption(caption=query.message.caption + "\n\n❌ <b>RAD ETILDI</b>", parse_mode='HTML')
        await context.bot.send_message(chat_id=uid, text="❌ To'lov chekingiz admin tomonidan qabul qilinmadi (rasm xato yoki eskirgan bo'lishi mumkin).")

async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID: return
    umumiy_balans = sum(balanslar.values())
    matn = (f"👮 ADMIN PANEL\n\n👥 Haydovchilar: {len(haydovchilar)}\n👤 Yo‘lovchilar: {len(yolovchilar)}\n"
            f"🚕 Jami Buyurtmalar: {stat_zakaslar}\n💰 Tizimdagi jami balans: {umumiy_balans} so'm")
    await update.message.reply_text(matn)

# ================== 9. REKLAMA & QOROVUL ==================
async def reklama_yuborish(context: ContextTypes.DEFAULT_TYPE):
    reklama_matni = ("🚕 Termiz  Sariosiyo Boti — tez va qulay taksi xizmati.\n\n📲 Bir necha soniyada buyurtma berish\n🚗 Haydovchilar tomonidan tezkor qabul\nBotni sinab ko'ring 👇👇👇\n@termizsariosiyotaxi_bot\n@termizsariosiyotaxi_bot")
    try: await context.bot.send_message(chat_id=DRIVERS_GROUP_ID, text=reklama_matni)
    except: pass

async def guruhda_yozishni_taqiqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message and update.message.chat_id == DRIVERS_GROUP_ID:
        uid = update.effective_user.id
        if uid in haydovchilar: return
        try:
            user_status = await context.bot.get_chat_member(DRIVERS_GROUP_ID, uid)
            if user_status.status in ['administrator', 'creator']: return
        except: pass
        try:
            await update.message.delete()
            bot_username = context.bot.username
            bot_url = f"https://t.me/{bot_username}"
            tugmalar = InlineKeyboardMarkup([[InlineKeyboardButton("🚕 Taksiga buyurtma berish", url=bot_url)], [InlineKeyboardButton("👨‍✈️ Haydovchi bo'lish", url=bot_url)]])
            matn = f"Hurmatli {update.effective_user.first_name}!\n\nTaksi kerak bo'lsa bot orqali buyurtma bering, haydovchi bo'lish uchun botga kiring 👇"
            ogohlantirish = await context.bot.send_message(chat_id=DRIVERS_GROUP_ID, text=matn, reply_markup=tugmalar)
            context.job_queue.run_once(guruh_xabarini_ochirish, when=15, data={'chat_id': DRIVERS_GROUP_ID, 'msg_id': ogohlantirish.message_id})
        except: pass

# ================== MAIN ==================
def main():
    load_data() 
    app = ApplicationBuilder().token(TOKEN).build()
    
    zakas_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^🚕 Taksi buyurtma qilish$") & filters.ChatType.PRIVATE, zakas_boshlash)],
        states={
            ISM: [MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE, ism_qabul_qilish)],
            TELEFON: [MessageHandler((filters.CONTACT | filters.TEXT) & ~filters.COMMAND & filters.ChatType.PRIVATE, telefon_qabul_qilish)],
            QAYERDAN: [MessageHandler((filters.LOCATION | filters.TEXT) & ~filters.COMMAND & filters.ChatType.PRIVATE, qayerdan_qabul_qilish)],
            QAYERGA: [MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE, qayerga_qabul_qilish)],
            ODAM_SONI: [MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE, odam_soni_qabul_qilish)],
            VAQT: [MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE, vaqt_qabul_qilish)],
        },
        fallbacks=[CommandHandler("cancel", bekor_qilish_anketa, filters=filters.ChatType.PRIVATE)]
    )

    app.add_handler(CommandHandler("start", start, filters=filters.ChatType.PRIVATE))
    app.add_handler(CommandHandler("admin", admin_panel, filters=filters.ChatType.PRIVATE))
    app.add_handler(zakas_handler) 
    
    app.add_handler(MessageHandler(filters.Regex("^👨‍✈️ Haydovchi bo'lish$") & filters.ChatType.PRIVATE, haydovchi_bolish))
    app.add_handler(MessageHandler(filters.CONTACT & filters.ChatType.PRIVATE, haydovchi_raqamini_saqlash))
    
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE, umumiy_matn_qabul_qilish))
    app.add_handler(MessageHandler(filters.PHOTO & filters.ChatType.PRIVATE, rasm_qabul_qilish))
    app.add_handler(MessageHandler(filters.ChatType.GROUPS & filters.TEXT & ~filters.COMMAND, guruhda_yozishni_taqiqlash))
    
    app.add_handler(CallbackQueryHandler(hisob_toldirish_tugmasi, pattern="^hisob_toldirish$"))
    app.add_handler(CallbackQueryHandler(zakas_yopish, pattern="^yopish_"))
    app.add_handler(CallbackQueryHandler(zakas_bekor_haydovchi, pattern="^hbekor_"))
    app.add_handler(CallbackQueryHandler(zakas_bekor_yolovchi, pattern="^ybekor_"))
    app.add_handler(CallbackQueryHandler(admin_tasdiqlash_rad, pattern="^(tasdiq_|rad_)"))
    
    if app.job_queue: app.job_queue.run_repeating(reklama_yuborish, interval=3600, first=10)
    
    print("Bot ishga tushdi...")
    app.run_polling()

if __name__ == "__main__":
    main()
