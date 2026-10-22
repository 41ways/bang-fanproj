"""2x2 (or NxM) grid image -> separate panels, by detecting near-white gutters.

usage: python tools/cut_grid.py <raw.png> <out_prefix_or_names...> [--rows 2 --cols 2]
  names: give rows*cols output paths in reading order (TL, TR, BL, BR).
As a module: cut(im, rows=2, cols=2) -> list of PIL images (reading order).
"""
import sys
import numpy as np
from PIL import Image


def _runs(mask):
    """mask: 1D bool array -> list of (start, end) runs of True (end exclusive)."""
    runs, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i)); start = None
    if start is not None:
        runs.append((start, len(mask)))
    return runs


def _segments(white_line, n, length):
    """Split [0,length) into n content segments using white lines as separators."""
    content = ~white_line
    segs = _runs(content)
    # drop tiny specks
    segs = [s for s in segs if s[1] - s[0] > length * 0.05]
    if len(segs) == n:
        return segs
    # fallback: merge/split around expected gutter positions
    if len(segs) > n:
        # merge segments separated by the smallest gaps until n remain
        while len(segs) > n:
            gaps = [segs[i + 1][0] - segs[i][1] for i in range(len(segs) - 1)]
            i = int(np.argmin(gaps))
            segs[i:i + 2] = [(segs[i][0], segs[i + 1][1])]
        return segs
    # too few: blind split of the content span
    a = segs[0][0] if segs else 0
    b = segs[-1][1] if segs else length
    step = (b - a) / n
    return [(int(a + k * step), int(a + (k + 1) * step)) for k in range(n)]


def cut(im, rows=2, cols=2, thr=235, frac=0.97):
    im = im.convert('RGB')
    a = np.asarray(im).astype(np.int16)
    white = (a.min(axis=2) >= thr)
    col_white = white.mean(axis=0) >= frac
    row_white = white.mean(axis=1) >= frac
    H, W = white.shape
    xs = _segments(col_white, cols, W)
    ys = _segments(row_white, rows, H)
    out = []
    for (y0, y1) in ys:
        for (x0, x1) in xs:
            p = im.crop((x0, y0, x1, y1))
            out.append(trim(p, thr))
    return out


def trim(p, thr=235, frac=0.9):
    """Trim residual near-white margin lines from the panel edges."""
    a = np.asarray(p).astype(np.int16)
    white = a.min(axis=2) >= thr
    H, W = white.shape
    t, b, l, r = 0, H, 0, W
    while t < b - 1 and white[t, l:r].mean() >= frac: t += 1
    while b > t + 1 and white[b - 1, l:r].mean() >= frac: b -= 1
    while l < r - 1 and white[t:b, l].mean() >= frac: l += 1
    while r > l + 1 and white[t:b, r - 1].mean() >= frac: r -= 1
    # shave 3px more to kill anti-aliased gutter fringe
    s = 3
    return p.crop((l + s, t + s, r - s, b - s))


if __name__ == '__main__':
    args = sys.argv[1:]
    rows = cols = 2
    if '--rows' in args:
        i = args.index('--rows'); rows = int(args[i + 1]); del args[i:i + 2]
    if '--cols' in args:
        i = args.index('--cols'); cols = int(args[i + 1]); del args[i:i + 2]
    src, names = args[0], args[1:]
    panels = cut(Image.open(src), rows, cols)
    for p, n in zip(panels, names):
        p.save(n)
        print(n, p.size)
