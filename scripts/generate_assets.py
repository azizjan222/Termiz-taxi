"""Generate Sarix Go app icons, splash, and other assets."""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Brand colors
PRIMARY = (14, 27, 61)       # #0E1B3D
ACCENT = (244, 196, 48)      # #F4C430
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)

OUTPUT_DIR = Path(__file__).parent.parent / "sarix-go-app" / "assets"
DRIVER_OUTPUT_DIR = Path(__file__).parent.parent / "sarix-go-driver" / "assets"


def get_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    """Try to load a system font; fall back to default."""
    candidates = [
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_taxi_logo(img: Image.Image, size: int, with_text: bool = True):
    """Draw the SARIX GO logo on a square canvas."""
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2

    # Outer ring (yellow circle outline)
    ring_radius = int(size * 0.42)
    ring_thickness = max(int(size * 0.03), 4)
    draw.ellipse(
        [
            cx - ring_radius,
            cy - ring_radius,
            cx + ring_radius,
            cy + ring_radius,
        ],
        outline=ACCENT,
        width=ring_thickness,
    )

    # Speed lines (left side, yellow)
    speed_count = 4
    for i in range(speed_count):
        y = cy + int(size * 0.15) + i * int(size * 0.04)
        x_start = cx - int(size * 0.32)
        x_end = cx - int(size * 0.10) + i * int(size * 0.02)
        draw.line(
            [(x_start, y), (x_end, y)],
            fill=ACCENT,
            width=max(int(size * 0.012), 2),
        )

    # Car body (simplified - rounded rectangle)
    car_w = int(size * 0.55)
    car_h = int(size * 0.16)
    car_x = cx - car_w // 2
    car_y = cy - int(size * 0.05)
    draw.rounded_rectangle(
        [car_x, car_y, car_x + car_w, car_y + car_h],
        radius=car_h // 2,
        fill=ACCENT,
    )

    # Taxi top (small rectangle on top of car)
    top_w = int(size * 0.18)
    top_h = int(size * 0.07)
    top_x = cx - top_w // 2
    top_y = car_y - top_h
    draw.rectangle(
        [top_x, top_y, top_x + top_w, top_y + top_h],
        fill=ACCENT,
    )

    # Checker pattern on taxi top
    checker_size = top_h // 3
    for i in range(0, top_w, checker_size * 2):
        for j in range(0, top_h, checker_size * 2):
            draw.rectangle(
                [
                    top_x + i,
                    top_y + j,
                    min(top_x + i + checker_size, top_x + top_w),
                    min(top_y + j + checker_size, top_y + top_h),
                ],
                fill=PRIMARY,
            )

    # Text "SARIX" (white) - placed below car
    if with_text:
        text_y = cy + int(size * 0.18)
        font_sarix = get_font(int(size * 0.13))
        text_sarix = "SARIX"
        bbox = draw.textbbox((0, 0), text_sarix, font=font_sarix)
        tw = bbox[2] - bbox[0]
        draw.text(
            (cx - tw // 2, text_y),
            text_sarix,
            fill=WHITE,
            font=font_sarix,
        )

        # Text "GO" (yellow)
        text_y2 = text_y + int(size * 0.14)
        font_go = get_font(int(size * 0.11))
        text_go = "GO"
        bbox2 = draw.textbbox((0, 0), text_go, font=font_go)
        tw2 = bbox2[2] - bbox2[0]
        draw.text(
            (cx - tw2 // 2, text_y2),
            text_go,
            fill=ACCENT,
            font=font_go,
        )


def make_app_icon(size: int) -> Image.Image:
    """Create app icon with rounded background."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Rounded background
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(bg)
    radius = int(size * 0.22)
    draw.rounded_rectangle(
        [0, 0, size, size],
        radius=radius,
        fill=PRIMARY,
    )
    img.paste(bg, (0, 0), bg)

    # Draw logo
    draw_taxi_logo(img, size, with_text=size >= 256)

    return img


def make_splash(width: int = 1284, height: int = 2778) -> Image.Image:
    """Create splash screen image."""
    img = Image.new("RGB", (width, height), PRIMARY)
    # Draw centered logo
    logo_size = min(width, height) // 3
    logo = make_app_icon(logo_size)
    paste_x = (width - logo_size) // 2
    paste_y = (height - logo_size) // 2
    img.paste(logo, (paste_x, paste_y), logo)
    return img


def make_adaptive_foreground(size: int = 1024) -> Image.Image:
    """Foreground for Android adaptive icon (transparent bg)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Logo at center, smaller (66% rule for adaptive)
    inner = int(size * 0.66)
    logo = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    draw_taxi_logo(logo, inner, with_text=True)
    paste_x = (size - inner) // 2
    paste_y = (size - inner) // 2
    img.paste(logo, (paste_x, paste_y), logo)
    return img


def make_notification_icon(size: int = 96) -> Image.Image:
    """Monochrome notification icon (white on transparent)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2

    # Simple taxi shape in white
    car_w = int(size * 0.7)
    car_h = int(size * 0.24)
    car_x = cx - car_w // 2
    car_y = cy - car_h // 2 + int(size * 0.05)
    draw.rounded_rectangle(
        [car_x, car_y, car_x + car_w, car_y + car_h],
        radius=car_h // 2,
        fill=WHITE,
    )

    # Top
    top_w = int(size * 0.2)
    top_h = int(size * 0.1)
    top_x = cx - top_w // 2
    top_y = car_y - top_h
    draw.rectangle(
        [top_x, top_y, top_x + top_w, top_y + top_h],
        fill=WHITE,
    )
    return img


def make_feature_graphic() -> Image.Image:
    """Play Store feature graphic (1024x500)."""
    width, height = 1024, 500
    img = Image.new("RGB", (width, height), PRIMARY)
    draw = ImageDraw.Draw(img)

    # Logo on the left
    logo_size = 320
    logo = make_app_icon(logo_size)
    img.paste(logo, (60, (height - logo_size) // 2), logo)

    # Text on the right
    title_font = get_font(72)
    subtitle_font = get_font(32, bold=False)

    title = "SARIX GO"
    draw.text((430, 150), title, fill=WHITE, font=title_font)
    draw.text((430, 235), "Termiz Sariosiyo Taxi", fill=ACCENT, font=subtitle_font)
    draw.text((430, 295), "Surxondaryo bo'ylab tez va xavfsiz", fill=WHITE, font=subtitle_font)

    return img


def save_all(output_dir: Path, prefix: str = "passenger"):
    """Generate all assets and save to assets folder."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. App icon (1024 - source for all sizes)
    icon = make_app_icon(1024)
    icon.save(output_dir / "icon.png", "PNG")

    # 2. Adaptive icon foreground
    adaptive = make_adaptive_foreground(1024)
    adaptive.save(output_dir / "adaptive-icon.png", "PNG")

    # 3. Splash
    splash = make_splash(1284, 2778)
    splash.save(output_dir / "splash.png", "PNG")

    # 4. Favicon
    favicon = make_app_icon(192)
    favicon.save(output_dir / "favicon.png", "PNG")

    # 5. Notification icon
    notif = make_notification_icon(96)
    notif.save(output_dir / "notification-icon.png", "PNG")

    # 6. Play Store feature graphic
    feature = make_feature_graphic()
    feature.save(output_dir / "play-feature-graphic.png", "PNG")

    # 7. Play Store icon (high res 512x512)
    play_icon = make_app_icon(512)
    play_icon.save(output_dir / "play-icon-512.png", "PNG")

    print(f"✅ {prefix} assets generated in {output_dir}")
    for f in sorted(output_dir.glob("*.png")):
        print(f"   - {f.name} ({f.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    save_all(OUTPUT_DIR, "Passenger")
    save_all(DRIVER_OUTPUT_DIR, "Driver")
