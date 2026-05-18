from aiohttp import web
import asyncio
import json
import os
import csv
import io
from datetime import datetime, timedelta
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
ADMIN_ID = 5660204735 # Admin ID
DB_FILE = "/data/taksi_baza.json" # Xavfsiz xotira fayli

KUTISH_VAQTI = 30 # Avto bekor qilish vaqti (minut)
OGOHLANTIRISH_VAQTI = 10 # Eslatma vaqti (minut)
ISM, TELEFON, QAYERDAN, QAYERGA, ODAM_SONI, VAQT = range(6)

# ================== 📂 XOTIRA VA BAZA ==================
haydovchilar = {}  
balanslar = {}     
yolovchilar = set() 
zakaslar = {}      
faol_zakaslar = {} 

stat_zakaslar = 0
stat_cheklar = 0
zakas_raqami = 0
zakaslar_tarixi = []
bekor_tarixi = [] 
birinchi_tolov_qilganlar = [] 

banned_users = []
maintenance_mode = False

def load_data():
    global haydovchilar, balanslar, yolovchilar, stat_zakaslar, stat_cheklar, zakas_raqami
    global zakaslar_tarixi, bekor_tarixi, birinchi_tolov_qilganlar, banned_users, maintenance_mode
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
                bekor_tarixi = d.get("bekor_tarixi", [])
                birinchi_tolov_qilganlar = d.get("birinchi_tolov_qilganlar", [])
                banned_users = d.get("banned_users", [])
                maintenance_mode = d.get("maintenance_mode", False)
        except Exception as e: 
            print(f"Baza o'qishda xatolik: {e}")

def save_data():
    d = {
        "haydovchilar": haydovchilar,
        "balanslar": balanslar,
        "yolovchilar": list(yolovchilar),
        "stat_zakaslar": stat_zakaslar,
        "stat_cheklar": stat_cheklar,
        "zakas_raqami": zakas_raqami,
        "zakaslar_tarixi": zakaslar_tarixi,
        "bekor_tarixi": bekor_tarixi,
        "birinchi_tolov_qilganlar": birinchi_tolov_qilganlar,
        "banned_users": banned_users,
        "maintenance_mode": maintenance_mode
    }
    try:
        with open(DB_FILE, "w") as f:
            json.dump(d, f)
    except Exception as e: 
        print(f"Baza saqlashda xatolik: {e}")

