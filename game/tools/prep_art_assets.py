"""把用户给的美术整理成游戏能直接用的资源。

输入（tools/_art_in/）：
  bg_red.png / bg_night.png  960x540 RGB 全景
  scars.png                  512x512 RGBA 弹坑/血迹/尸骸贴图集

输出：
  public/art/bg/bg_sea_red.png / bg_sea_night.png   480x270（NEAREST 减半，保持像素）
  public/art/scars/scar_NN.png                      逐个贴花，带透明
  tools/_art_in/preview_horizon_*.png               远景条候选（给人眼看）
"""
from PIL import Image
import os

SRC = 'tools/_art_in'
BG_OUT = 'public/art/bg'
SCAR_OUT = 'public/art/scars'
os.makedirs(BG_OUT, exist_ok=True)
os.makedirs(SCAR_OUT, exist_ok=True)

# ---------- ① 背景：960x540 -> 480x270 ----------
for name in ('bg_red', 'bg_night'):
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGB')
    small = im.resize((480, 270), Image.NEAREST)
    dst = os.path.join(BG_OUT, 'bg_sea_' + name.split('_')[1] + '.png')
    small.save(dst)
    print('bg ->', dst, small.size)

# ---------- ② 远景条候选：从全景里裁一条出来 ----------
night = Image.open(os.path.join(SRC, 'bg_night.png')).convert('RGB')
red = Image.open(os.path.join(SRC, 'bg_red.png')).convert('RGB')
# 全景 960x540，游戏 480x270，比例 2:1
candidates = [
    ('a_sky_only', 0, 96),        # 纯天空 + 烟
    ('b_ship_line', 60, 200),     # 天空下沿 + 全部舰影 + 水线
    ('c_ship_tight', 96, 236),    # 紧贴舰影与水线
    ('d_low', 120, 260),          # 舰影 + 海面
]
for tag, y0, y1 in candidates:
    for src, label in ((night, 'night'), (red, 'red')):
        strip = src.crop((0, y0, 960, y1))
        # 高度压到 64px（= sky_rows 4 行 x 16px），宽度保持 480
        h = 64
        w = 480
        strip = strip.resize((w, h), Image.NEAREST)
        out = os.path.join(SRC, 'preview_horizon_%s_%s.png' % (tag, label))
        strip.save(out)
print('preview strips written')

# ---------- ③ 贴花：按 alpha 连通块切 ----------
sheet = Image.open(os.path.join(SRC, 'scars.png')).convert('RGBA')
W, H = sheet.size
alpha = sheet.getchannel('A')
px = alpha.load()

# 行/列投影，找出有内容的条带
rows_busy = [any(px[x, y] > 8 for x in range(0, W, 2)) for y in range(H)]
cols_busy = [any(px[x, y] > 8 for y in range(0, H, 2)) for x in range(W)]


def bands(flags, gap=6, minlen=8):
    out = []
    start = None
    for i, f in enumerate(flags + [False] * gap):
        f = f or (start is not None and i < len(flags) and False)
        if f and start is None:
            start = i
        elif not f and start is not None:
            # 收尾：允许中间有 gap 个空行
            if i - start >= minlen:
                out.append((start, i))
            start = None
    # 合并间距 < gap 的相邻条带
    merged = []
    for a, b in out:
        if merged and a - merged[-1][1] <= gap * 2:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged


def split_cells(y0, y1, count):
    """把一条横带均匀切成 count 格（贴图集是等宽排布的）。"""
    step = (y1 - y0) / count
    return [(round(y0 + i * step), round(y0 + (i + 1) * step)) for i in range(count)]


row_bands = bands(rows_busy, gap=8, minlen=20)
print('row bands:', row_bands)

decal_index = 0
for (ry0, ry1) in row_bands:
    sub = sheet.crop((0, ry0, W, ry1))
    boxes = []
    # 在这条带里按列找三块
    cols = []
    for x in range(W):
        busy = any(sub.getpixel((x, y))[3] > 8 for y in range(0, ry1 - ry0, 2))
        cols.append(busy)
    cb = bands(cols, gap=8, minlen=20)
    print('  band', ry0, ry1, '->', cb)
    for (cx0, cx1) in cb:
        cell = sub.crop((cx0, 0, cx1, ry1 - ry0))
        bbox = cell.getbbox()
        if not bbox:
            continue
        decal = cell.crop(bbox)
        dst = os.path.join(SCAR_OUT, 'scar_%02d.png' % decal_index)
        decal.save(dst)
        print('    decal', decal_index, decal.size, dst)
        decal_index += 1

print('total decals:', decal_index)