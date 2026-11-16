#!/usr/bin/env python3
"""
Redacts all visible phone numbers from the uploaded screenshots and builds
three HD (720x1280, 9:16 vertical) MP4 instructional videos WITH NATIVE UZBEK
NEURAL VOICE NARRATION (uz-UZ-SardorNeural & uz-UZ-MadinaNeural) using SVG + FFmpeg:
  1. /public/videos/sarix-go-yolovchi.mp4       (Sarix Go — Yo'lovchi qo'llanmasi)
  2. /public/videos/sarix-driver-haydovchi.mp4  (Sarix Driver — Haydovchi qo'llanmasi)
  3. /public/videos/sarix-toliq-qollanma.mp4    (Ikkala ilova to'liq qo'llanmasi)
"""
import base64
import hashlib
import html
import math
import os
import shutil
import socket
import ssl
import struct
import subprocess
import tempfile
import urllib.request
import uuid
from datetime import datetime, timezone

WORKSPACE = "/app/applet" if os.path.exists("/app/applet/public") else os.getcwd()
ASSETS_DIR = os.path.join(WORKSPACE, "public", "assets", "aistudio")
REDACTED_DIR = os.path.join(WORKSPACE, "public", "assets", "redacted")
VIDEOS_DIR = os.path.join(WORKSPACE, "public", "videos")
TTS_CACHE_DIR = os.path.join(WORKSPACE, "public", "assets", "tts_uz_neural")

os.makedirs(REDACTED_DIR, exist_ok=True)
os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(TTS_CACHE_DIR, exist_ok=True)

# Load Edge Neural TTS v2 DRM helper
_DRM_NS = {}


def _get_drm():
    if "DRM" not in _DRM_NS:
        drm_url = "https://raw.githubusercontent.com/rany2/edge-tts/master/src/edge_tts/drm.py"
        drm_code = urllib.request.urlopen(drm_url, timeout=8).read().decode("utf-8")
        drm_code = (
            drm_code.replace("import aiohttp", "")
            .replace(
                "from .constants import TRUSTED_CLIENT_TOKEN",
                'TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"',
            )
            .replace(
                "from .exceptions import SkewAdjustmentError",
                "class SkewAdjustmentError(Exception): pass",
            )
            .replace("e: aiohttp.ClientResponseError", "e")
        )
        exec(drm_code, _DRM_NS)
    return _DRM_NS["DRM"]


