import asyncio
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

# Taymer vaqtlari (minutda)
KUTISH_VAQTI = 30
OGOHLANTIRISH_VAQTI = 20 # 30 dan 20 o'tgach (10 minut qolganda) xabar boradi
TOLOV_KUTISH_VAQTI = 20

# Xotira va Statistika
haydovchilar = {}  # haydovchi_id -> telefon raqami
yolovchilar = set() # yo'lovchilar ID lari (statistika uchun)
zakaslar = {}      
faol_zakaslar = {} 
pending_payments = {} # Kutilyotgan to'lovlar
bloklangan_haydovchilar = set()

stat_zakaslar = 0
stat_cheklar = 0
zakas_raqami = 0

# Suhbat bosqichlari
ISM, TELEFON, QAYERDAN, QAYERGA, ODAM_SONI, VAQT = range(6)

# ================== 1. START MENYU ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tugmalar = [
        [KeyboardButton("🚕 Taksi buyurtma qilish")],
        [KeyboardButton("👨‍✈️ Haydovchi bo'lish")]
    ]
    menyular = ReplyKeyboardMarkup(tugmalar, resize_keyboard=True)

    await update.message.reply_text(
        "Assalomu alaykum! Termiz-Sariosiyo taksi xizmatiga xush kelibsiz.\n\n"
        "Iltimos, o'zingizga kerakli bo'limni tanlang:",
        reply_markup=menyular
    )

# ================== 2. HAYDOVCHI RO'YXATDAN O'TISHI ==================
async def haydovchi_bolish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tugma = ReplyKeyboardMarkup(
        [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
        resize_keyboard=True, one_time_keyboard=True
    )
    await update.message.reply_text(
        "👨‍✈️ Haydovchi, guruhdan zakas olishingiz uchun telefon raqamingizni yuboring:", 
        reply_markup=tugma
    )

async def haydovchi_raqamini_saqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if update.message.contact:
        haydovchilar[uid] = update.message.contact.phone_number
        await update.message.reply_text(
            "✅ Telefon raqamingiz saqlandi! Endi guruhdan bemalol zakas olishingiz mumkin.",
            reply_markup=ReplyKeyboardRemove()
        )

# ================== 3. YO'LOVCHI ANKETASI ==================
async def zakas_boshlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    yolovchilar.add(update.effective_user.id)
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
    await update.message.reply_text(
        "📍 Qayerdan ketasiz?", reply_markup=tugma
    )
    return QAYERDAN

async def qayerdan_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.location:
        context.user_data['qayerdan'] = "Lokatsiya yuborildi 🗺"
    else:
        context.user_data['qayerdan'] = update.message.text
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
    
    context.user_data['vaqt'] = update.message.text
    m = context.user_data
    
    zakaslar[zakas_raqami] = {
        "yolovchi_id": update.effective_user.id,
        "telefon": m['telefon'],
        "ism": m['ism'],
        "qayerdan": m['qayerdan'],
        "qayerga": m['qayerga'],
        "odam_soni": m['odam_soni'],
        "vaqt": m['vaqt']
    }

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
    
    tugma_guruh = InlineKeyboardMarkup([[InlineKeyboardButton("✅ Zakasni olish", callback_data=f"olish_{zakas_raqami}")]])
    await context.bot.send_message(chat_id=DRIVERS_GROUP_ID, text=guruh_xabari, reply_markup=tugma_guruh)
    return ConversationHandler.END

async def bekor_qilish_anketa(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Buyurtma bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END

# ================== 4. HAYDOVCHI ZAKASNI OLISHI ==================
async def zakasni_olish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    haydovchi_id = query.from_user.id
    zakas_id = int(query.data.split("_")[1])
    
    if haydovchi_id not in haydovchilar:
        await query.message.reply_text("❗ Iltimos, avval /start ni bosib 'Haydovchi bo'lish' tugmasi orqali raqamingizni yuboring.")
        return
        
    if haydovchi_id in bloklangan_haydovchilar:
        await query.message.reply_text("⛔ Siz vaqtincha bloklandingiz\nSabab: To‘lov amalga oshirilmadi\nOldingi zakasni to‘lang.")
        return
        
    if zakas_id not in zakaslar:
        await query.message.edit_text("❌ Bu zakas allaqachon olindi yoki bekor qilindi.")
        return
        
    z = zakaslar.pop(zakas_id) 
    z["haydovchi_id"] = haydovchi_id
    faol_zakaslar[zakas_id] = z
    
    await query.message.edit_text(text=f"{query.message.text}\n\n✅ <b>Bu zakas @{query.from_user.username} tomonidan olindi!</b>", parse_mode='HTML')
    
    tugma_yolovchi = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_id}")]])
    await context.bot.send_message(
        chat_id=z["yolovchi_id"],
        text=(f"✅ Haydovchi topildi!\n\n👤 @{query.from_user.username}\n📞 {haydovchilar[haydovchi_id]}\n\nTez orada siz bilan bog‘lanadi."),
        reply_markup=tugma_yolovchi
    )
    
    haydovchi_xabari = (
        "🚕 BUYURTMA OLINDI\n\n"
        f"👤 Yo‘lovchi: {z['ism']}\n📞 Tel: {z['telefon']}\n📍 {z['qayerdan']} → {z['qayerga']}\n"
        f"👥 {z['odam_soni']} ta odam | ⏰ {z['vaqt']}\n\n"
        "⚠️ Eslatma: Har bir olingan yo'lovchi uchun 10 ming so'm to'lov qilish shart!"
    )
    tugmalar_haydovchi = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Yopildi", callback_data=f"yopish_{zakas_id}")],
        [InlineKeyboardButton("❌ Bekor qilish", callback_data=f"hbekor_{zakas_id}")]
    ])
    await context.bot.send_message(chat_id=haydovchi_id, text=haydovchi_xabari, reply_markup=tugmalar_haydovchi)

    # Taymerlar (10 min ogohlantirish va to'liq bekor qilish)
    context.job_queue.run_once(ogohlantirish_10_min, OGOHLANTIRISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"warn_{zakas_id}")
    context.job_queue.run_once(avto_bekor_qilish, KUTISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"avto_{zakas_id}")

