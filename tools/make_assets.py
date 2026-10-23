"""raw/ -> public/img final assets (reproducible).

usage: python tools/make_assets.py            (build everything whose raw exists)
       python tools/make_assets.py chars1     (only one raw source)

MAP below lists every raw source:
  grid sources: raw/<name>.png is a 2x2 grid -> 4 outputs (TL, TR, BL, BR)
  single sources: raw/<name>.png is one image -> 1 output
Gemini's sparkle watermark is removed (reverse alpha blend, tools/dewatermark2.py) on the full raw image first.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from cut_grid import cut  # noqa: E402
from dewatermark2 import clean2  # noqa: E402

RAW = os.path.join(ROOT, 'raw')
IMG = os.path.join(ROOT, 'public', 'img')

# raw name -> list of output paths (relative to public/img), reading order
GRIDS = {
    'chars1': ['chars/bart', 'chars/blackjack', 'chars/calamity', 'chars/elgringo'],
    'chars2': ['chars/jesse', 'chars/jourdonnais', 'chars/kit', 'chars/lucky'],
    'chars3': ['chars/paul', 'chars/pedro', 'chars/rose', 'chars/sid'],
    'chars4': ['chars/slab', 'chars/suzy', 'chars/vulture', 'chars/willy'],
    'cards1': ['cards/bang', 'cards/missed', 'cards/beer', 'cards/saloon'],
    'cards2': ['cards/stagecoach', 'cards/wellsfargo', 'cards/generalstore', 'cards/panic'],
    'cards3': ['cards/catbalou', 'cards/gatling', 'cards/indians', 'cards/duel'],
    'cards4': ['cards/barrel', 'cards/scope', 'cards/mustang', 'cards/jail'],
    'cards5': ['cards/dynamite', 'cards/volcanic', 'cards/schofield', 'cards/remington'],
    'cards6': ['cards/carabine', 'cards/winchester', 'cards/back', 'roles/back'],
    'roles1': ['roles/sheriff', 'roles/deputy', 'roles/outlaw', 'roles/renegade'],
    # event cards (High Noon + A Fistful of Cards)
    'events1': ['events/blessing', 'events/curse', 'events/daltons', 'events/doctor'],
    'events2': ['events/ghosttown', 'events/goldrush', 'events/hangover', 'events/reverend'],
    'events3': ['events/sermon', 'events/shootout', 'events/thirst', 'events/train'],
    'events4': ['events/highnoon', 'events/mine', 'events/ambush', 'events/bloodbros'],
    'events5': ['events/deadman', 'events/liquor', 'events/judge', 'events/lasso'],
    'events6': ['events/lawwest', 'events/peyote', 'events/ranch', 'events/ricochet'],
    'events7': ['events/roulette', 'events/sniper', 'events/vendetta', 'events/fistful'],
    # re-rolls (later entries overwrite earlier ones; None = panel unused)
    #   roles1 sheriff/deputy badges had lettering, chars4 vulture had lettered gravestones
    'fix1': ['roles/sheriff', 'roles/deputy', 'chars/vulture', None],
    #   events2 hangover ('SALOON' carved on table) / reverend ('BIBLE' on book) had lettering
    'events_fix1': ['events/hangover', 'events/reverend', None, None],
    #   events7 roulette had a closed cylinder on green felt, events6 ricochet trail looked too cartoony
    'events_fix2': [None, 'events/roulette', 'events/ricochet', None],
}
# extra inset (fraction of each side) after deframe, for panels with rounded/torn edges
INSET = {'cards/back': 0.045, 'roles/back': 0.045, 'lobby': 0.025, 'table': 0.03}
# per-output override: raw single image replacing a grid panel (if raw/<id>.png exists)
# e.g. raw/single_indians.png -> cards/indians
BACKGROUNDS = {
    'table': ('table.jpg', (1920, 1080)),
    'lobby': ('lobby.jpg', (1920, 1080)),
    'paper': ('paper.jpg', (512, 512)),
}


def deframe(p, dark=110, frac=0.55, search=0.08):
    """Crop inside a thin dark frame line drawn near the panel edges (if any)."""
    a = np.asarray(p.convert('L')).astype(np.int16)
    H, W = a.shape
    d = a < dark
    lim_y, lim_x = int(H * search), int(W * search)

    def find(lines, n):
        idx = None
        for i in range(n):
            if lines(i) >= frac:
                idx = i
        return idx

    t = find(lambda i: d[i, :].mean(), lim_y)
    b = find(lambda i: d[H - 1 - i, :].mean(), lim_y)
    l = find(lambda i: d[:, i].mean(), lim_x)
    r = find(lambda i: d[:, W - 1 - i].mean(), lim_x)
    pad = 3
    x0 = (l + pad) if l is not None else 0
    y0 = (t + pad) if t is not None else 0
    x1 = (W - 1 - r - pad) if r is not None else W
    y1 = (H - 1 - b - pad) if b is not None else H
    return p.crop((x0, y0, x1, y1))


def inset(p, f):
    if not f:
        return p
    W, H = p.size
    dx, dy = int(W * f), int(H * f)
    return p.crop((dx, dy, W - dx, H - dy))


def seamless(p, frac=0.125):
    """Make a texture tileable: cross-fade the far edge strip onto the near edge (cols, then rows).
    Output is smaller by frac on each axis; resize afterwards."""
    a = np.asarray(p.convert('RGB')).astype(np.float32)
    H, W = a.shape[:2]
    m = int(W * frac)
    t = np.linspace(0, 1, m)[None, :, None]
    out = a[:, :W - m].copy()
    out[:, :m] = a[:, :m] * t + a[:, W - m:] * (1 - t)
    a = out
    m = int(H * frac)
    t = np.linspace(0, 1, m)[:, None, None]
    out = a[:H - m].copy()
    out[:m] = a[:m] * t + a[H - m:] * (1 - t)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def square(p, size=512):
    return ImageOps.fit(p, (size, size), Image.LANCZOS, centering=(0.5, 0.5))


def save_webp(p, rel):
    path = os.path.join(IMG, rel + '.webp')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    p.convert('RGB').save(path, 'WEBP', quality=82, method=6)
    print('  ->', os.path.relpath(path, ROOT))


def load_raw(name):
    path = os.path.join(RAW, name + '.png')
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert('RGB')
    # Gemini sparkle watermark: same pixel size/offset (120.5px from bottom-right) on all outputs
    return clean2(im)


def build_grid(name, outs):
    im = load_raw(name)
    if im is None:
        return
    print(name)
    panels = cut(im, 2, 2)
    for p, rel in zip(panels, outs):
        if rel is None:
            continue
        single = os.path.join(RAW, 'single_' + os.path.basename(rel) + ('_role' if rel == 'roles/back' else '') + '.png')
        if os.path.exists(single):
            continue  # replaced by a single image, built below
        save_webp(square(inset(deframe(p), INSET.get(rel, 0))), rel)


def build_singles():
    for f in sorted(os.listdir(RAW)):
        if not (f.startswith('single_') and f.endswith('.png')):
            continue
        key = f[len('single_'):-4]
        rel = None
        if key == 'back_role':
            rel = 'roles/back'
        else:
            for outs in GRIDS.values():
                for o in outs:
                    if os.path.basename(o) == key and o != 'roles/back':
                        rel = o
        if rel is None:
            print('?? unknown single', f); continue
        print(f[:-4])
        im = load_raw(f[:-4])
        save_webp(square(deframe(im)), rel)


def unfelt(im, hue=26, sat=0.5, val=0.6):
    """green felt -> dark brown leather (user: no green card tables). Keeps shading/texture, leaves the wood rim alone."""
    hsv = np.asarray(im.convert('HSV')).astype(np.float32)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    m = np.clip(1 - np.maximum(0, np.abs(h - 110) - 60) / 12, 0, 1) * np.clip((s - 0.08) / 0.1, 0, 1)
    ns = np.clip(sat * (0.6 + 0.8 * s), 0, 1)
    out = hsv.copy()
    out[..., 0] = np.where(m > 0, hue * 255 / 360, hsv[..., 0])
    out[..., 1] = (s * (1 - m) + ns * m) * 255
    out[..., 2] = (v * (1 - m) + v * val * m) * 255
    return Image.fromarray(out.round().clip(0, 255).astype(np.uint8), 'HSV').convert('RGB')


def build_bg(name, out, size):
    im = load_raw(name)
    if im is None:
        return
    print(name)
    im = inset(im, INSET.get(name, 0))  # no deframe: it would bite into the table's felt outline
    if name == 'paper':
        im = seamless(im)
    if name == 'table':
        im = unfelt(im)
    im = ImageOps.fit(im, size, Image.LANCZOS)
    path = os.path.join(IMG, out)
    im.save(path, 'JPEG', quality=80, optimize=True, progressive=True)
    print('  ->', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    only = sys.argv[1:]
    for name, outs in GRIDS.items():
        if not only or name in only:
            build_grid(name, outs)
    if not only or 'singles' in only:
        build_singles()
    for name, (out, size) in BACKGROUNDS.items():
        if not only or name in only:
            build_bg(name, out, size)
