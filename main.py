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
from app.migrate import run_migration
from app.models import Driver as DBDriver
from app import car_models
from app.services.driver_pdf import build_driver_pdf

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
# Driver registration conversation states
(D_PHONE, D_FIRST, D_LAST, D_PINFL, D_CARNUM, D_MODEL,
 D_YEAR, D_TECHPASS, D_CARPHOTO, D_LICENSE) = range(100, 110)
REQUIRE_DRIVER_DOCUMENTS = app_config.REQUIRE_DRIVER_DOCUMENTS

# ================== 📂 XOTIRA VA BAZA ==================
haydovchilar = {}
balanslar = {}
yolovchilar = set()
zakaslar = {}
faol_zakaslar = {}
haydovchi_hujjatlar = {}  # telegram_id -> {first_name,last_name,pinfl,car_number,car_model,car_year,license_file_id,tech_passport_file_id,car_photo_file_id}

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
    global haydovchi_hujjatlar
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r") as f:
                d = json.load(f)
                haydovchilar.update({int(k): v for k, v in d.get("haydovchilar", {}).items()})
                balanslar.update({int(k): v for k, v in d.get("balanslar", {}).items()})
                yolovchilar.update([int(i) for i in d.get("yolovchilar", [])])
                haydovchi_hujjatlar.update({int(k): v for k, v in d.get("haydovchi_hujjatlar", {}).items()})
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
        "haydovchi_hujjatlar": {str(k): v for k, v in haydovchi_hujjatlar.items()},
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
        if param.startswith("auth_"):
            # Telegram-based app login/registration
            auth_token = param[len("auth_"):]
            context.user_data['tg_auth_token'] = auth_token
            tugma = ReplyKeyboardMarkup(
                [[KeyboardButton("📲 Raqamni ulashib kirish", request_contact=True)]],
                resize_keyboard=True, one_time_keyboard=True)
            await update.message.reply_text(
                "🔐 <b>Ilovaga kirish</b>\n\n"
                "Ilovaga kirish uchun telefon raqamingizni ulashing. "
                "Quyidagi tugmani bosing 👇",
                parse_mode='HTML',
                reply_markup=tugma)
            return
        if param.startswith("apporder_"):
            # Driver accepting an app-originated order via Telegram deep link
            try:
                order_id = int(param.split("_")[1])
            except (ValueError, IndexError):
                await update.message.reply_text("❌ Noto'g'ri havola.")
                return
            await _accept_app_order_from_bot(update, context, user_id, order_id)
            return
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