# ================== 5. TAYMER JOB LARI ==================
async def ogohlantirish_10_min(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        await context.bot.send_message(
            chat_id=d['h_id'],
            text="⏰ 10 minut qoldi!\nYo‘lovchi sizni kutmoqda.\nIltimos zakasni yoping."
        )

async def avto_bekor_qilish(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        z = faol_zakaslar.pop(d['z_id'])
        await context.bot.send_message(chat_id=z['yolovchi_id'], text="❌ Buyurtma bekor qilindi (vaqt tugadi).")
        await context.bot.send_message(chat_id=z['haydovchi_id'], text="❌ Buyurtma bekor qilindi (vaqt tugadi). Siz 'Yopildi' tugmasini bosmadingiz.")

def taymerni_toxtatish(context, zakas_id):
    for job in context.job_queue.get_jobs_by_name(f"warn_{zakas_id}"): job.schedule_removal()
    for job in context.job_queue.get_jobs_by_name(f"avto_{zakas_id}"): job.schedule_removal()

async def haydovchini_bloklash(context: ContextTypes.DEFAULT_TYPE):
    uid = context.job.data
    if uid in pending_payments:
        bloklangan_haydovchilar.add(uid)
        await context.bot.send_message(
            chat_id=uid, 
            text="⛔ Siz vaqtincha bloklandingiz\nSabab: To‘lov amalga oshirilmadi\nOldingi zakasni to‘lang"
        )

# ================== 6. YOPISH VA BEKOR QILISHLAR ==================
async def zakas_yopish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    zakas_id = int(query.data.split("_")[1])
    haydovchi_id = query.from_user.id
    
    await query.message.edit_reply_markup(reply_markup=None)
    
    if zakas_id in faol_zakaslar:
        z = faol_zakaslar.pop(zakas_id)
        taymerni_toxtatish(context, zakas_id) 
        
        # To'lov hisoblash
        summa = z['odam_soni'] * 10000
        pending_payments[haydovchi_id] = {'summa': summa, 'zakas_id': zakas_id}
        
        matn = f"💰 To‘lov qiling:\n\n9860 1301 4778 5443\n(K.A nomida)\n\nSumma: {summa} so'm"
        tugma = InlineKeyboardMarkup([[InlineKeyboardButton("📸 Chek yuborish", callback_data=f"chek_{haydovchi_id}")]])
        
        await context.bot.send_message(chat_id=haydovchi_id, text=matn, reply_markup=tugma)
        
        # 20 minutlik blok taymeri
        context.job_queue.run_once(haydovchini_bloklash, TOLOV_KUTISH_VAQTI * 60, data=haydovchi_id, name=f"block_{haydovchi_id}")

async def zakas_bekor_haydovchi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    zakas_id = int(query.data.split("_")[1])
    
    await query.message.edit_reply_markup(reply_markup=None)
    await query.message.reply_text("❌ Siz bu zakasni bekor qildingiz.")
    
    if zakas_id in faol_zakaslar:
        z = faol_zakaslar.pop(zakas_id)
        taymerni_toxtatish(context, zakas_id)
        await context.bot.send_message(chat_id=z['yolovchi_id'], text="⚠️ Uzr, haydovchi kutilmaganda zakasni bekor qildi.\nIltimos boshqattan buyurtma bering.")

async def zakas_bekor_yolovchi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    zakas_id = int(query.data.split("_")[1])
    
    await query.message.edit_reply_markup(reply_markup=None)
    await query.message.reply_text("❌ Siz buyurtmani bekor qildingiz.")
    
    if zakas_id in zakaslar:
        zakaslar.pop(zakas_id)
    elif zakas_id in faol_zakaslar:
        z = faol_zakaslar.pop(zakas_id)
        taymerni_toxtatish(context, zakas_id)
        await context.bot.send_message(chat_id=z['haydovchi_id'], text=f"⚠️ Diqqat! Yo'lovchi ({z['ism']}) buyurtmani bekor qildi.")

# ================== 7. TO'LOV VA ADMIN PANEL ==================
async def chek_yuborish_tugmasi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.message.reply_text("📸 Iltimos, to'lov chekini rasmga olib menga yuboring.")

async def rasm_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid in pending_payments:
        # Blok taymerini to'xtatamiz (vaqtincha bloklamaydi)
        for job in context.job_queue.get_jobs_by_name(f"block_{uid}"): 
            job.schedule_removal()
            
        global stat_cheklar
        stat_cheklar += 1
        
        photo = update.message.photo[-1].file_id
        summa = pending_payments[uid]['summa']
        
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"tasdiq_{uid}")],
            [InlineKeyboardButton("❌ Rad etish", callback_data=f"rad_{uid}")]
        ])
        
        await context.bot.send_photo(
            chat_id=ADMIN_ID, 
            photo=photo, 
            caption=f"🧾 Yangi chek!\nHaydovchi ID: {uid}\nSumma: {summa} so'm", 
            reply_markup=tugmalar
        )
        await update.message.reply_text("✅ Chek adminga yuborildi. Tasdiqlanishini kuting.")

