#!/usr/bin/env python3
"""生成「洋务运动及之后」专用的第三套瓦片集 tp_late_qing（16×16，8 列）。

为什么必须新做一套：第三幕（江南制造总局）、第四幕（北京南海会馆）、
第五幕（武昌总督衙门）原来全都复用第二幕的 `tp_act2` 天京地图 —— 那套图是
1851—1864 年的乡野 / 城池 / 战场：草坡、山林、护城河、木桥、太平军营垒。
拿它铺 1865 年的机器局、1898 年的北京胡同、1911 年的总督衙门，时代是错的。
用户这轮的要求是「重做洋务运动时期及之后的所有地图资源，确保风格与历史背景一致」，
所以石板巷、青砖墙、灰瓦门楼、朱红大门、机器与锅炉、铁轨、电线杆、路灯、
街垒与新军旗，都得各自是画好的瓦片，而不是改配色。

**纯标准库**（和 `gen_units.py` / `gen_sea_tiles.py` 一路），任何人
`python tools/gen_late_qing_tiles.py` 都能重出。输出：

    public/art/tiles/late_qing/tp_late_qing_sheet.png   8 列 × 5 行 = 128×80
    public/art/tiles/late_qing/lq_<name>.png            36 张单图
    public/art/tiles/late_qing/tileset.json             登记表

取帧规则与前两套一致：`col = id % 8`、`row = id // 8`、id 0 恒透明。
调色只用 `src/core/constants.ts → PALETTE` 的 24 色，硬边、无半透明渐变。

用法：
    python tools/gen_late_qing_tiles.py            # 全部重出
    python tools/gen_late_qing_tiles.py --check    # 只核对 sheet 尺寸与帧数
    python tools/gen_late_qing_tiles.py --preview  # 额外出 4 倍放大预览（不入库）
"""

from __future__ import annotations

import json
import struct
import sys
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "art" / "tiles" / "late_qing"
PREVIEW = Path(__file__).resolve().parent / "_cdp"

TILE = 16
COLS = 8
ROWS = 5

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
        self.w, self.h = w, h
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
    """稳定伪随机：同一格永远同一结果，重跑脚本逐像素一致。"""
    v = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((v ^ (v >> 16)) & 0xFFFFFFFF) / 4294967295


# ---------------------------------------------------------------- 地面底子

def stone_base(cv: Canvas, ox: int, oy: int, seed: int) -> None:
    """青石板：整块 PLUM_L + 交错的深砖缝，缝不要每格都在同一位置。"""
    cv.rect(ox, oy, TILE, TILE, PLUM_L)
    off = 3 + (seed % 3) * 3
    cv.hline(ox, oy + 7, TILE, PLUM_D)
    cv.hline(ox, oy + 15, TILE, PLUM_D)
    cv.vline(ox + off, oy, 7, PLUM_D)
    cv.vline(ox + (off + 6) % 15, oy + 8, 7, PLUM_D)
    cv.hline(ox + 1, oy + 1, 6, GREY_P)
    if h2(seed, 11) > 0.5:
        cv.put(ox + 11, oy + 11, GREY_P)


def brick_floor_base(cv: Canvas, ox: int, oy: int) -> None:
    """厂房红砖地：暗棕底 + 错缝的浅砖面。"""
    cv.rect(ox, oy, TILE, TILE, BROWN_D)
    for yy in (2, 8, 14):
        cv.hline(ox, oy + yy, TILE, BROWN_DD)
    for row, yy in enumerate((2, 8, 14)):
        off = 0 if row % 2 == 0 else 4
        for xx in range(off, TILE, 8):
            cv.vline(ox + xx, oy + yy - 6, 6, BROWN_DD)
    cv.hline(ox + 2, oy + 4, 4, BROWN)
    cv.hline(ox + 9, oy + 10, 4, BROWN)


# ---------------------------------------------------------------- 36 块瓦片

def d_stone_a(cv, ox, oy):
    stone_base(cv, ox, oy, 1)


def d_stone_b(cv, ox, oy):
    stone_base(cv, ox, oy, 5)
    cv.hline(ox + 4, oy + 3, 5, GREY_P)


