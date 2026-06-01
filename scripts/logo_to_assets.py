"""Generate app icons/splash from the real Sarix Go logos.

Passenger app uses logo.jpg, Driver app uses logo-driver.jpg.
"""
from pathlib import Path
from PIL import Image

PRIMARY = (14, 27, 61)  # #0E1B3D dark blue

ROOT = Path(__file__).parent.parent
SRC_PASSENGER = ROOT / "assets-src" / "logo.jpg"
SRC_DRIVER = ROOT / "assets-src" / "logo-driver.jpg"

PASSENGER_ASSETS = ROOT / "sarix-go-app" / "assets"
DRIVER_ASSETS = ROOT / "sarix-go-driver" / "assets"


def load_logo(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def make_icon(logo: Image.Image, size: int = 1024) -> Image.Image:
    return logo.resize((size, size), Image.LANCZOS)


def make_adaptive(logo: Image.Image, size: int = 1024) -> Image.Image:
    bg = Image.new("RGBA", (size, size), PRIMARY + (255,))
    inner = int(size * 0.72)
    resized = logo.resize((inner, inner), Image.LANCZOS)
    pos = (size - inner) // 2
    bg.paste(resized, (pos, pos), resized)
    return bg


def make_splash(logo: Image.Image, w: int = 1284, h: int = 2778) -> Image.Image:
    bg = Image.new("RGBA", (w, h), PRIMARY + (255,))
    logo_size = int(min(w, h) * 0.45)
    resized = logo.resize((logo_size, logo_size), Image.LANCZOS)
    bg.paste(resized, ((w - logo_size) // 2, (h - logo_size) // 2), resized)
    return bg.convert("RGB")


def generate(src: Path, target: Path, label: str):
    logo = load_logo(src)
    target.mkdir(parents=True, exist_ok=True)
    make_icon(logo, 1024).save(target / "icon.png", "PNG")
    make_adaptive(logo, 1024).save(target / "adaptive-icon.png", "PNG")
    make_splash(logo).save(target / "splash.png", "PNG")
    make_icon(logo, 512).save(target / "splash-icon.png", "PNG")
    make_icon(logo, 48).save(target / "favicon.png", "PNG")
    make_icon(logo, 512).save(target / "play-icon-512.png", "PNG")
    print(f"  [{label}] wrote 6 assets to {target}")


def main():
    print("Generating assets...")
    generate(SRC_PASSENGER, PASSENGER_ASSETS, "Passenger")
    generate(SRC_DRIVER, DRIVER_ASSETS, "Driver")
    print("Done!")


if __name__ == "__main__":
    main()
