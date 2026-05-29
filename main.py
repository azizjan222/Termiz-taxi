import asyncio
import json
import os
import csv
import io
import logging
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

# Load environment configuration
from app import config as app_config
from app.database import init_db, get_session
from app.api.server import start_api_server
from app.api.websocket import ws_manager
from app.migrate import run_migration
from app.models import Driver as DBDriver, User as DBUser, Order as DBOrder, OrderHistory as DBHistory

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sarixgo.bot")

# ================== ⚙️ SOZLAMALAR ==================
TOKEN = app_config.BOT_TOKEN
DRIVERS_GROUP_ID = app_config.DRIVERS_GROUP_ID
ADMIN_ID = app_config.ADMIN_ID
# Use local data folder by default; falls back to /data if it exists (Railway volume)
DB_FILE = "/data/taksi_baza.json" if os.path.exists("/data") else "./data/taksi_baza.json"

KUTISH_VAQTI = app_config.WAIT_MINUTES
OGOHLANTIRISH_VAQTI = app_config.WARN_MINUTES
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
        "zakaslar": {str(k): v for k, v in zakaslar.items()},
        "faol_zakaslar": {str(k): v for k, v in faol_zakaslar.items()},
        "zakaslar_tarixi": zakaslar_tarixi,
        "bekor_tarixi": bekor_tarixi,
        "birinchi_tolov_qilganlar": birinchi_tolov_qilganlar,
        "banned_users": banned_users,
        "maintenance_mode": maintenance_mode
    }
    try:
        with open(DB_FILE, "w") as f:
            json.dump(d, f, ensure_ascii=False)
    except Exception as e:
        print(f"Baza saqlashda xatolik: {e}")


