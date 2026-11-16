#!/usr/bin/env python3
"""生成「黄海海战」用的海洋 / 甲板瓦片集（16×16，8 列）。

为什么要新做一套，而不是拿 `tp_act2` 凑：那张图里唯一的「水」是护城河，
唯一能走的跨水件是木桥；拿木桥拼一片甲板会读成「海上一座长栈桥」，
而且 `MapRenderer` 会给它的每个实心格描一圈灰亮边，整片海被划成网格。
用户这轮的要求是「洋务运动必须要有甲午海战，并且地图是海洋」——
所以水、甲板、舷墙、舰炮、沉船这五样必须各自是画好的瓦片。

**纯标准库**（跟 `gen_units.py` / `gen_portraits.py` 一个路子），任何人
`python tools/gen_sea_tiles.py` 都能重出。输出：

    public/art/tiles/sea/tp_sea_sheet.png      8 列 × 4 行 = 128×64
    public/art/tiles/sea/sea_<name>.png        逐个单图（方便肉眼核对/替换）
    public/art/tiles/sea/tileset.json          登记表（id / 名称 / 说明 / 碰撞建议）

取帧规则与 tp_act2 完全一致：`col = id % 8`、`row = id // 8`、id 0 恒透明。
调色只用 `src/core/constants.ts → PALETTE` 的 24 色，硬边、无半透明渐变。

用法：
    python tools/gen_sea_tiles.py            # 生成全部
    python tools/gen_sea_tiles.py --check    # 只核对已有 sheet 的尺寸与帧数
    python tools/gen_sea_tiles.py --preview  # 额外出一张 4 倍放大预览（tools/_cdp 下，不入库）
"""

from __future__ import annotations

import json
import struct
import sys
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "art" / "tiles" / "sea"
PREVIEW = Path(__file__).resolve().parent / "_cdp"

TILE = 16
COLS = 8
ROWS = 4

# 24 色盘（与 constants.ts PALETTE 逐值一致；这里不放任何新色号）
INK = (0x0D, 0x0B, 0x14)
NIGHT = (0x1C, 0x1A, 0x2B)
PLUM_D = (0x2F, 0x2B, 0x45)
PLUM_M = (0x4A, 0x44, 0x68)
PLUM_L = (0x6B, 0x64, 0x89)
GREY_P = (0x94, 0x8D, 0xAB)
GREY_L = (0xC2, 0xBC, 0xD1)
PAPER = (0xF2, 0xED, 0xE4)
CREAM = (0xE8, 0xCF, 0xA8)
SAND = (0xCF, 0xA2, 0x6A)
BROWN = (0xA8, 0x76, 0x3F)
BROWN_D = (0x7A, 0x4F, 0x2A)
BROWN_DD = (0x4E, 0x2F, 0x1A)
RED_D = (0x8C, 0x1C, 0x1C)
RED = (0xC0, 0x39, 0x2B)
RED_B = (0xE8, 0x5C, 0x4A)
RED_S = (0xF2, 0xA0, 0x8C)
INDIGO = (0x2A, 0x5A, 0x8A)
BLUE = (0x4A, 0x90, 0xC8)
BLUE_L = (0x7B, 0xC0, 0xE8)
STAR = (0xD4, 0xA8, 0x40)


class Canvas:
    """RGBA 画布；`px[y][x]` 为 None 表示透明。"""

    def __init__(self, w: int, h: int) -> None:
        self.w = w
        self.h = h
        self.px: list[list[tuple[int, int, int] | None]] = [[None] * w for _ in range(h)]

    def put(self, x: int, y: int, c: tuple[int, int, int] | None) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def rect(self, x: int, y: int, w: int, h: int, c: tuple[int, int, int] | None) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, c)

    def hline(self, x: int, y: int, w: int, c: tuple[int, int, int]) -> None:
        self.rect(x, y, w, 1, c)

    def vline(self, x: int, y: int, h: int, c: tuple[int, int, int]) -> None:
        self.rect(x, y, 1, h, c)

    def disc(self, cx: int, cy: int, r: int, c: tuple[int, int, int]) -> None:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6:
                    self.put(x, y, c)

    def ring(self, cx: int, cy: int, r: int, c: tuple[int, int, int]) -> None:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                d = (x - cx) ** 2 + (y - cy) ** 2
                if (r - 0.7) ** 2 <= d <= r * r + r * 0.6:
                    self.put(x, y, c)


