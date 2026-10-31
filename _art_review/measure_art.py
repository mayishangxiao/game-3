# -*- coding: utf-8 -*-
"""量一下交付包里的素材：尺寸、色彩数、透明边距，和游戏当前规格对照。"""
import os
import sys
from PIL import Image

root = sys.argv[1]

def info(p):
    im = Image.open(p)
    n_colors = len({px for px in im.convert('RGBA').getdata()})
    bbox = im.convert('RGBA').getbbox()
    return im.size, im.mode, n_colors, bbox

groups = {}
for dirpath, _dirs, files in os.walk(root):
    for f in files:
        if not f.lower().endswith('.png'):
            continue
        p = os.path.join(dirpath, f)
        rel = os.path.relpath(p, root)
        top = rel.split(os.sep)[0]
        size, mode, n, bbox = info(p)
        groups.setdefault(top, []).append((rel, size, mode, n, bbox))

for top in sorted(groups):
    rows = groups[top]
    print(f"== {top}  ({len(rows)} 张)")
    seen = {}
    for rel, size, mode, n, bbox in rows:
        key = (size, mode, n)
        seen.setdefault(key, []).append(rel)
    for (size, mode, n), rels in sorted(seen.items(), key=lambda kv: -len(kv[1])):
        print(f"   {size[0]}x{size[1]:<4} {mode:<5} {n:>3}色  x{len(rels):<3} 例: {rels[0]}")