# ================== 🚫 XAVFSIZLIK ==================
async def check_access(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    uid = update.effective_user.id
    if uid in banned_users and uid != ADMIN_ID:
        await update.message.reply_text("🚫 Siz botdan foydalanishdan chetlatilgansiz.")
        return False
    if maintenance_mode and uid != ADMIN_ID:
        await update.message.reply_text("🛠 <b>Texnik ishlar olib borilmoqda!</b>", parse_mode='HTML')
        return False
    return True


# ================== 1. START ==================
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
                tugma = ReplyKeyboardMarkup(
                    [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
                    resize_keyboard=True, one_time_keyboard=True)
                await update.message.reply_text(
                    "👨‍✈️ Zakasni olish uchun telefon raqamingizni yuborib ro'yxatdan o'ting:",
                    reply_markup=tugma)
                return

    tugmalar = [
        [KeyboardButton("🚕 Taksi buyurtma qilish")],
        [KeyboardButton("👨‍✈️ Haydovchi bo'lish"), KeyboardButton("💳 Kabinet (Balans)")],
        [KeyboardButton("📚 Yo'riqnoma")]
    ]
    await update.message.reply_text(
        "Assalomu alaykum! Termiz-Sariosiyo taksi xizmatiga xush kelibsiz.\n\nIltimos, kerakli bo'limni tanlang:",
        reply_markup=ReplyKeyboardMarkup(tugmalar, resize_keyboard=True))


# ================== ADMIN PANEL ==================
async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID: return
    tugmalar = [
        [KeyboardButton("📊 Statistika"), KeyboardButton("📢 Rassilka")],
        [KeyboardButton("💾 DB Yuklash"), KeyboardButton("📄 Excel Export")],
        [KeyboardButton("🚫 Ban"), KeyboardButton("♻️ Unban")],
        [KeyboardButton("🛠 Maintenance"), KeyboardButton("🔙 Foydalanuvchi menyusi")]
    ]
    await update.message.reply_text(
        "👑 <b>Admin Paneli</b>", parse_mode='HTML',
        reply_markup=ReplyKeyboardMarkup(tugmalar, resize_keyboard=True))


# ================== PUL QO'SHISH ==================
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
            toza = identifikator.replace("+", "").replace(" ", "")
            for uid, tel in haydovchilar.items():
                if str(tel).replace("+", "").replace(" ", "") == toza:
                    haydovchi_id = uid
                    break

        if not haydovchi_id:
            await update.message.reply_text("❌ Haydovchi topilmadi!")
            return

        balanslar[haydovchi_id] = balanslar.get(haydovchi_id, 0) + summa
        save_data()
        jami = f"{balanslar[haydovchi_id]:,}".replace(",", " ")
        qosh = f"{summa:,}".replace(",", " ")
        await update.message.reply_text(f"✅ Qo'shildi!\nID: {haydovchi_id}\n+{qosh} so'm\nJami: {jami} so'm")
        try:
            await context.bot.send_message(haydovchi_id,
                f"🎁 Balansingizga {qosh} so'm qo'shildi.\nJami: {jami} so'm")
        except: pass
    except:
        await update.message.reply_text("❌ Xato! /pul [ID/Tel] [Summa]")


# ================== KABINET ==================
async def kabinet(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid not in haydovchilar:
        await update.message.reply_text("❗ Siz haydovchi emassiz.")
        return
    balans = balanslar.get(uid, 0)
    matn = f"💳 <b>KABINET</b>\n\n📞 {haydovchilar[uid]}\n💰 Balans: <b>{balans:,} so'm</b>".replace(",", " ")
    tugma = InlineKeyboardMarkup([[InlineKeyboardButton("💰 Hisobni to'ldirish", callback_data="hisob_toldirish")]])
    await update.message.reply_text(matn, reply_markup=tugma, parse_mode='HTML')


async def hisob_toldirish_tugmasi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    tugmalar = InlineKeyboardMarkup([
        [InlineKeyboardButton("10 000 so'm", callback_data="summatanla_10000"),
         InlineKeyboardButton("20 000 so'm", callback_data="summatanla_20000")],
        [InlineKeyboardButton("50 000 so'm", callback_data="summatanla_50000"),
         InlineKeyboardButton("100 000 so'm", callback_data="summatanla_100000")],
        [InlineKeyboardButton("✏️ Boshqa summa", callback_data="summatanla_boshqa")]
    ])
    await query.message.reply_text("💰 Summani tanlang:", reply_markup=tugmalar)


async def summa_tanlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data.split('_')
    if data[1] == "boshqa":
        context.user_data['topup_step'] = 'summa'
        await query.message.reply_text("✏️ Summani raqamda yozing (masalan: 35000)")
        return
    summa = int(data[1])
    context.user_data['topup_summa'] = summa
    context.user_data['topup_step'] = 'chek'
    matn = f"Summa: <b>{summa:,} so'm</b>\n\n💳 Karta:\n<code>9860130147785443</code>\n\n📸 To'lab, chekni yuboring.".replace(",", " ")
    await query.message.reply_text(matn, parse_mode='HTML')


async def rasm_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return
    if context.user_data.get('topup_step') == 'chek':
        uid = update.effective_user.id
        summa = context.user_data['topup_summa']
        photo = update.message.photo[-1].file_id
        global stat_cheklar
        stat_cheklar += 1
        save_data()
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"tasdiq_{uid}_{summa}")],
            [InlineKeyboardButton("❌ Rad etish", callback_data=f"rad_{uid}_{summa}")]
        ])
        bonus = "🎁 BIRINCHI TO'LOV!" if uid not in birinchi_tolov_qilganlar else ""
        caption = f"🧾 <b>YANGI TO'LOV</b> {bonus}\n👤 <a href='tg://user?id={uid}'>{update.effective_user.first_name}</a>\n🆔 <code>{uid}</code>\n📞 {haydovchilar.get(uid, '')}\n💰 {summa:,} so'm".replace(",", " ")
        await context.bot.send_photo(ADMIN_ID, photo=photo, caption=caption, reply_markup=tugmalar, parse_mode='HTML')
        await update.message.reply_text("✅ Chek yuborildi. Tez orada to'ldiriladi.")
        context.user_data.pop('topup_step', None)
        context.user_data.pop('topup_summa', None)


