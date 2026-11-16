#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成第三幕（洋务 / 甲午）专用的战时远景条 480×64。

为什么另做一张
--------------
海战关卡原来和虎门、天京共用 `bg_strip_dusk.png`：淡紫黄昏、黄色**帆船**、
晴空无云。1894 年大东沟外海是蒸汽铁甲舰对射，画面既不贴合洋务运动
（烟囱 / 煤烟 / 舰桥 / 炮塔才是这一时期的识别物），也谈不上肃杀危险。
甲方这轮的要求是「背景贴合洋务运动时期，并且要肃杀、黑暗，体现战斗的危险」。

这张条子画的是：铅灰浓云压到海平线、三艘冒煤烟的铁甲舰剪影、居中一艘
中弹起火、横贯全场的硝烟带、远处两点炮口闪光。整体只有 `ink/night/plumDark`
三档冷暗色打底，**唯一的亮色是炮口闪光与火苗**（star / redBright，全图不到
100 像素），避免像旧图那样亮成旅游照，也避免像海面瓦片那样撒一地黑噪点。

硬性约束（改脚本前先读）
------------------------
* 输出必须是 480×64 RGBA：`Backdrop.horizonImage()` 按 1.6 倍放大、
  `LevelScene.buildWorld()` 用 `HORIZON_H * 1.6` 算淡出带，尺寸变了会整条错位。
* 顶边贴 `y=0` 放大 1.6 倍后，**原图只有 y=0..40 可见**；水平居中裁切后
  只有 **x=90..390 可见**。所以舰影 / 火光 / 烟柱必须画在 x=100..380、
  y=18..40，画到两头等于没画。
* 顶部 y<10 被战役条白字压着、右上角是「暂停」，必须压到极暗，否则白字读不清。
* 颜色只能取 `src/core/constants.ts → PALETTE` 的 24 色盘（美术规范 8.1）。
* 纯标准库、确定性：任何人 `python tools/gen_jiawu_sky.py` 都能重出同样的字节。

用法：
    python tools/gen_jiawu_sky.py
    python tools/gen_jiawu_sky.py --preview    # 额外出 3 倍放大预览（tools/_cdp 下，不入库）
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "art" / "bg" / "bg_strip_jiawu.png"
PREVIEW = ROOT / "tools" / "_cdp" / "_jiawu_sky_preview.png"

W, H = 480, 64
SEA_Y = 40  # 海平线；1.6 倍裁切后正好是可见区最下沿

# 24 色盘（与 src/core/constants.ts 逐值一致，不引入新色号）
INK = (0x0D, 0x0B, 0x14)
NIGHT = (0x1C, 0x1A, 0x2B)
PLUM_D = (0x2F, 0x2B, 0x45)
PLUM_M = (0x4A, 0x44, 0x68)
PLUM_L = (0x6B, 0x64, 0x89)
GREY_P = (0x94, 0x8D, 0xAB)
PAPER = (0xF2, 0xED, 0xE4)
BROWN_D = (0x7A, 0x4F, 0x2A)
BROWN_DD = (0x4E, 0x2F, 0x1A)
RED_D = (0x8C, 0x1C, 0x1C)
RED = (0xC0, 0x39, 0x2B)
RED_B = (0xE8, 0x5C, 0x4A)
INDIGO = (0x2A, 0x5A, 0x8A)
BLUE = (0x4A, 0x90, 0xC8)
STAR = (0xD4, 0xA8, 0x40)

PALETTE_24 = {
    INK, NIGHT, PLUM_D, PLUM_M, PLUM_L, GREY_P, PAPER,
    (0xE8, 0xCF, 0xA8), (0xCF, 0xA2, 0x6A), (0xA8, 0x76, 0x3F),
    BROWN_D, BROWN_DD, RED_D, RED, RED_B, (0xF2, 0xA0, 0x8C),
    (0x4A, 0x7A, 0x2E), (0x7B, 0xA8, 0x4A), (0xA8, 0xD0, 0x70),
    INDIGO, BLUE, (0x7B, 0xC0, 0xE8), STAR, (0xC2, 0xBC, 0xD1),
}


