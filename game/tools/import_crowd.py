"""把甲方给的围观百姓条带还原成一个个 6×12 的像素小人。

源图（用户 m11885 发来的）：`tools/_ref_crowd.png`，480×96，深灰底。
里面是 5 个小人，每个在图上占 36×72 像素 —— 等于把 6×12 的像素画放大了 6 倍。
所以这里不重画，只做还原：按 6 像素一格取色，丢掉背景色，输出 6×12 的 PNG。

为什么不在游戏里直接缩放原图：36×72 画进 480×270 的战场会挡住路，
而 6 倍放大再缩小会糊边；还原成原始像素后用 Phaser 的最近邻放大最干净
（游戏里 `CROWD_SCALE=3` → 18×36，和玩家小人 24×32 同量级）。

用法：
    python tools/import_crowd.py            # 用默认源图
    python tools/import_crowd.py <源图路径>

输出：public/art/crowd/door_0.png … door_4.png（6×12，RGBA，背景透明）
"""

from __future__ import annotations

import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_SRC = os.path.join(HERE, "_ref_crowd.png")
OUT_DIR = os.path.join(ROOT, "public", "art", "crowd")

CELL = 6          # 源图上每个「像素」占多少真实像素
COLS = 6          # 小人的像素宽
ROWS = 12         # 小人的像素高
FIGURES = 5       # 图里有几个小人


def load(src: str) -> Image.Image:
    im = Image.open(src).convert("RGB")
    return im


def background(im: Image.Image) -> tuple[int, int, int]:
    """取左上角做背景色。条带是纯色底，四个角一致。"""
    return im.getpixel((1, 1))


def figure_columns(im: Image.Image, bg: tuple[int, int, int], tol: int = 30) -> list[tuple[int, int]]:
    """按列扫描非背景像素，返回 5 个小人各自的 x 区间。"""

    def is_fg(px: tuple[int, int, int]) -> bool:
        return sum(abs(px[i] - bg[i]) for i in range(3)) > tol

    w, h = im.size
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x in range(w):
        hit = any(is_fg(im.getpixel((x, y))) for y in range(h))
        if hit and start is None:
            start = x
        elif not hit and start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, w - 1))
    # 丢掉右下角的水印之类的小碎块
    runs = [(a, b) for a, b in runs if b - a + 1 >= COLS * CELL]
    return runs


def extract(im: Image.Image, x0: int, bg: tuple[int, int, int]) -> Image.Image:
    """在 x0 处取一个 6×12 的小人，背景透明。

    源图里小人不是从条带顶部开始的（有的衣服高、有的矮），
    所以按「非背景像素的最低行」对齐脚底，统一贴到 12 行画布的底部。
    """
    tol = 30

    def is_fg(px: tuple[int, int, int]) -> bool:
        return sum(abs(px[i] - bg[i]) for i in range(3)) > tol

    # 找出这个小人纵向占了多少格
    rows_fg = []
    for gy in range(im.size[1] // CELL):
        for gx in range(COLS):
            px = im.getpixel((x0 + gx * CELL + CELL // 2, gy * CELL + CELL // 2))
            if is_fg(px):
                rows_fg.append(gy)
                break
    if not rows_fg:
        raise SystemExit(f"x={x0} 处没有找到小人")
    top, bottom = min(rows_fg), max(rows_fg)

    out = Image.new("RGBA", (COLS, ROWS), (0, 0, 0, 0))
    height = bottom - top + 1
    # 第 2 个小人（door_2，白毛巾）原图就是 13 格高：白布裹头厚一格。
    # 画布仍是 12 格 —— 统一底边对齐后顶掉最上面一行，正好是多余的布角。
    if height > ROWS:
        top += height - ROWS
        height = ROWS
    y_off = ROWS - height  # 脚底对齐
    for gy in range(height):
        for gx in range(COLS):
            px = im.getpixel((x0 + gx * CELL + CELL // 2, (top + gy) * CELL + CELL // 2))
            if is_fg(px):
                out.putpixel((gx, y_off + gy), (px[0], px[1], px[2], 255))
    return out


def main() -> int:
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        print(f"找不到源图：{src}", file=sys.stderr)
        return 2
    im = load(src)
    bg = background(im)
    cols = figure_columns(im, bg)
    if len(cols) != FIGURES:
        print(f"预期 {FIGURES} 个小人，实际找到 {len(cols)}：{cols}", file=sys.stderr)
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    for i, (a, _b) in enumerate(cols):
        fig = extract(im, a, bg)
        path = os.path.join(OUT_DIR, f"door_{i}.png")
        fig.save(path, "PNG", optimize=True)
        print(f"door_{i}.png  {fig.size[0]}x{fig.size[1]}  源 x={a}")
    print(f"完成：{OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())