def d_cobble(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_M)
    for gy in range(0, TILE, 4):
        for gx in range(0, TILE, 4):
            k = h2(gx + ox, gy + oy)
            c = GREY_P if k > 0.62 else (PLUM_L if k > 0.3 else PLUM_D)
            cv.rect(ox + gx + 1, oy + gy + 1, 2, 2, c)
    cv.put(ox + 6, oy + 9, INK)


def d_brick_floor(cv, ox, oy):
    brick_floor_base(cv, ox, oy)


def d_cement(cv, ox, oy):
    """洋式水泥地：浅灰大分格，江南制造局新厂房。"""
    cv.rect(ox, oy, TILE, TILE, GREY_L)
    cv.hline(ox, oy + 8, TILE, GREY_P)
    cv.vline(ox + 8, oy, TILE, GREY_P)
    cv.hline(ox + 1, oy + 1, 6, PAPER)
    cv.hline(ox + 9, oy + 9, 5, PAPER)
    cv.put(ox + 7, oy + 7, PLUM_D)


def d_plank(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, BROWN)
    for yy in (5, 11):
        cv.hline(ox, oy + yy, TILE, BROWN_DD)
        cv.hline(ox, oy + yy + 1, TILE, BROWN_D)
    for xx in (3, 12):
        cv.put(ox + xx, oy + 2, STAR)
        cv.put(ox + xx, oy + 8, STAR)
    cv.hline(ox + 5, oy + 3, 4, SAND)


def d_track(cv, ox, oy):
    """厂内窄轨：枕木 + 两条亮铁轨，横向铺。"""
    brick_floor_base(cv, ox, oy)
    for xx in range(1, TILE, 4):
        cv.rect(ox + xx, oy + 1, 2, 14, BROWN_DD)
    cv.hline(ox, oy + 5, TILE, GREY_L)
    cv.hline(ox, oy + 10, TILE, GREY_L)
    cv.hline(ox, oy + 6, TILE, PLUM_D)
    cv.hline(ox, oy + 11, TILE, PLUM_D)


def d_drain(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_M)
    cv.rect(ox + 2, oy + 4, 12, 8, INDIGO)
    cv.hline(ox + 2, oy + 3, 12, GREY_L)
    cv.hline(ox + 2, oy + 12, 12, GREY_L)
    cv.hline(ox + 3, oy + 7, 5, BLUE_L)
    cv.hline(ox + 9, oy + 9, 4, BLUE_L)


def d_grass_edge(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_L)
    cv.rect(ox, oy, TILE, 4, PLUM_M)
    for x in range(0, TILE, 2):
        if h2(x, oy) > 0.42:
            cv.put(ox + x, oy + 2 + int(h2(x + 3, oy) * 3), GREY_P)
            cv.put(ox + x, oy + 3 + int(h2(x + 3, oy) * 3), PLUM_D)
    cv.hline(ox, oy + 5, TILE, PLUM_D)


def d_brick_wall(cv, ox, oy):
    """青砖墙：横缝 + 交错竖缝，实心。"""
    cv.rect(ox, oy, TILE, TILE, PLUM_D)
    for yy in (0, 4, 8, 12):
        cv.hline(ox, oy + yy, TILE, INK)
        cv.hline(ox, oy + yy + 1, TILE, PLUM_M)
    for row in range(4):
        off = 0 if row % 2 == 0 else 5
        for xx in range(off, TILE, 10):
            cv.vline(ox + xx, oy + row * 4 + 1, 3, INK)


def d_brick_wall_win(cv, ox, oy):
    d_brick_wall(cv, ox, oy)
    cv.rect(ox + 4, oy + 4, 9, 8, BROWN_DD)
    cv.rect(ox + 5, oy + 5, 7, 6, GREY_L)
    cv.vline(ox + 8, oy + 5, 6, INK)
    cv.hline(ox + 5, oy + 8, 7, INK)
    cv.hline(ox + 5, oy + 5, 7, PAPER)


def d_tile_roof(cv, ox, oy):
    """灰瓦屋顶（俯视）：竖向瓦垄，行尾错开。"""
    cv.rect(ox, oy, TILE, TILE, PLUM_D)
    for x in range(0, TILE, 3):
        cv.vline(ox + x, oy, TILE, PLUM_L)
        cv.vline(ox + x + 1, oy, TILE, NIGHT)
    for yy in (4, 10):
        cv.hline(ox, oy + yy, TILE, PLUM_M)
        for x in range(0, TILE, 3):
            cv.put(ox + x, oy + yy, GREY_P)


