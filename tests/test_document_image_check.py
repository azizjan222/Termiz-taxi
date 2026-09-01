"""Tests for driver document photo content validation and duplicate fingerprinting.

Context: a driver put one screenshot of a crypto advert into all four document slots and
every upload succeeded, because the only check was "do the first bytes look like a JPEG".
These cover the two halves of the fix — is it a usable picture, and is it the same picture
again — from raw bytes, with no HTTP or DB involved.

The quality thresholds are heuristics, so the tests are written to assert what is actually
guaranteed rather than to hard-code a number that would turn a threshold tweak into a test
failure:

* a **deterministic** reject (garbage, blank frame, thumbnail, sliver) is asserted by its
  exact error code;
* the **sharpness metric** is asserted comparatively — a blurred copy must score far below
  its sharp original — which validates that the measure discriminates without pinning the
  cut-off;
* a realistic sharp document is asserted to be ACCEPTED, because a false rejection here is
  the dangerous failure: this screen gates the whole app, so wrongly refusing a real licence
  strands the driver in onboarding.
"""
import io

import pytest
from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy.exc import IntegrityError

from app.api.uploads import _find_conflicting_document, _record_document_fingerprint
from app.models import Driver, DriverDocumentImage
from app.services.image_check import (
    MIN_SIDE,
    NEAR_DUPLICATE_MAX_DISTANCE,
    DocumentImageError,
    analyse_document_image,
    hamming_distance,
    is_near_duplicate,
)


def _encode(image: Image.Image, fmt: str = "JPEG", **kwargs) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def _document_like(width: int = 1000, height: int = 700) -> Image.Image:
    """A high-contrast, sharp-edged stand-in for a photographed document.

    Deterministic on purpose (no randomness), so sharpness numbers are reproducible across
    runs and platforms.
    """
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle([20, 20, width - 20, height - 20], outline="black", width=6)
    # Text-like bars of varying length, i.e. plenty of edges at document scale.
    for index, y in enumerate(range(70, height - 70, 46)):
        bar = int(width * (0.32 + 0.09 * (index % 6)))
        draw.rectangle([60, y, 60 + bar, y + 20], fill="black")
    # A portrait-photo block, as on a licence.
    draw.rectangle([width - 260, 90, width - 70, 340], fill="#303030")
    draw.ellipse([width - 225, 130, width - 105, 250], fill="#c8c8c8")
    return image


