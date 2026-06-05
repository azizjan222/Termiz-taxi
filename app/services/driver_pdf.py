"""Generate a PDF of a driver's registration documents (admin only)."""
import io
import os
import logging

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


async def build_driver_pdf(bot, driver: dict) -> bytes:
    """Build a PDF (bytes) with the driver's details and document photos.

    `driver` keys: first_name, last_name, pinfl, phone, car_model, car_number,
    car_year, telegram_id, and the three file_ids:
    license_file_id, tech_passport_file_id, car_photo_file_id.
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

    # Photos
    photos = [
        ("Haydovchilik guvohnomasi", driver.get("license_file_id")),
        ("Texnik pasport", driver.get("tech_passport_file_id")),
        ("Mashina fotosurati", driver.get("car_photo_file_id")),
    ]
    for caption, file_id in photos:
        buf = await _download_photo(bot, file_id)
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