async def admin_tasdiqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    amal = query.data.split('_')[0]
    uid = int(query.data.split('_')[1])
    summa = int(query.data.split('_')[2])
    if amal == "tasdiq":
        if uid not in birinchi_tolov_qilganlar:
            jami = summa + int(summa * 0.5)
            birinchi_tolov_qilganlar.append(uid)
            balanslar[uid] = balanslar.get(uid, 0) + jami
            save_data()
            await query.edit_message_caption(caption=f"{query.message.caption}\n\n✅ TASDIQLANDI (+50% BONUS)", parse_mode='HTML')
            try: await context.bot.send_message(uid, f"🎉 <b>50% BONUS!</b> Balansingizga {jami:,} so'm tushdi.".replace(",", " "), parse_mode='HTML')
            except: pass
        else:
            balanslar[uid] = balanslar.get(uid, 0) + summa
            save_data()
            await query.edit_message_caption(caption=f"{query.message.caption}\n\n✅ TASDIQLANDI", parse_mode='HTML')
            try: await context.bot.send_message(uid, f"✅ {summa:,} so'm tushdi!".replace(",", " "))
            except: pass
    elif amal == "rad":
        await query.edit_message_caption(caption=f"{query.message.caption}\n\n❌ RAD ETILDI", parse_mode='HTML')
        try: await context.bot.send_message(uid, "❌ To'lovingiz rad etildi.")
        except: pass


# ================== UMUMIY MATN ==================
async def umumiy_matn_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return
    text = update.message.text
    uid = update.effective_user.id

    if text == "💳 Kabinet (Balans)":
        await kabinet(update, context); return

    if text == "📚 Yo'riqnoma":
        matn = (
            "📚 <b>YO'RIQNOMA</b>\n\n"
            "🎁 Birinchi to'lovda <b>50% BONUS</b>!\n\n"
            "1️⃣ Zakas narxi: 1 odam = 10 000 so'm\n\n"
            "2️⃣ Hisobni to'ldirish:\n"
            "🔸 Kabinet → Hisobni to'ldirish\n"
            "🔸 Karta raqamiga to'lab, chekni yuboring\n"
            "🔸 Admin tasdiqlashi bilan balans to'ldiriladi\n\n"
            "3️⃣ Zakas olish:\n"
            "🔸 Ilovada zakasni ko'rib qabul qiling\n"
            "🔸 Yetkazgach ✅ Yopildi tugmasini bosing"
        )
        await update.message.reply_text(matn, parse_mode='HTML'); return

    if context.user_data.get('topup_step') == 'summa' and uid != ADMIN_ID:
        if not text.isdigit():
            await update.message.reply_text("❗ Faqat raqam kiriting"); return
        summa = int(text)
        context.user_data['topup_summa'] = summa
        context.user_data['topup_step'] = 'chek'
        await update.message.reply_text(
            f"Summa: <b>{summa:,} so'm</b>\n\n💳 Karta:\n<code>9860130147785443</code>\n\n📸 Chekni yuboring.".replace(",", " "),
            parse_mode='HTML'); return

    if uid == ADMIN_ID:
        admin_state = context.user_data.get('admin_state')

        if text == "🔙 Foydalanuvchi menyusi":
            await start(update, context); return
        elif text == "📊 Statistika":
            tugmalar = InlineKeyboardMarkup([[
                InlineKeyboardButton("📦 Zakaslar", callback_data="stat_zakaslar"),
                InlineKeyboardButton("📈 Umumiy", callback_data="stat_umumiy")
            ]])
            await update.message.reply_text("📊 Statistika:", reply_markup=tugmalar); return
        elif text == "💾 DB Yuklash":
            try: await update.message.reply_document(document=open(DB_FILE, 'rb'), filename="taksi_baza.json")
            except: await update.message.reply_text("Xato: fayl topilmadi.")
            return
        elif text == "📄 Excel Export":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['ID', 'Rol', 'Telefon', 'Balans', 'Holat'])
            for hid, tel in haydovchilar.items():
                writer.writerow([hid, 'Haydovchi', tel, balanslar.get(hid, 0), "Banned" if hid in banned_users else "Active"])
            for yid in yolovchilar:
                writer.writerow([yid, 'Yolovchi', '', '', "Banned" if yid in banned_users else "Active"])
            bio = io.BytesIO(output.getvalue().encode('utf-8'))
            bio.name = f"Baza_{datetime.now().strftime('%Y%m%d')}.csv"
            await update.message.reply_document(document=bio); return
        elif text == "🛠 Maintenance":
            global maintenance_mode
            maintenance_mode = not maintenance_mode
            save_data()
            holat = "YONIQ 🔴" if maintenance_mode else "O'CHIQ 🟢"
            await update.message.reply_text(f"🛠 Maintenance: {holat}"); return
        elif text == "📢 Rassilka":
            context.user_data['admin_state'] = 'rassilka'
            await update.message.reply_text("📢 Xabarni yuboring:"); return
        elif text == "🚫 Ban":
            context.user_data['admin_state'] = 'ban'
            await update.message.reply_text("🚫 ID yuboring:"); return
        elif text == "♻️ Unban":
            context.user_data['admin_state'] = 'unban'
            await update.message.reply_text("♻️ ID yuboring:"); return

        if admin_state == 'ban':
            if text.isdigit():
                b_id = int(text)
                if b_id not in banned_users: banned_users.append(b_id); save_data()
                await update.message.reply_text(f"✅ {b_id} bloklandi.")
            else: await update.message.reply_text("❗ ID raqam bo'lishi kerak.")
            context.user_data.pop('admin_state', None); return
        elif admin_state == 'unban':
            if text.isdigit():
                b_id = int(text)
                if b_id in banned_users: banned_users.remove(b_id); save_data()
                await update.message.reply_text(f"✅ {b_id} blokdan chiqarildi.")
            else: await update.message.reply_text("❗ ID raqam bo'lishi kerak.")
            context.user_data.pop('admin_state', None); return
        elif admin_state == 'rassilka':
            await rassilka_tarqatish(update, context); return


