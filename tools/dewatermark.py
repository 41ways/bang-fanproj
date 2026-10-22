"""제미나이 이미지 오른쪽 아래 반짝이(4갈래 별) 워터마크를 지운다.
별 모양 영역을 가리고 바깥 픽셀의 중앙값으로 안쪽을 채운다.
사용: from dewatermark import clean; clean(PIL.Image) -> PIL.Image (RGB)
"""
from PIL import Image


def clean(im, cx=None, cy=None, R=32):
    im = im.convert('RGB')
    W, H = im.size
    cx = W - 121 if cx is None else cx
    cy = H - 121 if cy is None else cy
    px = im.load()
    k = R ** (2 / 3)
    mask = set()
    for y in range(cy - R, cy + R + 1):
        for x in range(cx - R, cx + R + 1):
            if 0 <= x < W and 0 <= y < H and abs(x - cx) ** (2 / 3) + abs(y - cy) ** (2 / 3) <= k:
                mask.add((x, y))
    while mask:
        done = []
        for (x, y) in mask:
            cols = [px[x + dx, y + dy] for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                    if (x + dx, y + dy) not in mask and 0 <= x + dx < W and 0 <= y + dy < H]
            if len(cols) >= 3:
                px[x, y] = tuple(sorted(c[i] for c in cols)[len(cols) // 2] for i in range(3))
                done.append((x, y))
        if not done:
            break
        mask.difference_update(done)
    return im