# ================== 🚫 XAVFSIZLIK TEKSHIRUVLARI ==================
async def check_access(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    uid = update.effective_user.id
    if uid in banned_users and uid != ADMIN_ID:
        await update.message.reply_text("🚫 Siz botdan foydalanishdan chetlatilgansiz. Adminga murojaat qiling.")
        return False
    if maintenance_mode and uid != ADMIN_ID:
        await update.message.reply_text("🛠 <b>Texnik ishlar olib borilmoqda!</b>\nBot tez orada o'z ishini tiklaydi, noqulaylik uchun uzr so'raymiz.", parse_mode='HTML')
        return False
    return True

# ================== 1. START VA MENYU ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return
    context.user_data.pop('admin_state', None) 

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
                tugma = ReplyKeyboardMarkup([[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]], resize_keyboard=True, one_time_keyboard=True)
                await update.message.reply_text("👨‍✈️ Zakasni olish uchun bir marta telefon raqamingizni yuborib ro'yxatdan o'ting:", reply_markup=tugma)
                return

    tugmalar = [
        [KeyboardButton("🚕 Taksi buyurtma qilish")],
        [KeyboardButton("👨‍✈️ Haydovchi bo'lish"), KeyboardButton("💳 Kabinet (Balans)")],
        [KeyboardButton("📚 Yo'riqnoma")]
    ]
    menyular = ReplyKeyboardMarkup(tugmalar, resize_keyboard=True)
    await update.message.reply_text("Assalomu alaykum! Termiz-Sariosiyo taksi xizmatiga xush kelibsiz.\n\nIltimos, o'zingizga kerakli bo'limni tanlang:", reply_markup=menyular)

# ================== 🔥 ADMIN PANEL ==================
async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID: return 
    
    tugmalar = [
        [KeyboardButton("📊 Statistika"), KeyboardButton("📢 Rassilka")],
        [KeyboardButton("💾 DB Yuklash"), KeyboardButton("📄 Excel Export")],
        [KeyboardButton("🚫 Ban"), KeyboardButton("♻️ Unban")],
        [KeyboardButton("🛠 Maintenance"), KeyboardButton("🔙 Foydalanuvchi menyusi")]
    ]
    menyular = ReplyKeyboardMarkup(tugmalar, resize_keyboard=True)
    await update.message.reply_text("👑 <b>Admin Paneliga xush kelibsiz!</b>\nO'zingizga kerakli tugmani tanlang:", reply_markup=menyular, parse_mode='HTML')

# ================== 💰 ADMIN QO'LDA PUL QO'SHISHI (/pul) ==================
async def admin_pul_qoshish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID: return
    try:
        args = context.args
        if len(args) < 2: raise ValueError
        identifikator, summa = args[0], int(args[1])
        haydovchi_id = None
        
        if identifikator.isdigit() and int(identifikator) in haydovchilar:
            haydovchi_id = int(identifikator)
            
        if not haydovchi_id:
            toza_kiritilgan = identifikator.replace("+", "").replace(" ", "")
            for uid, tel in haydovchilar.items():
                if str(tel).replace("+", "").replace(" ", "") == toza_kiritilgan:
                    haydovchi_id = uid; break
        
        if not haydovchi_id:
            await update.message.reply_text("❌ Bunday ID yoki Telefon raqamli haydovchi topilmadi!")
            return
            
        balanslar[haydovchi_id] = balanslar.get(haydovchi_id, 0) + summa
        save_data()
        
        jami_str = f"{balanslar[haydovchi_id]:,}".replace(",", " ")
        qosh_str = f"{summa:,}".replace(",", " ")
        
        await update.message.reply_text(f"✅ Muaffaqiyatli qo'shildi!\nID: {haydovchi_id}\nSumma: {qosh_str} so'm\nJami: {jami_str} so'm")
        try: await context.bot.send_message(haydovchi_id, f"🎁 Admin tomonidan balansingizga {qosh_str} so'm qo'shildi.\nJoriy balans: {jami_str} so'm")
        except: pass
    except:
        await update.message.reply_text("❌ Xato! Foydalanish shakli: /pul [Raqam/ID] [Summa]")

# ================== 3. KABINET VA TUGMALI TO'LOV ==================
async def kabinet(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid not in haydovchilar:
        await update.message.reply_text("❗ Siz hali haydovchi emassiz. '👨‍✈️ Haydovchi bo'lish' ni bosing.")
        return
        
    balans = balanslar.get(uid, 0)
    balans_str = f"{balans:,}".replace(",", " ")
    
    matn = f"💳 <b>SHAXSIY KABINET</b>\n\n👨‍✈️ Haydovchi: {haydovchilar[uid]}\n💰 Joriy balans: <b>{balans_str} so'm</b>\n\n<i>Zakas olish uchun balansingizda yetarli mablag' bo'lishi shart.</i>"
    tugma = InlineKeyboardMarkup([[InlineKeyboardButton("💰 Hisobni to'ldirish", callback_data="hisob_toldirish")]])
    await update.message.reply_text(matn, reply_markup=tugma, parse_mode='HTML')

async def hisob_toldirish_tugmasi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    tugmalar = InlineKeyboardMarkup([
        [InlineKeyboardButton("10 000 so'm", callback_data="summatanla_10000"), InlineKeyboardButton("20 000 so'm", callback_data="summatanla_20000")],
        [InlineKeyboardButton("50 000 so'm", callback_data="summatanla_50000"), InlineKeyboardButton("100 000 so'm", callback_data="summatanla_100000")],
        [InlineKeyboardButton("✏️ Boshqa summa yozish", callback_data="summatanla_boshqa")]
    ])
    await query.message.reply_text("💰 Qancha miqdorda hisobingizni to'ldirmoqchisiz?\nQuyidagilardan birini tanlang:", reply_markup=tugmalar)

async def summa_tanlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data.split('_')
    
    if data[1] == "boshqa":
        context.user_data['topup_step'] = 'summa'
        await query.message.reply_text("✏️ Iltimos, summani faqat raqamlar bilan yozing (masalan: 35000)")
        return
        
    summa = int(data[1])
    context.user_data['topup_summa'] = summa
    context.user_data['topup_step'] = 'chek' 
    
    matn = f"Tanlangan summa: <b>{summa:,} so'm</b>\n\n💳 Karta raqami (Nusxa olish uchun ustiga bosing):\n<code>9860130147785443</code>\n(K.A nomida)\n\n📸 To'lovni amalga oshirib, tasdiqlash uchun <b>chekni (skrinshot) shu yerga tashlang.</b>"
    await query.message.reply_text(matn.replace(",", " "), parse_mode='HTML')

async def rasm_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return
    if context.user_data.get('topup_step') == 'chek':
        uid = update.effective_user.id
        summa = context.user_data['topup_summa']
        summa_str = f"{summa:,}".replace(",", " ")
        photo = update.message.photo[-1].file_id
        
        haydovchi_user = update.effective_user.first_name
        global stat_cheklar; stat_cheklar += 1; save_data()
        
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"tasdiq_{uid}_{summa}")],
            [InlineKeyboardButton("❌ Rad etish", callback_data=f"rad_{uid}_{summa}")]
        ])
        
        bonus_yozuv = "🎁 (BIRINCHI TO'LOV KUTILMOQDA!)" if uid not in birinchi_tolov_qilganlar else ""
        caption = f"🧾 <b>YANGI TO'LOV!</b> {bonus_yozuv}\n👨‍✈️ Haydovchi: <a href='tg://user?id={uid}'>{haydovchi_user}</a>\n🆔 ID: <code>{uid}</code>\n📞 Tel: {haydovchilar.get(uid, '')}\n💰 Summa: <b>{summa_str} so'm</b>"
        
        await context.bot.send_photo(ADMIN_ID, photo=photo, caption=caption, reply_markup=tugmalar, parse_mode='HTML')
        await update.message.reply_text("✅ Chek adminga yuborildi. Hisobingiz tez orada to'ldiriladi.")
        context.user_data.pop('topup_step', None); context.user_data.pop('topup_summa', None)

