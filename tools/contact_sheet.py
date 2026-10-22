"""public/img 의 모든 결과물을 작게 바둑판으로 모아 public/img/_contact.png 로 저장."""
import os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'public', 'img')
files = []
for sub in ('chars', 'cards', 'roles'):
    d = os.path.join(IMG, sub)
    files += [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith('.webp')]
T, cols = 180, 10
rows = (len(files) + cols - 1) // cols
bgs = ['table.jpg', 'lobby.jpg', 'paper.jpg']
sheet = Image.new('RGB', (cols * (T + 6), rows * (T + 22) + 300), (40, 40, 40))
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    x, y = (i % cols) * (T + 6), (i // cols) * (T + 22)
    sheet.paste(Image.open(f).convert('RGB').resize((T, T)), (x, y))
    dr.text((x + 2, y + T + 4), os.path.relpath(f, IMG).replace(os.sep, '/'), fill='white')
x, y0 = 0, rows * (T + 22)
for b in bgs:
    im = Image.open(os.path.join(IMG, b)).convert('RGB')
    im.thumbnail((500, 280))
    sheet.paste(im, (x, y0)); dr.text((x + 4, y0 + 4), b, fill='white'); x += im.width + 10
sheet.save(os.path.join(IMG, '_contact.png'))
print(len(files), 'tiles')
