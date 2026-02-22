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
yolovchilar = set() 
zakaslar = {}      
faol_zakaslar = {} 
pending_payments = {} 
bloklangan_haydovchilar = set()

stat_zakaslar = 0
stat_cheklar = 0
zakas_raqami = 0

ISM, TELEFON, QAYERDAN, QAYERGA, ODAM_SONI, VAQT = range(6)

# ================== 📂 MA'LUMOTLARNI SAQLASH VA YUKLASH ==================
def load_data():
    global haydovchilar, yolovchilar, bloklangan_haydovchilar, stat_zakaslar, stat_cheklar, zakas_raqami
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r") as f:
                d = json.load(f)
                haydovchilar.update({int(k): v for k, v in d.get("haydovchilar", {}).items()})
                yolovchilar.update([int(i) for i in d.get("yolovchilar", [])])
                bloklangan_haydovchilar.update([int(i) for i in d.get("bloklangan", [])])
                stat_zakaslar = d.get("stat_zakaslar", 0)
                stat_cheklar = d.get("stat_cheklar", 0)
                zakas_raqami = d.get("zakas_raqami", 0)
        except: pass

def save_data():
    d = {
        "haydovchilar": haydovchilar,
        "yolovchilar": list(yolovchilar),
        "bloklangan": list(bloklangan_haydovchilar),
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
                    "👨‍✈️ Siz hali botdan ro'yxatdan o'tmagansiz.\nZakasni olish uchun telefon raqamingizni yuboring:", 
                    reply_markup=tugma
                )
                return

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
        save_data() # MA'LUMOT BAZAGA SAQLANDI
        
        kutilayotgan_zakas = context.user_data.get('kutilayotgan_zakas')
        if kutilayotgan_zakas:
            del context.user_data['kutilayotgan_zakas'] 
            await update.message.reply_text("✅ Telefoningiz saqlandi.", reply_markup=ReplyKeyboardRemove())
            await zakasni_biriktirish(update, context, uid, kutilayotgan_zakas)
        else:
            await update.message.reply_text(
                "✅ Telefon raqamingiz saqlandi! Endi guruhdan bemalol zakas olishingiz mumkin.",
                reply_markup=ReplyKeyboardRemove()
            )

# ================== 3. YO'LOVCHI ANKETASI ==================
async def zakas_boshlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    yolovchilar.add(update.effective_user.id)
    save_data() # BAZAGA SAQLANDI
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
    save_data() # BAZAGA SAQLANDI
    
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
        "yolovchi_id": update.effective_user.id,
        "telefon": m['telefon'],
        "ism": m['ism'],
        "qayerdan": m['qayerdan'],
        "qayerga": m['qayerga'],
        "odam_soni": m['odam_soni'],
        "vaqt": m['vaqt'],
        "lat": m.get('lat'),
        "lon": m.get('lon'),
        "guruh_xabar_id": msg.message_id 
    }
    
    return ConversationHandler.END

async def bekor_qilish_anketa(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Buyurtma bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END

# ================== GURUHDAN XABAR O'CHIRISH ==================
async def guruh_xabarini_ochirish(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    try:
        await context.bot.delete_message(chat_id=d['chat_id'], message_id=d['msg_id'])
    except:
        pass

# ================== 4. ZAKASNI BIRIKTIRISH JARAYONI ==================
async def zakasni_biriktirish(update: Update, context: ContextTypes.DEFAULT_TYPE, haydovchi_id: int, zakas_id: int):
    if haydovchi_id in bloklangan_haydovchilar:
        await context.bot.send_message(chat_id=haydovchi_id, text="⛔ Siz vaqtincha bloklandingiz\nSabab: To‘lov amalga oshirilmadi\nOldingi zakasni to‘lang.")
        return
        
    if zakas_id not in zakaslar:
        await context.bot.send_message(chat_id=haydovchi_id, text="❌ Kechirasiz, bu zakas allaqachon boshqa haydovchi tomonidan olindi yoki bekor qilindi.")
        return
        
    z = zakaslar.pop(zakas_id) 
    z["haydovchi_id"] = haydovchi_id
    faol_zakaslar[zakas_id] = z
    
    try:
        await context.bot.edit_message_text(
            chat_id=DRIVERS_GROUP_ID,
            message_id=z['guruh_xabar_id'],
            text="✅ Zakas yopildi"
        )
        context.job_queue.run_once(
            guruh_xabarini_ochirish, 
            when=60, 
            data={'chat_id': DRIVERS_GROUP_ID, 'msg_id': z['guruh_xabar_id']}
        )
    except: pass 
    
    user = update.effective_user
    username_str = f"@{user.username}" if user.username else user.first_name
    
    tugma_yolovchi = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_id}")]])
    await context.bot.send_message(
        chat_id=z["yolovchi_id"],
        text=(f"✅ Haydovchi topildi!\n\n👤 {username_str}\n📞 {haydovchilar[haydovchi_id]}\n\nTez orada siz bilan bog‘lanadi."),
        reply_markup=tugma_yolovchi
    )
    
    if z.get('lat') and z.get('lon'):
        await context.bot.send_location(
            chat_id=haydovchi_id,
            latitude=z['lat'],
            longitude=z['lon']
        )
        
    haydovchi_xabari = (
        "🚕 BUYURTMA OLINDI\n\n"
        f"👤 Yo‘lovchi: {z['ism']}\n📞 Tel: {z['telefon']}\n📍 {z['qayerdan']} → {z['qayerga']}\n"
        f"👥 {z['odam_soni']} ta odam | ⏰ {z['vaqt']}\n\n"
        "⚠️ Eslatma: Har bir olingan yo'lovchi uchun 10 ming so'm to'lov qilish shart!\n\n"
        "❗️ Iltimos, yo'lovchi bilan tezroq bog'laning. Zakas yakunlangach, pastdagi «✅ Yopildi» tugmasini bosishni unutmang!"
    )
    tugmalar_haydovchi = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Yopildi", callback_data=f"yopish_{zakas_id}")],
        [InlineKeyboardButton("❌ Bekor qilish", callback_data=f"hbekor_{zakas_id}")]
    ])
    await context.bot.send_message(chat_id=haydovchi_id, text=haydovchi_xabari, reply_markup=tugmalar_haydovchi)

    context.job_queue.run_once(ogohlantirish_10_min, OGOHLANTIRISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"warn_{zakas_id}")
    context.job_queue.run_once(avto_bekor_qilish, KUTISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"avto_{zakas_id}")

