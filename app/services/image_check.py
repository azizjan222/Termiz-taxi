"""Content-level checks for driver-supplied document photos.

WHY THIS EXISTS
---------------
``app.api.uploads.detect_image_extension`` proves a file *starts* with the magic bytes of a
JPEG/PNG/WEBP. That is a type check, not a content check, and it is all the document upload
endpoints used to do. It cannot tell that:

* the remaining bytes actually decode (a truncated or hand-crafted file passes the sniff);
* the picture is legible enough for a human to read a licence number off it;
* the picture is the *same picture* the driver already sent for a different document.

A driver put one screenshot of a crypto advert into all four document slots — licence front,
licence back, tech-passport front, tech-passport back — and every upload returned 200 with a
green checkmark, because nothing compared the four images to each other and nothing looked
at what was inside them. Approval then only checked that the four columns were non-empty.

WHAT IS ENFORCED HERE, AND WHAT IS DELIBERATELY NOT
---------------------------------------------------
Two very different kinds of check live in this module, and the distinction matters:

* **Deterministic** — "does it decode", "how big is it", "is it byte-identical to another
  document". These are safe to reject on: there is no judgement involved and no legitimate
  photo trips them.
* **Heuristic** — sharpness and contrast. A threshold that is too eager rejects a real
  document and traps the driver in onboarding, since this screen gates the whole app. So the
  thresholds below are set to catch only *unusable* frames (a lens-cap black rectangle, a
  smear with no edges at all) and are intentionally far looser than "a human would call this
  photo good". Judging document quality properly is the reviewing admin's job; this only
  stops the frames that are worthless to send them.

This module does no I/O and knows nothing about HTTP or the database, so it is unit-testable
on raw bytes.
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from PIL import Image, ImageStat

# --- Deterministic limits ---------------------------------------------------------------
# A document photographed at less than this on its shorter side cannot be read by the
# reviewing admin. Phone cameras and even screenshots are an order of magnitude above it, so
# this only catches thumbnails and icons.
MIN_SIDE = 400
# Decompression-bomb ceiling. The 5 MB transfer cap does NOT bound decoded size: a few
# hundred KB of PNG can expand to gigapixels and exhaust the process. Checked from the
# header, before any pixels are decoded.
MAX_PIXELS = 40_000_000
# A document is roughly rectangular. 4:1 still admits a tall phone screenshot (about 2.2:1),
# so this only rejects slivers.
MAX_ASPECT = 4.0

# --- Heuristic quality floors (see the note above: deliberately permissive) --------------
# Standard deviation of grey levels. A frame with almost none is a blank wall, a covered
# lens, or a solid-colour fill — never a document.
MIN_STDDEV = 12.0
# Variance of the Laplacian, the usual focus measure. Computed on a fixed-size downscale so
# the number does not depend on camera resolution. A legible document scores in the hundreds
# or thousands; this floor only removes frames with essentially no edge content.
MIN_SHARPNESS = 8.0

# Long side of the working copy used for the sharpness measure. Fixed so the threshold is
# resolution-independent.
ANALYSIS_SIDE = 256
# Average-hash grid. 8x8 -> 64 bits -> 16 hex characters.
PHASH_SIDE = 8
# Hamming distance below which two average hashes count as the same picture. Average hashing
# is coarse, so this stays tight: it is meant to catch a re-encode, re-crop or resize of one
# image, not two different photos that happen to share a layout.
NEAR_DUPLICATE_MAX_DISTANCE = 6


class DocumentImageError(Exception):
    """A document photo that must not be stored.

    Carries a machine-readable ``code`` alongside the Uzbek sentence because the driver app
    translates from the code (``src/api/errors.ts`` resolves ``data.code`` before
    ``data.error``); without one, a Russian or English driver gets the Uzbek text verbatim.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class DocumentImageAnalysis:
    """Fingerprint and measurements of one accepted document photo."""

    sha256: str
    phash: str
    width: int
    height: int
    stddev: float
    sharpness: float


def _average_hash(gray: Image.Image) -> str:
    """Average hash: 1 bit per cell of an 8x8 downscale, set when the cell is above the mean.

    Chosen over plain sha256 alone because sha256 changes completely when an image is
    re-saved at another quality, which is exactly what re-picking the same gallery photo
    through the picker does — ``app/api/payments.py`` already documents that hole for
    receipts. This survives re-encoding, mild scaling and recompression.
    """
    small = gray.resize((PHASH_SIDE, PHASH_SIDE), Image.Resampling.BICUBIC)
    # tobytes() rather than getdata(): mode "L" gives exactly PHASH_SIDE**2 bytes with no row
    # padding, and getdata() is deprecated for removal in Pillow 14.
    pixels = list(small.tobytes())
    mean = sum(pixels) / len(pixels)
    bits = 0
    for index, value in enumerate(pixels):
        if value > mean:
            bits |= 1 << index
    # 64 bits -> fixed 16 hex chars, so the column width and comparisons are stable.
    return f"{bits:016x}"