def d_roof_edge(cv, ox, oy):
    d_tile_roof(cv, ox, oy)
    cv.rect(ox, oy + 10, TILE, 6, RED_D)
    for x in range(1, TILE, 4):
        cv.rect(ox + x, oy + 11, 2, 5, RED)
        cv.put(ox + x, oy + 11, STAR)
    cv.hline(ox, oy + 9, TILE, INK)


def d_red_pillar(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_M)
    cv.rect(ox + 5, oy, 6, TILE, RED_D)
    cv.vline(ox + 6, oy, TILE, RED)
    cv.vline(ox + 10, oy, TILE, INK)
    cv.rect(ox + 4, oy, 8, 2, STAR)
    cv.rect(ox + 4, oy + 14, 8, 2, STAR)


def d_gate(cv, ox, oy):
    """朱红大门 + 门钉：衙门与会馆的正门。"""
    cv.rect(ox, oy, TILE, TILE, BROWN_DD)
    cv.rect(ox + 1, oy + 1, 14, 15, RED_D)
    cv.vline(ox + 8, oy + 1, 15, INK)
    for yy in (4, 8, 12):
        for xx in (3, 6, 10, 13):
            cv.put(ox + xx, oy + yy, STAR)
            cv.put(ox + xx, oy + yy + 1, BROWN_DD)
    cv.ring(ox + 6, oy + 9, 1, CREAM)
    cv.ring(ox + 10, oy + 9, 1, CREAM)
    cv.hline(ox, oy, TILE, BROWN_DD)


def d_lattice(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, BROWN_DD)
    cv.rect(ox + 1, oy + 1, 14, 14, GREY_L)
    for xx in (4, 8, 12):
        cv.vline(ox + xx, oy + 1, 14, BROWN_DD)
    for yy in (4, 8, 12):
        cv.hline(ox + 1, oy + yy, 14, BROWN_DD)
    cv.hline(ox + 2, oy + 2, 12, PAPER)


def d_plaque(cv, ox, oy):
    """门匾：金框黑底，几条金线示意题字（不写可辨字）。"""
    cv.rect(ox, oy, TILE, TILE, PLUM_M)
    cv.rect(ox + 1, oy + 3, 14, 10, BROWN_D)
    cv.rect(ox + 2, oy + 4, 12, 8, NIGHT)
    cv.hline(ox + 2, oy + 4, 12, STAR)
    cv.hline(ox + 2, oy + 11, 12, STAR)
    for x in (4, 7, 10):
        cv.vline(ox + x, oy + 6, 4, STAR)
        cv.put(ox + x, oy + 10, CREAM)


def d_lantern(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_M)
    cv.vline(ox + 8, oy, 3, BROWN_DD)
    cv.disc(ox + 8, oy + 8, 5, RED_D)
    cv.disc(ox + 8, oy + 8, 4, RED)
    cv.hline(ox + 5, oy + 7, 6, RED_B)
    cv.hline(ox + 6, oy + 3, 4, STAR)
    cv.hline(ox + 6, oy + 12, 4, STAR)
    cv.vline(ox + 8, oy + 13, 3, STAR)
    cv.hline(ox + 4, oy + 4, 8, INK)


def d_notice(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_M)
    cv.rect(ox + 2, oy + 1, 12, 13, BROWN_D)
    cv.rect(ox + 3, oy + 2, 10, 11, PAPER)
    for yy in (4, 6, 8, 10):
        cv.hline(ox + 4, oy + yy, 8 - (yy % 3), INK)
    cv.hline(ox + 3, oy + 2, 10, CREAM)
    cv.vline(ox + 7, oy + 13, 3, BROWN_DD)


def d_tree(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_L)
    cv.rect(ox + 7, oy + 8, 3, 8, BROWN_DD)
    cv.disc(ox + 8, oy + 6, 6, PLUM_D)
    cv.disc(ox + 5, oy + 4, 3, GREY_P)
    cv.disc(ox + 11, oy + 5, 3, PLUM_M)
    cv.put(ox + 8, oy + 2, GREY_P)
    cv.hline(ox, oy + 15, TILE, PLUM_D)