# ================== 5. TAYMER JOB LARI ==================
async def ogohlantirish_10_min(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        await context.bot.send_message(chat_id=d['h_id'], text="⏰ 10 minut qoldi!\nYo‘lovchi sizni kutmoqda.\nIltimos zakasni yoping.")

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
        save_data() # BAZAGA SAQLANDI
        await context.bot.send_message(chat_id=uid, text="⛔ Siz vaqtincha bloklandingiz\nSabab: To‘lov amalga oshirilmadi\nOldingi zakasni to‘lang")

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
        
        summa = z['odam_soni'] * 10000
        summa_str = f"{summa:,}".replace(",", " ")
        pending_payments[haydovchi_id] = {'summa': summa, 'zakas_id': zakas_id}
        
        matn = (
            "✅ Zakas muvaffaqiyatli yopildi!\n\n"
            "💰 To‘lov qiling:\n"
            "9860 1301 4778 5443\n"
            "(K.A nomida)\n\n"
            f"Summa: {summa_str} so'm\n\n"
            "📸 Iltimos, to'lov qilinganligi haqidagi chekni rasmga olib (skrinshot) shu yerga yuboring."
        )
        
        await context.bot.send_message(chat_id=haydovchi_id, text=matn)
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
        z = zakaslar.pop(zakas_id)
        try:
             await context.bot.edit_message_text(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id'], text="❌ Bu zakas yo'lovchi tomonidan bekor qilindi.")
             context.job_queue.run_once(guruh_xabarini_ochirish, when=60, data={'chat_id': DRIVERS_GROUP_ID, 'msg_id': z['guruh_xabar_id']})
        except: pass
    elif zakas_id in faol_zakaslar:
        z = faol_zakaslar.pop(zakas_id)
        taymerni_toxtatish(context, zakas_id)
        await context.bot.send_message(chat_id=z['haydovchi_id'], text=f"⚠️ Diqqat! Yo'lovchi ({z['ism']}) buyurtmani bekor qildi.")

# ================== 7. TO'LOV VA ADMIN PANEL ==================
async def rasm_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid in pending_payments:
        for job in context.job_queue.get_jobs_by_name(f"block_{uid}"): job.schedule_removal()
            
        global stat_cheklar
        stat_cheklar += 1
        save_data() # BAZAGA SAQLANDI
        
        photo = update.message.photo[-1].file_id
        summa = pending_payments[uid]['summa']
        
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"tasdiq_{uid}")],
            [InlineKeyboardButton("❌ Rad etish", callback_data=f"rad_{uid}")]
        ])
        
        await context.bot.send_photo(
            chat_id=ADMIN_ID, photo=photo, 
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
            save_data() # BAZAGA SAQLANDI
        if uid in pending_payments: 
            del pending_payments[uid]
            
        await query.message.edit_caption(caption=query.message.caption + "\n\n✅ TASDIQLANDI")
        await context.bot.send_message(chat_id=uid, text="✅ To‘lov tasdiqlandi\nBlok yechildi, yana ishlashingiz mumkin!")
        
    elif data.startswith("rad_"):
        bloklangan_haydovchilar.add(uid)
        save_data() # BAZAGA SAQLANDI
        await query.message.edit_caption(caption=query.message.caption + "\n\n❌ RAD ETILDI")
        await context.bot.send_message(chat_id=uid, text="⛔ Siz vaqtincha bloklandingiz\nSabab: Chek noto'g'ri. Admin rad etdi.")

async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID: return
    matn = (f"👮 ADMIN PANEL\n\n👥 Haydovchilar: {len(haydovchilar)}\n👤 Yo‘lovchilar: {len(yolovchilar)}\n🚕 Buyurtmalar: {stat_zakaslar}\n📸 Cheklar: {stat_cheklar}")
    await update.message.reply_text(matn)

# ================== MAIN ==================
def main():
    load_data() # ISHGA TUSHGANDA BAZADAGI MA'LUMOTLARNI YUKLASH
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
    app.add_handler(MessageHandler(filters.PHOTO & filters.ChatType.PRIVATE, rasm_qabul_qilish))
    
    app.add_handler(CallbackQueryHandler(zakas_yopish, pattern="^yopish_"))
    app.add_handler(CallbackQueryHandler(zakas_bekor_haydovchi, pattern="^hbekor_"))
    app.add_handler(CallbackQueryHandler(zakas_bekor_yolovchi, pattern="^ybekor_"))
    app.add_handler(CallbackQueryHandler(admin_tasdiqlash_rad, pattern="^(tasdiq_|rad_)"))
    
    print("Bot ishga tushdi...")
    app.run_polling()

if __name__ == "__main__":
    main()
