#!/usr/bin/env python3
"""
Regenerate every Sarix Driver Android asset from one source logo.

Usage:  python3 gen_driver_icons.py assets-src/logo-driver-wide.png

Why a script instead of hand-edited files: there are seven PNGs at five sizes, two of
which have different framing requirements, and getting one of them wrong ships a broken
app icon. Re-running this is reproducible; re-cropping by hand is not.

The interesting case is adaptive-icon.png. Android masks adaptive icons to a circle or
squircle and only guarantees the central ~66% of the canvas, so a full-width wordmark
loses its first and last letter on most launchers. The existing (SARIX GO) asset solved
this by insetting the logo to ~53% width; this script reproduces that, scaling the logo
into the middle of a canvas filled with the logo's own background colour.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngtool as P

# Fraction of the adaptive-icon canvas the artwork may occupy. Android guarantees the
# central 66%; 52% matches the framing of the asset this replaces and leaves margin for
# launchers that mask more aggressively than the spec requires.
ADAPTIVE_CONTENT = 0.52

ASSETS = "sarix-go-driver/assets"

# name -> (width, height, mode)
#   square   : plain resample of the square source
#   adaptive : source inset into the centre, background extended
#   feature  : Play feature graphic, 1024x500, logo centred on the background colour
TARGETS = {
    "icon.png": (1024, 1024, "square"),
    "splash.png": (1024, 1024, "square"),
    "splash-icon.png": (1024, 1024, "square"),
    "adaptive-icon.png": (1024, 1024, "adaptive"),
    "splash-logo.png": (512, 512, "square"),
    "play-icon-512.png": (512, 512, "square"),
    "play-feature-graphic.png": (1024, 500, "feature"),
    "favicon.png": (48, 48, "square"),
}


def build(src, w, h, mode, bg):
    if mode == "square":
        return P.resize(src, w, h)

    if mode == "adaptive":
        # Crop to the artwork before compositing. Pasting the whole source square instead
        # leaves a visible rectangle: the logo's background is very slightly graduated, so
        # its edges do not match the flat canvas colour and the seam shows on screen.
        bb = P.content_bbox(src, bg) or (0, 0, src.width - 1, src.height - 1)
        art = P.crop(src, *bb)
        target_w = int(w * ADAPTIVE_CONTENT)
        target_h = max(1, round(art.height * target_w / art.width))
        canvas = P.solid(w, h, bg)
        P.paste(canvas, P.resize(art, target_w, target_h), (w - target_w) // 2, (h - target_h) // 2)
        return canvas

    if mode == "feature":
        # Fit the artwork's visible content to ~76% of the banner width, centred.
        bb = P.content_bbox(src, bg) or (0, 0, src.width - 1, src.height - 1)
        art = P.crop(src, *bb)
        target_w = int(w * 0.76)
        target_h = max(1, round(art.height * target_w / art.width))
        if target_h > int(h * 0.62):
            target_h = int(h * 0.62)
            target_w = max(1, round(art.width * target_h / art.height))
        canvas = P.solid(w, h, bg)
        P.paste(canvas, P.resize(art, target_w, target_h), (w - target_w) // 2, (h - target_h) // 2)
        return canvas

    raise ValueError(mode)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src_path = sys.argv[1]
    src = P.read_png(src_path)
    if src.width != src.height:
        print(f"! ogohlantirish: manba kvadrat emas ({src.width}x{src.height})")
    bg = P.corner_color(src)
    print(f"manba: {src_path} {src.width}x{src.height}, fon rangi RGB{bg[:3]}")

    bb = P.content_bbox(src, bg)
    if bb:
        print(f"yozuv kengligi: {(bb[2]-bb[0]+1)/src.width*100:.0f}% (manbada)")

    for name, (w, h, mode) in TARGETS.items():
        img = build(src, w, h, mode, bg)
        path = os.path.join(ASSETS, name)
        size = P.write_png(img, path)
        note = ""
        if mode == "adaptive":
            b2 = P.content_bbox(img, bg)
            if b2:
                note = f"  yozuv {(b2[2]-b2[0]+1)/w*100:.0f}% (66% zona ichida)"
        print(f"  yozildi {name:26s} {w}x{h} {size//1024:5d} KB{note}")

    print("\nnotification-icon.png tegilmadi: u status-bar uchun monoxrom ikona.")


if __name__ == "__main__":
    main()
