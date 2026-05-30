"""File upload endpoints (car photos, license, etc.)."""
import os
import uuid
from pathlib import Path
from aiohttp import web

from app.database import get_session
from app.models import Driver
from app.api.drivers import _get_driver_from_request

UPLOAD_DIR = Path("./data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


async def upload_car_photo(request: web.Request) -> web.Response:
    """POST /api/driver/upload/car-photo
    Multipart form-data with 'file' field.
    """
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    return await _handle_upload(request, driver, "car_photo")


async def upload_license_photo(request: web.Request) -> web.Response:
    """POST /api/driver/upload/license"""
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    return await _handle_upload(request, driver, "license")


async def _handle_upload(request: web.Request, driver, upload_type: str) -> web.Response:
    """Common upload handler."""
    reader = await request.multipart()
    field = await reader.next()

    if not field or field.name != "file":
        return web.json_response({"error": "file field kerak"}, status=400)

    filename = field.filename or "file"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return web.json_response({
            "error": f"Faqat {', '.join(ALLOWED_EXTENSIONS)} formatlar"
        }, status=400)

    # Generate unique filename
    new_filename = f"driver_{driver.id}_{upload_type}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = UPLOAD_DIR / new_filename

    size = 0
    with open(file_path, "wb") as f:
        while True:
            chunk = await field.read_chunk()
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                f.close()
                file_path.unlink(missing_ok=True)
                return web.json_response({"error": "Fayl juda katta (max 5MB)"}, status=413)
            f.write(chunk)

    # Public URL path (relative)
    public_url = f"/uploads/{new_filename}"

    # Update driver record
    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver.id).first()
        if d:
            if upload_type == "car_photo":
                d.car_photo_url = public_url
            elif upload_type == "license":
                d.license_photo_url = public_url
            session.commit()
    finally:
        session.close()

    return web.json_response({
        "success": True,
        "url": public_url,
        "size": size,
    })


async def serve_upload(request: web.Request) -> web.Response:
    """GET /uploads/{filename}"""
    filename = request.match_info["filename"]
    # Sanitize filename
    if "/" in filename or "\\" in filename or ".." in filename:
        return web.Response(status=404)

    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        return web.Response(status=404)

    return web.FileResponse(file_path)