async def admin_tasdiqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    amal, uid, summa = query.data.split('_')[0], int(query.data.split('_')[1]), int(query.data.split('_')[2])

    if amal == "tasdiq":
        if uid not in birinchi_tolov_qilganlar:
            bonus = int(summa * 0.5)
            jami_summa = summa + bonus
            birinchi_tolov_qilganlar.append(uid)
            balanslar[uid] = balanslar.get(uid, 0) + jami_summa
            save_data()
            await query.edit_message_caption(caption=f"{query.message.caption}\n\n✅ TASDIQLANDI (+50% BONUS BERILDI)", parse_mode='HTML')
            try: await context.bot.send_message(uid, f"🎉 <b>BIRINCHI TO'LOV UCHUN 50% BONUS!</b>\nHisobingizga jami <b>{jami_summa:,} so'm</b> tushdi.", parse_mode='HTML')
            except: pass
        else:
            balanslar[uid] = balanslar.get(uid, 0) + summa
            save_data()
            await query.edit_message_caption(caption=f"{query.message.caption}\n\n✅ TASDIQLANDI", parse_mode='HTML')
            try: await context.bot.send_message(uid, f"✅ Hisobingiz {summa:,} so'mga to'ldirildi!\n💰 Balans: {balanslar[uid]:,} so'm.")
            except: pass
    elif amal == "rad":
        await query.edit_message_caption(caption=f"{query.message.caption}\n\n❌ RAD ETILDI", parse_mode='HTML')
        try: await context.bot.send_message(uid, f"❌ To'lovingiz rad etildi.")
        except: pass