def h2(a: int, b: int) -> float:
    """确定性 hash → [0,1)。不用 random，保证每次重跑字节一致。"""
    n = (a * 374761393 + b * 668265263 + 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


class Canvas:
    def __init__(self) -> None:
        self.px = [INK] * (W * H)

    def put(self, x: int, y: int, c: tuple[int, int, int]) -> None:
        if 0 <= x < W and 0 <= y < H:
            self.px[y * W + x] = c

    def hline(self, x: int, y: int, w: int, c: tuple[int, int, int]) -> None:
        for i in range(w):
            self.put(x + i, y, c)

    def vline(self, x: int, y: int, h: int, c: tuple[int, int, int]) -> None:
        for i in range(h):
            self.put(x, y + i, c)

    def rect(self, x: int, y: int, w: int, h: int, c: tuple[int, int, int]) -> None:
        for j in range(h):
            self.hline(x, y + j, w, c)

    def bytes(self) -> bytes:
        out = bytearray(W * H * 4)
        for i, c in enumerate(self.px):
            out[i * 4:i * 4 + 4] = bytes((c[0], c[1], c[2], 255))
        return bytes(out)


def sky_base(cv: Canvas) -> None:
    """铅灰夜空：越往下云越厚。大片横向色块，不是逐像素噪点。"""
    cv.rect(0, 0, W, SEA_Y, NIGHT)
    cv.rect(0, 0, W, 10, INK)
    # 三层浓云，每层由若干条 2~4px 高的长横线叠成，边界错开，读成压顶的云。
    for band, (y0, y1, col) in enumerate((
        (9, 19, PLUM_D), (17, 29, PLUM_D), (26, 39, PLUM_M),
    )):
        for y in range(y0, y1):
            # 每行的云从不同的 x 起、长度不同；同一层内相邻行错开 1~6px
            k = 0
            x = -int(h2(band, y) * 60)
            while x < W:
                w = 18 + int(h2(y, k + band * 7) * 46)
                if h2(y * 3 + k, band + 11) > 0.46:
                    cv.hline(x, y, w, col if h2(k, y + band) > 0.35 else NIGHT)
                x += w + int(h2(k + 3, y) * 12)
                k += 1
    # 云底整体压暗，把「天」和「海」分开；只留最下沿一点点灰当硝烟的衬底
    cv.rect(0, 36, W, 4, PLUM_D)
    cv.rect(0, 39, W, 1, INK)


def fire_reflection(cv: Canvas) -> None:
    """中部一艘在烧：火光只把云底**零星**染成暗红。

    第一版按「到燃烧点的距离」连续填色，结果是一整块规则的大红三角，
    像贴了面旗子。现在按云块逐段抽样：靠近燃烧点的云段有较高概率被染，
    远处几乎不染，且只改云像素本身，底色与轮廓一律不动。
    """
    for y in range(24, 38):
        x = 150
        while x < 330:
            seg = 8 + int(h2(y, x // 9) * 14)
            near = 1.0 - abs((x + seg / 2) - 245) / 100.0
            chance = 0.10 + 0.46 * max(0.0, near) * (1.0 - abs(y - 34) / 20.0)
            if h2(x + y * 3, 17) < chance:
                c = RED_D if h2(y, x + 3) > 0.55 else BROWN_DD
                for xx in range(x, min(x + seg, 330)):
                    if cv.px[y * W + xx] in (PLUM_D, PLUM_M, NIGHT, PLUM_L):
                        cv.put(xx, y, c)
            x += seg + int(h2(x, y) * 9)


def smoke_cloud(cv: Canvas, x: int, y: int, size: int, drift: int, col: tuple[int, int, int]) -> None:
    """一叠小团拼成烟柱（画成大圆饼会像气球，是老毛病）。"""
    for i in range(6):
        t = i / 5
        cx = x + int(drift * t) + int((h2(x + i, y) - 0.5) * 4)
        cy = y - i * (size // 5)
        r = max(2, int(size * (0.34 - 0.12 * t)))
        cv.rect(cx - r, cy - 1, r * 2, 2, col)
        if i < 3:
            cv.rect(cx - r + 1, cy - 2, r * 2 - 2, 1, col)


def ironclad(cv: Canvas, cx: int, width: int, burning: bool = False) -> None:
    """蒸汽铁甲舰剪影：烟囱 / 桅杆 / 舰桥 / 炮塔，**没有帆**。

    这是「贴合洋务运动时期」的关键：旧远景条画的是鸦片战争时代的帆船，
    1894 年北洋水师与日本联合舰队打的是燃煤蒸汽舰。
    """
    left = cx - width // 2
    hull_y = SEA_Y - 4
    # 船体 + 斜艏；下沿吃水线压一道更暗的墨线
    cv.rect(left, hull_y, width, 4, INK)
    cv.rect(left + 1, hull_y - 1, 3, 1, INK)
    cv.rect(left + width - 4, hull_y - 1, 3, 1, INK)
    cv.rect(left, SEA_Y, width, 1, NIGHT)
    # 前后炮塔
    cv.rect(left + 5, hull_y - 2, 5, 2, INK)
    cv.rect(left + width - 10, hull_y - 2, 5, 2, INK)
    # 舰桥 / 上层建筑
    cv.rect(cx - 6, hull_y - 6, 12, 6, INK)
    cv.rect(cx - 5, hull_y - 5, 10, 2, PLUM_D)
    # 两根烟囱（燃煤蒸汽舰的识别点）
    for dx in (-10, 8):
        cv.rect(cx + dx, hull_y - 13, 3, 8, INK)
        cv.rect(cx + dx, hull_y - 13, 3, 1, PLUM_D)
        # 煤烟斜着往上飘，接到上方浓云里
        smoke_cloud(cv, cx + dx + 1, hull_y - 14, 18 if burning else 12, -6, PLUM_D)
    # 主桅 + 横桁
    cv.vline(cx - 2, hull_y - 16, 11, INK)
    cv.hline(cx - 6, hull_y - 13, 9, INK)
    if burning:
        # 中弹：舰桥上窜火苗，烟柱更高更浓
        for i in range(7):
            fx = cx - 3 + int((h2(i, cx) - 0.5) * 8)
            top = hull_y - 8 - int(h2(cx, i) * 7)
            cv.vline(fx, top, hull_y - 6 - top, RED_D if i % 3 else RED)
            cv.put(fx, top - 1, RED_B if i % 2 else STAR)
        smoke_cloud(cv, cx + 2, hull_y - 20, 30, 9, PLUM_D)
        smoke_cloud(cv, cx - 12, hull_y - 18, 22, -8, NIGHT)
        # 甲板反射的火光
        cv.hline(cx - 9, SEA_Y - 1, 18, RED_D)


def muzzle_flash(cv: Canvas, x: int, y: int) -> None:
    """远处舰炮开火：一点亮斑 + 一小段斜白烟。全图只放两处。"""
    cv.rect(x, y, 2, 2, STAR)
    cv.put(x - 1, y + 1, RED_B)
    for i in range(6):
        cv.put(x + 3 + i, y - 1 - i // 3, GREY_P if i < 3 else PLUM_L)


def sea(cv: Canvas) -> None:
    """海平线以下基本被地砖盖住，只留暗蓝紫的水，别把远景抬亮。"""
    cv.rect(0, SEA_Y, W, H - SEA_Y, NIGHT)
    cv.hline(205, SEA_Y - 2, 78, RED_D)  # 燃烧舰脚下一小段暗红水影
    cv.hline(0, SEA_Y, W, INK)
    for i in range(3):
        for x in range(int(h2(i, 5) * 30), W, 52):
            cv.hline(x, SEA_Y + 4 + i * 5, 9, PLUM_D if i % 2 else INDIGO)
    # 下沿越远越暗，避免 1.6 倍裁切露出的那一两行像一条亮蓝带
    cv.rect(0, 52, W, H - 52, INK)


def hud_dim(cv: Canvas) -> None:
    """顶部战役条与右上角暂停区：压到极暗，白字才读得清。"""
    for y in range(10):
        for x in range(W):
            c = cv.px[y * W + x]
            cv.put(x, y, INK if c in (PLUM_M, PLUM_L, GREY_P, RED_D, RED, BROWN_DD) else NIGHT)
    for y in range(10, 16):
        for x in range(424, W):
            cv.put(x, y, INK)


def build() -> Canvas:
    cv = Canvas()
    sky_base(cv)
    fire_reflection(cv)
    sea(cv)
    # 三艘都落在可见区 x=90..390 内；中间那艘正在燃烧
    ironclad(cv, 152, 62)
    ironclad(cv, 245, 78, burning=True)
    ironclad(cv, 344, 56)
    # 硝烟带横贯海平线，压在舰影之后，读作「打起来了的烟幕」
    for y in range(35, 39):
        x = int(h2(y, 3) * 20) - 20
        while x < W:
            w = 24 + int(h2(x // 8, y) * 34)
            if h2(y * 5 + x, 7) > 0.42:
                cv.hline(x, y, w, PLUM_D if y % 2 else NIGHT)
            x += w + 8
    # 舰影要压在烟带之上，否则船被烟吃掉
    ironclad(cv, 152, 62)
    ironclad(cv, 245, 78, burning=True)
    ironclad(cv, 344, 56)
    muzzle_flash(cv, 112, 31)
    muzzle_flash(cv, 376, 33)
    hud_dim(cv)
    return cv


def lum(c: tuple[int, int, int]) -> int:
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) // 1000


def self_check(cv: Canvas) -> None:
    assert len(cv.px) == W * H
    illegal = [c for c in cv.px if c not in PALETTE_24]
    assert not illegal, f"出现 24 色盘外的颜色：{illegal[:3]}"
    top = sum(lum(cv.px[y * W + x]) for y in range(10) for x in range(W)) / (W * 10)
    visible = sum(lum(cv.px[y * W + x]) for y in range(16, SEA_Y) for x in range(90, 390)) / (300 * (SEA_Y - 16))
    bright = sum(1 for c in cv.px if lum(c) > 150)
    warm = sum(1 for c in cv.px if c in (RED_D, RED, RED_B, BROWN_DD, BROWN_D))
    hull = sum(1 for x in range(90, 390) if cv.px[(SEA_Y - 2) * W + x] == INK)
    # 铁甲舰识别物：烟囱竖条（y=24 附近至少 6 段 INK）
    stacks = sum(1 for x in range(90, 390) if cv.px[24 * W + x] == INK)
    assert top < 32, f"顶部 HUD 区太亮（{top:.1f}），白字会读不清"
    assert visible < 62, f"可见区不够肃杀（平均亮度 {visible:.1f}）"
    assert bright < 120, f"亮色过多（{bright} 像素），旧图就是亮成黄昏旅游照"
    # 火光只要「读得出来」即可：第一版连续染色铺出 2276 像素的大红三角，
    # 像贴了面旗子。上限同样要锁，防止以后又被改回整块红。
    assert 300 < warm < 3000, f"火光映照偏成了整块红或几乎看不见（{warm} 像素）"
    assert hull > 120, f"铁甲舰船体没成形（y=38 墨色 {hull} 像素）"
    assert stacks >= 6, f"烟囱剪影缺失（{stacks} 段），会退化回帆船时代"
    print(f"自检通过：{W}×{H} / 24 色盘内 / 顶部亮度 {top:.1f} / 可见区亮度 {visible:.1f}")
    print(f"亮色像素 {bright} / 火光暖色 {warm} / 船体墨色 {hull} / 烟囱段 {stacks}")


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, pixels: bytes, w: int, h: int) -> None:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += pixels[y * w * 4:(y + 1) * w * 4]
    png = (b"\x89PNG\r\n\x1a\n"
           + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + _chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def write_preview(cv: Canvas) -> None:
    scale = 3
    w, h = W * scale, H * scale
    out = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            c = cv.px[(y // scale) * W + (x // scale)]
            o = (y * w + x) * 4
            out[o:o + 4] = bytes((c[0], c[1], c[2], 255))
    write_png(PREVIEW, bytes(out), w, h)
    print(f"预览 {PREVIEW.relative_to(ROOT)}")


def main() -> None:
    cv = build()
    self_check(cv)
    pixels = cv.bytes()
    write_png(OUT, pixels, W, H)
    print(f"输出 {OUT.relative_to(ROOT)} {W}×{H} {OUT.stat().st_size} bytes")
    if "--preview" in sys.argv:
        write_preview(cv)


if __name__ == "__main__":
    main()
