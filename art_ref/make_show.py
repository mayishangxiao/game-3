# -*- coding: utf-8 -*-
"""按 8 倍放大导出预览图，供在对话里直接看（openGameArt 原始素材本身很小）。"""
import urllib.request, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'show')
os.makedirs(OUT, exist_ok=True)
SRC = os.path.dirname(os.path.abspath(__file__))
S = 'https://opengameart.org/sites/default/files/'
UA = {'User-Agent': 'Mozilla/5.0 Chrome/156.0 Safari/537.36'}

from PIL import Image

items = [
    # (本地文件, 输出名, 描述)
    ('_preview_castle.png', 'castle_tileset_part3.png'),
    ('_preview_smoke.png', 'sample_27.png'),
    ('_preview_fx.png', '11_fire_spritesheet.png'),
]
for dst, fn in items:
    try:
        d = urllib.request.urlopen(urllib.request.Request(S + fn, headers=UA), timeout=60).read()
        open(os.path.join(SRC, '_dl_' + fn), 'wb').write(d)
        im = Image.open(os.path.join(SRC, '_dl_' + fn))
        print(dst, im.size, im.mode)
    except Exception as e:
        print('ERR', fn, e)


def upscale(src, dst, scale=None, nearest=True, bg=None, maxw=1400):
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    if scale is None:
        scale = max(1, min(8, maxw // max(w, 1)))
    im = im.resize((w * scale, h * scale), Image.NEAREST if nearest else Image.LANCZOS)
    out = os.path.join(OUT, dst)
    if bg:
        canvas = Image.new('RGBA', im.size, bg)
        canvas.alpha_composite(im)
        im = canvas
    im.convert('RGB').save(out)
    print('saved', out, im.size)


# 1. Sunny Land 环境预览（本身很大，直接缩小成合适宽度）
up = os.path.join(SRC, 'sun_Sunny-land-assets-files_PNG_environment_environment-preview.png')
im = Image.open(up).convert('RGB')
im.thumbnail((1400, 1400))
im.save(os.path.join(OUT, '01_sunnyland_env.png'))
print('saved 01', im.size)

# 2. Platformer Art Pixel —— spritesheet（深色底以便看清）
upscale(os.path.join(SRC, 'real_spritesheet_2.png'), '02_platformer_tileset.png', scale=3, bg=(60, 70, 90, 255))

# 3. Ars Notoria 角色分层
upscale(os.path.join(SRC, 'real_player-spritemap-v9.png'), '03_arsnotoria_player.png', scale=4, bg=(40, 40, 48, 255))
upscale(os.path.join(SRC, 'real_sword-slash-06-60x30.png'), '03b_arsnotoria_sword.png', scale=6, bg=(40, 40, 48, 255))

# 4. Items and elements
upscale(os.path.join(SRC, 'real_Items_1.png'), '04_items_elements.png', scale=8, bg=(70, 80, 70, 255))

# 5. 城堡 tileset part1 太长，取前 1/3 展示
im = Image.open(os.path.join(SRC, 'real_castle_tileset_part1.png')).convert('RGBA')
w, h = im.size
im.crop((0, 0, w, h // 3)).resize((w // 2, h // 6), Image.NEAREST).save(os.path.join(OUT, '05_castle_part1.png'))
print('saved 05')

# 6. 烟雾
up_ = os.path.join(SRC, '_dl_sample_27.png')
if os.path.exists(up_):
    im = Image.open(up_).convert('RGBA')
    im.thumbnail((1200, 1200))
    canvas = Image.new('RGBA', im.size, (30, 30, 40, 255))
    canvas.alpha_composite(im)
    canvas.convert('RGB').save(os.path.join(OUT, '06_smoke.png'))
    print('saved 06', im.size)

# 7. 火焰特效条（取第 1 行 8 帧放大）
im = Image.open(os.path.join(SRC, '_dl_11_fire_spritesheet.png')).convert('RGBA')
im = im.crop((0, 0, 800, 100))
im = im.resize((1600, 200), Image.NEAREST)
canvas = Image.new('RGBA', im.size, (25, 25, 32, 255))
canvas.alpha_composite(im)
canvas.convert('RGB').save(os.path.join(OUT, '07_fire_fx.png'))
print('saved 07')