# ================== 4. UMUMIY MATN VA ADMIN PANEL FUNKSIYALARI ==================
async def umumiy_matn_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return
    text = update.message.text
    uid = update.effective_user.id
    
    if text == "💳 Kabinet (Balans)":
        await kabinet(update, context)
        return
    if text == "📚 Yo'riqnoma":
        matn = (
            "📚 <b>HAYDOVCHILAR UCHUN YO'RIQNOMA</b>\n\n"
            "🎁 <b>AKSIYA:</b> Birinchi marta hisob to'ldirganda <b>50% BONUS</b> beriladi!\n"
            "<i>(Masalan: 50,000 so'm tashlasangiz, 75,000 so'm tushadi)</i>\n\n"
            "1️⃣ <b>Zakas narxi:</b> 1 odam = 10 000 so'm.\n"
            "<i>(Zakas olish uchun hisobingizda pul bo'lishi shart)</i>\n\n"
            "2️⃣ <b>Hisobni to'ldirish tartibi:</b>\n"
            "🔸 Asosiy menyudan <b>«💳 Kabinet (Balans)»</b> tugmasini bosing.\n"
            "🔸 <b>«💰 Hisobni to'ldirish»</b> ni tanlab, tayyor summalardan birini bosing yoki o'zingiz summa yozing.\n"
            "🔸 Berilgan karta raqami ustiga bossangiz, avtomatik nusxa (copy) oladi.\n"
            "🔸 Payme/Click orqali pulni tashlab, chekni (skrinshot) botga yuboring.\n"
            "🔸 Admin tasdiqlashi bilan pul darhol hisobingizga tushadi!\n\n"
            "3️⃣ <b>Zakas bilan ishlash:</b>\n"
            "🔸 Guruhda chiqqan zakasni olish uchun <b>«✅ Zakasni olish»</b> tugmasini bosing.\n"
            "🔸 Mijozni manzilga yetkazgach, botdagi <b>«✅ Yopildi»</b> tugmasini bosishni unutmang!"
        )
        await update.message.reply_text(matn, parse_mode='HTML')
        return

    if context.user_data.get('topup_step') == 'summa' and uid not in [ADMIN_ID]: 
        if not text.isdigit():
            await update.message.reply_text("❗ Faqat raqam kiriting (masalan: 35000)")
            return
        summa = int(text)
        context.user_data['topup_summa'] = summa
        context.user_data['topup_step'] = 'chek'
        matn = f"Kiritilgan summa: <b>{summa:,} so'm</b>\n\n💳 Karta raqami (Nusxa oling):\n<code>9860130147785443</code>\n\n📸 Tasdiqlash uchun <b>chekni (skrinshot) shu yerga tashlang.</b>"
        await update.message.reply_text(matn.replace(",", " "), parse_mode='HTML')
        return

    # ================== ADMIN TUGMALARI ISHLASHI ==================
    if uid == ADMIN_ID:
        admin_state = context.user_data.get('admin_state')

        if text == "🔙 Foydalanuvchi menyusi":
            await start(update, context)
            return
            
        elif text == "📊 Statistika":
            tugmalar = InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("📦 Zakaslar", callback_data="stat_zakaslar"),
                    InlineKeyboardButton("📈 Umumiy", callback_data="stat_umumiy")
                ]
            ])
            await update.message.reply_text("📊 <b>Qaysi statistikani ko'rishni xohlaysiz?</b>\nQuyidagi tugmalardan birini tanlang 👇", reply_markup=tugmalar, parse_mode='HTML')
            return
            
        elif text == "💾 DB Yuklash":
            try: await update.message.reply_document(document=open(DB_FILE, 'rb'), filename="taksi_baza.json")
            except: await update.message.reply_text("Xato: Baza fayli topilmadi.")
            return
            
        elif text == "📄 Excel Export":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['ID', 'Rol', 'Telefon', 'Balans', 'Qora royxat'])
            for hid, tel in haydovchilar.items():
                ban_holat = "Banned" if hid in banned_users else "Active"
                writer.writerow([hid, 'Haydovchi', tel, balanslar.get(hid, 0), ban_holat])
            for yid in yolovchilar:
                ban_holat = "Banned" if yid in banned_users else "Active"
                writer.writerow([yid, 'Yolovchi', '', '', ban_holat])
            
            bio = io.BytesIO(output.getvalue().encode('utf-8'))
            bio.name = f"Baza_{datetime.now().strftime('%Y%m%d')}.csv"
            await update.message.reply_document(document=bio)
            return
            
        elif text == "🛠 Maintenance":
            global maintenance_mode; maintenance_mode = not maintenance_mode; save_data()
            holat = "YONIQ 🔴 (Faqat admin ishlata oladi)" if maintenance_mode else "O'CHIQ 🟢 (Hamma ishlata oladi)"
            await update.message.reply_text(f"🛠 Maintenance rejimi o'zgartirildi.\nHozirgi holati: {holat}")
            return
            
        elif text == "📢 Rassilka":
            context.user_data['admin_state'] = 'rassilka'
            await update.message.reply_text("📢 Barcha foydalanuvchilarga jo'natiladigan xabarni yuboring (Rasm, Video yoki Matn):")
            return
            
        elif text == "🚫 Ban":
            context.user_data['admin_state'] = 'ban'
            await update.message.reply_text("🚫 Bloklamoqchi bo'lgan foydalanuvchining ID raqamini yuboring:")
            return
            
        elif text == "♻️ Unban":
            context.user_data['admin_state'] = 'unban'
            await update.message.reply_text("♻️ Blokdan chiqarmoqchi bo'lgan foydalanuvchining ID raqamini yuboring:")
            return

        if admin_state == 'ban':
            if text.isdigit():
                b_id = int(text)
                if b_id not in banned_users: banned_users.append(b_id); save_data()
                await update.message.reply_text(f"✅ {b_id} ID bloklandi.")
            else: await update.message.reply_text("❗ ID raqam bo'lishi kerak.")
            context.user_data.pop('admin_state', None)
            return
            
        elif admin_state == 'unban':
            if text.isdigit():
                b_id = int(text)
                if b_id in banned_users: banned_users.remove(b_id); save_data()
                await update.message.reply_text(f"✅ {b_id} ID blokdan chiqarildi.")
            else: await update.message.reply_text("❗ ID raqam bo'lishi kerak.")
            context.user_data.pop('admin_state', None)
            return
            
        elif admin_state == 'rassilka':
            await rassilka_tarqatish(update, context) 
            return