def _laplacian_variance(gray: Image.Image) -> float:
    """Variance of a 3x3 Laplacian over a fixed-size downscale.

    Written out rather than using ``ImageFilter.Kernel`` on purpose: the kernel path runs in
    8-bit, which clamps every negative response to zero and so throws away half the edge
    signal the variance is supposed to measure.
    """
    work = gray.copy()
    work.thumbnail((ANALYSIS_SIDE, ANALYSIS_SIDE), Image.Resampling.BICUBIC)
    width, height = work.size
    if width < 3 or height < 3:
        return 0.0

    pixels = work.tobytes()  # mode "L" -> exactly width*height bytes, no row padding
    total = 0.0
    total_squared = 0.0
    count = 0
    for y in range(1, height - 1):
        row = y * width
        above = row - width
        below = row + width
        for x in range(1, width - 1):
            index = row + x
            value = (
                4 * pixels[index]
                - pixels[index - 1]
                - pixels[index + 1]
                - pixels[above + x]
                - pixels[below + x]
            )
            total += value
            total_squared += value * value
            count += 1

    if not count:
        return 0.0
    mean = total / count
    return max(0.0, total_squared / count - mean * mean)


def analyse_document_image(data: bytes) -> DocumentImageAnalysis:
    """Validate one document photo and return its fingerprint.

    Raises ``DocumentImageError`` if the bytes must not be stored.
    """
    # 1. Does it decode at all? verify() consumes the file object, so the image has to be
    #    reopened afterwards to read pixels — that is the documented Pillow contract, not a
    #    redundant second open.
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
    except Exception:
        raise DocumentImageError(
            "not_an_image",
            "Fayl haqiqiy rasm emas yoki buzilgan. Qaytadan suratga oling.",
        ) from None

    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            # Header-only so far: bound the decode BEFORE asking for pixels.
            if width <= 0 or height <= 0:
                raise DocumentImageError(
                    "not_an_image",
                    "Fayl haqiqiy rasm emas yoki buzilgan. Qaytadan suratga oling.",
                )
            if width * height > MAX_PIXELS:
                raise DocumentImageError(
                    "image_too_large",
                    "Rasm o'lchami juda katta. Oddiy telefon kamerasida suratga oling.",
                )
            if min(width, height) < MIN_SIDE:
                raise DocumentImageError(
                    "image_too_small",
                    (
                        "Rasm juda kichik — hujjatdagi yozuvlar o'qilmaydi. "
                        "Hujjatni yaqindan, to'liq kadrga oling."
                    ),
                )
            if max(width, height) / min(width, height) > MAX_ASPECT:
                raise DocumentImageError(
                    "image_bad_shape",
                    (
                        "Rasm juda cho'zilgan — hujjat to'liq ko'rinmayapti. "
                        "Hujjatni to'liq kadrga olib, qaytadan suratga oling."
                    ),
                )
            gray = image.convert("L")
    except DocumentImageError:
        raise
    except Exception:
        raise DocumentImageError(
            "not_an_image",
            "Fayl haqiqiy rasm emas yoki buzilgan. Qaytadan suratga oling.",
        ) from None

    stddev = float(ImageStat.Stat(gray).stddev[0])
    if stddev < MIN_STDDEV:
        raise DocumentImageError(
            "image_blank",
            (
                "Rasmda hujjat ko'rinmayapti — kadr bo'sh yoki kamera berkitilgan. "
                "Hujjatni yorug'da, to'liq kadrga olib suratga oling."
            ),
        )

    sharpness = _laplacian_variance(gray)
    if sharpness < MIN_SHARPNESS:
        raise DocumentImageError(
            "image_blurry",
            (
                "Rasm xira chiqqan — yozuvlar o'qilmaydi. "
                "Telefonni qimirlatmasdan, fokusni hujjatga qaratib qayta suratga oling."
            ),
        )

    return DocumentImageAnalysis(
        sha256=hashlib.sha256(data).hexdigest(),
        phash=_average_hash(gray),
        width=width,
        height=height,
        stddev=stddev,
        sharpness=sharpness,
    )


def hamming_distance(left: str, right: str) -> int:
    """Number of differing bits between two average hashes.

    Returns a deliberately large number for malformed input so a corrupt stored hash can
    never make two unrelated images look identical.
    """
    try:
        return bin(int(left, 16) ^ int(right, 16)).count("1")
    except (TypeError, ValueError):
        return PHASH_SIDE * PHASH_SIDE


def is_near_duplicate(left: str, right: str) -> bool:
    """True when two average hashes are close enough to be the same picture."""
    if not left or not right:
        return False
    return hamming_distance(left, right) <= NEAR_DUPLICATE_MAX_DISTANCE
