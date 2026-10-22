"""제미나이 반짝이 워터마크를 '역 알파 합성'으로 지운다 (dewatermark.py 의 중앙값 메우기보다 흔적이 적다).
워터마크 = 흰색을 일정 알파로 덮은 아스트로이드(4갈래 별). 중심은 오른쪽/아래 끝에서 120.5px,
반지름 약 25.5px, 알파 약 0.27 (raw 15장에서 알파 지도 추정 + 격자 탐색으로 정함).
원본 = (out - a*255) / (1 - a).  남는 가는 윤곽은 별 가장자리 띠만 5x5 중앙값으로 다듬는다.
사용: from dewatermark2 import clean2; clean2(PIL.Image) -> PIL.Image (RGB)"""
import numpy as np
from PIL import Image, ImageFilter

A0, RAD, OFF = 0.27, 25.5, 120.5
HALF = 34


def _dist(cx_frac, cy_frac, ss=4):
    n = 2 * HALF + 1
    g = (np.arange(n * ss) + 0.5) / ss - HALF - 0.5
    yy, xx = np.meshgrid(g - cy_frac, g - cx_frac, indexing='ij')
    d = (np.abs(xx) ** (2 / 3) + np.abs(yy) ** (2 / 3)) ** 1.5
    return d, n, ss


def clean2(im, a0=A0, r=RAD, off=OFF):
    im = im.convert('RGB')
    W, H = im.size
    cxf, cyf = W - off, H - off
    cx, cy = int(np.floor(cxf)), int(np.floor(cyf))
    d, n, ss = _dist(cxf - cx, cyf - cy, ss=4)
    a = a0 * (d <= r).reshape(n, ss, n, ss).mean(axis=(1, 3))
    band = (np.abs(d - r) <= 2.0).reshape(n, ss, n, ss).any(axis=(1, 3))
    arr = np.asarray(im).astype(np.float64).copy()
    y0, x0 = cy - HALF, cx - HALF
    win = arr[y0:y0 + n, x0:x0 + n]
    aa = a[..., None]
    win[:] = np.clip((win - aa * 255) / (1 - aa), 0, 255)
    out = Image.fromarray(arr.round().astype(np.uint8))
    # smooth the thin edge band
    sub = out.crop((x0, y0, x0 + n, y0 + n))
    med = np.asarray(sub.filter(ImageFilter.MedianFilter(5)))
    s = np.asarray(sub).copy()
    s[band] = med[band]
    out.paste(Image.fromarray(s), (x0, y0))
    return out
