# -*- coding: utf-8 -*-
"""把几个 CC0 资源直接落到工程里能用的形态，并和现有占位贴图拼一张对比图。"""
import os, urllib.request, io, zipfile
from PIL import Image, ImageDraw

ROOT = r'D:\game_project\game 3'
ART = os.path.join(ROOT, 'game', 'public', 'art')
SHOW = os.path.join(ROOT, 'art_ref', 'show')
SRC = os.path.join(ROOT, 'art_ref')
os.makedirs(SHOW, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 Chrome/156.0 Safari/537.36'}
S = 'https://opengameart.org/sites/default/files/'


def dl(name):
    p = os.path.join(SRC, name)
    if not os.path.exists(p):
        open(p, 'wb').write(urllib.request.urlopen(urllib.request.Request(S + name, headers=UA), timeout=90).read())
    return p


# ---------- 1. 烟雾（CC0, Kenney）缩到 64px 存进 art/fx ----------
fx_dir = os.path.join(ART, 'fx')
os.makedirs(fx_dir, exist_ok=True)
sm = Image.open(dl('smokeParticleAssets.zip')) if False else None
try:
    z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(urllib.request.Request(S + 'smokeParticleAssets.zip', headers=UA), timeout=120).read()))
    pngs = [n for n in z.namelist() if n.lower().endswith('.png') and '__MACOSX' not in n]
    print('smoke zip png count', len(pngs))
    pick = None
    for n in pngs:
        if 'blackSmoke' in n or 'smoke' in n.lower():
            pick = n
            break
    print('first png', pngs[:3])
except Exception as e:
    print('smoke zip err', e)

# ---------- 2. Sunny Land 打包：取 tileset + props 展示 ----------
zpath = os.path.join(SRC, 'sunny-land-files.zip')
if os.path.exists(zpath):
    z = zipfile.ZipFile(zpath)
    names = [n for n in z.namelist() if n.lower().endswith('.png') and '__MACOSX' not in n]
    keep = {}
    for n in names:
        base = os.path.basename(n)
        if base in ('tileset.png', 'props.png', 'player.png', 'player_sprites.png'):
            keep.setdefault(base, n)
    for base, n in keep.items():
        data = z.read(n)
        im = Image.open(io.BytesIO(data))
        print('sunny', base, im.size)
        im.thumbnail((1200, 1200))
        im.save(os.path.join(SHOW, 'sun_' + base))

# ---------- 3. 把主角占位贴图与 Ars Notoria 角色并排 ----------
cur = Image.open(os.path.join(ART, 'units', 'lin_zexu_down.png')).convert('RGBA')
ar = Image.open(os.path.join(SRC, 'real_player-spritemap-v9.png')).convert('RGBA').crop((0, 0, 46, 50))
W, H = 46, 50
canvas = Image.new('RGBA', (420, 260), (35, 35, 42, 255))
canvas.alpha_composite(cur.resize((W * 4, H * 4), Image.NEAREST), (16, 40))
canvas.alpha_composite(ar.resize((W * 4, H * 4), Image.NEAREST), (220, 40))
d = ImageDraw.Draw(canvas)
d.text((16, 8), 'current lin_zexu_down  24x32', fill=(220, 220, 220))
d.text((220, 8), 'Ars Notoria hero  46x50', fill=(220, 220, 220))
canvas.convert('RGB').save(os.path.join(SHOW, '08_compare_hero.png'))
print('saved compare')