def h2(x: int, y: int) -> float:
    """稳定的伪随机（同一格永远同一结果，重跑脚本逐像素一致）。"""
    v = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((v ^ (v >> 16)) & 0xFFFFFFFF) / 4294967295


# ---------------------------------------------------------------- 海面

def sea_base(cv: Canvas, ox: int, oy: int, seed: int) -> None:
    """深海底色：整片 INDIGO + 一两道压暗的涌 + 稀疏亮点。

    第一版每格固定画 3 条横暗纹，铺成一片之后横向条纹完全对齐，
    读起来是「马赛克地砖」而不是水。现在纹路条数与位置都由 seed 决定，
    相邻格常常一条纹都不画，整片海才有疏密。
    """
    cv.rect(ox, oy, TILE, TILE, INDIGO)
    n = 1 if h2(seed, 3) > 0.45 else 2
    for i in range(n):
        y = 3 + int(h2(seed, i * 5 + 1) * 10)
        x = int(h2(i + 2, seed) * 9)
        w = 2 + int(h2(seed + i, 7) * 5)
        cv.hline(ox + x, oy + y, w, NIGHT)
        # 暗纹下沿压 1px 更暗的线，水才有厚度（只给一半的格子）
        if h2(seed + i, 9) > 0.5:
            cv.hline(ox + x, oy + y + 1, max(1, w - 2), INK)
    # 浪尖高光：只给一两个像素，多了整片海会闪
    for i in range(2):
        if h2(seed + i * 3, 11) < 0.45:
            continue
        x = 2 + int(h2(seed + i * 3, 11) * 12)
        y = 2 + int(h2(seed + i * 5, 13) * 12)
        cv.put(ox + x, oy + y, BLUE)


def tile_sea_deep_a(cv: Canvas, ox: int, oy: int) -> None:
    # 第一版在这格底部压了一条 1px 暗线，铺开之后每 16px 一道横线，
    # 整片海被划成「蓝色方块阵列」——用户一眼就看出来是马赛克。
    # 海面瓦片**必须四边干净**，纹路只能落在格内、且不能贴边。
    sea_base(cv, ox, oy, 1)