def d_machine(cv, ox, oy):
    """车床：机座 + 齿轮 + 皮带轮，江南制造总局的主角。"""
    brick_floor_base(cv, ox, oy)
    cv.rect(ox + 2, oy + 9, 12, 5, PLUM_D)
    cv.rect(ox + 3, oy + 9, 10, 1, GREY_P)
    cv.disc(ox + 5, oy + 6, 4, GREY_P)
    cv.ring(ox + 5, oy + 6, 4, INK)
    cv.disc(ox + 5, oy + 6, 1, PLUM_D)
    cv.disc(ox + 12, oy + 7, 3, STAR)
    cv.ring(ox + 12, oy + 7, 3, BROWN_DD)
    cv.hline(ox + 7, oy + 4, 6, NIGHT)
    cv.rect(ox + 8, oy + 2, 3, 3, GREY_L)


def d_boiler(cv, ox, oy):
    brick_floor_base(cv, ox, oy)
    cv.rect(ox + 2, oy + 3, 12, 11, GREY_P)
    cv.rect(ox + 2, oy + 3, 12, 2, GREY_L)
    cv.hline(ox + 2, oy + 7, 12, INK)
    cv.hline(ox + 2, oy + 11, 12, INK)
    cv.disc(ox + 8, oy + 6, 2, RED_B)
    cv.ring(ox + 8, oy + 6, 2, STAR)
    cv.put(ox + 11, oy + 1, PAPER)
    cv.put(ox + 13, oy, PAPER)
    cv.rect(ox + 1, oy + 13, 14, 2, PLUM_D)


def d_chimney(cv, ox, oy):
    brick_floor_base(cv, ox, oy)
    cv.rect(ox + 4, oy + 4, 8, 12, BROWN_D)
    for yy in (6, 9, 12):
        cv.hline(ox + 4, oy + yy, 8, BROWN_DD)
    cv.rect(ox + 3, oy + 2, 10, 3, GREY_P)
    cv.rect(ox + 4, oy + 3, 8, 2, INK)
    cv.put(ox + 6, oy, GREY_L)
    cv.put(ox + 9, oy + 1, GREY_L)
    cv.put(ox + 11, oy, GREY_P)


def d_pipe(cv, ox, oy):
    brick_floor_base(cv, ox, oy)
    cv.rect(ox, oy + 5, TILE, 5, GREY_P)
    cv.hline(ox, oy + 5, TILE, GREY_L)
    cv.hline(ox, oy + 9, TILE, INK)
    cv.rect(ox + 5, oy + 4, 2, 7, STAR)
    cv.rect(ox + 12, oy + 4, 2, 7, STAR)
    cv.put(ox + 2, oy + 6, PAPER)


def d_crate(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, None)
    cv.rect(ox + 2, oy + 3, 12, 11, BROWN_D)
    cv.rect(ox + 3, oy + 4, 10, 9, BROWN)
    cv.hline(ox + 2, oy + 3, 12, BROWN_DD)
    cv.vline(ox + 2, oy + 3, 11, BROWN_DD)
    cv.vline(ox + 13, oy + 3, 11, BROWN_DD)
    cv.hline(ox + 2, oy + 13, 12, BROWN_DD)
    for a, b in ((3, 4), (12, 13), (3, 13), (12, 4)):
        cv.put(ox + a, oy + b, STAR)
    cv.hline(ox + 4, oy + 8, 8, SAND)


def d_cannon_part(cv, ox, oy):
    """刚铸好的炮管，横搁在木架上（江南制造局造炮）。"""
    brick_floor_base(cv, ox, oy)
    cv.rect(ox + 1, oy + 6, 14, 4, PLUM_D)
    cv.rect(ox + 1, oy + 6, 14, 1, GREY_P)
    cv.rect(ox + 13, oy + 5, 2, 6, NIGHT)
    cv.rect(ox + 1, oy + 10, 3, 4, BROWN_D)
    cv.rect(ox + 10, oy + 10, 3, 4, BROWN_D)
    cv.hline(ox + 1, oy + 14, 3, BROWN_DD)
    cv.hline(ox + 10, oy + 14, 3, BROWN_DD)
    cv.put(ox + 6, oy + 7, GREY_L)