def _distinct_document(index: int, width: int = 1000, height: int = 700) -> Image.Image:
    """One of four documents that differ in CONTENT, not merely in size.

    The dark region occupies a different half of the frame per index, which puts the four
    average hashes far apart (each cell is compared against the frame mean, so moving the
    dark mass flips most of the 64 bits). Text-like bars are drawn on the light side to keep
    edge content high enough to pass the sharpness floor.
    """
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    half = [
        (0, 0, width // 2, height),           # left
        (width // 2, 0, width, height),       # right
        (0, 0, width, height // 2),           # top
        (0, height // 2, width, height),      # bottom
    ][index % 4]
    draw.rectangle(list(half), fill="#141414")

    # Bars on the light side: horizontal for the left/right variants, vertical for top/bottom.
    if index % 4 in (0, 1):
        x0 = width // 2 + 40 if index % 4 == 0 else 40
        for y in range(60, height - 60, 44):
            draw.rectangle([x0, y, x0 + width // 3, y + 18], fill="black")
    else:
        y0 = height // 2 + 40 if index % 4 == 2 else 40
        for x in range(60, width - 60, 44):
            draw.rectangle([x, y0, x + 18, y0 + height // 3], fill="black")
    return image


def test_rejects_bytes_that_are_not_a_decodable_image():
    # Passes the magic-byte sniff (real JPEG SOI) but is not a decodable image — exactly the
    # gap detect_image_extension cannot close on its own.
    with pytest.raises(DocumentImageError) as excinfo:
        analyse_document_image(b"\xff\xd8\xff" + b"garbage" * 500)
    assert excinfo.value.code == "not_an_image"


def test_rejects_blank_frame():
    """A covered lens or a blank wall: no document is present at any sharpness."""
    with pytest.raises(DocumentImageError) as excinfo:
        analyse_document_image(_encode(Image.new("RGB", (1200, 900), "white")))
    assert excinfo.value.code == "image_blank"


def test_rejects_image_too_small_to_read():
    small = _document_like(MIN_SIDE * 2, MIN_SIDE // 2)  # short side under the floor
    with pytest.raises(DocumentImageError) as excinfo:
        analyse_document_image(_encode(small))
    assert excinfo.value.code == "image_too_small"


def test_rejects_extremely_elongated_image():
    with pytest.raises(DocumentImageError) as excinfo:
        analyse_document_image(_encode(_document_like(4000, 500)))
    assert excinfo.value.code == "image_bad_shape"


def test_accepts_a_realistic_sharp_document():
    """The critical no-false-positive case: a real document must not be refused."""
    analysis = analyse_document_image(_encode(_document_like()))
    assert analysis.width == 1000
    assert analysis.height == 700
    assert len(analysis.sha256) == 64
    assert len(analysis.phash) == 16
    assert analysis.sharpness > 0


def test_accepts_a_tall_phone_screenshot_shape():
    """1080x2400 is a normal phone aspect (2.22:1) and must stay inside MAX_ASPECT."""
    analysis = analyse_document_image(_encode(_document_like(1080, 2400)))
    assert analysis.height == 2400


def test_sharpness_separates_a_blurred_copy_from_its_original():
    sharp = _document_like()
    blurred = sharp.filter(ImageFilter.GaussianBlur(radius=14))

    sharp_score = analyse_document_image(_encode(sharp, quality=95)).sharpness
    try:
        blurred_score = analyse_document_image(_encode(blurred, quality=95)).sharpness
    except DocumentImageError as exc:
        # Rejected outright for being unreadable — the stronger form of the same outcome.
        assert exc.code in {"image_blurry", "image_blank"}
        return

    # Not a pinned threshold: only that defocus collapses the measure by a wide margin.
    assert blurred_score < sharp_score / 5


def test_identical_bytes_share_a_fingerprint():
    data = _encode(_document_like())
    first = analyse_document_image(data)
    second = analyse_document_image(data)
    assert first.sha256 == second.sha256
    assert first.phash == second.phash


def test_reencoded_copy_defeats_sha256_but_not_the_perceptual_hash():
    """The exact hole this pairing exists to close.

    The image picker re-encodes at ``quality: 0.7``, so the same gallery photo picked twice
    arrives with different bytes. sha256 alone would call those two different documents.
    """
    original = _document_like()
    high = analyse_document_image(_encode(original, quality=95))
    low = analyse_document_image(_encode(original, quality=45))

    assert high.sha256 != low.sha256, "re-encoding must change the exact hash"
    assert is_near_duplicate(high.phash, low.phash), (
        "a re-encode of one photo must still be recognised as the same picture"
    )


def test_rescaled_copy_is_still_recognised_as_the_same_picture():
    original = _document_like()
    resized = original.resize((700, 490), Image.Resampling.BICUBIC)

    first = analyse_document_image(_encode(original))
    second = analyse_document_image(_encode(resized))
    assert is_near_duplicate(first.phash, second.phash)


def test_two_different_documents_are_not_near_duplicates():
    """Guards the other direction: genuine front/back photos must remain distinct."""
    front = _document_like(1000, 700)

    back = Image.new("RGB", (1000, 700), "white")
    draw = ImageDraw.Draw(back)
    # A deliberately different layout: dark ground, bright blocks on the opposite side.
    draw.rectangle([0, 0, 1000, 700], fill="#1a1a1a")
    for y in range(60, 640, 60):
        draw.rectangle([520, y, 950, y + 26], fill="white")
    draw.ellipse([80, 120, 380, 420], fill="#f0f0f0")

    front_hash = analyse_document_image(_encode(front)).phash
    back_hash = analyse_document_image(_encode(back)).phash
    assert not is_near_duplicate(front_hash, back_hash)


def test_hamming_distance_basics():
    assert hamming_distance("0" * 16, "0" * 16) == 0
    assert hamming_distance("0" * 16, "f" + "0" * 15) == 4
    # A malformed stored hash must never read as "identical".
    assert hamming_distance("not-hex", "0" * 16) > NEAR_DUPLICATE_MAX_DISTANCE
    assert is_near_duplicate("", "0" * 16) is False



# ---------------------------------------------------------------------------------------
# Duplicate detection against the database
# ---------------------------------------------------------------------------------------

def _driver(db, telegram_id: int) -> Driver:
    driver = Driver(telegram_id=telegram_id, phone=f"+9989012345{telegram_id:02d}")
    db.add(driver)
    db.commit()
    return driver


def _store(db, driver_id: int, kind: str, analysis) -> None:
    _record_document_fingerprint(db, driver_id, kind, analysis)
    db.commit()


def test_same_photo_in_a_second_slot_is_rejected(db):
    """The reported incident, reduced to its mechanism."""
    driver = _driver(db, 501)
    analysis = analyse_document_image(_encode(_document_like()))
    _store(db, driver.id, "license", analysis)

    conflict = _find_conflicting_document(db, driver.id, "license_back", analysis)
    assert conflict == "license"


def test_reuploading_the_same_slot_with_the_same_file_is_allowed(db):
    """Replacing a document with the identical file is a correction, not fraud."""
    driver = _driver(db, 502)
    analysis = analyse_document_image(_encode(_document_like()))
    _store(db, driver.id, "license", analysis)

    assert _find_conflicting_document(db, driver.id, "license", analysis) is None


def test_a_reencoded_copy_in_another_slot_is_still_rejected(db):
    driver = _driver(db, 503)
    original = _document_like()
    stored = analyse_document_image(_encode(original, quality=95))
    _store(db, driver.id, "tech_passport", stored)

    reencoded = analyse_document_image(_encode(original, quality=45))
    assert reencoded.sha256 != stored.sha256
    assert _find_conflicting_document(db, driver.id, "tech_passport_back", reencoded) == (
        "tech_passport"
    )


def test_another_drivers_identical_file_is_rejected(db):
    """Byte-identical documents across accounts mean one image is being shared."""
    first = _driver(db, 504)
    second = _driver(db, 505)
    analysis = analyse_document_image(_encode(_document_like()))
    _store(db, first.id, "license", analysis)

    assert _find_conflicting_document(db, second.id, "license", analysis) == "license"


def test_distinct_documents_are_accepted_for_every_slot(db):
    """Four genuinely different photos must fill all four slots without complaint.

    Note what "genuinely different" has to mean here. An earlier version of this test drew
    the same layout at four slightly different sizes and was rejected — correctly: the
    perceptual hash downscales to a fixed 8x8 grid, so a resize of one picture hashes
    identically to it. That is the property that catches a driver re-picking one gallery
    photo, so the fixture has to differ in CONTENT, not in dimensions.
    """
    driver = _driver(db, 506)
    kinds = ["license", "license_back", "tech_passport", "tech_passport_back"]
    for index, kind in enumerate(kinds):
        analysis = analyse_document_image(_encode(_distinct_document(index)))
        assert _find_conflicting_document(db, driver.id, kind, analysis) is None
        _store(db, driver.id, kind, analysis)

    stored = db.query(DriverDocumentImage).filter_by(driver_id=driver.id).all()
    assert len(stored) == 4
    assert len({row.sha256 for row in stored}) == 4


def test_the_four_slot_fixtures_are_pairwise_distinct():
    """Self-check for the fixture above, so a silent regression in it cannot mask a bug."""
    hashes = [
        analyse_document_image(_encode(_distinct_document(i))).phash for i in range(4)
    ]
    for i in range(4):
        for j in range(i + 1, 4):
            assert not is_near_duplicate(hashes[i], hashes[j]), (
                f"fixtures {i} and {j} hash alike (distance "
                f"{hamming_distance(hashes[i], hashes[j])}); they must differ in content"
            )


def test_fingerprint_upsert_keeps_one_row_per_slot(db):
    driver = _driver(db, 507)
    first = analyse_document_image(_encode(_document_like(1000, 700)))
    _store(db, driver.id, "license", first)
    second = analyse_document_image(_encode(_document_like(1100, 760)))
    _store(db, driver.id, "license", second)

    rows = db.query(DriverDocumentImage).filter_by(driver_id=driver.id, kind="license").all()
    assert len(rows) == 1
    assert rows[0].sha256 == second.sha256


def test_sha256_is_unique_across_the_table(db):
    """The DB itself refuses a duplicate, closing the check-then-insert race."""
    first = _driver(db, 508)
    second = _driver(db, 509)
    analysis = analyse_document_image(_encode(_document_like()))
    _store(db, first.id, "license", analysis)

    db.add(
        DriverDocumentImage(
            driver_id=second.id,
            kind="license",
            sha256=analysis.sha256,
            phash=analysis.phash,
            width=analysis.width,
            height=analysis.height,
            sharpness=analysis.sharpness,
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
