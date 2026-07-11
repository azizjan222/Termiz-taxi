"""Generate a PDF of a driver's registration documents (admin only)."""
import io
import logging
import os

logger = logging.getLogger("sarixgo.driver_pdf")

_FONT_PATH = os.path.join(os.path.dirname(__file__), "..", "fonts", "DejaVuSans.ttf")


async def _download_photo(bot, file_id):
    """Download a Telegram photo by file_id; return BytesIO(JPEG) or None."""
    if not file_id or not bot:
        return None
    try:
        tg_file = await bot.get_file(file_id)
        data = await tg_file.download_as_bytearray()
        return io.BytesIO(bytes(data))
    except Exception as e:
        logger.warning("Could not download file %s: %s", file_id, e)
        return None


def _load_local_image(url):
    """Load an app-uploaded document image from local disk.

    Documents are now uploaded IN THE APP and stored under the uploads dir, served at
    ``/uploads/<filename>``. The admin PDF must embed these files (the old code only
    knew about Telegram ``file_id``s, so app-registered drivers' PDFs came out empty).
    Returns BytesIO or None.
    """
    if not url:
        return None
    try:
        from app import config
        # url is like "/uploads/driver_1_license_ab12cd.jpg" (or an absolute http URL,
        # which we can't read from disk — skip those).
        if str(url).startswith("http://") or str(url).startswith("https://"):
            return None
        filename = str(url).rsplit("/", 1)[-1]
        if not filename or ".." in filename or "\\" in filename:
            return None
        path = os.path.join(str(config.UPLOAD_DIR), filename)
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            return io.BytesIO(f.read())
    except Exception as e:
        logger.warning("Could not load local image %s: %s", url, e)
        return None


async def build_driver_pdf(bot, driver: dict) -> bytes:
    """Build a PDF (bytes) with the driver's details and document photos.

    `driver` keys: first_name, last_name, pinfl, phone, car_model, car_number,
    car_year, telegram_id, the Telegram file_ids (license_file_id,
    tech_passport_file_id, car_photo_file_id) collected by the old bot flow, AND the
    app-uploaded document URLs (license_photo_url, license_back_url, tech_passport_url,
    tech_passport_back_url, car_photo_url). For each document the Telegram file is
    tried first, then the app-uploaded local file.
    """
    from fpdf import FPDF

    pdf = FPDF()
    use_unicode = os.path.exists(_FONT_PATH)
    if use_unicode:
        pdf.add_font("DejaVu", "", _FONT_PATH)
        pdf.add_font("DejaVu", "B", _FONT_PATH)
        base_font = "DejaVu"
    else:
        base_font = "Helvetica"

    def text(s: str) -> str:
        # Helvetica (latin-1) fallback: drop non-encodable chars.
        if use_unicode:
            return s
        return s.encode("latin-1", "replace").decode("latin-1")

    pdf.add_page()

    def line(s: str, h: int = 8, bold: bool = False, size: int = 11):
        pdf.set_font(base_font, "B" if bold else "", size)
        pdf.cell(0, h, text(s))
        pdf.ln(h)

    # Title
    line("Haydovchi hujjatlari", h=12, bold=True, size=16)

    fields = [
        ("Ism", driver.get("first_name")),
        ("Familiya", driver.get("last_name")),
        ("JSHSHIR", driver.get("pinfl")),
        ("Telefon", driver.get("phone")),
        ("Mashina modeli", driver.get("car_model")),
        ("Mashina raqami", driver.get("car_number")),
        ("Ishlab chiqarilgan yili", driver.get("car_year")),
        ("Telegram ID", driver.get("telegram_id")),
    ]
    for label, value in fields:
        line(f"{label}: {value if value not in (None, '') else '-'}")

    # Photos. Each entry: (caption, telegram_file_id, app_uploaded_url). We prefer the
    # Telegram file (legacy bot flow) and fall back to the app-uploaded local file.
    photos = [
        ("Haydovchilik guvohnomasi (old tomoni)", driver.get("license_file_id"), driver.get("license_photo_url")),
        ("Haydovchilik guvohnomasi (orqa tomoni)", None, driver.get("license_back_url")),
        ("Texnik pasport (old tomoni)", driver.get("tech_passport_file_id"), driver.get("tech_passport_url")),
        ("Texnik pasport (orqa tomoni)", None, driver.get("tech_passport_back_url")),
        ("Mashina fotosurati", driver.get("car_photo_file_id"), driver.get("car_photo_url")),
    ]
    for caption, file_id, url in photos:
        buf = await _download_photo(bot, file_id)
        if buf is None:
            buf = _load_local_image(url)
        pdf.add_page()
        line(caption, h=10, bold=True, size=13)
        if buf is not None:
            try:
                pdf.image(buf, x=15, y=30, w=180)
            except Exception as e:
                logger.warning("Could not embed image (%s): %s", caption, e)
                line("(Rasmni qo'shib bo'lmadi)")
        else:
            line("(Rasm yuborilmagan)")

    out = pdf.output()
    return bytes(out)
