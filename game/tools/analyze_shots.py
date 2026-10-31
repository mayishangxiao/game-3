# -*- coding: utf-8 -*-
"""分析 CDP 截图：确认画面确实渲染了内容（不是纯黑/纯色），并统计主色分布。"""
import sys, io, os, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from PIL import Image

PALETTE = {
    "ink": (0x0D, 0x0B, 0x14),
    "night": (0x1C, 0x1A, 0x2B),
    "plumDark": (0x2F, 0x2B, 0x45),
    "plumMid": (0x4A, 0x44, 0x68),
    "plumLight": (0x6B, 0x64, 0x89),
    "greyPlum": (0x94, 0x8D, 0xAB),
    "greyLight": (0xC2, 0xBC, 0xD1),
    "paper": (0xF2, 0xED, 0xE4),
    "cream": (0xE8, 0xCF, 0xA8),
    "sand": (0xCF, 0xA2, 0x6A),
    "brown": (0xA8, 0x76, 0x3F),
    "brownDark": (0x7A, 0x4F, 0x2A),
    "brownDeep": (0x4E, 0x2F, 0x1A),
    "redDark": (0x8C, 0x1C, 0x1C),
    "red": (0xC6, 0x28, 0x28),
    "redBright": (0xE8, 0x5C, 0x4A),
    "greenDark": (0x1F, 0x5C, 0x3A),
    "green": (0x2F, 0x8F, 0x5B),
    "indigo": (0x1B, 0x3A, 0x6B),
    "blue": (0x2F, 0x6B, 0xA8),
    "blueLight": (0x7F, 0xB2, 0xD9),
    "star": (0xF0, 0xC4, 0x19),
}


def nearest(rgb):
    best, bd = None, 10 ** 9
    for name, p in PALETTE.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, p))
        if d < bd:
            bd, best = d, name
    return best, bd


def analyze(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = list(im.getdata())
    colors = im.getcolors(maxcolors=1 << 24) or []
    colors.sort(reverse=True)
    top = colors[:8]

    # 落到调色板上的比例（容差 6 通道）
    on_palette = 0
    names = {}
    for c in px[::13]:
        name, d = nearest(c)
        if d <= 6 * 6 * 3:
            on_palette += 1
        names[name] = names.get(name, 0) + 1
    sampled = len(px[::13])
    top_names = sorted(names.items(), key=lambda kv: -kv[1])[:8]

    print(f"\n=== {os.path.basename(path)} ({w}x{h}) ===")
    print(f"  不同颜色数: {len(colors)}")
    print(f"  前三色: " + ", ".join(f"rgb{c[1]} {c[0]*100//(w*h)}%" for c in top[:3]))
    print(f"  命中 24 色调色板比例: {on_palette*100//max(1,sampled)}%")
    print("  主要色名: " + ", ".join(f"{n}({v*100//max(1,sampled)}%)" for n, v in top_names))
    uniq = len(colors)
    verdict = "OK 画面有内容" if uniq > 20 else "警告：画面过于单调"
    print(f"  判定: {verdict}")
    return uniq


d = sys.argv[1] if len(sys.argv) > 1 else r"D:\game_project\game 3\game\tools\_cdp"
files = sorted(glob.glob(os.path.join(d, "screenshot-*.png")))
if not files:
    print("没有找到截图")
for f in files:
    analyze(f)