# ================== STATISTIKA ==================
async def admin_stat_tugmalari(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "stat_umumiy":
        jami_balans = sum(balanslar.values())
        matn = (f"📈 <b>UMUMIY STATISTIKA</b>\n\n"
                f"👨‍✈️ Haydovchilar: {len(haydovchilar)} ta\n"
                f"👤 Yo'lovchilar: {len(yolovchilar)} ta\n"
                f"💰 Umumiy balans: {jami_balans:,} so'm\n"
                f"🚕 Jami zakaslar: {stat_zakaslar}\n"
                f"🚫 Bloklangan: {len(banned_users)}").replace(",", " ")
        tugmalar = InlineKeyboardMarkup([[
            InlineKeyboardButton("📦 Zakaslar", callback_data="stat_zakaslar"),
            InlineKeyboardButton("🔄 Yangilash", callback_data="stat_umumiy")
        ]])
        await query.edit_message_text(matn, parse_mode='HTML', reply_markup=tugmalar)

    elif data == "stat_zakaslar":
        uz_time = datetime.utcnow() + timedelta(hours=5)
        bugun = uz_time.strftime("%Y-%m-%d")
        bugun_qabul = [z for z in zakaslar_tarixi if z.get("vaqt", "").startswith(bugun)]
        bugun_bekor = [b for b in bekor_tarixi if b.get("vaqt", "").startswith(bugun)]

        matn = (f"📦 <b>ZAKASLAR</b>\n\n"
                f"📅 Bugun: {len(bugun_qabul)} qabul | {len(bugun_bekor)} bekor\n"
                f"📊 Jami: {len(zakaslar_tarixi)} qabul | {len(bekor_tarixi)} bekor\n\n")

        matn += "✅ <b>Oxirgi 5 qabul:</b>\n"
        for z in zakaslar_tarixi[-5:]:
            matn += f"🚕 {z.get('qayerdan','?')} → {z.get('qayerga','?')} | ⏰ {z.get('vaqt','')}\n"

        matn += "\n❌ <b>Oxirgi 5 bekor:</b>\n"
        for b in bekor_tarixi[-5:]:
            matn += f"🚕 {b.get('qayerdan','?')} → {b.get('qayerga','?')} | ⏰ {b.get('vaqt','')}\n"

        tugmalar = InlineKeyboardMarkup([[
            InlineKeyboardButton("📈 Umumiy", callback_data="stat_umumiy"),
            InlineKeyboardButton("🔄 Yangilash", callback_data="stat_zakaslar")
        ]])
        try: await query.edit_message_text(matn, parse_mode='HTML', reply_markup=tugmalar)
        except: pass


# ================== RASSILKA ==================
async def admin_rassilka_media(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id == ADMIN_ID and context.user_data.get('admin_state') == 'rassilka':
        await rassilka_tarqatish(update, context)


async def rassilka_tarqatish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    jami_users = set(list(haydovchilar.keys()) + list(yolovchilar))
    success = 0
    await update.message.reply_text("⏳ Tarqatilmoqda...")
    for uid in jami_users:
        try:
            await context.bot.copy_message(chat_id=uid, from_chat_id=update.message.chat_id,
                                           message_id=update.message.message_id)
            success += 1
            await asyncio.sleep(0.05)
        except: pass
    context.user_data.pop('admin_state', None)
    await update.message.reply_text(f"✅ {success} ta foydalanuvchiga yuborildi.")


# ================== GURUH AVTO-JAVOB ==================
async def guruhda_avtomatik_javob(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.chat.type in ['group', 'supergroup']:
        if update.effective_user.id in haydovchilar: return
        try: await update.message.delete()
        except: pass
        tugmalar = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚕 Zakas berish", url=f"https://t.me/{context.bot.username}")],
            [InlineKeyboardButton("👨‍✈️ Haydovchi bo'lish", url=f"https://t.me/{context.bot.username}")]
        ])
        msg = await context.bot.send_message(update.message.chat_id,
            f"Hurmatli <b>{update.effective_user.first_name}</b>, botdan foydalaning 👇",
            reply_markup=tugmalar, parse_mode='HTML')
        async def ochir():
            await asyncio.sleep(30)
            try: await context.bot.delete_message(chat_id=msg.chat_id, message_id=msg.message_id)
            except: pass
        asyncio.create_task(ochir())


# ================== RO'YXATDAN O'TISH ==================
async def haydovchi_bolish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return
    uid = update.effective_user.id
    if uid in haydovchilar:
        await update.message.reply_text("✅ Siz allaqachon ro'yxatdan o'tgansiz!"); return
    tugma = ReplyKeyboardMarkup([[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
                                resize_keyboard=True, one_time_keyboard=True)
    await update.message.reply_text("📞 Telefon raqamingizni yuboring:", reply_markup=tugma)


async def haydovchi_raqamini_saqlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if update.message.contact:
        haydovchilar[uid] = update.message.contact.phone_number
        if uid not in balanslar: balanslar[uid] = 0
        save_data()
        await update.message.reply_text(
            "🎉 <b>Ro'yxatdan o'tdingiz!</b>\n/start bosing.", parse_mode='HTML',
            reply_markup=ReplyKeyboardRemove())
        if 'kutilayotgan_zakas' in context.user_data:
            zakas_id = context.user_data.pop('kutilayotgan_zakas')
            await zakasni_biriktirish(update, context, uid, zakas_id)


# ================== ZAKAS ANKETA ==================
async def zakas_boshlash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context): return ConversationHandler.END
    yolovchilar.add(update.effective_user.id)
    save_data()
    await update.message.reply_text("👤 Ismingizni yozing:", reply_markup=ReplyKeyboardRemove())
    return ISM


async def ism_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['ism'] = update.message.text
    tugma = ReplyKeyboardMarkup([[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
                                resize_keyboard=True, one_time_keyboard=True)
    await update.message.reply_text("📱 Telefon raqamingizni yuboring:", reply_markup=tugma)
    return TELEFON


async def telefon_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['telefon'] = update.message.contact.phone_number if update.message.contact else update.message.text
    tugma = ReplyKeyboardMarkup([[KeyboardButton("📍 Lokatsiyani yuborish", request_location=True)]],
                                resize_keyboard=True, one_time_keyboard=True)
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
    await update.message.reply_text("👥 Nechta odam? (raqamda)")
    return ODAM_SONI


async def odam_soni_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message.text.isdigit():
        await update.message.reply_text("❗ Raqam kiriting")
        return ODAM_SONI
    context.user_data['odam_soni'] = int(update.message.text)
    await update.message.reply_text("⏰ Qaysi vaqtda? (Hozir yoki 14:30)")
    return VAQT


async def vaqt_qabul_qilish(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global zakas_raqami, stat_zakaslar
    zakas_raqami += 1
    stat_zakaslar += 1
    m = context.user_data
    m['vaqt'] = update.message.text
    uz_time = datetime.utcnow() + timedelta(hours=5)

    zakaslar[zakas_raqami] = {
        "id": zakas_raqami,
        "yolovchi_id": update.effective_user.id,
        "telefon": m['telefon'],
        "ism": m['ism'],
        "qayerdan": m['qayerdan'],
        "qayerga": m['qayerga'],
        "odam_soni": m['odam_soni'],
        "vaqt": m['vaqt'],
        "lat": m.get('lat'),
        "lon": m.get('lon'),
        "holat": "yangi",
        "yaratildi": uz_time.strftime("%Y-%m-%d %H:%M")
    }
    save_data()

    tugma = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_raqami}")]])
    await update.message.reply_text(
        "✅ Buyurtmangiz qabul qilindi!\nHaydovchi topilishi bilan xabar beramiz. 🚕",
        reply_markup=tugma)
    return ConversationHandler.END


async def bekor_qilish_anketa(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END


# ================== TAYMERLAR ==================
async def ogohlantirish_10_min(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        try: await context.bot.send_message(d['h_id'], "⏰ 10 minut qoldi! Zakasni yoping.")
        except: pass


async def avto_bekor_qilish(context: ContextTypes.DEFAULT_TYPE):
    d = context.job.data
    if d['z_id'] in faol_zakaslar:
        z = faol_zakaslar.pop(d['z_id'])
        uz_time = datetime.utcnow() + timedelta(hours=5)
        bekor_tarixi.append({
            "qayerdan": z['qayerdan'], "qayerga": z['qayerga'],
            "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
            "kim": "Avtomatik", "tel": "-"
        })
        save_data()
        try: await context.bot.send_message(z['yolovchi_id'], "❌ Buyurtma bekor qilindi (vaqt tugadi).")
        except: pass
        try: await context.bot.send_message(z['haydovchi_id'], "❌ Buyurtma avtomatik yopildi.")
        except: pass


def taymerni_toxtatish(context, zakas_id):
    for job in context.job_queue.get_jobs_by_name(f"warn_{zakas_id}"): job.schedule_removal()
    for job in context.job_queue.get_jobs_by_name(f"avto_{zakas_id}"): job.schedule_removal()


# ================== ZAKAS BIRIKTIRISH ==================
async def zakasni_biriktirish(update: Update, context: ContextTypes.DEFAULT_TYPE, haydovchi_id: int, zakas_id: int):
    if zakas_id not in zakaslar:
        await context.bot.send_message(haydovchi_id, "❌ Zakas band yoki bekor qilingan.")
        return
    narx = zakaslar[zakas_id]['odam_soni'] * 10000
    if balanslar.get(haydovchi_id, 0) >= narx:
        z = zakaslar.pop(zakas_id)
        z["haydovchi_id"] = haydovchi_id
        faol_zakaslar[zakas_id] = z
        balanslar[haydovchi_id] -= narx
        save_data()

        tugma_y = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Bekor qilish", callback_data=f"ybekor_{zakas_id}")]])
        await context.bot.send_message(z["yolovchi_id"],
            f"✅ Haydovchi topildi!\n📞 {haydovchilar[haydovchi_id]}", reply_markup=tugma_y)

        if z.get('lat') and z.get('lon'):
            await context.bot.send_location(haydovchi_id, z['lat'], z['lon'])

        h_xabar = (f"🚕 BUYURTMA OLINDI\n"
                   f"👤 {z['ism']} | 📞 {z['telefon']}\n"
                   f"📍 {z['qayerdan']} → {z['qayerga']}\n"
                   f"💸 -{narx:,} so'm | Qoldiq: {balanslar[haydovchi_id]:,} so'm").replace(",", " ")
        tugma_h = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Yopildi", callback_data=f"yopish_{zakas_id}")],
            [InlineKeyboardButton("❌ Bekor qilish", callback_data=f"hbekor_{zakas_id}")]
        ])
        await context.bot.send_message(haydovchi_id, h_xabar, reply_markup=tugma_h)

        context.job_queue.run_once(ogohlantirish_10_min, OGOHLANTIRISH_VAQTI * 60,
            data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"warn_{zakas_id}")
        context.job_queue.run_once(avto_bekor_qilish, KUTISH_VAQTI * 60,
            data={'z_id': zakas_id, 'h_id': haydovchi_id}, name=f"avto_{zakas_id}")
    else:
        await context.bot.send_message(haydovchi_id, f"❌ Balans yetarli emas. Kerak: {narx:,} so'm".replace(",", " "))


async def zakas_amallari(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    amal = query.data.split('_')[0]
    z_id = int(query.data.split('_')[1])
    uz_time = datetime.utcnow() + timedelta(hours=5)

    if amal == "yopish" and z_id in faol_zakaslar:
        z = faol_zakaslar.pop(z_id)
        taymerni_toxtatish(context, z_id)
        h_id = z['haydovchi_id']
        ismi = update.effective_user.first_name if update.effective_user else "Noma'lum"
        username = f" (@{update.effective_user.username})" if update.effective_user and update.effective_user.username else ""
        zakaslar_tarixi.append({
            "qayerdan": z['qayerdan'], "qayerga": z['qayerga'],
            "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
            "haydovchi_user": f"{ismi}{username}",
            "haydovchi_tel": haydovchilar.get(h_id, "")
        })
        save_data()
        await query.edit_message_text(f"{query.message.text}\n\n✅ YOPILDI")
        try: await context.bot.send_message(z['yolovchi_id'], "✅ Manzilga yetib keldingiz. Rahmat!")
        except: pass

    elif amal == "hbekor" and z_id in faol_zakaslar:
        z = faol_zakaslar.pop(z_id)
        h_id = z['haydovchi_id']
        taymerni_toxtatish(context, z_id)
        balanslar[h_id] = balanslar.get(h_id, 0) + (z['odam_soni'] * 10000)
        ismi = update.effective_user.first_name if update.effective_user else "Noma'lum"
        username = f" (@{update.effective_user.username})" if update.effective_user and update.effective_user.username else ""
        bekor_tarixi.append({
            "qayerdan": z['qayerdan'], "qayerga": z['qayerga'],
            "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
            "kim": f"Haydovchi: {ismi}{username}", "tel": haydovchilar.get(h_id, "")
        })
        save_data()
        await query.edit_message_text(f"{query.message.text}\n\n❌ BEKOR (Pul qaytarildi)")
        try: await context.bot.send_message(z['yolovchi_id'], "❌ Haydovchi bekor qildi.")
        except: pass

    elif amal == "ybekor":
        ismi = update.effective_user.first_name if update.effective_user else "Noma'lum"
        username = f" (@{update.effective_user.username})" if update.effective_user and update.effective_user.username else ""
        kim = f"Yo'lovchi: {ismi}{username}"
        if z_id in zakaslar:
            z = zakaslar.pop(z_id)
            bekor_tarixi.append({
                "qayerdan": z['qayerdan'], "qayerga": z['qayerga'],
                "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
                "kim": kim, "tel": z.get('telefon', '')
            })
            save_data()
            await query.edit_message_text("❌ Buyurtma bekor qilindi.")
        elif z_id in faol_zakaslar:
            z = faol_zakaslar.pop(z_id)
            h_id = z['haydovchi_id']
            taymerni_toxtatish(context, z_id)
            balanslar[h_id] = balanslar.get(h_id, 0) + (z['odam_soni'] * 10000)
            bekor_tarixi.append({
                "qayerdan": z['qayerdan'], "qayerga": z['qayerga'],
                "vaqt": uz_time.strftime("%Y-%m-%d %H:%M"),
                "kim": kim, "tel": z.get('telefon', '')
            })
            save_data()
            await query.edit_message_text("❌ Buyurtma bekor qilindi.")
            try: await context.bot.send_message(h_id, "❌ Yo'lovchi bekor qildi. Pul qaytarildi.")
            except: pass


# ================== GURUH REKLAMA ==================
async def guruhga_eslatma_xabar(context: ContextTypes.DEFAULT_TYPE):
    try:
        await context.bot.send_message(chat_id=DRIVERS_GROUP_ID,
            text="🚕 Termiz-Sariosiyo taksi xizmati!\n📲 Zakas berish uchun @termizsariosiyotaxi_bot")
    except: pass


# ================== 🌐 API SERVER (Legacy + New) ==================
# Note: Old /db endpoint is kept for backward compatibility in app.api.server
# New API endpoints are in app.api.* modules


async def notify_drivers_about_new_app_order(order):
    """Called when a new order arrives from the mobile app.
    Forward it to the drivers Telegram group like bot orders.
    """
    try:
        from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
        bot = Bot(token=TOKEN)

        narx_str = f"{order.price:,}".replace(",", " ")
        komissiya_str = f"{order.commission:,}".replace(",", " ")
        emoji = "📦" if order.service_type == "parcel" else ("🚗" if order.service_type == "full_car" else "🚕")
        service_label = {
            "taxi": "Taksi",
            "parcel": "Pochta",
            "full_car": "Bo'sh mashina",
        }.get(order.service_type, "Taksi")

        text = (
            f"{emoji} <b>YANGI ZAKAS (Ilovadan)</b>\n\n"
            f"📍 <b>{order.from_city}</b> → <b>{order.to_city}</b>\n"
            f"👥 {order.person_count} kishi · {service_label}\n"
            f"⏰ {order.departure_time or 'Hozir'}\n"
            f"💰 Narxi: <b>{narx_str} so'm</b>\n"
            f"💸 Komissiya: {komissiya_str} so'm\n"
            f"📞 {order.passenger_phone}"
        )
        if order.note:
            text += f"\n📝 {order.note}"

        # Get bot username for deep link
        me = await bot.get_me()
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton(
                "✅ Zakasni olish",
                url=f"https://t.me/{me.username}?start=apporder_{order.id}"
            )
        ]])

        await bot.send_message(
            chat_id=DRIVERS_GROUP_ID,
            text=text,
            parse_mode="HTML",
            reply_markup=keyboard,
        )
        await bot.shutdown()
    except Exception as e:
        logger.error(f"Failed to notify drivers about app order: {e}")


# ================== MAIN ==================
async def run():
    # Initialize DB and run migration
    print("🔄 Initializing database...")
    init_db()
    try:
        run_migration()
    except Exception as e:
        logger.error(f"Migration error (non-fatal): {e}")

    # Load legacy JSON data for the bot's existing logic
    load_data()

    # Validate config
    issues = app_config.validate()
    if issues:
        for issue in issues:
            logger.error(f"❌ Config issue: {issue}")
        if not TOKEN:
            raise SystemExit("BOT_TOKEN not configured. Set it in .env")

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
        fallbacks=[
            CommandHandler("cancel", bekor_qilish_anketa),
            MessageHandler(filters.Regex("^❌ Bekor qilish$"), bekor_qilish_anketa)
        ]
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin_panel))
    app.add_handler(CommandHandler("pul", admin_pul_qoshish))
    app.add_handler(conv_handler)
    app.add_handler(MessageHandler(filters.Regex("^👨‍✈️ Haydovchi bo'lish$"), haydovchi_bolish))
    app.add_handler(MessageHandler(filters.CONTACT, haydovchi_raqamini_saqlash))
    app.add_handler(MessageHandler(filters.ChatType.GROUPS & ~filters.COMMAND, guruhda_avtomatik_javob))
    app.add_handler(MessageHandler(
        filters.PHOTO,
        lambda u, c: rasm_qabul_qilish(u, c) if c.user_data.get('topup_step') == 'chek' else admin_rassilka_media(u, c)
    ))
    app.add_handler(MessageHandler(filters.VIDEO | filters.Document.ALL, admin_rassilka_media))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, umumiy_matn_qabul_qilish))
    app.add_handler(CallbackQueryHandler(hisob_toldirish_tugmasi, pattern="^hisob_toldirish$"))
    app.add_handler(CallbackQueryHandler(summa_tanlash, pattern="^summatanla_"))
    app.add_handler(CallbackQueryHandler(admin_tasdiqlash, pattern="^(tasdiq|rad)_"))
    app.add_handler(CallbackQueryHandler(zakas_amallari, pattern="^(yopish|hbekor|ybekor)_"))
    app.add_handler(CallbackQueryHandler(admin_stat_tugmalari, pattern="^stat_"))
    app.job_queue.run_repeating(guruhga_eslatma_xabar, interval=21600, first=10)

    # Start new API server (replaces old start_api)
    api_runner, api_app = await start_api_server(
        bot=app.bot,
        host=app_config.API_HOST,
        port=app_config.API_PORT,
    )
    # Register callbacks for app→bot integration
    api_app["notify_drivers_callback"] = notify_drivers_about_new_app_order

    await app.initialize()
    await app.start()
    await app.updater.start_polling()
    logger.info("✅ Bot ishga tushdi (Sarix Go API + Telegram Bot)")
    await asyncio.Event().wait()


if __name__ == '__main__':
    asyncio.run(run())
