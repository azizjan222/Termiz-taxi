import time, pngkit as p

SRC = '../assets-src/logo-sarixgo.png'
t0 = time.time()
w, h, rgb = p.read_png(SRC)
print('decoded', w, h, 'in', round(time.time()-t0, 1), 's')

def gen(app_dir, base_rgb, bw, bh, bg):
    """Generate the icon/splash asset set for one app from a 1024 master."""
    t = time.time()
    master = p.resize(bw, bh, base_rgb, 1024, 1024)
    print(' master 1024 in', round(time.time()-t, 1), 's')
    # Full-logo assets (same 1024 content): app icon + splash images.
    for name in ('icon.png', 'splash.png', 'splash-icon.png'):
        p.write_png(f'{app_dir}/{name}', 1024, 1024, master)
    # Android adaptive icon: pad the logo (~64%) onto a brand-colour canvas so the
    # round/squircle system mask never clips the "SARIX GO" wordmark edges.
    adaptive = p.canvas(1024, 1024, bg)
    inner = p.resize(1024, 1024, master, 660, 660)
    p.paste(adaptive, 1024, 1024, inner, 660, 660, (1024-660)//2, (1024-660)//2)
    p.write_png(f'{app_dir}/adaptive-icon.png', 1024, 1024, adaptive)
    # Play store icon 512
    p.write_png(f'{app_dir}/play-icon-512.png', 512, 512, p.resize(1024, 1024, master, 512, 512))
    # Web favicon 48
    p.write_png(f'{app_dir}/favicon.png', 48, 48, p.resize(1024, 1024, master, 48, 48))
    # Play feature graphic 1024x500: logo centered on brand-colour canvas
    fg = p.canvas(1024, 500, bg)
    logo500 = p.resize(1024, 1024, master, 500, 500)
    p.paste(fg, 1024, 500, logo500, 500, 500, (1024-500)//2, 0)
    p.write_png(f'{app_dir}/play-feature-graphic.png', 1024, 500, fg)
    print(' wrote', app_dir, 'in', round(time.time()-t, 1), 's')

def edge_bg(im):
    """Average a strip along the top edge so the feature-graphic canvas matches the
    logo background seamlessly."""
    r = g = b = n = 0
    for y in range(4, 20):
        for x in range(4, w-4, 7):
            o = (y*w + x)*3; r += im[o]; g += im[o+1]; b += im[o+2]; n += 1
    return (r//n, g//n, b//n)

# Passenger: original navy logo. Canvas matches the logo's own navy edge.
gen('../sarix-go-app/assets', rgb, w, h, edge_bg(rgb))

# Driver: recolour navy background -> deep green, then the same set.
t = time.time()
drv = p.recolor_bg(w, h, rgb, (16, 74, 52))
print('recoloured driver in', round(time.time()-t, 1), 's')
gen('../sarix-go-driver/assets', drv, w, h, edge_bg(drv))
print('ALL DONE in', round(time.time()-t0, 1), 's')