# ================== 🔥 STATISTIKA TUGMALARI ISHLASHI ==================
async def admin_stat_tugmalari(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    
    if data == "stat_umumiy":
        jami_balans = sum(balanslar.values())
        matn = "📈 <b>UMUMIY STATISTIKA</b>\n\n"
        matn += f"👨‍✈️ <b>Jami haydovchilar:</b> {len(haydovchilar)} ta\n"
        matn += f"👤 <b>Jami yo'lovchilar:</b> {len(yolovchilar)} ta\n"
        matn += f"💰 <b>Tizimdagi umumiy balans:</b> {jami_balans:,} so'm\n"
        
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("📦 Zakaslar", callback_data="stat_zakaslar"), InlineKeyboardButton("🔄 Yangilash", callback_data="stat_umumiy")]
        ])
        await query.edit_message_text(matn.replace(",", " "), parse_mode='HTML', reply_markup=tugmalar)
        
    elif data == "stat_zakaslar":
        uz_time = datetime.utcnow() + timedelta(hours=5)
        bugun_sana = uz_time.strftime("%Y-%m-%d")
        
        bugun_yopilgan = [z for z in zakaslar_tarixi if z.get("vaqt", "").startswith(bugun_sana)]
        bugun_bekor = [b for b in bekor_tarixi if b.get("vaqt", "").startswith(bugun_sana)]
        
        matn = "📦 <b>ZAKASLAR STATISTIKASI</b>\n\n"
        matn += f"📅 <b>Bugun:</b> {len(bugun_yopilgan)} ta qabul | {len(bugun_bekor)} ta atkaz\n"
        matn += f"📊 <b>Umumiy:</b> {len(zakaslar_tarixi)} ta qabul | {len(bekor_tarixi)} ta atkaz\n\n"
        
        matn += "✅ <b>OXIRGI 10 TA QABUL QILINGAN:</b>\n"
        if not zakaslar_tarixi: 
            matn += "<i>Hozircha yo'q...</i>\n"
        for z in zakaslar_tarixi[-10:]:
            h_user = z.get('haydovchi_user', "Noma'lum")
            h_tel = z.get('haydovchi_tel', "")
            qayerdan = z.get('qayerdan', "?")
            qayerga = z.get('qayerga', "?")
            vaqt = z.get('vaqt', "")
            matn += f"🚕 {qayerdan} -> {qayerga}\n"
            matn += f"👨‍✈️ Haydovchi: {h_user} | 📞 {h_tel}\n"
            matn += f"⏰ {vaqt}\n〰️〰️〰️\n"

        matn += "\n❌ <b>OXIRGI 10 TA ATKAZ (BEKOR) QILINGAN:</b>\n"
        if not bekor_tarixi: 
            matn += "<i>Hozircha yo'q...</i>\n"
        for b in bekor_tarixi[-10:]:
            b_kim = b.get('kim', "Noma'lum")
            b_tel = b.get('tel', "")
            qayerdan = b.get('qayerdan', "?")
            qayerga = b.get('qayerga', "?")
            vaqt = b.get('vaqt', "")
            matn += f"🚕 {qayerdan} -> {qayerga}\n"
            matn += f"👤 {b_kim} | 📞 {b_tel}\n"
            matn += f"⏰ {vaqt}\n〰️〰️〰️\n"
            
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("📈 Umumiy", callback_data="stat_umumiy"), InlineKeyboardButton("🔄 Yangilash", callback_data="stat_zakaslar")]
        ])
        
        try:
            await query.edit_message_text(matn, parse_mode='HTML', reply_markup=tugmalar)
        except Exception: pass

# ================== 📢 RASSILKA (RASM/VIDEO/TEXT YUBORISH) ==================
async def admin_rassilka_media(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id == ADMIN_ID and context.user_data.get('admin_state') == 'rassilka':
        await rassilka_tarqatish(update, context)

async def rassilka_tarqatish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    jami_users = set(list(haydovchilar.keys()) + list(yolovchilar))
    success = 0
    await update.message.reply_text("⏳ Tarqatish boshlandi... Bu biroz vaqt olishi mumkin.")
    
    for uid in jami_users:
        try:
            await context.bot.copy_message(chat_id=uid, from_chat_id=update.message.chat_id, message_id=update.message.message_id)
            success += 1
            await asyncio.sleep(0.05) 
        except: pass
        
    context.user_data.pop('admin_state', None)
    await update.message.reply_text(f"✅ Rassilka yakunlandi.\nJami yuborildi: {success} ta foydalanuvchiga.")

# ================== 🔥 GURUH AVTO-JAVOB ==================
async def guruhda_avtomatik_javob(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.chat.type in ['group', 'supergroup']:
        user_id = update.effective_user.id
        if user_id in haydovchilar: return 

        try: await update.message.delete()
        except: pass

        matn = f"Hurmatli <b>{update.effective_user.first_name}</b>,\nIltimos, o'zingizga kerakli bo'limni tanlang 👇"
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚕 Taksi zakas qilish", url=f"https://t.me/{context.bot.username}")],
            [InlineKeyboardButton("👨‍✈️ Haydovchi bo'lish", url=f"https://t.me/{context.bot.username}")]
        ])
        msg = await context.bot.send_message(update.message.chat_id, text=matn, reply_markup=tugmalar, parse_mode='HTML')
        
        async def xabarni_ochirish():
            await asyncio.sleep(30) 
            try: await context.bot.delete_message(chat_id=msg.chat_id, message_id=msg.message_id)
            except: pass
            
        asyncio.create_task(xabarni_ochirish())

# ================== 5. RO'YXATDAN O'TISH & ANKETA ==================
async def haydovchi_bolish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return
    uid = update.effective_user.id
    if uid in haydovchilar:
        await update.message.reply_text("✅ Siz allaqachon ro'yxatdan o'tgansiz!\nEndi zakas olish uchun hisobingizni to'ldiring!")
        return
    tugma = ReplyKeyboardMarkup([[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]], resize_keyboard=True, one_time_keyboard=True)
    await update.message.reply_text("👨‍✈️ Telefon raqamingizni yuboring:", reply_markup=tugma)