def d_rail_cart(cv, ox, oy):
    d_track(cv, ox, oy)
    cv.rect(ox + 2, oy + 3, 12, 7, BROWN_D)
    cv.rect(ox + 3, oy + 4, 10, 5, BROWN)
    cv.disc(ox + 4, oy + 11, 2, NIGHT)
    cv.disc(ox + 12, oy + 11, 2, NIGHT)
    cv.hline(ox + 2, oy + 3, 12, SAND)


def d_coal(cv, ox, oy):
    brick_floor_base(cv, ox, oy)
    cv.disc(ox + 8, oy + 10, 6, NIGHT)
    cv.disc(ox + 5, oy + 8, 3, PLUM_D)
    cv.disc(ox + 12, oy + 9, 3, PLUM_D)
    for x, y in ((6, 7), (9, 6), (11, 11), (4, 11)):
        cv.put(ox + x, oy + y, GREY_P)


def d_telegraph(cv, ox, oy):
    stone_base(cv, ox, oy, 2)
    cv.rect(ox + 7, oy + 1, 2, 15, BROWN_D)
    cv.hline(ox + 3, oy + 4, 10, BROWN_DD)
    cv.hline(ox + 3, oy + 6, 10, BROWN_DD)
    cv.hline(ox, oy + 3, TILE, INK)
    cv.hline(ox, oy + 6, TILE, INK)
    cv.put(ox + 4, oy + 3, GREY_L)
    cv.put(ox + 12, oy + 5, GREY_L)


def d_street_lamp(cv, ox, oy):
    stone_base(cv, ox, oy, 4)
    cv.rect(ox + 7, oy + 6, 2, 10, GREY_P)
    cv.rect(ox + 5, oy + 2, 6, 5, STAR)
    cv.rect(ox + 6, oy + 3, 4, 3, PAPER)
    cv.hline(ox + 5, oy + 1, 6, INK)
    cv.rect(ox + 6, oy + 15, 4, 1, PLUM_D)


def d_stone_lion(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_L)
    cv.rect(ox + 3, oy + 12, 10, 3, PLUM_D)
    cv.rect(ox + 5, oy + 6, 6, 6, GREY_L)
    cv.disc(ox + 8, oy + 5, 3, GREY_L)
    cv.put(ox + 7, oy + 5, INK)
    cv.put(ox + 9, oy + 5, INK)
    cv.hline(ox + 7, oy + 8, 3, GREY_P)
    cv.vline(ox + 5, oy + 6, 6, PLUM_D)


def d_barricade(cv, ox, oy):
    stone_base(cv, ox, oy, 7)
    for row, yy in enumerate((4, 8, 12)):
        off = 0 if row % 2 == 0 else 4
        for xx in range(off, TILE, 7):
            cv.rect(ox + xx, oy + yy, 6, 3, CREAM)
            cv.hline(ox + xx, oy + yy, 6, SAND)
            cv.hline(ox + xx, oy + yy + 2, 6, BROWN_D)
    cv.vline(ox + 2, oy + 1, 15, BROWN_DD)
    cv.vline(ox + 13, oy + 1, 15, BROWN_DD)


def d_flag(cv, ox, oy):
    stone_base(cv, ox, oy, 3)
    cv.vline(ox + 4, oy + 1, 15, BROWN_DD)
    cv.rect(ox + 5, oy + 2, 9, 7, RED_D)
    cv.hline(ox + 5, oy + 2, 9, RED)
    for x, y in ((7, 4), (10, 4), (8, 6), (11, 6), (6, 7), (12, 7)):
        cv.put(ox + x, oy + y, STAR)
    cv.put(ox + 4, oy, STAR)


def d_cart(cv, ox, oy):
    stone_base(cv, ox, oy, 6)
    cv.rect(ox + 2, oy + 5, 12, 6, BROWN_D)
    cv.rect(ox + 3, oy + 6, 10, 4, BROWN)
    cv.disc(ox + 4, oy + 12, 3, NIGHT)
    cv.disc(ox + 12, oy + 12, 3, NIGHT)
    cv.disc(ox + 4, oy + 12, 1, GREY_P)
    cv.disc(ox + 12, oy + 12, 1, GREY_P)
    cv.hline(ox + 2, oy + 5, 12, SAND)