def tile_sea_deep_b(cv: Canvas, ox: int, oy: int) -> None:
    sea_base(cv, ox, oy, 7)
    # 一道斜向的暗涌，打破「全是横线」的规律
    for i in range(5):
        cv.put(ox + 3 + i, oy + 6 + (i // 2), NIGHT)


def tile_sea_wave(cv: Canvas, ox: int, oy: int) -> None:
    """浪脊：一列海浪的波峰，带白沫。铺成一行就是推进的浪线。"""
    sea_base(cv, ox, oy, 3)
    # 波峰：中间高、两头低的三段，读作一道起伏
    cv.hline(ox + 1, oy + 9, 4, BLUE)
    cv.hline(ox + 5, oy + 8, 7, BLUE)
    cv.hline(ox + 12, oy + 9, 3, BLUE)
    cv.hline(ox + 5, oy + 7, 6, BLUE_L)
    cv.put(ox + 7, oy + 6, BLUE_L)
    cv.put(ox + 10, oy + 6, BLUE_L)
    # 波峰下面压暗，浪才有厚度（否则像一条贴上去的亮线）
    cv.hline(ox + 5, oy + 10, 7, NIGHT)
    cv.put(ox + 12, oy + 10, NIGHT)
    cv.put(ox + 1, oy + 10, NIGHT)


def tile_sea_foam(cv: Canvas, ox: int, oy: int) -> None:
    """白沫：舰首切开水面、炮弹落点的碎浪。"""
    sea_base(cv, ox, oy, 5)
    pts = [
        (2, 6), (3, 6), (4, 7), (6, 5), (7, 6), (8, 6),
        (9, 7), (11, 5), (12, 6), (13, 6), (5, 9), (10, 9),
        (3, 10), (12, 10), (7, 11), (8, 11),
    ]
    for x, y in pts:
        cv.put(ox + x, oy + y, PAPER)
    for x, y in [(2, 7), (5, 6), (10, 8), (13, 7), (6, 10), (11, 11)]:
        cv.put(ox + x, oy + y, BLUE_L)


def tile_sea_swell(cv: Canvas, ox: int, oy: int) -> None:
    """涌浪：一段正在抬起来的大浪，底深、顶上一条白沫。

    第一版在 16px 里塞了弧线 + 台阶 + 阴影三层，缩到实际大小读成一团脏色；
    现在只留「一条斜抬的深色浪墙 + 顶端一条白沫」，远看就是一道涌。
    """
    sea_base(cv, ox, oy, 9)
    # 浪墙：左低右高，用两条阶梯描出来（不加内部纹理）
    cv.hline(ox + 2, oy + 11, 7, INK)
    cv.hline(ox + 3, oy + 10, 7, INK)
    cv.hline(ox + 6, oy + 9, 8, INK)
    cv.hline(ox + 9, oy + 8, 6, INK)
    # 浪顶白沫：压在浪墙最高处，右端拖尾
    cv.hline(ox + 9, oy + 7, 6, PAPER)
    cv.hline(ox + 12, oy + 6, 3, BLUE_L)
    cv.put(ox + 10, oy + 6, BLUE_L)
    # 浪谷：浪墙下方压一道更深的水
    cv.hline(ox + 2, oy + 12, 6, NIGHT)
    cv.hline(ox + 8, oy + 10, 3, NIGHT)


# ---------------------------------------------------------------- 甲板

def deck_base(cv: Canvas, ox: int, oy: int, offset: int = 0) -> None:
    """甲板底色：横向木板 + 板缝 + 木纹。offset 用来错开板缝，避免整片对齐。"""
    cv.rect(ox, oy, TILE, TILE, BROWN_D)
    for y in (offset, offset + 8):
        if 0 <= y < TILE:
            cv.hline(ox, oy + y, TILE, BROWN_DD)
            cv.hline(ox, oy + y + 1, TILE, BROWN)
    # 木纹：每格两道短亮线（三道的版本铺满全屏后偏橙，像地板蜡）
    for i in range(2):
        y = 2 + int(h2(offset + 1, i) * 12)
        x = 1 + int(h2(i, offset + 3) * 10)
        w = 2 + int(h2(i * 3, offset + 5) * 4)
        cv.hline(ox + x, oy + y, w, BROWN)


def tile_deck_a(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 0)


def tile_deck_b(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 4)


def tile_deck_seam(cv: Canvas, ox: int, oy: int) -> None:
    """甲板接缝：一道纵向暗拼缝 + 稀疏铁钉。

    第一版是 GREY_L 亮钉每 4px 一对、成列铺满整船，实拍出来是一排贯穿甲板的
    亮虚线，像没关掉的网格辅助线（和海面「蓝色方块阵列」同类观感问题）。
    现在缝只留一道暗棕、钉子降成中灰且每格两颗错列，远看读作木板拼缝。
    """
    deck_base(cv, ox, oy, 0)
    cv.vline(ox + 7, oy, TILE, BROWN_DD)
    cv.put(ox + 6, oy + 4, GREY_P)
    cv.put(ox + 9, oy + 12, GREY_P)


def _wall_band(cv: Canvas, ox: int, oy: int, side: str) -> None:
    """舷墙：5px 厚的木围沿，外侧一条白浪，读作「船压在水里」。

    4px 时俯视几乎看不出厚度，甲板和海像两块贴纸拼在一起；
    加厚到 5px 再在外侧补 1px 白沫，边界立刻有「这条船浮在水上」的体积感。
    """
    band = 5
    if side == "n":
        cv.rect(ox, oy, TILE, band, INK)
        cv.hline(ox, oy + 1, TILE, BROWN_D)
        cv.hline(ox, oy + 2, TILE, BROWN)
        cv.hline(ox, oy + 3, TILE, BROWN_D)
        cv.hline(ox, oy + 4, TILE, BROWN_DD)
        for x in (1, 9):
            cv.vline(ox + x, oy + 1, band - 1, GREY_P)
    elif side == "s":
        cv.rect(ox, oy + TILE - band, TILE, band, INK)
        cv.hline(ox, oy + TILE - 5, TILE, BROWN_D)
        cv.hline(ox, oy + TILE - 4, TILE, BROWN)
        cv.hline(ox, oy + TILE - 3, TILE, BROWN_D)
        cv.hline(ox, oy + TILE - 2, TILE, BROWN_DD)
        for x in (1, 9):
            cv.vline(ox + x, oy + TILE - 4, band - 1, GREY_P)
        # 外侧白浪
        cv.hline(ox + 1, oy + TILE - 1, TILE - 2, BLUE_L)
    elif side == "w":
        cv.rect(ox, oy, band, TILE, INK)
        cv.vline(ox + 1, oy, TILE, BROWN_D)
        cv.vline(ox + 2, oy, TILE, BROWN)
        cv.vline(ox + 3, oy, TILE, BROWN_D)
        cv.vline(ox + 4, oy, TILE, BROWN_DD)
        for y in (1, 9):
            cv.hline(ox + 1, oy + y, band - 1, GREY_P)
        cv.vline(ox, oy + 1, TILE - 2, BLUE_L)
    elif side == "e":
        cv.rect(ox + TILE - band, oy, band, TILE, INK)
        cv.vline(ox + TILE - 5, oy, TILE, BROWN_D)
        cv.vline(ox + TILE - 4, oy, TILE, BROWN)
        cv.vline(ox + TILE - 3, oy, TILE, BROWN_D)
        cv.vline(ox + TILE - 2, oy, TILE, BROWN_DD)
        for y in (1, 9):
            cv.hline(ox + TILE - 4, oy + y, band - 1, GREY_P)
        cv.vline(ox + TILE - 1, oy + 1, TILE - 2, BLUE_L)


def tile_edge_n(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 0)
    _wall_band(cv, ox, oy, "n")


def tile_edge_s(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 4)
    _wall_band(cv, ox, oy, "s")


def tile_edge_w(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 0)
    _wall_band(cv, ox, oy, "w")


def tile_edge_e(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 4)
    _wall_band(cv, ox, oy, "e")


def tile_corner_nw(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 0)
    _wall_band(cv, ox, oy, "n")
    _wall_band(cv, ox, oy, "w")


def tile_corner_ne(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 0)
    _wall_band(cv, ox, oy, "n")
    _wall_band(cv, ox, oy, "e")


def tile_corner_sw(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 4)
    _wall_band(cv, ox, oy, "s")
    _wall_band(cv, ox, oy, "w")


def tile_corner_se(cv: Canvas, ox: int, oy: int) -> None:
    deck_base(cv, ox, oy, 4)
    _wall_band(cv, ox, oy, "s")
    _wall_band(cv, ox, oy, "e")


# ---------------------------------------------------------------- 甲板上的东西

def tile_gun(cv: Canvas, ox: int, oy: int) -> None:
    """炮位：可转动的圆炮座（定远舰 305mm 主炮的俯视读法）。

    辨识度靠三件事：炮座压一块深色底、炮管又长又亮地伸出右舷、末端有加粗的炮口。
    第一版炮管只有 2px 宽且和炮座同色系，远看读成一个「井盖」——已改。
    """
    deck_base(cv, ox, oy, 0)
    cv.disc(ox + 8, oy + 8, 6, INK)
    cv.disc(ox + 8, oy + 8, 5, PLUM_D)
    cv.ring(ox + 8, oy + 8, 5, PLUM_M)
    # 炮管：指向右舷（海图里敌人来自右侧），长到压住格子右沿
    cv.rect(ox + 9, oy + 7, 6, 3, INK)
    cv.rect(ox + 9, oy + 7, 6, 2, PLUM_M)
    cv.hline(ox + 9, oy + 7, 6, GREY_L)
    # 炮口加粗
    cv.rect(ox + 14, oy + 6, 2, 5, INK)
    cv.put(ox + 14, oy + 7, PLUM_L)
    cv.put(ox + 14, oy + 8, PLUM_L)
    # 炮座顶盖与铆钉
    cv.disc(ox + 8, oy + 8, 3, PLUM_M)
    cv.disc(ox + 8, oy + 8, 2, PLUM_L)
    cv.put(ox + 8, oy + 8, GREY_P)
    for x, y in [(3, 8), (13, 8), (8, 3), (8, 13)]:
        cv.put(ox + x, oy + y, GREY_P)


def tile_cannon(cv: Canvas, ox: int, oy: int) -> None:
    """侧舷炮：炮架 + 炮管伸出舷外，带一只轮子。"""
    deck_base(cv, ox, oy, 4)
    cv.rect(ox + 2, oy + 8, 7, 5, BROWN_DD)
    cv.rect(ox + 3, oy + 9, 5, 3, BROWN_D)
    # 炮管
    cv.rect(ox + 8, oy + 8, 7, 2, INK)
    cv.rect(ox + 9, oy + 8, 5, 1, PLUM_L)
    # 轮子
    cv.disc(ox + 4, oy + 13, 2, PLUM_D)
    cv.put(ox + 4, oy + 13, GREY_P)
    # 炮弹
    cv.put(ox + 13, oy + 12, INK)
    cv.put(ox + 12, oy + 12, PLUM_M)


def tile_hatch(cv: Canvas, ox: int, oy: int) -> None:
    """舱口：方形的铁盖格栅（阻挡，读作「这里不能踩」）。

    第一版画成圆环，俯视缩小后就是一个「井盖」，和炮位分不清；改成方盖 + 四角铁钉。
    """
    deck_base(cv, ox, oy, 0)
    cv.rect(ox + 1, oy + 1, 14, 14, INK)
    cv.rect(ox + 2, oy + 2, 12, 12, PLUM_D)
    for y in range(4, 14, 3):
        cv.hline(ox + 3, oy + y, 10, PLUM_M)
    cv.vline(ox + 8, oy + 3, 10, PLUM_M)
    # 四角铁钉 + 一圈亮沿
    for x, y in [(2, 2), (13, 2), (2, 13), (13, 13)]:
        cv.put(ox + x, oy + y, GREY_L)
    cv.hline(ox + 2, oy + 2, 12, PLUM_L)


def tile_mast(cv: Canvas, ox: int, oy: int) -> None:
    """桅杆基座：一圈铁箍 + 中间的桅杆。"""
    deck_base(cv, ox, oy, 4)
    cv.disc(ox + 8, oy + 8, 5, BROWN_DD)
    cv.disc(ox + 8, oy + 8, 4, BROWN)
    cv.rect(ox + 6, oy + 5, 4, 7, BROWN_D)
    cv.rect(ox + 7, oy + 4, 2, 9, BROWN)
    cv.put(ox + 7, oy + 4, CREAM)
    for x, y in [(2, 8), (13, 8), (8, 2), (8, 13)]:
        cv.put(ox + x, oy + y, GREY_L)


def tile_funnel(cv: Canvas, ox: int, oy: int) -> None:
    """烟囱：黑铁筒 + 红漆环 + 冒烟口。"""
    deck_base(cv, ox, oy, 0)
    cv.rect(ox + 4, oy + 3, 8, 10, INK)
    cv.rect(ox + 5, oy + 4, 6, 8, PLUM_D)
    cv.vline(ox + 5, oy + 4, 8, PLUM_L)
    cv.hline(ox + 4, oy + 3, 8, PLUM_M)
    cv.hline(ox + 4, oy + 6, 8, RED_D)
    cv.hline(ox + 4, oy + 7, 8, RED)
    cv.hline(ox + 4, oy + 12, 8, INK)


def tile_ammo(cv: Canvas, ox: int, oy: int) -> None:
    """弹药箱：可以当掩体；箱盖上画炮弹头。"""
    deck_base(cv, ox, oy, 4)
    cv.rect(ox + 2, oy + 5, 12, 9, BROWN_DD)
    cv.rect(ox + 3, oy + 6, 10, 7, BROWN)
    cv.hline(ox + 3, oy + 6, 10, SAND)
    cv.vline(ox + 5, oy + 6, 7, BROWN_DD)
    cv.vline(ox + 10, oy + 6, 7, BROWN_DD)
    cv.rect(ox + 3, oy + 9, 10, 1, BROWN_DD)
    # 露出来的两颗炮弹
    cv.disc(ox + 6, oy + 3, 1, INK)
    cv.put(ox + 10, oy + 2, INK)
    cv.put(ox + 11, oy + 3, INK)


# ---------------------------------------------------------------- 海面杂物

def tile_wreck(cv: Canvas, ox: int, oy: int) -> None:
    """沉船残骸：半沉的船肋 + 油污与碎浪。"""
    sea_base(cv, ox, oy, 11)
    cv.rect(ox, oy + 9, TILE, 5, NIGHT)
    # 露出水面的船肋：三段不等高的木板
    cv.rect(ox + 2, oy + 7, 3, 4, BROWN_D)
    cv.hline(ox + 2, oy + 7, 3, BROWN)
    cv.rect(ox + 6, oy + 5, 2, 6, BROWN_D)
    cv.put(ox + 6, oy + 5, BROWN)
    cv.rect(ox + 9, oy + 8, 4, 3, BROWN_D)
    cv.hline(ox + 9, oy + 8, 4, BROWN)
    # 水线白沫
    cv.hline(ox + 1, oy + 11, 5, BLUE_L)
    cv.hline(ox + 8, oy + 12, 5, BLUE_L)
    cv.put(ox + 14, oy + 10, PAPER)
    # 折断的桅杆斜插着
    for i in range(5):
        cv.put(ox + 12 + i // 2, oy + 6 - i, PLUM_M)


def tile_rock(cv: Canvas, ox: int, oy: int) -> None:
    """礁石：浪打上去的黑色礁体（黄海沿岸的礁）。"""
    sea_base(cv, ox, oy, 13)
    cv.rect(ox + 3, oy + 7, 10, 7, PLUM_D)
    cv.hline(ox + 3, oy + 7, 10, PLUM_M)
    cv.rect(ox + 5, oy + 5, 6, 3, PLUM_D)
    cv.hline(ox + 5, oy + 5, 6, PLUM_M)
    cv.hline(ox + 6, oy + 4, 3, PLUM_M)
    # 受光的棱面
    cv.hline(ox + 5, oy + 6, 5, PLUM_L)
    cv.vline(ox + 5, oy + 7, 5, PLUM_M)
    # 撞在礁上的白沫
    cv.hline(ox + 2, oy + 12, 5, PAPER)
    cv.hline(ox + 9, oy + 13, 5, BLUE_L)
    cv.put(ox + 13, oy + 8, BLUE_L)


# ---------------------------------------------------------------- 登记表

TILESET: list[tuple[str, str, str, bool, str]] = [
    # (name, 中文名, 类别, 建议阻挡, 说明)
    ("sea_deep_a", "深海·基", "terrain", True, "海面底色，可平铺；海一律不可走"),
    ("sea_deep_b", "深海·变体", "terrain", True, "换一处暗涌，打散平铺规律"),
    ("sea_wave", "浪脊", "terrain", True, "一列波峰，横排铺出推进的浪线"),
    ("sea_foam", "白沫", "terrain", True, "舰首切水、炮弹落点的碎浪"),
    ("sea_swell", "涌浪", "terrain", True, "正在抬起来的大浪，底深顶白"),
    ("deck_a", "甲板·横板", "deck", False, "可走；横向板缝 + 木纹"),
    ("deck_b", "甲板·错缝", "deck", False, "可走；板缝错开 4px"),
    ("deck_seam", "甲板·接缝", "deck", False, "可走；纵向拼缝 + 铁钉"),
    ("deck_edge_n", "舷墙·上", "deck", True, "4px 木围沿，挡住玩家下海"),
    ("deck_edge_s", "舷墙·下", "deck", True, "同上，朝下"),
    ("deck_edge_w", "舷墙·左", "deck", True, "舰尾方向"),
    ("deck_edge_e", "舷墙·右", "deck", True, "对敌方向，Boss 舰贴在这一侧"),
    ("deck_corner_nw", "舷角·左上", "deck", True, "两向舷墙相接"),
    ("deck_corner_ne", "舷角·右上", "deck", True, "两向舷墙相接"),
    ("deck_corner_sw", "舷角·左下", "deck", True, "两向舷墙相接"),
    ("deck_corner_se", "舷角·右下", "deck", True, "两向舷墙相接"),
    ("deck_gun", "主炮位", "prop", True, "圆炮座 + 炮管朝右（定远 305mm）"),
    ("deck_cannon", "侧舷炮", "prop", True, "炮架 + 伸出舷外的炮管"),
    ("hatch", "舱口格栅", "prop", True, "往下开的舱口，阻挡"),
    ("mast", "桅杆基座", "prop", True, "铁箍 + 桅杆，阻挡"),
    ("funnel", "烟囱", "prop", True, "黑铁筒 + 红漆环，阻挡"),
    ("ammo", "弹药箱", "prop", True, "可当掩体的木箱，阻挡"),
    ("wreck", "沉船残骸", "deco", True, "半沉的船肋与断桅，海面装饰"),
    ("rock", "礁石", "deco", True, "黑礁 + 撞上去的白沫"),
]

DRAW: dict[str, object] = {
    "sea_deep_a": tile_sea_deep_a,
    "sea_deep_b": tile_sea_deep_b,
    "sea_wave": tile_sea_wave,
    "sea_foam": tile_sea_foam,
    "sea_swell": tile_sea_swell,
    "deck_a": tile_deck_a,
    "deck_b": tile_deck_b,
    "deck_seam": tile_deck_seam,
    "deck_edge_n": tile_edge_n,
    "deck_edge_s": tile_edge_s,
    "deck_edge_w": tile_edge_w,
    "deck_edge_e": tile_edge_e,
    "deck_corner_nw": tile_corner_nw,
    "deck_corner_ne": tile_corner_ne,
    "deck_corner_sw": tile_corner_sw,
    "deck_corner_se": tile_corner_se,
    "deck_gun": tile_gun,
    "deck_cannon": tile_cannon,
    "hatch": tile_hatch,
    "mast": tile_mast,
    "funnel": tile_funnel,
    "ammo": tile_ammo,
    "wreck": tile_wreck,
    "rock": tile_rock,
}


def png_bytes(w: int, h: int, cv: Canvas) -> bytes:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            c = cv.px[y][x]
            raw += bytes((c[0], c[1], c[2], 255)) if c is not None else b"\x00\x00\x00\x00"

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def build() -> Canvas:
    sheet = Canvas(COLS * TILE, ROWS * TILE)
    for i, (name, _cn, _cat, _solid, _note) in enumerate(TILESET, start=1):
        cv = Canvas(TILE, TILE)
        DRAW[name](cv, 0, 0)  # type: ignore[operator]
        col, row = i % COLS, i // COLS
        for y in range(TILE):
            for x in range(TILE):
                sheet.put(col * TILE + x, row * TILE + y, cv.px[y][x])
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"sea_{name}.png").write_bytes(png_bytes(TILE, TILE, cv))
    return sheet


def write_tileset() -> None:
    tiles = [
        {
            "id": i,
            "name": name,
            "cn": cn,
            "category": cat,
            "file": f"sea_{name}.png",
            "sheet_cell": {"col": i % COLS, "row": i // COLS},
            "layer": "ground",
            "scenes": ["sea"],
            "collidable": solid,
            "note": note,
        }
        for i, (name, cn, cat, solid, note) in enumerate(TILESET, start=1)
    ]
    doc = {
        "name": "tp_sea",
        "version": "1.0",
        "description": "序章第三幕「黄海海战」专用图块集：海面 / 甲板 / 舷墙 / 舰炮 / 海面杂物",
        "engine": "Phaser 3 (MapDef JSON)",
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilecount": len(tiles) + 1,
        "columns": COLS,
        "image": "tp_sea_sheet.png",
        "imagewidth": COLS * TILE,
        "imageheight": ROWS * TILE,
        "margin": 0,
        "spacing": 0,
        "id_zero": "透明（不画）",
        "indexing": "col = id % 8, row = id // 8（与 tp_act2 同一规则）",
        "generator": "tools/gen_sea_tiles.py",
        "palette": "仅用 src/core/constants.ts → PALETTE 的 24 色，硬边、无半透明渐变",
        "tiles": tiles,
    }
    (OUT / "tileset.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def preview(sheet: Canvas) -> None:
    """4 倍放大 + 网格线，方便肉眼核对外形（写到 tools/_cdp，不入库）。"""
    scale = 4
    w, h = sheet.w * scale, sheet.h * scale
    big = Canvas(w, h)
    for y in range(sheet.h):
        for x in range(sheet.w):
            c = sheet.px[y][x]
            if c is None:
                c = (0x20, 0x20, 0x28)
            for dy in range(scale):
                for dx in range(scale):
                    big.put(x * scale + dx, y * scale + dy, c)
    for x in range(0, w, TILE * scale):
        big.vline(x, 0, h, (0xFF, 0x00, 0xFF))
    for y in range(0, h, TILE * scale):
        big.hline(0, y, w, (0xFF, 0x00, 0xFF))
    PREVIEW.mkdir(parents=True, exist_ok=True)
    (PREVIEW / "sea_tiles_preview.png").write_bytes(png_bytes(w, h, big))
    print(f"preview -> {PREVIEW / 'sea_tiles_preview.png'}")


def main(argv: list[str]) -> int:
    if "--check" in argv:
        p = OUT / "tp_sea_sheet.png"
        if not p.exists():
            print("缺少 tp_sea_sheet.png，先不带参数跑一次")
            return 1
        import binascii

        data = p.read_bytes()
        w, h = struct.unpack(">II", data[16:24])
        ok = (w, h) == (COLS * TILE, ROWS * TILE)
        print(f"sheet {w}×{h}  tiles={len(TILESET)}  预期 {COLS * TILE}×{ROWS * TILE} -> {'OK' if ok else 'FAIL'}")
        _ = binascii
        return 0 if ok else 1

    sheet = build()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tp_sea_sheet.png").write_bytes(png_bytes(sheet.w, sheet.h, sheet))
    write_tileset()
    print(f"tp_sea: {len(TILESET)} 块 -> {OUT}")
    if "--preview" in argv:
        preview(sheet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