async def app_topup_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin approval for IN-APP top-ups (callback_data: apppay_ok_<id> / apppay_no_<id>).

    Unlike the bot's own manual top-up (which credits the legacy JSON `balanslar`),
    this credits the DB `Driver.balance` that the driver app reads. The JSON `balanslar`
    is kept in sync when the driver's telegram_id already exists there.
    """
    query = update.callback_query
    await query.answer()

    # ADMIN-only guard.
    if update.effective_user.id != ADMIN_ID:
        try:
            await query.answer("Faqat admin uchun", show_alert=True)
        except Exception:
            pass
        return

    data = query.data  # apppay_ok_<id> or apppay_no_<id>
    approve = data.startswith("apppay_ok_")
    try:
        payment_id = int(data.rsplit("_", 1)[1])
    except (ValueError, IndexError):
        return

    from app.api.payments import credit_driver_payment
    from app.services.push import send_push, notify_balance_topup
    from app.models import Payment

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(id=payment_id).first()
        if not payment:
            try:
                await query.edit_message_caption(
                    caption=f"{query.message.caption}\n\n⚠️ To'lov topilmadi (#{payment_id})",
                    parse_mode='HTML')
            except Exception:
                pass
            return

        # Idempotency: don't process the same payment twice.
        if payment.status != "pending":
            label = "✅ Tasdiqlangan" if payment.status == "approved" else "❌ Rad etilgan"
            try:
                await query.edit_message_caption(
                    caption=f"{query.message.caption}\n\nℹ️ Allaqachon: {label}",
                    parse_mode='HTML')
            except Exception:
                pass
            return

        if approve:
            amount, bonus, driver = credit_driver_payment(session, payment)
            new_balance = driver.balance if driver else 0
            drv_id = driver.id if driver else None
            drv_tg = driver.telegram_id if driver else None
            session.commit()

            # Keep the legacy JSON balances in sync if this telegram_id exists there.
            if drv_tg and drv_tg in balanslar:
                balanslar[drv_tg] = new_balance
                save_data()

            # Notify the driver (push).
            try:
                if drv_id:
                    await notify_balance_topup(session, drv_id, amount, bonus)
            except Exception:
                pass

            amount_str = f"{amount:,}".replace(",", " ")
            extra = f" (+50% bonus: {bonus:,} so'm)".replace(",", " ") if bonus else ""
            try:
                await query.edit_message_caption(
                    caption=f"{query.message.caption}\n\n✅ Tasdiqlandi (+{amount_str} so'm{extra})",
                    parse_mode='HTML')
            except Exception:
                pass
        else:
            payment.status = "rejected"
            payment.processed_at = datetime.utcnow()
            drv_id = payment.driver_id
            session.commit()

            # Notify the driver (push).
            try:
                if drv_id:
                    await send_push(
                        session,
                        recipient_type="driver",
                        recipient_id=drv_id,
                        title="❌ To'lov rad etildi",
                        body="To'lov skrinshotingiz admin tomonidan rad etildi.",
                        data={"type": "balance_topup_rejected", "payment_id": payment_id},
                        channel_id="balance",
                    )
            except Exception:
                pass

            try:
                await query.edit_message_caption(
                    caption=f"{query.message.caption}\n\n❌ Rad etildi",
                    parse_mode='HTML')
            except Exception:
                pass
    finally:
        session.close()


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

    # --- Telegram-based app login (passenger/driver) ---
    if update.message.contact and context.user_data.get('tg_auth_token'):
        token = context.user_data.pop('tg_auth_token')
        phone = update.message.contact.phone_number
        try:
            from app.database import get_session as _gs
            from app.services.telegram_auth import mark_verified as _mark
            db = _gs()
            try:
                sess = _mark(
                    db, token, telegram_id=uid, phone=phone,
                    first_name=update.effective_user.first_name or "",
                    last_name=update.effective_user.last_name or "",
                )
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Telegram auth verify error: {e}")
            sess = None

        if sess:
            await update.message.reply_text(
                "✅ <b>Tasdiqlandi!</b>\n\nIlovaga qayting — avtomatik kirasiz. 📱",
                parse_mode='HTML', reply_markup=ReplyKeyboardRemove())
        else:
            await update.message.reply_text(
                "❌ Muddati tugagan yoki xatolik. Ilovada qaytadan \"Telegram orqali kirish\"ni bosing.",
                reply_markup=ReplyKeyboardRemove())
        return

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


async def _accept_app_order_from_bot(update: Update, context: ContextTypes.DEFAULT_TYPE, driver_telegram_id: int, order_id: int):
    """Accept an app-originated order via the Telegram 'apporder_' deep link.

    Triggered when a driver taps "✅ Zakasni olish" in the drivers group for an
    order created in the mobile app. Notifies the passenger (push + WebSocket).
    """
    from app.database import get_session as _gs
    from app.models import Order, Driver as DBDriver
    from app.services.push import notify_passenger_order_accepted
    from app.api.websocket import ws_manager
    from app import config

    session = _gs()
    try:
        order = session.query(Order).filter_by(id=order_id).first()
        if not order:
            await context.bot.send_message(driver_telegram_id, "❌ Buyurtma topilmadi.")
            return
        if order.status != "new":
            await context.bot.send_message(driver_telegram_id, "❌ Buyurtma allaqachon olingan.")
            return

        driver = session.query(DBDriver).filter_by(telegram_id=driver_telegram_id).first()
        if not driver:
            await context.bot.send_message(
                driver_telegram_id,
                "❌ Siz ilovada ro'yxatdan o'tmagansiz. Avval ilovada hujjatlaringizni yuboring.",
            )
            return

        # Balance check (same policy as the API accept_order).
        now = datetime.utcnow()
        on_free_trial = bool(driver.subscription_until and driver.subscription_until > now)
        if not on_free_trial and (driver.balance or 0) < config.MIN_DRIVER_BALANCE:
            await context.bot.send_message(
                driver_telegram_id,
                (
                    f"❌ Balans yetarli emas.\n"
                    f"Kerak: {config.MIN_DRIVER_BALANCE:,} so'm\n"
                    f"Hozir: {driver.balance or 0:,} so'm"
                ).replace(",", " "),
            )
            return

        # Atomic claim — only ONE driver can win (prevents double-accept race).
        accepted_at = datetime.utcnow()
        claimed = (
            session.query(Order)
            .filter(Order.id == order_id, Order.status == "new")
            .update(
                {
                    "driver_id": driver.id,
                    "driver_telegram_id": driver_telegram_id,
                    "status": "accepted",
                    "accepted_at": accepted_at,
                    "commission_charged": False,
                },
                synchronize_session=False,
            )
        )
        session.commit()
        if not claimed:
            await context.bot.send_message(driver_telegram_id, "❌ Buyurtma allaqachon olingan.")
            return
        session.refresh(order)
        session.refresh(driver)

        # Notify the passenger's mobile app (push + WebSocket).
        try:
            await notify_passenger_order_accepted(session, order, driver)
        except Exception as e:
            logger.error(f"Push to passenger failed: {e}")
        try:
            if order.passenger_id:
                await ws_manager.send_to_passenger(order.passenger_id, {
                    "type": "order_accepted",
                    "order_id": order.id,
                    "driver": {
                        "first_name": driver.first_name,
                        "phone": driver.contact_phone or driver.phone,
                        "car_model": driver.car_model,
                        "car_number": driver.car_number,
                    },
                })
        except Exception as e:
            logger.error(f"WS to passenger failed: {e}")

        # Notify the admin that a driver accepted this order.
        try:
            if ADMIN_ID:
                service_label = {
                    "parcel": "📦 Pochta",
                    "full_car": "🚗 To'liq mashina",
                }.get(order.service_type, "🚕 Taksi")
                d_name = (driver.first_name or "Haydovchi").strip()
                d_car = " · ".join(p for p in [driver.car_model, driver.car_number] if p) or "—"
                d_price = f"{order.price:,}".replace(",", " ") + " so'm" if order.price else "Kelishiladi"
                await context.bot.send_message(
                    ADMIN_ID,
                    (
                        "✅ <b>Zakas qabul qilindi</b>\n\n"
                        f"🆔 Zakas #{order.id}\n"
                        f"👨‍✈️ Haydovchi: <b>{d_name}</b> ({driver.phone or '—'})\n"
                        f"🚗 {d_car}\n"
                        f"📍 {order.from_city or '—'} → {order.to_city or '—'}\n"
                        f"{service_label} · 💰 {d_price}"
                    ),
                    parse_mode="HTML",
                )
        except Exception as e:
            logger.error(f"Admin accept notify (bot) failed: {e}")

        # Confirm to the driver in Telegram.
        narx_str = f"{order.price:,}".replace(",", " ")
        if order.service_type == "parcel":
            subject_line = "📦 Pochta"
        elif order.service_type == "full_car":
            subject_line = "🚗 Bo'sh mashina"
        else:
            subject_line = f"👥 {order.person_count} kishi"
        h_xabar = (
            f"🚕 <b>BUYURTMA QABUL QILINDI!</b>\n\n"
            f"📍 {order.from_city} → {order.to_city}\n"
            f"{subject_line}\n"
            f"💰 Narxi: {narx_str} so'm\n"
            f"📞 Yo'lovchi: {order.passenger_phone}\n"
            f"👤 {order.passenger_name or 'Nomalum'}"
        )
        if order.note:
            h_xabar += f"\n📝 {order.note}"
        await context.bot.send_message(driver_telegram_id, h_xabar, parse_mode="HTML")
    except Exception as e:
        logger.error(f"App order accept from bot failed: {e}")
        try:
            await context.bot.send_message(driver_telegram_id, "❌ Xatolik yuz berdi. Qayta urinib ko'ring.")
        except Exception:
            pass
    finally:
        session.close()


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

        # Taxi rides show the passenger count; parcel/full_car only show the
        # service label (saying "1 kishi" for a parcel makes no sense).
        if order.service_type == "taxi":
            subject_line = f"👥 {order.person_count} kishi · {service_label}"
        else:
            subject_line = f"{emoji} {service_label}"

        text = (
            f"{emoji} <b>YANGI ZAKAS (Ilovadan)</b>\n\n"
            f"📍 <b>{order.from_city}</b> → <b>{order.to_city}</b>\n"
            f"{subject_line}\n"
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


async def notify_driver_order_cancelled(driver_telegram_id, order_id, refunded):
    """Called when a passenger cancels an order in the app.

    The cancellation notice is sent to the ADMIN ONLY (not to the driver). The
    driver's app is already updated in real time over WebSocket, so the driver
    does not need — and per product decision should not receive — a Telegram bot
    "order cancelled" message. Admin gets the bot message instead, enriched with
    the order / driver / passenger context for monitoring.
    """
    if not ADMIN_ID:
        return

    # Gather context (route, passenger, driver) for the admin message. Best-effort:
    # never let a DB hiccup block the notification path.
    from_city = to_city = passenger_name = driver_label = None
    session = get_session()
    try:
        from app.models import Order as _Order
        order = session.query(_Order).filter_by(id=order_id).first()
        if order:
            from_city = order.from_city
            to_city = order.to_city
            passenger_name = order.passenger_name
        drv = None
        if driver_telegram_id:
            drv = session.query(DBDriver).filter_by(telegram_id=driver_telegram_id).first()
        if drv:
            name = " ".join(p for p in [drv.first_name, drv.last_name] if p) or "—"
            driver_label = f"{name} ({drv.phone or '—'})"
    except Exception as e:
        logger.error(f"Cancel-notify context lookup failed: {e}")
    finally:
        session.close()

    try:
        from telegram import Bot
        bot = Bot(token=TOKEN)
        lines = [
            "🚫 <b>Yo'lovchi zakasni bekor qildi</b>",
            f"🧷 Zakas #{order_id}",
        ]
        if from_city or to_city:
            lines.append(f"📍 {from_city or '—'} → {to_city or '—'}")
        if passenger_name:
            lines.append(f"👤 Yo'lovchi: {passenger_name}")
        if driver_label:
            lines.append(f"🚖 Haydovchi: {driver_label}")
        elif driver_telegram_id:
            lines.append(f"🚖 Haydovchi ID: {driver_telegram_id}")
        if refunded:
            lines.append("💰 Komissiya haydovchiga qaytarildi.")
        await bot.send_message(chat_id=ADMIN_ID, text="\n".join(lines), parse_mode="HTML")
        await bot.shutdown()
    except Exception as e:
        logger.error(f"Failed to notify admin about cancel: {e}")



# ================== HAYDOVCHI RO'YXATDAN O'TISH (HUJJATLAR) ==================
def _model_keyboard():
    pop = car_models.get_popular_models()
    rows = []
    for i in range(0, len(pop), 2):
        rows.append([KeyboardButton(m) for m in pop[i:i + 2]])
    rows.append([KeyboardButton("✏️ Boshqa model")])
    rows.append([KeyboardButton("❌ Bekor qilish")])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def _save_registered_driver_to_db(uid: int, phone: str, data: dict):
    """Create/update the DB Driver row so the app can authenticate the driver."""
    from app.database import get_session as _gs

    def _norm(p):
        digits = "".join(ch for ch in (p or "") if ch.isdigit())
        return ("+" + digits) if digits else ""

    session = _gs()
    try:
        d = session.query(DBDriver).filter_by(telegram_id=uid).first()
        if not d and phone:
            # Avoid creating a duplicate row (e.g. a synthetic test-driver row keyed by phone)
            norm = _norm(phone)
            for existing in session.query(DBDriver).all():
                if _norm(existing.phone) == norm:
                    d = existing
                    d.telegram_id = uid  # relink to the real Telegram id
                    break
        if not d:
            d = DBDriver(telegram_id=uid, phone=phone or f"tg{uid}")
            session.add(d)
        if phone:
            d.phone = phone
        d.first_name = data.get('first_name')
        d.last_name = data.get('last_name')
        d.pinfl = data.get('pinfl')
        d.car_number = data.get('car_number')
        d.car_model = data.get('car_model')
        d.car_year = data.get('car_year')
        # Documents are NOT collected by the bot anymore; they are uploaded in the
        # app (driver-documents screen). We must NOT mark documents_submitted=True
        # here — doing so makes the app skip the upload step entirely (the driver is
        # never asked for their license/tech-passport/car photo). Leave it to the
        # model default (False for new drivers) and the app's
        # /api/driver/documents/submit endpoint, which sets it True only AFTER the
        # required photos are actually uploaded. We also don't reset an existing
        # True back to False (a driver who already uploaded in the app keeps access).
        if d.documents_submitted is None:
            d.documents_submitted = False
        session.commit()
    except Exception as e:
        session.rollback()
        logger.error(f"Driver DB save error: {e}")
    finally:
        session.close()


async def _notify_admin_new_driver(bot, uid: int, phone: str, data: dict):
    caption = (
        "🆕 <b>Yangi haydovchi ro'yxatdan o'tdi</b>\n\n"
        f"👤 {data.get('first_name','')} {data.get('last_name','')}\n"
        f"🆔 JSHSHIR: <code>{data.get('pinfl','')}</code>\n"
        f"📞 {phone}\n"
        f"🚗 {data.get('car_model','')} · {data.get('car_number','')} · {data.get('car_year','')}\n"
        f"TG ID: <code>{uid}</code>"
    )
    kb = InlineKeyboardMarkup([[InlineKeyboardButton("📄 PDF yuklab olish", callback_data=f"drvpdf_{uid}")]])
    try:
        await bot.send_message(ADMIN_ID, caption, parse_mode='HTML', reply_markup=kb)
    except Exception as e:
        logger.error(f"Admin new-driver notify error: {e}")


async def _send_driver_pdf(bot, chat_id: int, uid: int):
    data = dict(haydovchi_hujjatlar.get(uid, {}))
    data['telegram_id'] = uid
    data.setdefault('phone', haydovchilar.get(uid))
    # Always merge the DB record so the app-uploaded document URLs are included.
    # Documents are now uploaded IN THE APP (stored as file URLs), not collected by the
    # bot as Telegram file_ids — so the PDF must read those URLs, otherwise it comes out
    # empty ("Rasm yuborilmagan") for every app-registered driver.
    try:
        from app.database import get_session as _gs
        s = _gs()
        try:
            d = s.query(DBDriver).filter_by(telegram_id=uid).first()
            if d:
                data.setdefault('first_name', d.first_name)
                data.setdefault('last_name', d.last_name)
                data.setdefault('pinfl', d.pinfl)
                data.setdefault('phone', d.phone)
                data.setdefault('car_model', d.car_model)
                data.setdefault('car_number', d.car_number)
                data.setdefault('car_year', d.car_year)
                # Legacy Telegram file_ids (old bot flow).
                data.setdefault('license_file_id', d.license_file_id)
                data.setdefault('tech_passport_file_id', d.tech_passport_file_id)
                data.setdefault('car_photo_file_id', d.car_photo_file_id)
                # App-uploaded document URLs (current flow).
                data['license_photo_url'] = d.license_photo_url
                data['license_back_url'] = d.license_back_url
                data['tech_passport_url'] = d.tech_passport_url
                data['tech_passport_back_url'] = d.tech_passport_back_url
                data['car_photo_url'] = d.car_photo_url
        finally:
            s.close()
    except Exception as e:
        logger.error(f"PDF DB fetch error: {e}")
    try:
        pdf_bytes = await build_driver_pdf(bot, data)
        bio = io.BytesIO(pdf_bytes)
        bio.name = f"haydovchi_{uid}.pdf"
        await bot.send_document(chat_id, document=bio, filename=f"haydovchi_{uid}.pdf",
                                caption=f"📄 Haydovchi hujjatlari (TG: {uid})")
    except Exception as e:
        logger.error(f"PDF generate error: {e}")
        await bot.send_message(chat_id, f"❌ PDF yaratishda xatolik: {e}")


async def driver_pdf_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if update.effective_user.id != ADMIN_ID:
        await query.answer("Faqat admin uchun", show_alert=True)
        return
    await query.answer("PDF tayyorlanmoqda...")
    uid = int(query.data.split("_")[1])
    await _send_driver_pdf(context.bot, ADMIN_ID, uid)


async def cmd_hujjat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return
    args = context.args
    if not args:
        await update.message.reply_text("Foydalanish: /hujjat <telegram_id yoki telefon>")
        return
    ident = args[0]
    uid = None
    if ident.isdigit() and (int(ident) in haydovchi_hujjatlar or int(ident) in haydovchilar):
        uid = int(ident)
    else:
        toza = ident.replace("+", "").replace(" ", "")
        for k, tel in haydovchilar.items():
            if str(tel).replace("+", "").replace(" ", "") == toza:
                uid = k
                break
    if not uid:
        await update.message.reply_text("❌ Haydovchi topilmadi.")
        return
    await _send_driver_pdf(context.bot, ADMIN_ID, uid)


async def reg_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop('reg', None)
    await update.message.reply_text("❌ Ro'yxatdan o'tish bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END


async def reg_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context):
        return ConversationHandler.END
    context.user_data['reg'] = {}
    tugma = ReplyKeyboardMarkup(
        [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)],
         [KeyboardButton("❌ Bekor qilish")]],
        resize_keyboard=True, one_time_keyboard=True)
    await update.message.reply_text(
        "👨‍✈️ <b>Haydovchi ro'yxatdan o'tish</b>\n\n"
        "Bir necha qadam: ism, familiya, JSHSHIR va mashina ma'lumotlari.\n"
        "Hujjatlarni keyinroq ilovada yuklaysiz.\n\n"
        "1️⃣ Telefon raqamingizni yuboring:",
        parse_mode='HTML', reply_markup=tugma)
    return D_PHONE


async def reg_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ Bekor qilish":
        return await reg_cancel(update, context)
    # If the user opened an app-login deep link mid-registration, the shared contact
    # belongs to that login flow -> hand it off to the app-login handler and end here.
    if context.user_data.get('tg_auth_token') and update.message.contact:
        context.user_data.pop('reg', None)
        await haydovchi_raqamini_saqlash(update, context)
        return ConversationHandler.END
    phone = update.message.contact.phone_number if update.message.contact else (update.message.text or "").strip()
    context.user_data.setdefault('reg', {})['phone'] = phone
    await update.message.reply_text("2️⃣ Ismingizni yozing:", reply_markup=ReplyKeyboardRemove())
    return D_FIRST


async def reg_first(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == "❌ Bekor qilish":
        return await reg_cancel(update, context)
    context.user_data['reg']['first_name'] = txt
    await update.message.reply_text("3️⃣ Familiyangizni yozing:")
    return D_LAST


async def reg_last(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == "❌ Bekor qilish":
        return await reg_cancel(update, context)
    context.user_data['reg']['last_name'] = txt
    await update.message.reply_text("4️⃣ JSHSHIR (14 raqamli shaxsiy raqam) ni yozing:")
    return D_PINFL


async def reg_pinfl(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if (update.message.text or "").strip() == "❌ Bekor qilish":
        return await reg_cancel(update, context)
    txt = (update.message.text or "").strip().replace(" ", "")
    if not (txt.isdigit() and len(txt) == 14):
        await update.message.reply_text("❗ JSHSHIR 14 ta raqamdan iborat bo'lishi kerak. Qaytadan yozing:")
        return D_PINFL
    context.user_data['reg']['pinfl'] = txt
    await update.message.reply_text("5️⃣ Mashina davlat raqamini yozing (masalan: 90A123BC):")
    return D_CARNUM


async def reg_carnum(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == "❌ Bekor qilish":
        return await reg_cancel(update, context)
    context.user_data['reg']['car_number'] = txt.upper()
    await update.message.reply_text(
        "6️⃣ Mashina modelini tanlang (yoki \"✏️ Boshqa model\" orqali yozing):",
        reply_markup=_model_keyboard())
    return D_MODEL


async def reg_model(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == "❌ Bekor qilish":
        return await reg_cancel(update, context)
    if txt == "✏️ Boshqa model":
        await update.message.reply_text("✍️ Mashina modelini yozing:", reply_markup=ReplyKeyboardRemove())
        return D_MODEL
    if not car_models.is_valid_model(txt):
        await update.message.reply_text(
            "❗ Bu model qabul qilinmaydi (Matiz, Jiguli, Nexia 1-2 mumkin emas).\n"
            "Boshqa modelni tanlang yoki yozing:")
        return D_MODEL
    context.user_data['reg']['car_model'] = txt
    await update.message.reply_text(
        "7️⃣ Mashina ishlab chiqarilgan yilini yozing (masalan: 2018):",
        reply_markup=ReplyKeyboardRemove())
    return D_YEAR


async def reg_year(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == "❌ Bekor qilish":
        return await reg_cancel(update, context)
    cur = datetime.utcnow().year
    if not (txt.isdigit() and 1980 <= int(txt) <= cur + 1):
        await update.message.reply_text(f"❗ Yilni to'g'ri kiriting (1980-{cur + 1}):")
        return D_YEAR
    context.user_data['reg']['car_year'] = txt

    # Finalize registration WITHOUT requesting any documents.
    # Documents are uploaded later in the app ("Ma'lumotlarim" / driver-info screen).
    uid = update.effective_user.id
    reg = context.user_data.get('reg', {})
    phone = reg.get('phone') or haydovchilar.get(uid)

    haydovchilar[uid] = phone
    if uid not in balanslar:
        balanslar[uid] = 0
    haydovchi_hujjatlar[uid] = reg
    save_data()
    _save_registered_driver_to_db(uid, phone, reg)
    context.user_data.pop('reg', None)

    await update.message.reply_text(
        "✅ <b>Ro'yxatdan o'tdingiz!</b>\n\n"
        "Hujjatlaringizni ilovadagi \"Ma'lumotlarim\" bo'limida yuklang "
        "(Texnik pasport va Haydovchilik guvohnomasi). 📱\n"
        "Hujjatlaringiz administrator tomonidan tekshiriladi.",
        parse_mode='HTML', reply_markup=ReplyKeyboardRemove())
    await _notify_admin_new_driver(context.bot, uid, phone, reg)
    return ConversationHandler.END


# ================== MAIN ==================
async def run():
    # Security/persistence sanity checks (helps diagnose "logged out" / 401 issues)
    if app_config.JWT_SECRET in ("dev-jwt-secret", "change_this_to_random_string_in_production"):
        logger.warning(
            "⚠️ JWT_SECRET is using the default value. Set a strong, STABLE JWT_SECRET "
            "in the environment so tokens stay valid across restarts."
        )
    if app_config.ADMIN_USERNAME == "admin" and app_config.ADMIN_PASSWORD == "admin123":
        logger.warning(
            "⚠️ Admin panel is using default credentials (admin/admin123). "
            "Set ADMIN_USERNAME and ADMIN_PASSWORD environment variables for production."
        )
    # Log the DB target WITHOUT credentials (scheme/host only for external DBs).
    _dburl = app_config.DATABASE_URL
    if _dburl.startswith("sqlite"):
        _db_display = _dburl
    else:
        try:
            from urllib.parse import urlsplit
            _s = urlsplit(_dburl)
            _db_display = f"{_s.scheme}://***@{_s.hostname or '?'}/{(_s.path or '').lstrip('/')}"
        except Exception:
            _db_display = _dburl.split("://", 1)[0] + "://***"
    logger.info("🗄  Database: %s", _db_display)

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

    # Log security advisories (auto-generated secrets, weak/unset admin password, etc.)
    app_config.log_security_status()

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

    # New admin commands (manage app via bot)
    from app import admin_commands as admcmd
    app.add_handler(CommandHandler("stats", admcmd.cmd_stats))
    app.add_handler(CommandHandler("drivers", admcmd.cmd_drivers))
    app.add_handler(CommandHandler("driver", admcmd.cmd_driver))
    app.add_handler(CommandHandler("add_driver", admcmd.cmd_add_driver))
    app.add_handler(CommandHandler("users", admcmd.cmd_users))
    app.add_handler(CommandHandler("orders", admcmd.cmd_orders))
    app.add_handler(CommandHandler("find", admcmd.cmd_find))
    app.add_handler(CommandHandler("balance", admcmd.cmd_balance))
    app.add_handler(CommandHandler("broadcast", admcmd.cmd_broadcast))
    app.add_handler(CommandHandler("history", admcmd.cmd_history))
    app.add_handler(CommandHandler("payments", admcmd.cmd_payments))
    app.add_handler(CommandHandler("export", admcmd.cmd_export))
    app.add_handler(CommandHandler("admin_help", admcmd.cmd_admin_help))
    app.add_handler(CallbackQueryHandler(admcmd.admin_callback, pattern="^adm_"))

    # Push notification & management admin commands
    app.add_handler(CommandHandler("push_all", admcmd.cmd_push_all))
    app.add_handler(CommandHandler("push_drivers", admcmd.cmd_push_drivers))
    app.add_handler(CommandHandler("push_passengers", admcmd.cmd_push_passengers))
    app.add_handler(CommandHandler("push_user", admcmd.cmd_push_user))
    app.add_handler(CommandHandler("verify", admcmd.cmd_verify))
    app.add_handler(CommandHandler("reject", admcmd.cmd_reject))
    app.add_handler(CommandHandler("price", admcmd.cmd_price))
    app.add_handler(CommandHandler("commission", admcmd.cmd_commission))
    app.add_handler(CommandHandler("online_drivers", admcmd.cmd_online_drivers))
    app.add_handler(CommandHandler("active_orders", admcmd.cmd_active_orders))
    app.add_handler(CommandHandler("revenue", admcmd.cmd_revenue))
    app.add_handler(CommandHandler("top_drivers", admcmd.cmd_top_drivers))

    driver_reg_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^👨‍✈️ Haydovchi bo'lish$"), reg_start)],
        states={
            D_PHONE: [MessageHandler(filters.CONTACT | (filters.TEXT & ~filters.COMMAND), reg_phone)],
            D_FIRST: [MessageHandler(filters.TEXT & ~filters.COMMAND, reg_first)],
            D_LAST: [MessageHandler(filters.TEXT & ~filters.COMMAND, reg_last)],
            D_PINFL: [MessageHandler(filters.TEXT & ~filters.COMMAND, reg_pinfl)],
            D_CARNUM: [MessageHandler(filters.TEXT & ~filters.COMMAND, reg_carnum)],
            D_MODEL: [MessageHandler(filters.TEXT & ~filters.COMMAND, reg_model)],
            D_YEAR: [MessageHandler(filters.TEXT & ~filters.COMMAND, reg_year)],
        },
        fallbacks=[
            CommandHandler("cancel", reg_cancel),
            MessageHandler(filters.Regex("^❌ Bekor qilish$"), reg_cancel),
        ],
        name="driver_registration",
    )

    app.add_handler(conv_handler)
    app.add_handler(driver_reg_handler)
    app.add_handler(CommandHandler("hujjat", cmd_hujjat))
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
    app.add_handler(CallbackQueryHandler(app_topup_callback, pattern="^apppay_(ok|no)_"))
    app.add_handler(CallbackQueryHandler(driver_pdf_callback, pattern="^drvpdf_"))
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
    api_app["bot_notify_order_cancel"] = notify_driver_order_cancelled

    # Start the deferred-commission background task (charges commission 15 min after
    # a driver accepts an order, skipping drivers on the free trial).
    try:
        from app.services.commission_scheduler import start_commission_scheduler
        start_commission_scheduler()
        logger.info("✅ Commission scheduler started")
    except Exception as e:
        logger.error(f"Commission scheduler failed to start: {e}")

    # Start the order auto-expiry background task (marks immediate "new" orders as
    # "expired" after ORDER_EXPIRY_MINUTES with no driver, and notifies the passenger).
    try:
        from app.services.order_expiry import start_order_expiry_scheduler
        start_order_expiry_scheduler()
        logger.info("✅ Order-expiry scheduler started")
    except Exception as e:
        logger.error(f"Order-expiry scheduler failed to start: {e}")

    await app.initialize()
    await app.start()
    await app.updater.start_polling()
    logger.info("✅ Bot ishga tushdi (Sarix Go API + Telegram Bot)")

    # Start the separate support/feedback bot (@SarixGo_support_bot) if configured.
    # Users message it and the admin receives & replies. Disabled when SUPPORT_BOT_TOKEN
    # is not set, so this never affects the main bot.
    try:
        from app.support_bot import start_support_bot
        await start_support_bot()
    except Exception as e:
        logger.error(f"Support bot failed to start: {e}")

    await asyncio.Event().wait()


if __name__ == '__main__':
    asyncio.run(run())