def d_awning(cv, ox, oy):
    stone_base(cv, ox, oy, 8)
    cv.rect(ox, oy + 2, TILE, 7, RED_D)
    for x in range(1, TILE, 4):
        cv.rect(ox + x, oy + 2, 2, 7, RED)
    cv.hline(ox, oy + 2, TILE, INK)
    cv.hline(ox, oy + 8, TILE, BROWN_DD)
    cv.vline(ox + 1, oy + 9, 7, BROWN_DD)
    cv.vline(ox + 14, oy + 9, 7, BROWN_DD)


def d_steps(cv, ox, oy):
    cv.rect(ox, oy, TILE, TILE, PLUM_D)
    for yy in (2, 7, 12):
        cv.rect(ox, oy + yy, TILE, 3, GREY_P)
        cv.hline(ox, oy + yy, TILE, GREY_L)
        cv.hline(ox, oy + yy + 3, TILE, INK)
    cv.vline(ox + 7, oy + 2, 3, PLUM_D)
    cv.vline(ox + 11, oy + 7, 3, PLUM_D)


# (name, 中文名, 类别, 建议阻挡, 说明, 绘制函数)
TILESET: list[tuple[str, str, str, bool, str, object]] = [
    ("stone_a", "青石板·基", "terrain", False, "北京胡同 / 衙门前的主路面", d_stone_a),
    ("stone_b", "青石板·变体", "terrain", False, "错开砖缝，打散平铺规律", d_stone_b),
    ("cobble", "碎石巷路", "terrain", False, "会馆外的小巷，不平整的碎石", d_cobble),
    ("brick_floor", "红砖地", "terrain", False, "机器局厂房室内", d_brick_floor),
    ("cement", "洋式水泥地", "terrain", False, "新厂房的浇筑地面，洋务近代感", d_cement),
    ("plank", "木地板", "terrain", False, "工棚 / 栈桥铺板", d_plank),
    ("track", "厂内窄轨", "terrain", False, "运炮胚与煤的轻便铁轨", d_track),
    ("drain", "排水明沟", "terrain", False, "胡同与衙门前的石砌水沟", d_drain),
    ("grass_edge", "墙根荒草", "terrain", False, "墙脚碎石与枯草", d_grass_edge),
    ("brick_wall", "青砖墙", "building", True, "会馆 / 衙门 / 厂房外墙", d_brick_wall),
    ("brick_wall_win", "砖墙·格栅窗", "building", True, "外墙开窗，窗内透亮", d_brick_wall_win),
    ("tile_roof", "灰瓦屋顶", "building", True, "俯视瓦垄，北方官式屋面", d_tile_roof),
    ("roof_edge", "屋檐·朱椽", "building", True, "门楼檐口，红椽金钉", d_roof_edge),
    ("red_pillar", "朱红门柱", "building", True, "衙门与会馆的立柱", d_red_pillar),
    ("gate", "朱红大门", "building", True, "钉帽与门环，总督衙门正门", d_gate),
    ("lattice", "木格栅窗", "building", True, "会馆书房的窗棂", d_lattice),
    ("plaque", "门匾", "deco", True, "金框黑底，示意题字不写可辨字", d_plaque),
    ("lantern", "红灯笼", "deco", True, "会馆门前的灯笼", d_lantern),
    ("notice", "告示牌", "deco", True, "变法谕旨 / 衙门告示的纸面", d_notice),
    ("tree", "庭院槐树", "deco", True, "灰绿点彩的北方庭院树", d_tree),
    ("machine", "车床齿轮", "industry", True, "江南制造总局的机器", d_machine),
    ("boiler", "蒸汽锅炉", "industry", True, "铆钉箍 + 压力表 + 蒸汽", d_boiler),
    ("chimney", "砖烟囱", "industry", True, "厂房烟囱（俯视方口）", d_chimney),
    ("pipe", "蒸汽管", "industry", False, "横向铁管与法兰，可走", d_pipe),
    ("crate", "军械木箱", "industry", True, "造好的枪炮装箱", d_crate),
    ("cannon_part", "炮管胚", "industry", True, "刚铸好的炮管搁在木架上", d_cannon_part),
    ("rail_cart", "轨道小车", "industry", True, "厂内运料车", d_rail_cart),
    ("coal", "煤堆", "industry", True, "锅炉房燃料", d_coal),
    ("telegraph", "电线杆", "modern", True, "晚清电报线，近代城市标志", d_telegraph),
    ("street_lamp", "煤气路灯", "modern", True, "武昌街头的路灯", d_street_lamp),
    ("stone_lion", "衙门石狮", "modern", True, "总督衙门门前石狮", d_stone_lion),
    ("barricade", "沙袋街垒", "modern", True, "起义夜的街垒", d_barricade),
    ("flag", "新军旗帜", "modern", True, "铁血十八星旗意象（无文字）", d_flag),
    ("cart", "木轮车", "modern", True, "街边停着的骡车", d_cart),
    ("awning", "街铺布棚", "modern", True, "会馆外的红条布棚", d_awning),
    ("steps", "衙门石阶", "modern", False, "三道台阶，可走", d_steps),
]