def _ws_send_text(ssock, text: str):
    payload = text.encode("utf-8")
    mask_key = os.urandom(4)
    header = bytearray([0x81])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack(">H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack(">Q", length))
    header.extend(mask_key)
    masked = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    ssock.sendall(header + masked)


def _recv_exact(ssock, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = ssock.recv(n - len(buf))
        if not chunk:
            raise EOFError("WebSocket closed")
        buf.extend(chunk)
    return bytes(buf)


def _ws_recv_frame(ssock):
    b1, b2 = _recv_exact(ssock, 2)
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack(">H", _recv_exact(ssock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", _recv_exact(ssock, 8))[0]
    mask_key = _recv_exact(ssock, 4) if masked else None
    data = _recv_exact(ssock, length)
    if masked:
        data = bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))
    return opcode, data


def synthesize_edge_uzbek_mp3(text: str, voice: str = "uz-UZ-SardorNeural") -> bytes:
    """Synthesizes crystal-clear native Uzbek speech using Microsoft Edge Neural TTS v2."""
    DRM = _get_drm()
    token = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
    gec = DRM.generate_sec_ms_gec()
    conn_id = uuid.uuid4().hex
    path = (
        f"/consumer/speech/synthesize/readaloud/edge/v1"
        f"?TrustedClientToken={token}&ConnectionId={conn_id}"
        f"&Sec-MS-GEC={gec}&Sec-MS-GEC-Version=2-143.0.3650.75"
    )

    # Normalize Uzbek apostrophes so uz-UZ neural voice pronounces o' and g' accurately
    clean_text = (
        text.replace("'", "‘")
        .replace("`", "‘")
        .replace("«", "")
        .replace("»", "")
        .replace('"', "")
    )
    clean_text = html.escape(clean_text)

    ctx = ssl.create_default_context()
    with socket.create_connection(("speech.platform.bing.com", 443), timeout=12) as sock:
        with ctx.wrap_socket(sock, server_hostname="speech.platform.bing.com") as ssock:
            ws_key = base64.b64encode(os.urandom(16)).decode()
            req = (
                f"GET {path} HTTP/1.1\r\n"
                f"Host: speech.platform.bing.com\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Pragma: no-cache\r\n"
                f"Cache-Control: no-cache\r\n"
                f"Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold\r\n"
                f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0\r\n"
                f"Cookie: muid={DRM.generate_muid()};\r\n"
                f"Sec-WebSocket-Key: {ws_key}\r\n"
                f"Sec-WebSocket-Version: 13\r\n\r\n"
            )
            ssock.sendall(req.encode())
            resp = b""
            while b"\r\n\r\n" not in resp:
                ch = ssock.recv(1)
                if not ch:
                    raise RuntimeError("Handshake failed")
                resp += ch

            ts = datetime.now(timezone.utc).strftime(
                "%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)"
            )
            cfg = (
                f"X-Timestamp:{ts}\r\n"
                "Content-Type:application/json; charset=utf-8\r\n"
                "Path:speech.config\r\n\r\n"
                '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}'
            )
            _ws_send_text(ssock, cfg)

            req_id = uuid.uuid4().hex
            ssml = (
                f"X-RequestId:{req_id}\r\n"
                "Content-Type:application/ssml+xml\r\n"
                f"X-Timestamp:{ts}Z\r\n"
                "Path:ssml\r\n\r\n"
                f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="uz-UZ">'
                f'<voice name="{voice}"><prosody pitch="+0Hz" rate="+4%" volume="+0%">{clean_text}</prosody></voice>'
                "</speak>"
            )
            _ws_send_text(ssock, ssml)

            audio_bytes = bytearray()
            while True:
                opcode, data = _ws_recv_frame(ssock)
                if opcode == 2:
                    hdr_len = struct.unpack(">H", data[:2])[0]
                    hdr = data[2 : 2 + hdr_len].decode("utf-8", errors="ignore")
                    if "Path:audio" in hdr:
                        audio_bytes.extend(data[2 + hdr_len :])
                elif opcode == 1:
                    txt = data.decode("utf-8", errors="ignore")
                    if "Path:turn.end" in txt:
                        break
                elif opcode == 8:
                    break
            return bytes(audio_bytes)


PASSENGER_STEPS = [
    {
        "file": "Screenshot_20261116-122858_Sarix_Go_e999599a.jpg",
        "app": "go",
        "title": "Ilova tilini tanlang",
        "sub": "O'zbek tilini belgilab, «Davom etish» tugmasini bosing",
        "speech": "Birinchi qadam: Sarix Go yo'lovchi ilovasiga kiring, O'zbek tilini tanlang va pastdagi Davom etish tugmasini bosing.",
        "tap": (0.50, 0.91),
    },
    {
        "file": "Screenshot_20261116-122905_Sarix_Go_614d8401.jpg",
        "app": "go",
        "title": "Telegram orqali tizimga kiring",
        "sub": "«Telegram orqali kirish» tugmasini bosing",
        "speech": "Ikkinchi qadam: Tizimga kirish oynasida ko'k rangli Telegram orqali kirish tugmasini bosing.",
        "tap": (0.50, 0.69),
    },
    {
        "file": "Screenshot_20261116-123009_aka_c1f351f3.jpg",
        "app": "go",
        "title": "Botda raqamni ulashing",
        "sub": "Pastdagi «Raqamni ulashib kirish» tugmasini bosing",
        "speech": "Uchinchi qadam: Telegram bot ochilgach, pastdagi Raqamni ulashib kirish tugmasini bosing.",
        "tap": (0.50, 0.91),
    },
    {
        "file": "Screenshot_20261116-123014_aka_aee1b7bb.jpg",
        "app": "go",
        "title": "Kontaktni ulashishni tasdiqlang",
        "sub": "Chiqib kelgan oynada «Kontaktni ulashish» tugmasini bosing",
        "speech": "To'rtinchi qadam: Ekranda chiqqan oynada Kontaktni ulashish tugmasini bosib, telefon raqamingizni tasdiqlang.",
        "tap": (0.71, 0.61),
    },
    {
        "file": "Screenshot_20261116-123024_aka_07758d78.jpg",
        "app": "go",
        "title": "6 xonali kirish kodini oling",
        "sub": "Bot yuborgan bir martalik kodni eslab qoling yoki nusxalang",
        "speech": "Beshinchi qadam: Bot sizga olti xonali tasdiqlash kodini yuboradi. Shu kodni eslab qoling va ilovaga qayting.",
        "tap": (0.28, 0.37),
    },
    {
        "file": "Screenshot_20261116-123039_Sarix_Go_d37ee7fa.jpg",
        "app": "go",
        "title": "Kodni ilovaga kiriting",
        "sub": "6 xonali kodni yozib, «Kirish» tugmasini bosing",
        "speech": "Oltinchi qadam: Olti xonali kodni ilovaga kiriting va sariq rangli Kirish tugmasini bosing.",
        "tap": (0.50, 0.66),
    },
    {
        "file": "Screenshot_20261116-123047_Sarix_Go_9a1abcb3.jpg",
        "app": "go",
        "title": "Xizmat turini tanlang",
        "sub": "«Taksi chaqirish» yoki «Pochta yuborish» bo'limini tanlang",
        "speech": "Yettinchi qadam: Asosiy menyudan Taksi chaqirish yoki Pochta yuborish xizmatidan birini tanlang.",
        "tap": (0.50, 0.42),
    },
    {
        "file": "Screenshot_20261116-123214_Sarix_Go_4ad90859.jpg",
        "app": "go",
        "title": "Turgan joyingiz avtomatik aniqlanadi",
        "sub": "Xaritada manzilingizni tekshirib, «Qayerga borasiz?» ni bosing",
        "speech": "Sakkizinchi qadam: Xaritada siz turgan manzil avtomatik aniqlanadi. Pastdagi Qayerga borasiz tugmasini bosing.",
        "tap": (0.50, 0.90),
    },
    {
        "file": "Screenshot_20261116-123240_Sarix_Go_6dabc641.jpg",
        "app": "go",
        "title": "Aniq manzilni qidiring yoki tanlang",
        "sub": "Yakuniy manzil nomini yozing yoki xaritadan belgilang",
        "speech": "To'qqizinchi qadam: Borish manzilini qidiruv qatoriga yozing yoki ro'yxatdan tanlang.",
        "tap": (0.48, 0.28),
    },
    {
        "file": "Screenshot_20261116-123305_Sarix_Go_7c2b9cfc.jpg",
        "app": "go",
        "title": "Buyurtmani tasdiqlang",
        "sub": "Yo'lovchi soni va to'lov usulini tekshirib, «Buyurtma berish» ni bosing",
        "speech": "O'ninchi qadam: Yo'lovchi soni, to'lov usuli va safar narxini tekshirib, Buyurtma berish tugmasini bosing.",
        "tap": (0.50, 0.91),
    },
    {
        "file": "Screenshot_20261116-123326_Sarix_Go_be7b47de.jpg",
        "app": "go",
        "title": "Haydovchi qidirilmoqda",
        "sub": "Buyurtmangiz onlayn haydovchilarga va Telegram guruhga yuborildi",
        "speech": "O'n birinchi qadam: Buyurtmangiz darhol onlayn haydovchilarga va Telegram guruhga yuboriladi.",
        "tap": (0.50, 0.25),
    },
    {
        "file": "Screenshot_20261116-123534_Sarix_Go_a407518d.jpg",
        "app": "go",
        "title": "Haydovchi bilan ilova ichida chat",
        "sub": "Tezkor xabarlar orqali haydovchi bilan oson bog'laning",
        "speech": "O'n ikkinchi qadam: Haydovchi zakasni qabul qilgach, ilova ichidagi chat orqali Tayyorman, chiqyapman deb yozishingiz mumkin.",
        "tap": (0.65, 0.66),
    },
    {
        "file": "Screenshot_20261116-123638_Sarix_Go_2b368ec5.jpg",
        "app": "go",
        "title": "Safar yakunida baholang",
        "sub": "5 yulduz belgilab, «Yuborish» tugmasini bosing. Oq yo'l!",
        "speech": "O'n uchinchi qadam: Manzilga yetib borgach, safarni besh yulduz bilan baholab, Yuborish tugmasini bosing.",
        "tap": (0.50, 0.80),
    },
]

DRIVER_STEPS = [
    {
        "file": "Screenshot_20261116-122451_Sarix_Driver_d25dfead.jpg",
        "app": "driver",
        "title": "Ilova tilini tanlang",
        "sub": "O'zbek tilini belgilab, «Davom etish» tugmasini bosing",
        "speech": "Birinchi qadam: Sarix Driver haydovchi ilovasini oching, O'zbek tilini tanlab, Davom etish tugmasini bosing.",
        "tap": (0.50, 0.91),
    },
    {
        "file": "Screenshot_20261116-122525_Sarix_Driver_7f529f47.jpg",
        "app": "driver",
        "title": "Haydovchi qo'llanmasi bilan tanishing",
        "sub": "Qisqa tanishtiruv oynasida «Keyingi» tugmasini bosing",
        "speech": "Ikkinchi qadam: Haydovchi qo'llanmasi bilan tanishib chiqing va Keyingi tugmasini bosing.",
        "tap": (0.50, 0.86),
    },
    {
        "file": "Screenshot_20261116-122532_Sarix_Driver_776769dc.jpg",
        "app": "driver",
        "title": "Telegram orqali kiring",
        "sub": "«Telegram orqali kirish» tugmasini bosing",
        "speech": "Uchinchi qadam: Tizimga kirish oynasida Telegram orqali kirish tugmasini bosing.",
        "tap": (0.50, 0.72),
    },
    {
        "file": "Screenshot_20261116-122613_Android_System_ff21b813.jpg",
        "app": "driver",
        "title": "Telegram ilovasini tanlang",
        "sub": "Telefoningizdagi Telegram ilovasi orqali botni oching",
        "speech": "To'rtinchi qadam: Telefoningizdagi Telegram ilovasini tanlab, rasmiy botni oching.",
        "tap": (0.72, 0.85),
    },
    {
        "file": "Screenshot_20261116-122716_aka_f3b26d37.jpg",
        "app": "driver",
        "title": "Raqamni ulashib kirish",
        "sub": "Botda «Raqamni ulashib kirish» tugmasini bosing",
        "speech": "Beshinchi qadam: Bot ichida pastdagi Raqamni ulashib kirish tugmasini bosing.",
        "tap": (0.50, 0.91),
    },
    {
        "file": "Screenshot_20261116-122724_aka_f27ef5cc.jpg",
        "app": "driver",
        "title": "Kontaktni ulashishni tasdiqlang",
        "sub": "«Kontaktni ulashish» tugmasini bosib raqamingizni tasdiqlang",
        "speech": "Oltinchi qadam: Chiqib kelgan oynada Kontaktni ulashish tugmasini bosing.",
        "tap": (0.71, 0.61),
    },
    {
        "file": "Screenshot_20261116-122734_aka_e04f9d7d.jpg",
        "app": "driver",
        "title": "6 xonali kirish kodini oling",
        "sub": "Bot bergan 6 xonali kodni olib Sarix Driver ilovasiga qayting",
        "speech": "Yettinchi qadam: Bot yuborgan olti xonali tasdiqlash kodini oling va Sarix Driver ilovasiga qayting.",
        "tap": (0.28, 0.37),
    },
    {
        "file": "Screenshot_20261116-122749_Sarix_Driver_70c64452.jpg",
        "app": "driver",
        "title": "Kodni kiriting va tizimga kiring",
        "sub": "6 xonali kodni yozib, «Kirish» tugmasini bosing",
        "speech": "Sakkizinchi qadam: Olti xonali kodni katakchalarga yozing va Kirish tugmasini bosing.",
        "tap": (0.50, 0.66),
    },
    {
        "file": "Screenshot_20261116-122757_Sarix_Driver_e5f6ce45.jpg",
        "app": "driver",
        "title": "Joylashuv (GPS) ruxsatini tasdiqlang",
        "sub": "Yaqin zakaslarni olish uchun «Roziman» tugmasini bosing",
        "speech": "To'qqizinchi qadam: Yaqin atrofdagi zakaslarni qabul qilish uchun joylashuv oynasida Roziman tugmasini bosing.",
        "tap": (0.50, 0.72),
    },
    {
        "file": "Screenshot_20261116-122807_Permission_controller_c1f6ecf3.jpg",
        "app": "driver",
        "title": "Aniq joylashuvga ruxsat bering",
        "sub": "«Bu ilova ishlayotganida» bandini tanlang",
        "speech": "O'ninchi qadam: Telefon ruxsat oynasida Bu ilova ishlayotganida tugmasini tanlang.",
        "tap": (0.50, 0.79),
    },
    {
        "file": "Screenshot_20261116-122813_Sarix_Driver_791c17c1.jpg",
        "app": "driver",
        "title": "«Onlayn» rejimni yoqing",
        "sub": "Yuqori o'ng burchakdagi «Oflayn» tugmasini bosib Onlaynga o'ting",
        "speech": "O'n birinchi qadam: Zakaslar kelishi uchun yuqori o'ng burchakdagi Oflayn tugmasini bosib, Onlayn rejimni yoqing.",
        "tap": (0.76, 0.095),
    },
    {
        "file": "Screenshot_20261116-122818_Sarix_Driver_bb9e3e26.jpg",
        "app": "driver",
        "title": "Siz Onlaynsiz — Zakasga tayyor!",
        "sub": "Ilova yopiq bo'lsa ham yangi zakaslar ovozli bildirishnoma bilan keladi",
        "speech": "O'n ikkinchi qadam: Endi siz Onlayn rejimdasiz! Ilova yopiq bo'lsa ham yangi zakaslar ovozli xabar bilan keladi.",
        "tap": (0.76, 0.095),
    },
    {
        "file": "Screenshot_20261116-123337_Sarix_Driver_da5b22bc.jpg",
        "app": "driver",
        "title": "Yangi zakasni qabul qiling",
        "sub": "Yo'nalish va narxni ko'rib, sariq «Qabul qilish» tugmasini bosing",
        "speech": "O'n uchinchi qadam: Yangi zakas tushganda manzil va narxni ko'rib, sariq rangli Qabul qilish tugmasini bosing.",
        "tap": (0.72, 0.64),
    },
    {
        "file": "Screenshot_20261116-123356_Sarix_Driver_e836dfbd.jpg",
        "app": "driver",
        "title": "Yo'lovchi bilan bog'laning",
        "sub": "Xaritada yo'lovchi manzilini ko'ring, qo'ng'iroq qiling yoki xabar yozing",
        "speech": "O'n to'rtinchi qadam: Xaritada yo'lovchiga borish yo'lini ko'ring, Xabar yozish yoki Qo'ng'iroq tugmasi orqali bog'laning.",
        "tap": (0.28, 0.61),
    },
    {
        "file": "Screenshot_20261116-123421_Sarix_Driver_b2f6384f.jpg",
        "app": "driver",
        "title": "Yo'lovchiga tezkor xabar yuboring",
        "sub": "1 bosishda «Yetib keldim, kutyapman» xabarini yuboring",
        "speech": "O'n beshinchi qadam: Yo'lovchi oldiga yetib borgach, chatda Yetib keldim, kutyapman xabarini bir bosishda yuboring.",
        "tap": (0.66, 0.59),
    },
    {
        "file": "Screenshot_20261116-123429_Sarix_Driver_1a114e44.jpg",
        "app": "driver",
        "title": "Yo'lovchini olganingizni tasdiqlang",
        "sub": "«Yo'lovchini oldim» tugmasini bosib, «HA, OLDIM» ni tanlang",
        "speech": "O'n oltinchi qadam: Yo'lovchi mashinaga o'tirgach, Yo'lovchini oldim tugmasini bosing va Ha, oldim deb tasdiqlang.",
        "tap": (0.77, 0.56),
    },
    {
        "file": "Screenshot_20261116-123501_Sarix_Driver_e7f4bc54.jpg",
        "app": "driver",
        "title": "Manzilga yetkazib, zakasni yoping",
        "sub": "Manzilga yetib borgach, pastdagi yashil «Yopildi» tugmasini bosing",
        "speech": "O'n yettinchi qadam: Yo'lovchini manzilga yetkazib qo'ygach, pastdagi yashil rangli Yopildi tugmasini bosing.",
        "tap": (0.72, 0.94),
    },
    {
        "file": "Screenshot_20261116-123552_Sarix_Driver_b908ad49.jpg",
        "app": "driver",
        "title": "Buyurtma yopilganini tasdiqlang",
        "sub": "Tasdiqlash oynasida «HA» tugmasini bosing",
        "speech": "O'n sakkizinchi qadam: Buyurtma yopildimi degan tasdiqlash oynasida Ha tugmasini bosing.",
        "tap": (0.81, 0.56),
    },
    {
        "file": "Screenshot_20261116-123600_Sarix_Driver_705f6936.jpg",
        "app": "driver",
        "title": "Safar muvaffaqiyatli yakunlandi!",
        "sub": "«BAHOLASH» tugmasini bosing va keyingi zakaslarni qabul qiling",
        "speech": "O'n to'qqizinchi qadam: Safar muvaffaqiyatli yakunlandi! Endi Baholash tugmasini bosing.",
        "tap": (0.76, 0.57),
    },
    {
        "file": "Screenshot_20261116-123626_Sarix_Driver_392488ed.jpg",
        "app": "driver",
        "title": "Yo'lovchini baholang",
        "sub": "5 yulduz belgilab, «Yuborish» tugmasini bosing",
        "speech": "Yigirmanchi qadam: Yo'lovchini besh yulduz bilan baholab, Yuborish tugmasini bosing. Safaringiz bexatar bo'lsin!",
        "tap": (0.50, 0.81),
    },
]

COMBINED_STEPS = (
    DRIVER_STEPS[:12]
    + PASSENGER_STEPS[:11]
    + DRIVER_STEPS[12:16]
    + [PASSENGER_STEPS[11]]
    + DRIVER_STEPS[16:]
    + [PASSENGER_STEPS[12]]
)


def synthesize_uzbek_speech_wav(uz_text: str, out_wav: str, voice: str = "uz-UZ-SardorNeural") -> float:
    """
    Synthesizes native Uzbek neural speech for `uz_text`, writes a 24kHz mono WAV to `out_wav`,
    and returns its duration in seconds.
    """
    key = hashlib.md5(f"{voice}:{uz_text}".encode("utf-8")).hexdigest()
    cached_mp3 = os.path.join(TTS_CACHE_DIR, f"{key}.mp3")

    if not os.path.exists(cached_mp3) or os.path.getsize(cached_mp3) < 500:
        for attempt in range(3):
            try:
                mp3_bytes = synthesize_edge_uzbek_mp3(uz_text, voice=voice)
                if len(mp3_bytes) > 500:
                    with open(cached_mp3, "wb") as f:
                        f.write(mp3_bytes)
                    break
            except Exception as err:
                if attempt == 2:
                    raise RuntimeError(f"Edge Uzbek TTS failed for '{uz_text[:30]}': {err}") from err

    cmd = [
        "ffmpeg",
        "-y",
        "-i", cached_mp3,
        "-af", "apad=pad_dur=0.40",
        "-ar", "24000",
        "-ac", "1",
        out_wav,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    probe = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            out_wav,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(probe.stdout.strip())


def svg_to_image(svg_content: str, out_path: str):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False, encoding="utf-8") as tf:
        tf.write(svg_content)
        svg_path = tf.name
    try:
        cmd = ["ffmpeg", "-y", "-i", svg_path]
        if out_path.endswith(".jpg"):
            cmd += ["-q:v", "2"]
        cmd.append(out_path)
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    finally:
        if os.path.exists(svg_path):
            os.remove(svg_path)


def prepare_redacted_screenshots():
    all_files = sorted({s["file"] for s in PASSENGER_STEPS + DRIVER_STEPS})
    for fname in all_files:
        src = os.path.join(ASSETS_DIR, fname)
        dst = os.path.join(REDACTED_DIR, fname)
        if not os.path.exists(dst):
            shutil.copy2(src, dst)
    print(f"Verified {len(all_files)} redacted screenshots.")


def wrap_lines(text: str, max_chars: int) -> list[str]:
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        test = (cur + " " + w).strip()
        if len(test) <= max_chars or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_intro_outro_png(title: str, subtitle: str, badge: str, theme: str, out_png: str):
    accent = "#F59E0B" if theme == "go" else "#3B82F6"
    badge_fg = "#0F172A" if theme == "go" else "#FFFFFF"
    bg_grad_end = "#1E293B" if theme == "go" else "#172554"

    t_lines = wrap_lines(title, 26)
    s_lines = wrap_lines(subtitle, 42)

    t_svg = ""
    y_cur = 490
    for line in t_lines:
        t_svg += f'<text x="360" y="{y_cur}" text-anchor="middle" fill="#FFFFFF" font-family="DejaVu Sans" font-weight="bold" font-size="34">{html.escape(line)}</text>\n'
        y_cur += 46

    y_cur += 16
    for line in s_lines:
        t_svg += f'<text x="360" y="{y_cur}" text-anchor="middle" fill="#CBD5E1" font-family="DejaVu Sans" font-size="21">{html.escape(line)}</text>\n'
        y_cur += 32

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0F172A"/>
          <stop offset="100%" stop-color="{bg_grad_end}"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="720" height="1280" fill="url(#bg)"/>
      <rect x="48" y="300" width="624" height="680" rx="34" fill="#1E293B" stroke="{accent}" stroke-width="3"/>
      <rect x="170" y="365" width="380" height="50" rx="25" fill="{accent}"/>
      <text x="360" y="398" text-anchor="middle" fill="{badge_fg}" font-family="DejaVu Sans" font-weight="bold" font-size="20">{html.escape(badge)}</text>
      {t_svg}
      <rect x="130" y="810" width="460" height="44" rx="22" fill="#1E3A8A" stroke="#60A5FA" stroke-width="1.5"/>
      <text x="360" y="838" text-anchor="middle" fill="#DBEAFE" font-family="DejaVu Sans" font-weight="bold" font-size="16">🔊 Sof o'zbek tilida ovozli tushuntirish bilan</text>
      <rect x="110" y="870" width="500" height="46" rx="23" fill="#064E3B" stroke="#10B981" stroke-width="1.5"/>
      <text x="360" y="899" text-anchor="middle" fill="#6EE7B7" font-family="DejaVu Sans" font-weight="bold" font-size="16">🔒 Telefon raqamlar yashirilgan (+998 •• •••)</text>
    </svg>"""
    svg_to_image(svg, out_png)


def render_step_png(step: dict, idx: int, total: int, pulse_state: int, out_png: str):
    app_type = step["app"]
    accent = "#F59E0B" if app_type == "go" else "#3B82F6"
    badge_fg = "#0F172A" if app_type == "go" else "#FFFFFF"
    badge_text = "SARIX GO · YO'LOVCHI" if app_type == "go" else "SARIX DRIVER · HAYDOVCHI"

    scr_path = os.path.join(REDACTED_DIR, step["file"])
    b64 = base64.b64encode(open(scr_path, "rb").read()).decode()

    scr_w, scr_h = 459, 1020
    scr_x, scr_y = (720 - scr_w) // 2, 204

    tx_norm, ty_norm = step.get("tap", (0.5, 0.5))
    tx = scr_x + int(tx_norm * scr_w)
    ty = scr_y + int(ty_norm * scr_h)

    r_outer = 32 if pulse_state == 0 else 48
    r_op = "0.85" if pulse_state == 0 else "0.45"

    pill_w, pill_h = 134, 36
    px = max(24, min(720 - pill_w - 24, tx - pill_w // 2))
    py = ty - r_outer - 46 if ty > 340 else ty + r_outer + 14

    sub_lines = wrap_lines(step["sub"], 52)[:2]
    sub_svg = ""
    y_s = 126
    for sline in sub_lines:
        sub_svg += f'<text x="36" y="{y_s}" fill="#CBD5E1" font-family="DejaVu Sans" font-size="18">{html.escape(sline)}</text>\n'
        y_s += 25

    prog_w = max(16, int(648 * ((idx + 1) / total)))

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="720" height="1280">
      <rect x="0" y="0" width="720" height="1280" fill="#0F172A"/>

      <!-- Top Instruction Banner -->
      <rect x="16" y="14" width="688" height="172" rx="22" fill="#1E293B" stroke="{accent}" stroke-width="2.5"/>
      <rect x="34" y="28" width="270" height="34" rx="17" fill="{accent}"/>
      <text x="169" y="51" text-anchor="middle" fill="{badge_fg}" font-family="DejaVu Sans" font-weight="bold" font-size="15">{html.escape(badge_text)}</text>

      <rect x="520" y="28" width="166" height="34" rx="17" fill="#334155"/>
      <text x="603" y="51" text-anchor="middle" fill="#F8FAFC" font-family="DejaVu Sans" font-weight="bold" font-size="15">{idx + 1}-QADAM / {total}</text>

      <text x="36" y="94" fill="#FFFFFF" font-family="DejaVu Sans" font-weight="bold" font-size="24">{idx + 1}. {html.escape(step["title"])}</text>
      {sub_svg}

      <!-- Phone Bezel & Redacted Screenshot -->
      <rect x="{scr_x - 8}" y="{scr_y - 8}" width="{scr_w + 16}" height="{scr_h + 16}" rx="26" fill="#020617" stroke="#475569" stroke-width="3"/>
      <image x="{scr_x}" y="{scr_y}" width="{scr_w}" height="{scr_h}" xlink:href="data:image/jpeg;base64,{b64}"/>

      <!-- Animated Tap Target Highlight -->
      <circle cx="{tx}" cy="{ty}" r="{r_outer}" fill="{accent}" fill-opacity="0.22" stroke="#FBBF24" stroke-width="4" stroke-opacity="{r_op}"/>
      <circle cx="{tx}" cy="{ty}" r="13" fill="#EF4444" stroke="#FFFFFF" stroke-width="3"/>

      <rect x="{px}" y="{py}" width="{pill_w}" height="{pill_h}" rx="18" fill="#0F172A" stroke="#FBBF24" stroke-width="2"/>
      <text x="{px + pill_w // 2}" y="{py + 24}" text-anchor="middle" fill="#FEF08A" font-family="DejaVu Sans" font-weight="bold" font-size="15">▶ BOSING</text>

      <!-- Bottom Progress Track -->
      <rect x="36" y="1246" width="648" height="14" rx="7" fill="#334155"/>
      <rect x="36" y="1246" width="{prog_w}" height="14" rx="7" fill="{accent}"/>
    </svg>"""
    svg_to_image(svg, out_png)


def build_video(
    output_filename: str,
    steps: list[dict],
    intro_title: str,
    intro_sub: str,
    intro_badge: str,
    intro_speech: str,
    outro_speech: str,
    theme: str,
    default_voice: str = "uz-UZ-SardorNeural",
):
    out_path = os.path.join(VIDEOS_DIR, output_filename)

    with tempfile.TemporaryDirectory() as tmpdir:
        intro_png = os.path.join(tmpdir, "intro.png")
        outro_png = os.path.join(tmpdir, "outro.png")
        render_intro_outro_png(intro_title, intro_sub, intro_badge, theme, intro_png)
        render_intro_outro_png(
            "Qo'llanma yakunlandi!",
            "Sarix Go va Sarix Driver ilovalaridan qulay hamda xavfsiz foydalaning. Oq yo'l!",
            "TAYYOR",
            theme,
            outro_png,
        )

        intro_wav = os.path.join(tmpdir, "intro.wav")
        intro_dur = max(
            3.0,
            math.ceil(synthesize_uzbek_speech_wav(intro_speech, intro_wav, voice=default_voice) * 2.0) / 2.0,
        )

        video_concat_lines = [
            f"file '{intro_png}'",
            f"duration {intro_dur:.2f}",
        ]
        audio_concat_lines = []

        intro_wav_padded = os.path.join(tmpdir, "intro_pad.wav")
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", intro_wav,
                "-af", f"apad=whole_dur={intro_dur:.2f}",
                "-t", f"{intro_dur:.2f}",
                intro_wav_padded,
            ],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        audio_concat_lines.append(f"file '{intro_wav_padded}'")

        half_sec = 0.5
        total_duration = intro_dur

        for i, st in enumerate(steps):
            raw_wav = os.path.join(tmpdir, f"step_{i:02d}_raw.wav")
            spoken_text = st.get("speech") or f"{st['title']}. {st['sub']}"
            step_voice = st.get("voice", default_voice)
            dur_raw = synthesize_uzbek_speech_wav(spoken_text, raw_wav, voice=step_voice)
            step_dur = max(3.5, math.ceil(dur_raw * 2.0) / 2.0)
            pulses = int(round(step_dur / half_sec))

            step_wav = os.path.join(tmpdir, f"step_{i:02d}.wav")
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", raw_wav,
                    "-af", f"apad=whole_dur={step_dur:.2f}",
                    "-t", f"{step_dur:.2f}",
                    step_wav,
                ],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            audio_concat_lines.append(f"file '{step_wav}'")

            p0 = os.path.join(tmpdir, f"step_{i:02d}_0.png")
            p1 = os.path.join(tmpdir, f"step_{i:02d}_1.png")
            render_step_png(st, i, len(steps), 0, p0)
            render_step_png(st, i, len(steps), 1, p1)

            for p_idx in range(pulses):
                chosen = p0 if p_idx % 2 == 0 else p1
                video_concat_lines.append(f"file '{chosen}'")
                video_concat_lines.append(f"duration {half_sec:.2f}")

            total_duration += step_dur

        outro_wav = os.path.join(tmpdir, "outro.wav")
        outro_dur = max(
            3.0,
            math.ceil(synthesize_uzbek_speech_wav(outro_speech, outro_wav, voice=default_voice) * 2.0) / 2.0,
        )
        outro_wav_padded = os.path.join(tmpdir, "outro_pad.wav")
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", outro_wav,
                "-af", f"apad=whole_dur={outro_dur:.2f}",
                "-t", f"{outro_dur:.2f}",
                outro_wav_padded,
            ],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        audio_concat_lines.append(f"file '{outro_wav_padded}'")

        video_concat_lines.append(f"file '{outro_png}'")
        video_concat_lines.append(f"duration {outro_dur:.2f}")
        video_concat_lines.append(f"file '{outro_png}'")
        total_duration += outro_dur

        v_concat_txt = os.path.join(tmpdir, "v_concat.txt")
        with open(v_concat_txt, "w", encoding="utf-8") as vf:
            vf.write("\n".join(video_concat_lines) + "\n")

        a_concat_txt = os.path.join(tmpdir, "a_concat.txt")
        with open(a_concat_txt, "w", encoding="utf-8") as af:
            af.write("\n".join(audio_concat_lines) + "\n")

        full_wav = os.path.join(tmpdir, "full_audio.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", a_concat_txt, "-c", "copy", full_wav],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )

        cmd = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", v_concat_txt,
            "-i", full_wav,
            "-vf", "fps=15,format=yuv420p",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "22",
            "-movflags", "+faststart",
            "-c:a", "aac",
            "-b:a", "128k",
            "-shortest",
            out_path,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Built {output_filename} with Native Uzbek Neural Voice ({default_voice}): {size_mb:.2f} MB ({total_duration:.1f}s)")