async def admin_tasdiqlash_rad(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    uid = int(data.split("_")[1])
    
    if data.startswith("tasdiq_"):
        if uid in bloklangan_haydovchilar:
            bloklangan_haydovchilar.remove(uid)
        if uid in pending_payments:
            del pending_payments[uid]
            
        await query.message.edit_caption(caption=query.message.caption + "\n\n✅ TASDIQLANDI")
        await context.bot.send_message(chat_id=uid, text="✅ To‘lov tasdiqlandi\nBlok yechildi")
        
    elif data.startswith("rad_"):
        bloklangan_haydovchilar.add(uid)
        await query.message.edit_caption(caption=query.message.caption + "\n\n❌ RAD ETILDI")
        await context.bot.send_message(chat_id=uid, text="⛔ Siz vaqtincha bloklandingiz\nSabab: Chek noto'g'ri. Admin rad etdi.")

async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return
        
    matn = (
        "👮 ADMIN PANEL\n\n"
        f"👥 Haydovchilar soni: {len(haydovchilar)}\n"
        f"👤 Yo‘lovchilar soni: {len(yolovchilar)}\n"
        f"🚕 Buyurtmalar: {stat_zakaslar}\n"
        f"📸 Cheklar: {stat_cheklar}"
    )
    await update.message.reply_text(matn)

# ================== MAIN ==================
def main():
    app = ApplicationBuilder().token(TOKEN).build()
    
    zakas_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^🚕 Taksi buyurtma qilish$"), zakas_boshlash)],
        states={
            ISM: [MessageHandler(filters.TEXT & ~filters.COMMAND, ism_qabul_qilish)],
            TELEFON: [MessageHandler(filters.CONTACT | (filters.TEXT & ~filters.COMMAND), telefon_qabul_qilish)],
            QAYERDAN: [MessageHandler(filters.LOCATION | (filters.TEXT & ~filters.COMMAND), qayerdan_qabul_qilish)],
            QAYERGA: [MessageHandler(filters.TEXT & ~filters.COMMAND, qayerga_qabul_qilish)],
            ODAM_SONI: [MessageHandler(filters.TEXT & ~filters.COMMAND, odam_soni_qabul_qilish)],
            VAQT: [MessageHandler(filters.TEXT & ~filters.COMMAND, vaqt_qabul_qilish)],
        },
        fallbacks=[CommandHandler("cancel", bekor_qilish_anketa)]
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin_panel))
    app.add_handler(zakas_handler) 
    
    app.add_handler(MessageHandler(filters.Regex("^👨‍✈️ Haydovchi bo'lish$"), haydovchi_bolish))
    app.add_handler(MessageHandler(filters.CONTACT, haydovchi_raqamini_saqlash))
    app.add_handler(MessageHandler(filters.PHOTO, rasm_qabul_qilish)) # Chek qabul qilish
    
    app.add_handler(CallbackQueryHandler(zakasni_olish, pattern="^olish_"))
    app.add_handler(CallbackQueryHandler(zakas_yopish, pattern="^yopish_"))
    app.add_handler(CallbackQueryHandler(zakas_bekor_haydovchi, pattern="^hbekor_"))
    app.add_handler(CallbackQueryHandler(zakas_bekor_yolovchi, pattern="^ybekor_"))
    app.add_handler(CallbackQueryHandler(chek_yuborish_tugmasi, pattern="^chek_"))
    app.add_handler(CallbackQueryHandler(admin_tasdiqlash_rad, pattern="^(tasdiq_|rad_)"))
    
    print("Bot ishga tushdi...")
    app.run_polling()

if __name__ == "__main__":
    main()