async def haydovchi_raqamini_saqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if update.message.contact:
        haydovchilar[uid] = update.message.contact.phone_number
        if uid not in balanslar: balanslar[uid] = 0 
        save_data() 
        await update.message.reply_text("🎉 <b>TABRIKLAYMIZ! Ro'yxatdan o'tdingiz.</b>\nAsosiy menyuga o'tish uchun /start bosing.", parse_mode='HTML', reply_markup=ReplyKeyboardRemove())

async def zakas_boshlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return ConversationHandler.END
    yolovchilar.add(update.effective_user.id); save_data()
    await update.message.reply_text("👤 Ismingizni yozing:", reply_markup=ReplyKeyboardRemove())
    return ISM

async def ism_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ism'] = update.message.text
    tugma = ReplyKeyboardMarkup([[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]], resize_keyboard=True, one_time_keyboard=True)
    await update.message.reply_text("📱 Telefon raqamingizni yuboring:", reply_markup=tugma)
    return TELEFON

async def telefon_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['telefon'] = update.message.contact.phone_number if update.message.contact else update.message.text
    tugma = ReplyKeyboardMarkup([[KeyboardButton("📍 Lokatsiyani yuborish", request_location=True)]], resize_keyboard=True, one_time_keyboard=True)
    await update.message.reply_text("📍 Qayerdan ketasiz?", reply_markup=tugma)
    return QAYERDAN

async def qayerdan_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.location:
        context.user_data['qayerdan'] = "Lokatsiya 📍"
        context.user_data['lat'] = update.message.location.latitude
        context.user_data['lon'] = update.message.location.longitude
    else:
        context.user_data['qayerdan'] = update.message.text
        context.user_data['lat'], context.user_data['lon'] = None, None
    await update.message.reply_text("📍 Qayerga borasiz?", reply_markup=ReplyKeyboardRemove())
    return QAYERGA

async def qayerga_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['qayerga'] = update.message.text
    await update.message.reply_text("👥 Nechta odam ketadi? (Raqamda yozing)")
    return ODAM_SONI

async def odam_soni_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message.text.isdigit():
        await update.message.reply_text("❗ Raqam kiriting (masalan: 2)")
        return ODAM_SONI
    context.user_data['odam_soni'] = int(update.message.text)
    await update.message.reply_text("⏰ Qaysi vaqtda ketiladi? (Hozir yoki 14:30)")
    return VAQT

async def vaqt_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global zakas_raqami, stat_zakaslar; zakas_raqami += 1; stat_zakaslar += 1; save_data() 
    m = context.user_data
    m['vaqt'] = update.message.text
    
    tugma_yolovchi = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_raqami}")]])
    await update.message.reply_text("✅ Buyurtmangiz qabul qilindi va haydovchilarga yuborildi!", reply_markup=tugma_yolovchi)
    
    guruh_xabari = f"🚕 YANGI BUYURTMA\n\n👤 Yo'lovchi: {m['ism']}\n📍 {m['qayerdan']} → {m['qayerga']}\n👥 {m['odam_soni']} ta | ⏰ {m['vaqt']}"
    tugma_guruh = InlineKeyboardMarkup([[InlineKeyboardButton("✅ Zakasni olish", url=f"https://t.me/{context.bot.username}?start=olish_{zakas_raqami}")]])
    
    msg = await context.bot.send_message(DRIVERS_GROUP_ID, text=guruh_xabari, reply_markup=tugma_guruh)
    try: await context.bot.pin_chat_message(DRIVERS_GROUP_ID, msg.message_id)
    except: pass 
    
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

