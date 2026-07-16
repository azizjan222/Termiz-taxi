"""Authenticated image uploads with private storage for identity documents."""
import logging
import uuid
from pathlib import Path

from aiohttp import web

from app import config
from app.api.drivers import _get_driver_from_request
from app.database import get_session
from app.models import Driver, User
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(config.UPLOAD_DIR)
PRIVATE_UPLOAD_DIR = UPLOAD_DIR / "private"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PRIVATE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
try:
    PRIVATE_UPLOAD_DIR.chmod(0o700)
except OSError:
    pass

MAX_FILE_SIZE = 5 * 1024 * 1024
PRIVATE_DOCUMENT_TYPES = {
    "license",
    "license_back",
    "tech_passport",
    "tech_passport_back",
}
DOCUMENT_FIELD_BY_KIND = {
    "license": "license_photo_url",
    "license-back": "license_back_url",
    "tech-passport": "tech_passport_url",
    "tech-passport-back": "tech_passport_back_url",
}


def detect_image_extension(data: bytes) -> str | None:
    """Return a trusted extension from file magic bytes, never from the filename."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


async def _read_image(request: web.Request) -> tuple[bytes | None, str | None, web.Response | None]:
    """Read one multipart ``file`` field with a strict size and image-signature check."""
    if not request.content_type or "multipart/form-data" not in request.content_type:
        return None, None, web.json_response({"error": "multipart/form-data kerak"}, status=400)
    try:
        reader = await request.multipart()
        while True:
            field = await reader.next()
            if field is None:
                break
            if field.name != "file":
                continue
            chunks: list[bytes] = []
            size = 0
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    return None, None, web.json_response(
                        {"error": "Fayl juda katta (max 5MB)"}, status=413
                    )
                chunks.append(chunk)
            data = b"".join(chunks)
            if not data:
                return None, None, web.json_response({"error": "Rasm bo'sh"}, status=400)
            extension = detect_image_extension(data)
            if not extension:
                return None, None, web.json_response(
                    {"error": "Faqat haqiqiy JPG, PNG yoki WEBP rasm qabul qilinadi"},
                    status=400,
                )
            return data, extension, None
    except Exception:
        logger.exception("Could not parse image upload")
        return None, None, web.json_response({"error": "Faylni o'qib bo'lmadi"}, status=400)
    return None, None, web.json_response({"error": "file field kerak"}, status=400)


def resolve_upload_path(stored_value: str | None) -> Path | None:
    """Resolve a stored upload reference while preventing path traversal."""
    if not stored_value:
        return None
    value = str(stored_value)
    if value.startswith(("http://", "https://")):
        return None
    if value.startswith("/private-uploads/"):
        candidate = PRIVATE_UPLOAD_DIR / value.rsplit("/", 1)[-1]
    elif value.startswith("private/"):
        candidate = UPLOAD_DIR / value
    else:
        candidate = UPLOAD_DIR / value.rsplit("/", 1)[-1]
    try:
        resolved = candidate.resolve()
        base = UPLOAD_DIR.resolve()
        if resolved != base and base not in resolved.parents:
            return None
        return resolved
    except OSError:
        return None


def _delete_stored_file(stored_value: str | None) -> None:
    path = resolve_upload_path(stored_value)
    if path and path.exists() and path.is_file():
        try:
            path.unlink()
        except OSError:
            logger.warning("Could not remove replaced upload %s", path)


def _write_image(data: bytes, prefix: str, extension: str, *, private: bool) -> tuple[Path, str]:
    directory = PRIVATE_UPLOAD_DIR if private else UPLOAD_DIR
    filename = f"{prefix}_{uuid.uuid4().hex}{extension}"
    path = directory / filename
    with open(path, "xb") as file:
        file.write(data)
    if private:
        try:
            path.chmod(0o600)
        except OSError:
            pass
        stored_value = f"/private-uploads/{filename}"
    else:
        stored_value = f"/uploads/{filename}"
    return path, stored_value


async def upload_car_photo(request: web.Request) -> web.Response:
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    return await _handle_driver_upload(request, driver, "car_photo")


async def upload_license_photo(request: web.Request) -> web.Response:
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    return await _handle_driver_upload(request, driver, "license")


async def upload_license_back(request: web.Request) -> web.Response:
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    return await _handle_driver_upload(request, driver, "license_back")


async def upload_tech_passport(request: web.Request) -> web.Response:
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    return await _handle_driver_upload(request, driver, "tech_passport")


async def upload_tech_passport_back(request: web.Request) -> web.Response:
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    return await _handle_driver_upload(request, driver, "tech_passport_back")


async def upload_driver_profile_photo(request: web.Request) -> web.Response:
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    return await _handle_driver_upload(request, driver, "profile")


async def upload_passenger_profile_photo(request: web.Request) -> web.Response:
    user = get_current_user(request)
    if not user:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    data, extension, error = await _read_image(request)
    if error:
        return error
    assert data is not None and extension is not None

    path, url = _write_image(data, f"user_{user.id}_profile", extension, private=False)
    session = get_session()
    old_url = None
    try:
        saved = session.query(User).filter_by(id=user.id).first()
        if not saved:
            path.unlink(missing_ok=True)
            return web.json_response({"error": "User topilmadi"}, status=404)
        old_url = saved.profile_photo_url
        saved.profile_photo_url = url
        session.commit()
    except Exception:
        session.rollback()
        path.unlink(missing_ok=True)
        raise
    finally:
        session.close()
    _delete_stored_file(old_url)
    return web.json_response({"success": True, "url": url, "size": len(data)})


async def _handle_driver_upload(
    request: web.Request, driver: Driver, upload_type: str
) -> web.Response:
    data, extension, error = await _read_image(request)
    if error:
        return error
    assert data is not None and extension is not None

    private = upload_type in PRIVATE_DOCUMENT_TYPES
    path, stored_value = _write_image(
        data, f"driver_{driver.id}_{upload_type}", extension, private=private
    )
    field_by_type = {
        "car_photo": "car_photo_url",
        "license": "license_photo_url",
        "license_back": "license_back_url",
        "tech_passport": "tech_passport_url",
        "tech_passport_back": "tech_passport_back_url",
        "profile": "profile_photo_url",
    }
    field_name = field_by_type[upload_type]
    session = get_session()
    old_value = None
    try:
        saved = session.query(Driver).filter_by(id=driver.id).first()
        if not saved:
            path.unlink(missing_ok=True)
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        old_value = getattr(saved, field_name)
        setattr(saved, field_name, stored_value)
        session.commit()
    except Exception:
        session.rollback()
        path.unlink(missing_ok=True)
        raise
    finally:
        session.close()
    _delete_stored_file(old_value)

    # Private document references are never returned as public /uploads URLs.
    response_url = (
        f"/api/driver/documents/{upload_type.replace('_', '-')}"
        if private else stored_value
    )
    return web.json_response({
        "success": True,
        "url": response_url,
        "size": len(data),
        "private": private,
    })


def _sensitive_legacy_filename(filename: str) -> bool:
    lowered = filename.lower()
    return lowered.startswith("topup_") or any(
        marker in lowered
        for marker in ("_license_", "_license_back_", "_tech_passport_", "_tech_passport_back_")
    )


async def serve_upload(request: web.Request) -> web.Response:
    """Serve public profile/car images only; identity documents are denied."""
    filename = request.match_info["filename"]
    if (
        "/" in filename
        or "\\" in filename
        or ".." in filename
        or _sensitive_legacy_filename(filename)
    ):
        return web.Response(status=404)
    path = resolve_upload_path(f"/uploads/{filename}")
    if not path or not path.exists() or not path.is_file():
        return web.Response(status=404)
    return web.FileResponse(path, headers={"X-Content-Type-Options": "nosniff"})


async def serve_driver_document(request: web.Request) -> web.Response:
    """Serve one private identity document to its authenticated owner."""
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
    kind = request.match_info.get("kind", "")
    field_name = DOCUMENT_FIELD_BY_KIND.get(kind)
    if not field_name:
        return web.json_response({"error": "Noto'g'ri hujjat turi"}, status=400)

    session = get_session()
    try:
        saved = session.query(Driver).filter_by(id=driver.id).first()
        stored_value = getattr(saved, field_name, None) if saved else None
    finally:
        session.close()
    path = resolve_upload_path(stored_value)
    if not path or not path.exists() or not path.is_file():
        return web.Response(status=404)
    return web.FileResponse(path, headers={
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
    })
