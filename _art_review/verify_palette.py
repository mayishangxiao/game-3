# -*- coding: utf-8 -*-
"""独立复核：交付包的像素是否真的落在我们 constants.ts 的 24 色里。

用法: python verify_palette.py <artRoot> <colorsHexFile>
颜色文件由 node 侧导出（每行一个 #RRGGBB）。
"""
import os
import sys
from PIL import Image

root, colorfile = sys.argv[1], sys.argv[2]
palette = set()
for line in open(colorfile, encoding='utf-8'):
    line = line.strip().upper()
    if line.startswith('#'):
        palette.add(line)

print(f"对照色板: {len(palette)} 色")

bad_files = 0
total_px = 0
off_px = 0
off_colors = {}

for dirpath, _dirs, files in os.walk(root):
    if '_tools' in dirpath:
        continue
    for f in files:
        if not f.lower().endswith('.png'):
            continue
        p = os.path.join(dirpath, f)
        rel = os.path.relpath(p, root)
        if rel.split(os.sep)[0] in ('previews', 'qa') or 'proof' in f or 'preview' in f:
            continue          # 放大图与合成图不参与
        im = Image.open(p).convert('RGBA')
        for r, g, b, a in im.getdata():
            total_px += 1
            if a == 0:
                continue
            if a != 255:
                off_px += 1
                off_colors[f"alpha={a}"] = off_colors.get(f"alpha={a}", 0) + 1
                continue
            hx = f"#{r:02X}{g:02X}{b:02X}"
            if hx not in palette:
                off_px += 1
                off_colors[hx] = off_colors.get(hx, 0) + 1
        if any(True for _ in ()):
            pass

print(f"检查像素 {total_px}，越界 {off_px}")
if off_colors:
    top = sorted(off_colors.items(), key=lambda kv: -kv[1])[:12]
    print("越界色前几名:", top)
else:
    print("结论: 全部落在 24 色内，且 alpha 只有 0/255")