# ================== 🔥 TAYMERLAR ==================
async def ogohlantirish_10_min(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        try: await context.bot.send_message(chat_id=d['h_id'], text="⏰ 10 minut qoldi!\nYo‘lovchi sizni kutmoqda.\nIltimos zakasni yoping.")
        except: pass

async def avto_bekor_qilish(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        z = faol_zakaslar.pop(d['z_id'])
        
        uz_time = datetime.utcnow() + timedelta(hours=5)
        bekor_tarixi.append({
            "qayerdan": z['qayerdan'], "qayerga": z['qayerga'], "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
            "kim": "Taymer (Avtomatik)", "tel": "-"
        })
        save_data()
        
        try: await context.bot.send_message(chat_id=z['yolovchi_id'], text="❌ Buyurtma bekor qilindi (vaqt tugadi).")
        except: pass
        try: await context.bot.send_message(chat_id=z['haydovchi_id'], text="❌ Buyurtma avtomatik yopildi (vaqt tugadi). Keyingi safar tugmani bosishni unutmang.")
        except: pass

def taymerni_toxtatish(context, zakas_id):
    for job in context.job_queue.get_jobs_by_name(f"warn_{zakas_id}"): job.schedule_removal()
    for job in context.job_queue.get_jobs_by_name(f"avto_{zakas_id}"): job.schedule_removal()

async def guruh_xabarini_ochirish(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    try: await context.bot.delete_message(chat_id=d['chat_id'], message_id=d['msg_id'])
    except: pass

# ================== 6. ZAKAS BIRIKTIRISH VA AMALLARI ==================
async def zakasni_biriktirish(update: Update, context: ContextTypes.DEFAULT_TYPE, haydovchi_id: int, zakas_id: int):
    if zakas_id not in zakaslar:
        await context.bot.send_message(haydovchi_id, "❌ Zakas band yoki bekor qilingan.")
        return
        
    narx = zakaslar[zakas_id]['odam_soni'] * 10000
    if balanslar.get(haydovchi_id, 0) >= narx:
        z = zakaslar.pop(zakas_id); z["haydovchi_id"] = haydovchi_id; faol_zakaslar[zakas_id] = z
        balanslar[haydovchi_id] -= narx; save_data()
        
        try:
            await context.bot.edit_message_text(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id'], text="✅ Zakas yopildi")
            context.job_queue.run_once(guruh_xabarini_ochirish, 60, data={'chat_id': DRIVERS_GROUP_ID, 'msg_id': z['guruh_xabar_id']})
            await context.bot.unpin_chat_message(chat_id=DRIVERS_GROUP_ID, message_id=z['guruh_xabar_id']) 
        except: pass 
        
        tugma_yolovchi = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_id}")]])
        await context.bot.send_message(z["yolovchi_id"], f"✅ Haydovchi topildi!\n📞 {haydovchilar[haydovchi_id]}", reply_markup=tugma_yolovchi)
        
        if z.get('lat') and z.get('lon'): 
            await context.bot.send_location(haydovchi_id, z['lat'], z['lon'])
            
        h_xabar = f"🚕 BUYURTMA OLINDI\n👤 {z['ism']} | 📞 {z['telefon']}\n📍 {z['qayerdan']} → {z['qayerga']}\n📉 <i>Xizmat haqi ({narx} so'm) yechildi. Qoldiq: {balanslar[haydovchi_id]:,} so'm</i>"
        tugma_h = InlineKeyboardMarkup([[InlineKeyboardButton("✅ Yopildi", callback_data=f"yopish_{zakas_id}")], [InlineKeyboardButton("❌ Bekor qilish", callback_data=f"hbekor_{zakas_id}")]])
        await context.bot.send_message(haydovchi_id, h_xabar, reply_markup=tugma_h, parse_mode='HTML')
        
        context.job_queue.run_once(ogohlantirish_10_min, OGOHLANTIRISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"warn_{zakas_id}")
        context.job_queue.run_once(avto_bekor_qilish, KUTISH_VAQTI * 60, data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"avto_{zakas_id}")
    else:
        await context.bot.send_message(haydovchi_id, f"❌ Mablag' yetarli emas. Xizmat haqi: {narx} so'm.")

async def zakas_amallari(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query; await query.answer()
    amal, z_id = query.data.split('_')[0], int(query.data.split('_')[1])
    
    uz_time = datetime.utcnow() + timedelta(hours=5)

    if amal == "yopish" and z_id in faol_zakaslar:
        z = faol_zakaslar.pop(z_id)
        taymerni_toxtatish(context, z_id) 
        
        h_id = z['haydovchi_id']
        haydovchi_ismi = update.effective_user.first_name if update.effective_user else "Noma'lum"
        haydovchi_username = f" (@{update.effective_user.username})" if update.effective_user.username else ""
        haydovchi_raqami = haydovchilar.get(h_id, "")
        
        zakaslar_tarixi.append({
            "qayerdan": z['qayerdan'], 
            "qayerga": z['qayerga'], 
            "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"), 
            "haydovchi_user": f"{haydovchi_ismi}{haydovchi_username}",
            "haydovchi_tel": haydovchi_raqami
        })
        save_data()
        
        await query.edit_message_text(f"{query.message.text}\n\n✅ ZAKAS YOPILDI")
        try: await context.bot.send_message(z['yolovchi_id'], "✅ Manzilga yetib keldingiz. Rahmat!")
        except: pass
    
    elif amal == "hbekor" and z_id in faol_zakaslar:
        z = faol_zakaslar.pop(z_id); h_id = z['haydovchi_id']
        taymerni_toxtatish(context, z_id) 
        balanslar[h_id] = balanslar.get(h_id, 0) + (z['odam_soni'] * 10000)
        
        haydovchi_ismi = update.effective_user.first_name if update.effective_user else "Noma'lum"
        haydovchi_username = f" (@{update.effective_user.username})" if update.effective_user.username else ""
        
        bekor_tarixi.append({
            "qayerdan": z['qayerdan'], "qayerga": z['qayerga'], "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
            "kim": f"Haydovchi: {haydovchi_ismi}{haydovchi_username}", "tel": haydovchilar.get(h_id, "")
        })
        save_data()
        
        await query.edit_message_text(f"{query.message.text}\n\n❌ ZAKAS BEKOR QILINDI (Pul qaytarildi)")
        try: await context.bot.send_message(z['yolovchi_id'], "❌ Haydovchi buyurtmani bekor qildi.")
        except: pass
    
    elif amal == "ybekor":
        yolovchi_ismi = update.effective_user.first_name if update.effective_user else "Noma'lum"
        yolovchi_username = f" (@{update.effective_user.username})" if update.effective_user.username else ""
        kim_matni = f"Yo'lovchi: {yolovchi_ismi}{yolovchi_username}"

        if z_id in zakaslar:
            z = zakaslar.pop(z_id)
            bekor_tarixi.append({
                "qayerdan": z['qayerdan'], "qayerga": z['qayerga'], "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
                "kim": kim_matni, "tel": z.get('telefon', '')
            })
            save_data()
            await query.edit_message_text("❌ Buyurtma bekor qilindi.")
            try: await context.bot.delete_message(DRIVERS_GROUP_ID, z['guruh_xabar_id'])
            except: pass
            
        elif z_id in faol_zakaslar:
            z = faol_zakaslar.pop(z_id); h_id = z['haydovchi_id']
            taymerni_toxtatish(context, z_id) 
            balanslar[h_id] = balanslar.get(h_id, 0) + (z['odam_soni'] * 10000)
            
            bekor_tarixi.append({
                "qayerdan": z['qayerdan'], "qayerga": z['qayerga'], "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
                "kim": kim_matni, "tel": z.get('telefon', '')
            })
            save_data()
            await query.edit_message_text("❌ Buyurtma bekor qilindi.")
            try: await context.bot.send_message(h_id, "❌ Yo'lovchi buyurtmani bekor qildi. Pul qaytarildi.")
            except: pass

# ================== 📢 GURUH REKLAMA (Eslatma) ==================
async def guruhga_eslatma_xabar(context: ContextTypes.DEFAULT_TYPE):
    eslatma_matni = (
        "🚕 Termiz Sariosiyo Boti — tez va qulay taksi xizmati.\n\n"
        "📲 Bir necha soniyada buyurtma berish\n"
        "🚗 Haydovchilar tomonidan tezkor qabul\n"
        "Botni sinab ko'ring 👇👇👇\n"
        "@termizsariosiyotaxi_bot"
    )
    try: await context.bot.send_message(chat_id=DRIVERS_GROUP_ID, text=eslatma_matni)
    except Exception as e: pass
        async def api_handler(request):
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    if request.method == "OPTIONS":
        return web.Response(headers=headers)
    
    if request.method == "POST":
        body = await request.json()
        if os.path.exists(DB_FILE):
            with open(DB_FILE, "r") as f:
                current = json.load(f)
        else:
            current = {}
        current.update(body)
        with open(DB_FILE, "w") as f:
            json.dump(current, f)
        load_data()
        return web.Response(
            text='{"ok":true}',
            content_type="application/json",
            headers=headers
        )
    
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r") as f:
            data = f.read()
        return web.Response(
            text=data,
            content_type="application/json",
            headers=headers
        )
    return web.Response(
        text='{}',
        content_type="application/json",
        headers=headers
    )

async def start_api():
    app_web = web.Application()
    app_web.router.add_route("GET", "/db", api_handler)
    app_web.router.add_route("POST", "/db", api_handler)
    app_web.router.add_route("OPTIONS", "/db", api_handler)
    runner = web.AppRunner(app_web)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    print("✅ API ishga tushdi: port 8080")

# ================== ASOSIY MAIN FUNKSIYASI ==================
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
    app.add_handler(CommandHandler("pul", admin_pul_qoshish))
    
    app.add_handler(conv_handler)
    app.add_handler(MessageHandler(filters.Regex("^👨‍✈️ Haydovchi bo'lish$"), haydovchi_bolish))
    app.add_handler(MessageHandler(filters.CONTACT, haydovchi_raqamini_saqlash))
    
    app.add_handler(MessageHandler(filters.ChatType.GROUPS & ~filters.COMMAND, guruhda_avtomatik_javob))
    
    app.add_handler(MessageHandler(filters.PHOTO, lambda u, c: rasm_qabul_qilish(u, c) if c.user_data.get('topup_step') == 'chek' else admin_rassilka_media(u, c)))
    app.add_handler(MessageHandler(filters.VIDEO | filters.Document.ALL, admin_rassilka_media))
    
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, umumiy_matn_qabul_qilish))

    app.add_handler(CallbackQueryHandler(hisob_toldirish_tugmasi, pattern="^hisob_toldirish$"))
    app.add_handler(CallbackQueryHandler(summa_tanlash, pattern="^summatanla_"))
    app.add_handler(CallbackQueryHandler(admin_tasdiqlash, pattern="^(tasdiq|rad)_"))
    app.add_handler(CallbackQueryHandler(zakas_amallari, pattern="^(yopish|hbekor|ybekor)_"))
    app.add_handler(CallbackQueryHandler(admin_stat_tugmalari, pattern="^stat_")) 

    app.job_queue.run_repeating(guruhga_eslatma_xabar, interval=21600, first=10)

    async def run():
    await start_api()
    await app.initialize()
    await app.start()
    await app.updater.start_polling()
    print("✅ Bot ishga tushdi...")
    await asyncio.Event().wait()

asyncio.run(run())

if __name__ == '__main__':
    main()