assert len(TILESET) <= COLS * ROWS - 1, "id 0 恒透明，帧位不够"


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
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (name, _cn, _cat, _solid, _note, draw) in enumerate(TILESET, start=1):
        cv = Canvas(TILE, TILE)
        draw(cv, 0, 0)  # type: ignore[operator]
        col, row = i % COLS, i // COLS
        for y in range(TILE):
            for x in range(TILE):
                sheet.put(col * TILE + x, row * TILE + y, cv.px[y][x])
        (OUT / f"lq_{name}.png").write_bytes(png_bytes(TILE, TILE, cv))
    return sheet


def write_tileset() -> None:
    tiles = [
        {
            "id": i,
            "name": name,
            "cn": cn,
            "category": cat,
            "file": f"lq_{name}.png",
            "sheet_cell": {"col": i % COLS, "row": i // COLS},
            "layer": "ground",
            "collidable": solid,
            "note": note,
        }
        for i, (name, cn, cat, solid, note, _draw) in enumerate(TILESET, start=1)
    ]
    data = {
        "name": "tp_late_qing",
        "version": "1.0",
        "description": "洋务运动及之后（1861—1912）专用图块集：青砖巷 / 灰瓦门楼 / 机器厂房 / 近代街景",
        "engine": "Phaser 3 (MapDef JSON)",
        "tilewidth": TILE,
        "tileheight": TILE,
        "tilecount": len(TILESET) + 1,
        "columns": COLS,
        "image": "tp_late_qing_sheet.png",
        "imagewidth": COLS * TILE,
        "imageheight": ROWS * TILE,
        "margin": 0,
        "spacing": 0,
        "id_zero": "透明（不画）",
        "indexing": "col = id % 8, row = id // 8（与 tp_act2 / tp_sea 同一规则）",
        "generator": "tools/gen_late_qing_tiles.py",
        "palette": "仅用 src/core/constants.ts → PALETTE 的 24 色，硬边、无半透明渐变",
        "tiles": tiles,
    }
    (OUT / "tileset.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def preview(sheet: Canvas) -> None:
    scale = 4
    big = Canvas(sheet.w * scale, sheet.h * scale)
    for y in range(sheet.h):
        for x in range(sheet.w):
            c = sheet.px[y][x]
            if c is None:
                continue
            for dy in range(scale):
                for dx in range(scale):
                    big.put(x * scale + dx, y * scale + dy, c)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    (PREVIEW / "late_qing_tiles_preview.png").write_bytes(png_bytes(big.w, big.h, big))


def check() -> int:
    p = OUT / "tp_late_qing_sheet.png"
    b = p.read_bytes()
    w, h, _bd, ct = struct.unpack(">IIBB", b[16:26])
    ok = w == COLS * TILE and h == ROWS * TILE and ct == 6
    print(f"sheet {w}x{h} colortype={ct} tileset={len(TILESET)} frames; {'OK' if ok else 'FAIL'}")
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    if "--check" in argv:
        return check()
    sheet = build()
    write_tileset()
    (OUT / "tp_late_qing_sheet.png").write_bytes(png_bytes(sheet.w, sheet.h, sheet))
    if "--preview" in argv:
        preview(sheet)
    print(f"wrote {len(TILESET)} tiles -> {OUT}")
    return check()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
