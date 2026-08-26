"""
Minimal PNG reader/writer/resizer built on the standard library alone.

The sandbox has no ImageMagick, no Pillow and no network to install either, so the
driver icons have to be generated with what ships with Python: zlib and struct.

Supports the only thing the icons need: non-interlaced, 8-bit-per-channel PNGs in
grayscale / RGB / palette / grayscale+alpha / RGBA. Anything else raises, because a
silently mangled app icon is worse than a failed build.
"""

import struct
import zlib

SIG = b"\x89PNG\r\n\x1a\n"


class Image:
    """8-bit RGBA pixel buffer."""

    def __init__(self, width, height, pixels):
        self.width = width
        self.height = height
        self.pixels = pixels  # bytearray, len = w*h*4

    def get(self, x, y):
        i = (y * self.width + x) * 4
        return self.pixels[i : i + 4]


def _chunks(data):
    if data[:8] != SIG:
        raise ValueError("not a PNG (bad signature)")
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        payload = data[pos + 8 : pos + 8 + length]
        yield ctype, payload
        pos += 12 + length  # length + type + payload + crc


def _unfilter(raw, width, height, bpp):
    """Undo the per-scanline PNG filters, returning packed rows."""
    stride = width * bpp
    out = bytearray(height * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if ftype == 1:  # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:  # Average
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:  # Paeth
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ftype != 0:
            raise ValueError(f"unknown PNG filter type {ftype}")
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return bytes(out)


def read_png(path):
    data = open(path, "rb").read()
    idat = bytearray()
    palette = None
    trns = None
    width = height = depth = ctype = None
    interlace = 0

    for name, payload in _chunks(data):
        if name == b"IHDR":
            width, height, depth, ctype, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", payload
            )
        elif name == b"PLTE":
            palette = payload
        elif name == b"tRNS":
            trns = payload
        elif name == b"IDAT":
            idat += payload
        elif name == b"IEND":
            break

    if interlace != 0:
        raise ValueError("interlaced PNG not supported")
    if depth != 8:
        raise ValueError(f"only 8-bit channels supported, got {depth}")

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
    if ctype not in channels:
        raise ValueError(f"unsupported colour type {ctype}")
    bpp = channels[ctype]

    rows = _unfilter(zlib.decompress(bytes(idat)), width, height, bpp)

    px = bytearray(width * height * 4)
    n = width * height
    if ctype == 6:
        px[:] = rows
    elif ctype == 2:
        for i in range(n):
            px[i * 4 : i * 4 + 3] = rows[i * 3 : i * 3 + 3]
            px[i * 4 + 3] = 255
    elif ctype == 0:
        for i in range(n):
            g = rows[i]
            px[i * 4 : i * 4 + 4] = bytes((g, g, g, 255))
    elif ctype == 4:
        for i in range(n):
            g, a = rows[i * 2], rows[i * 2 + 1]
            px[i * 4 : i * 4 + 4] = bytes((g, g, g, a))
    elif ctype == 3:
        if palette is None:
            raise ValueError("palette PNG without PLTE")
        for i in range(n):
            idx = rows[i]
            px[i * 4 : i * 4 + 3] = palette[idx * 3 : idx * 3 + 3]
            px[i * 4 + 3] = trns[idx] if trns and idx < len(trns) else 255

    return Image(width, height, px)


def write_png(img, path, compress=9):
    raw = bytearray()
    stride = img.width * 4
    for y in range(img.height):
        raw.append(0)  # filter: None. Costs a few KB, keeps the writer trivial.
        raw += img.pixels[y * stride : (y + 1) * stride]

    def chunk(name, payload):
        return (
            struct.pack(">I", len(payload))
            + name
            + payload
            + struct.pack(">I", zlib.crc32(name + payload) & 0xFFFFFFFF)
        )

    out = bytearray(SIG)
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", img.width, img.height, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(bytes(raw), compress))
    out += chunk(b"IEND", b"")
    open(path, "wb").write(bytes(out))
    return len(out)


def resize(img, w, h):
    """Box-filter resample. Averaging every source pixel that lands in a target cell
    keeps text edges smooth when shrinking 1024 -> 48, which nearest-neighbour does not."""
    src, sw, sh = img.pixels, img.width, img.height
    dst = bytearray(w * h * 4)
    for oy in range(h):
        y0 = oy * sh // h
        y1 = max(y0 + 1, (oy + 1) * sh // h)
        for ox in range(w):
            x0 = ox * sw // w
            x1 = max(x0 + 1, (ox + 1) * sw // w)
            r = g = b = a = cnt = 0
            for yy in range(y0, y1):
                base = yy * sw
                for xx in range(x0, x1):
                    i = (base + xx) * 4
                    r += src[i]
                    g += src[i + 1]
                    b += src[i + 2]
                    a += src[i + 3]
                    cnt += 1
            o = (oy * w + ox) * 4
            dst[o] = r // cnt
            dst[o + 1] = g // cnt
            dst[o + 2] = b // cnt
            dst[o + 3] = a // cnt
    return Image(w, h, dst)


def solid(width, height, rgba):
    return Image(width, height, bytearray(bytes(rgba) * (width * height)))


def paste(base, top, x, y):
    for ty in range(top.height):
        by = y + ty
        if not (0 <= by < base.height):
            continue
        si = ty * top.width * 4
        di = (by * base.width + x) * 4
        base.pixels[di : di + top.width * 4] = top.pixels[si : si + top.width * 4]
    return base


def corner_color(img, inset=4):
    """Background colour, sampled from the four corners. Used to extend a logo's
    backdrop when it is inset onto a larger canvas."""
    pts = [
        (inset, inset),
        (img.width - 1 - inset, inset),
        (inset, img.height - 1 - inset),
        (img.width - 1 - inset, img.height - 1 - inset),
    ]
    acc = [0, 0, 0, 0]
    for x, y in pts:
        p = img.get(x, y)
        for c in range(4):
            acc[c] += p[c]
    return tuple(v // len(pts) for v in acc)


def content_bbox(img, bg, tol=28):
    """Bounding box of everything that is not the background colour."""
    minx, miny, maxx, maxy = img.width, img.height, -1, -1
    for y in range(img.height):
        base = y * img.width
        for x in range(img.width):
            i = (base + x) * 4
            p = img.pixels[i : i + 4]
            if p[3] < 8:
                continue
            if (
                abs(p[0] - bg[0]) > tol
                or abs(p[1] - bg[1]) > tol
                or abs(p[2] - bg[2]) > tol
            ):
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    if maxx < 0:
        return None
    return (minx, miny, maxx, maxy)


def crop(img, x0, y0, x1, y1):
    w, h = x1 - x0 + 1, y1 - y0 + 1
    dst = bytearray(w * h * 4)
    for y in range(h):
        si = ((y0 + y) * img.width + x0) * 4
        dst[y * w * 4 : (y + 1) * w * 4] = img.pixels[si : si + w * 4]
    return Image(w, h, dst)