def main():
    prepare_redacted_screenshots()

    # 1. Passenger video with native Uzbek voice (uz-UZ-MadinaNeural)
    build_video(
        output_filename="sarix-go-yolovchi.mp4",
        steps=PASSENGER_STEPS,
        intro_title="Sarix Go — Yo'lovchi Ilovasi",
        intro_sub="Taksi chaqirish, manzil tanlash va haydovchi bilan bog'lanish bo'yicha ovozli video qo'llanma",
        intro_badge="YO'LOVCHILAR UCHUN",
        intro_speech="Assalomu alaykum! Sarix Go yo'lovchi ilovasidan foydalanish bo'yicha ovozli video qo'llanmaga xush kelibsiz.",
        outro_speech="Qo'llanma yakunlandi! Sarix Go ilovasidan qulay va xavfsiz foydalaning. Oq yo'l tilaymiz!",
        theme="go",
        default_voice="uz-UZ-MadinaNeural",
    )

    # 2. Driver video with native Uzbek voice (uz-UZ-SardorNeural)
    build_video(
        output_filename="sarix-driver-haydovchi.mp4",
        steps=DRIVER_STEPS,
        intro_title="Sarix Driver — Haydovchi Ilovasi",
        intro_sub="Ro'yxatdan o'tish, Onlayn rejimni yoqish va zakaslarni qabul qilish bo'yicha ovozli video qo'llanma",
        intro_badge="HAYDOVCHILAR UCHUN",
        intro_speech="Assalomu alaykum! Sarix Driver haydovchi ilovasida ishlash va yangi zakaslarni qabul qilish bo'yicha ovozli qo'llanmani boshlaymiz.",
        outro_speech="Qo'llanma yakunlandi! Sarix Driver ilovasida doimo Onlayn bo'ling va yangi zakaslarni qabul qiling. Safaringiz bexatar bo'lsin!",
        theme="driver",
        default_voice="uz-UZ-SardorNeural",
    )

    # 3. Combined Full video: Sardor speaks for Driver steps, Madina speaks for Passenger steps!
    combined_with_speech = []
    for st in COMBINED_STEPS:
        copy_st = dict(st)
        sp = copy_st.get("speech", "")
        if ":" in sp:
            sp = sp.split(":", 1)[1].strip()
        if copy_st["app"] == "driver":
            copy_st["speech"] = f"Haydovchi ilovasida: {sp}"
            copy_st["voice"] = "uz-UZ-SardorNeural"
        else:
            copy_st["speech"] = f"Yo'lovchi ilovasida: {sp}"
            copy_st["voice"] = "uz-UZ-MadinaNeural"
        combined_with_speech.append(copy_st)

    build_video(
        output_filename="sarix-toliq-qollanma.mp4",
        steps=combined_with_speech,
        intro_title="Sarix Go va Sarix Driver",
        intro_sub="Haydovchi va yo'lovchi ilovalarini birgalikda ishlatish tartibi (Ovozli to'liq video qo'llanma)",
        intro_badge="2 TA ILOVA · OVOZLI TARTIB",
        intro_speech="Assalomu alaykum! Ushbu videoda Sarix Driver haydovchi ilovasi hamda Sarix Go yo'lovchi ilovasini birgalikda qanday ishlatishni qadamma-qadam ko'rib chiqamiz.",
        outro_speech="To'liq video qo'llanma yakunlandi! Sarix Go va Sarix Driver ilovalaridan qulay foydalaning. Oq yo'l!",
        theme="driver",
        default_voice="uz-UZ-SardorNeural",
    )


if __name__ == "__main__":
    main()
