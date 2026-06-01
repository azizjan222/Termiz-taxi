"""Generate app icons/splash from the real Sarix Go logo."""
import sys
from pathlib import Path
from PIL import Image

PRIMARY = (14, 27, 61)  # #0E1B3D dark blue

SRC = Path(__file__).parent.parent / "assets-src" / "logo.jpg"
TARGETS = [
    Path(__file__).parent.parent / "sarix-go-app" / "assets",
    Path(__file__).parent.parent / "sarix-go-driver" / "assets",
]


def load_logo() -> Image.Image:
    img = Image.open(SRC).convert("RGBA")
    return img


def make_icon(logo: Image.Image, size: int = 1024) -> Image.Image:
    """Full-bleed square icon."""
    return logo.resize((size, size), Image.LANCZOS)


def make_adaptive(logo: Image.Image, size: int = 1024) -> Image.Image:
    """Android adaptive foreground: logo at 70% on dark blue bg."""
    bg = Image.new("RGBA", (size, size), PRIMARY + (255,))
    inner = int(size * 0.72)
    resized = logo.resize((inner, inner), Image.LANCZOS)
    pos = (size - inner) // 2
    bg.paste(resized, (pos, pos), resized)
    return bg


def make_splash(logo: Image.Image, w: int = 1284, h: int = 2778) -> Image.Image:
    """Splash: centered logo on dark blue."""
    bg = Image.new("RGBA", (w, h), PRIMARY + (255,))
    logo_size = int(min(w, h) * 0.45)
    resized = logo.resize((logo_size, logo_size), Image.LANCZOS)
    bg.paste(resized, ((w - logo_size) // 2, (h - logo_size) // 2), resized)
    return bg.convert("RGB")


def main():
    logo = load_logo()
    print(f"Loaded logo: {logo.size}")

    icon = make_icon(logo, 1024)
    adaptive = make_adaptive(logo, 1024)
    splash = make_splash(logo)
    favicon = make_icon(logo, 48)
    play_icon = make_icon(logo, 512)

    for target in TARGETS:
        target.mkdir(parents=True, exist_ok=True)
        icon.save(target / "icon.png", "PNG")
        adaptive.save(target / "adaptive-icon.png", "PNG")
        splash.save(target / "splash.png", "PNG")
        favicon.save(target / "favicon.png", "PNG")
        play_icon.save(target / "play-icon-512.png", "PNG")
        print(f"  Wrote 5 assets to {target}")

    print("Done!")


if __name__ == "__main__":
    main()
