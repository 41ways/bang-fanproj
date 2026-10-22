"""raw/ui_*.png (제미나이 원본) 에서 public/img/ui/ 의 UI 그림을 전부 다시 만든다.

    python tools/make_ui.py            # 전부
    python tools/make_ui.py logo btn   # 이름에 해당 글자가 든 단계만

- 배경 그림(title_bg, table2): 반짝이 워터마크를 dewatermark2.clean2 로 지운 뒤 1920x1080 JPEG.
- 마젠타 시트: min(R,B)-G 로 바탕을 알아보고(cut_sheet.py 와 같은 식) 마젠타를 빼서(despill)
  덩어리별로 잘라 투명 WebP. 단추·판넬은 알파 상자에 딱 맞춰 자르고(비율 유지), 아이콘·효과는 정사각.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from dewatermark2 import clean2  # noqa: E402

RAW = os.path.join(ROOT, 'raw')
OUT = os.path.join(ROOT, 'public', 'img', 'ui')


def raw(name, wm=True):
    im = Image.open(os.path.join(RAW, f'ui_{name}.png')).convert('RGB')
    return clean2(im) if wm else im


def save_webp(im, rel, q=86):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, 'WEBP', quality=q, method=6, exact=False)
    print(rel, im.size)


def background(name, rel, q):
    im = raw(name)
    im = im.resize((1920, 1080), Image.LANCZOS)
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, 'JPEG', quality=q, optimize=True, progressive=True)
    print(rel, im.size)


def key_magenta(im, lo=60, hi=170):
    """RGB float 배열 -> (despill 한 색, 알파 0..1)."""
    a = np.asarray(im).astype(np.float32)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    corners = np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3), a[-8:, :8].reshape(-1, 3)])
    M = np.median(corners, axis=0)
    m = np.minimum(R, B) - G
    alpha = 1 - np.clip((m - lo) / (hi - lo), 0, 1)
    af = alpha[..., None]
    F = np.where(af > 0.02, (a - (1 - af) * M) / np.maximum(af, 0.02), a)
    F = np.clip(F, 0, 255)
    # 남은 분홍기 누르기: R,B 가 G 보다 둘 다 크게 높으면 G 쪽으로 당긴다(가장자리 띠에서만)
    edge = alpha < 0.98
    mm = np.minimum(F[..., 0], F[..., 2]) - F[..., 1]
    k = np.clip(mm - 20, 0, None) * edge
    F[..., 0] -= k * 0.8
    F[..., 2] -= k * 0.8
    F = np.clip(F, 0, 255)
    return F, alpha


def blobs(alpha, n, min_px=40, merge_pad=30):
    """알파>0.5 덩어리 중 큰 n 개 (작은 조각은 겹치는 큰 덩어리에 합침). [(mask, box)]."""
    lab, cnt = ndi.label(alpha > 0.5)
    sizes = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, cnt + 1))
    order = np.argsort(-sizes)
    sl = ndi.find_objects(lab)
    main = [int(i) + 1 for i in order[:n]]
    groups = {i: [i] for i in main}
    boxes = {}
    for i in main:
        s = sl[i - 1]
        boxes[i] = [s[1].start, s[0].start, s[1].stop, s[0].stop]
    for j in order[n:]:
        j = int(j) + 1
        if sizes[j - 1] < min_px:
            continue
        s = sl[j - 1]
        x0, y0, x1, y1 = s[1].start, s[0].start, s[1].stop, s[0].stop
        # 가장 가까운 큰 덩어리(상자 사이 거리)가 merge_pad 안이면 합친다 (불똥·연기 조각 등)
        best, bd = None, 1e9
        for i in main:
            X0, Y0, X1, Y1 = boxes[i]
            dx = max(X0 - x1, x0 - X1, 0)
            dy = max(Y0 - y1, y0 - Y1, 0)
            dd = max(dx, dy)
            if dd < bd:
                best, bd = i, dd
        if best is not None and bd <= merge_pad:
            groups[best].append(j)
    out = []
    for i in main:
        mask = np.isin(lab, groups[i])
        out.append((mask, boxes[i]))
    return out


def order_grid(items, rows):
    items = sorted(items, key=lambda t: (t[1][1] + t[1][3]) / 2)
    per = int(np.ceil(len(items) / rows))
    res = []
    for r in range(rows):
        res += sorted(items[r * per:(r + 1) * per], key=lambda t: t[1][0])
    return res


def cut(F, alpha, mask, erode=1, fill_holes=False):
    k = ndi.binary_dilation(mask, iterations=3)
    if fill_holes:
        k = ndi.binary_fill_holes(k)
    A = np.where(k, alpha, 0)
    if fill_holes:
        # 덩어리 안쪽(구멍 메우기 영역)은 불투명으로 — 종이 속 연분홍 얼룩이 비치지 않게
        inner = ndi.binary_erosion(ndi.binary_fill_holes(mask), iterations=4)
        A = np.where(inner, 1.0, A)
    if erode:
        A8 = Image.fromarray((A * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(2 * erode + 1))
        A = np.minimum(A, np.asarray(A8).astype(np.float32) / 255)
    ys, xs = np.where(A > 0.04)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([F[y0:y1, x0:x1], A[y0:y1, x0:x1] * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def fit_width(im, w):
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    return im


def square(im, S, fill=0.92):
    sc = min(S * fill / im.width, S * fill / im.height)
    t = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    can = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    can.paste(t, ((S - t.width) // 2, (S - t.height) // 2), t)
    return can


def sheet(name, names, rows, **kw):
    F, alpha = key_magenta(raw(name), **{k: kw.pop(k) for k in ('lo', 'hi') if k in kw})
    items = order_grid(blobs(alpha, len(names)), rows)
    return {n: cut(F, alpha, m, **kw) for n, (m, b) in zip(names, items)}


# ---------------------------------------------------------------- 단계들
STEPS = {}


def step(f):
    STEPS[f.__name__] = f
    return f


@step
def title():
    background('title_b', 'title_bg.jpg', 82)


@step
def logo():
    d = sheet('logo_a', ['logo'], 1)
    save_webp(fit_width(d['logo'], 1100), 'logo.webp')


@step
def btn():
    d = sheet('buttons_a', ['btn_wood', 'btn_red', 'btn_dark', 'btn_round'], 2, fill_holes=True)
    for k, im in d.items():
        save_webp(fit_width(im, 640 if k != 'btn_round' else 256), f'{k}.webp')


@step
def poster():
    d = sheet('poster_a', ['poster'], 1, fill_holes=True)
    save_webp(d['poster'], 'poster.webp')


ICONS = ['bullet', 'star_sheriff', 'star_deputy', 'outlaw', 'renegade', 'revolver', 'cards', 'chat',
         'hourglass', 'dynamite', 'horseshoe', 'crosshair']


@step
def icons():
    d = sheet('icons_a', ICONS, 3)
    for k, im in d.items():
        save_webp(square(im, 128, 0.94), f'icons/{k}.webp')


@step
def fx():
    d = sheet('fx_a', ['bang_burst', 'muzzle_flash', 'explosion_cloud', 'smoke_puff'], 2, fill_holes=True)
    for k, im in d.items():
        save_webp(square(im, 512, 0.96), f'fx/{k}.webp')


@step
def board():
    d = sheet('board_a', ['board'], 1, fill_holes=True)
    save_webp(d['board'], 'board.webp')


if __name__ == '__main__':
    want = sys.argv[1:]
    for k, f in STEPS.items():
        if not want or any(w in k for w in want):
            f()
