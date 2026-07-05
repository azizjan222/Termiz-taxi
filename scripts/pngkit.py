"""Minimal pure-stdlib PNG codec (RGB, 8-bit, non-interlaced) + resize/recolor.
Generates app icon/splash assets without PIL/ImageMagick (unavailable in this env)."""
import struct, zlib

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    i = 8
    w = h = None
    idat = bytearray()
    while i < len(d):
        ln = struct.unpack('>I', d[i:i+4])[0]
        typ = d[i+4:i+8]
        data = d[i+8:i+8+ln]
        if typ == b'IHDR':
            w, h, bd, ct, comp, filt, inter = struct.unpack('>IIBBBBB', data)
            assert bd == 8 and ct == 2 and inter == 0, f"unsupported bd={bd} ct={ct} inter={inter}"
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
        i += 12 + ln
    raw = zlib.decompress(bytes(idat))
    bpp = 3
    stride = w * bpp
    out = bytearray(w * h * bpp)
    prev = bytearray(stride)
    pos = 0
    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
        if pa <= pb and pa <= pc: return a
        if pb <= pc: return b
        return c
    for y in range(h):
        ftype = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if ftype == 1:
            for x in range(bpp, stride): line[x] = (line[x] + line[x-bpp]) & 255
        elif ftype == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif ftype == 3:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif ftype == 4:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                c = prev[x-bpp] if x >= bpp else 0
                line[x] = (line[x] + paeth(a, prev[x], c)) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, out

def write_png(path, w, h, rgb):
    stride = w * 3
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y*stride:(y+1)*stride]
    comp = zlib.compress(bytes(raw), 9)
    def chunk(typ, data):
        return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b''))

def resize(w, h, rgb, nw, nh):
    out = bytearray(nw * nh * 3)
    for ny in range(nh):
        y0 = ny * h // nh; y1 = max(y0+1, (ny+1) * h // nh)
        for nx in range(nw):
            x0 = nx * w // nw; x1 = max(x0+1, (nx+1) * w // nw)
            r = g = b = cnt = 0
            for yy in range(y0, y1):
                base = yy * w * 3
                for xx in range(x0, x1):
                    p = base + xx*3
                    r += rgb[p]; g += rgb[p+1]; b += rgb[p+2]; cnt += 1
            o = (ny*nw + nx) * 3
            out[o] = r//cnt; out[o+1] = g//cnt; out[o+2] = b//cnt
    return out

def canvas(nw, nh, bg):
    out = bytearray(nw*nh*3)
    for i in range(nw*nh):
        out[i*3], out[i*3+1], out[i*3+2] = bg
    return out

def paste(dst, dw, dh, src, sw, sh, ox, oy):
    for y in range(sh):
        drow = ((oy+y)*dw + ox)*3
        srow = (y*sw)*3
        dst[drow:drow+sw*3] = src[srow:srow+sw*3]

def recolor_bg(w, h, rgb, target):
    tr, tg, tb = target
    out = bytearray(rgb)
    for i in range(w*h):
        p = i*3; r = rgb[p]; g = rgb[p+1]; b = rgb[p+2]
        lum = (r*299 + g*587 + b*114)//1000
        if b >= r + 12 and b >= g + 8 and lum < 95:
            f = (lum + 18) / 53.0
            out[p]   = min(255, int(tr * f))
            out[p+1] = min(255, int(tg * f))
            out[p+2] = min(255, int(tb * f))
    return out
