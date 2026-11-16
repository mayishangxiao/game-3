#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成第三幕黄海海战 Boss「松岛舰」的 6 帧专属贴图 96×48。

为什么要另做一套
----------------
`boss_steamfrigate_0X.png` 是第一幕鸦片战争英军炮舰的占位美术：8 色几何
拼贴、桅杆像路灯、挂着白底红十字旗（英军），贴图里还自带一条蓝色水线 +
白浪，叠到游戏海面上重复一层。第三幕松岛舰一直复用这 6 帧，于是 1894 年
日本联合舰队的旗舰挂着英旗、6 帧几乎看不出差别，视觉上既串年代也不像
「速射炮成群」的铁甲巡洋舰。

这套图保持 96×48 / 6 帧 / `SHIP_FRAME` 语义不变（坐标、血条偏移、近战
距离、帧状态机全部沿用），只换美术：铅灰防护巡洋舰侧视、舰艏朝左正对
玩家甲板，日章旗、双烟囱煤烟、舰艉 320mm 主炮塔、一排舷侧速射炮、舰桥
/ 主桅 / 索具 / 舷窗 / 铆钉。水下部分只留 2px 暗影和舰艏几点破浪白沫，
**不画整条蓝水线**——水面交给地图瓦片。

逐帧差异（旧图 6 帧几乎一样，是这次重点）：
    0 idle      轻煤烟、旗飘、平静
    1 recoil    主炮炮口白烟、炮管后坐缩短
    2 smoke     双烟囱浓煤烟横拖
    3 broadside 五门舷炮同时喷火 + 炮口烟（最亮的一帧）
    4 brokenA   舰桥中弹起火、舷侧破洞、黑烟柱
    5 brokenB   两处大火、断桅、舰体下沉 2px、旗破角

硬性约束
--------
* 颜色只能取 `src/core/constants.ts → PALETTE` 的 24 色盘（美术规范 8.1）。
* 纯标准库、确定性：任何人重跑都能得到同样的字节（不用 random）。
* 背景透明；`CharacterRig` 用 `origin(0.5,1)` + `y=8` 贴图，第 40 行是
  吃水线。别把船整体上下挪，否则会浮空或陷进海面。

用法：
    python tools/gen_matsushima.py
    python tools/gen_matsushima.py --preview   # 额外出 4 倍放大联系表（不入库）
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "art" / "ship"
PREVIEW = ROOT / "tools" / "_cdp" / "_matsushima_preview.png"

W, H = 96, 48
WATER_Y = 40  # 吃水线：这一行以下属水下，只留暗影

# 24 色盘（与 src/core/constants.ts 逐值一致，不引入新色号）
INK = (0x0D, 0x0B, 0x14)
NIGHT = (0x1C, 0x1A, 0x2B)
PLUM_D = (0x2F, 0x2B, 0x45)
PLUM_M = (0x4A, 0x44, 0x68)
PLUM_L = (0x6B, 0x64, 0x89)
GREY_P = (0x94, 0x8D, 0xAB)
PAPER = (0xF2, 0xED, 0xE4)
CREAM = (0xE8, 0xCF, 0xA8)
SAND = (0xCF, 0xA2, 0x6A)
WOOD = (0xA8, 0x76, 0x3F)
BROWN_D = (0x7A, 0x4F, 0x2A)
BROWN_DD = (0x4E, 0x2F, 0x1A)
RED_D = (0x8C, 0x1C, 0x1C)
RED = (0xC0, 0x39, 0x2B)
RED_B = (0xE8, 0x5C, 0x4A)
PINK = (0xF2, 0xA0, 0x8C)
INDIGO = (0x2A, 0x5A, 0x8A)
BLUE = (0x4A, 0x90, 0xC8)
BLUE_L = (0x7B, 0xC0, 0xE8)
STAR = (0xD4, 0xA8, 0x40)
LILAC = (0xC2, 0xBC, 0xD1)

PALETTE_24 = {
    INK, NIGHT, PLUM_D, PLUM_M, PLUM_L, GREY_P, PAPER,
    CREAM, SAND, WOOD, BROWN_D, BROWN_DD, RED_D, RED, RED_B, PINK,
    (0x4A, 0x7A, 0x2E), (0x7B, 0xA8, 0x4A), (0xA8, 0xD0, 0x70),
    INDIGO, BLUE, BLUE_L, STAR, LILAC,
}


def h2(a: int, b: int) -> float:
    """确定性 hash → [0,1)。不用 random，保证每次重跑字节一致。"""
    n = (a * 374761393 + b * 668265263 + 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


class Canvas:
    """RGBA 画板；None = 全透明（船外区域）。"""

    def __init__(self) -> None:
        self.px: list[tuple[int, int, int] | None] = [None] * (W * H)

    def put(self, x: int, y: int, c: tuple[int, int, int] | None) -> None:
        if 0 <= x < W and 0 <= y < H:
            self.px[y * W + x] = c

    def get(self, x: int, y: int) -> tuple[int, int, int] | None:
        if 0 <= x < W and 0 <= y < H:
            return self.px[y * W + x]
        return None

    def hline(self, x: int, y: int, w: int, c) -> None:
        for i in range(w):
            self.put(x + i, y, c)

    def vline(self, x: int, y: int, h: int, c) -> None:
        for i in range(h):
            self.put(x, y + i, c)

    def rect(self, x: int, y: int, w: int, h: int, c) -> None:
        for j in range(h):
            self.hline(x, y + j, w, c)

    def line(self, x0: int, y0: int, x1: int, y1: int, c) -> None:
        """Bresenham：索具、斜切舰艏用。"""
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            self.put(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def disc(self, cx: int, cy: int, r: int, c) -> None:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.put(x, y, c)

    def rgba(self) -> bytes:
        out = bytearray(W * H * 4)
        for i, c in enumerate(self.px):
            if c is not None:
                out[i * 4:i * 4 + 4] = bytes((c[0], c[1], c[2], 255))
        return bytes(out)


def write_png(path: Path, raw: bytes) -> None:
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    scan = b"".join(b"\x00" + raw[y * W * 4:(y + 1) * W * 4] for y in range(H))
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scan, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


# ---------------------------------------------------------------- 舰体

def hull(cv: Canvas, sink: int = 0, damage: int = 0) -> None:
    """铅灰舰体：斜切飞剪艏朝左，方形舰艉朝右。y=27..41。"""
    top = 27 + sink
    bot = 38 + sink
    for y in range(top, bot + 1):
        # 舰艏上缘靠右、下缘靠左，画出前倾的撞角
        left = max(4, 16 - (y - top))
        right = 90 if y < top + 10 else 88
        # 上四行受光更亮：v2.4 把整片海压暗了，船体不比海面亮一档就会糊在一起
        cv.hline(left, y, right - left, PLUM_L if y < top + 4 else PLUM_M)
    # 顶边：舷墙 / 装甲带上沿
    cv.hline(16, top, 74, GREY_P)
    cv.hline(10, top + 2, 6, GREY_P)
    cv.hline(16, top + 1, 74, PLUM_L)
    # 水线暗带 + 吃水
    cv.hline(6, bot - 2, 84, PLUM_D)
    cv.hline(6, bot - 1, 84, PLUM_D)
    cv.hline(5, bot, 85, NIGHT)
    # 水下 2px 暗影（不画蓝水线，水面交给地图瓦片）
    cv.hline(8, bot + 1, 80, PLUM_D)
    cv.hline(12, bot + 2, 72, NIGHT)
    # 铆钉：装甲带上一排，别连成虚线（错列、稀疏）
    for x in range(20, 88, 7):
        cv.put(x, top + 3, GREY_P if h2(x, 3) > 0.55 else PLUM_L)
    # 舷侧受光：v2.4 全场压暗后，靠这一层把舰体从深蓝海面里抠出来（同样错列）
    for x in range(18, 88, 5):
        if h2(x, 23) > 0.5:
            cv.put(x, top + 4, GREY_P)
    # 舷侧速射炮门：一排暗炮窗 + 朝左伸出的短炮管
    for x in (18, 28, 38, 48, 58, 68, 78):
        cv.rect(x, top + 5, 4, 3, INK)
        cv.hline(x, top + 5, 4, GREY_P)
        cv.put(x + 1, top + 6, NIGHT)
        cv.hline(x - 3, top + 6, 3, PLUM_L)
        cv.put(x - 3, top + 6, GREY_P)
    # 木甲板与栏杆
    cv.hline(18, top - 1, 70, BROWN_D)
    cv.hline(18, top - 2, 70, WOOD)
    for x in range(19, 88, 3):
        cv.put(x, top - 2, PLUM_L)
        if h2(x, 7) > 0.62:
            cv.put(x, top - 3, GREY_P)
    cv.hline(74, top - 3, 14, GREY_P)
    # 舰艏破浪白沫（只在船头，不铺满整条水线）
    for i in range(9):
        x = 4 + i
        y = bot + (1 if i % 2 else 0)
        if h2(i, 11) > 0.35:
            cv.put(x, y, PAPER if h2(i, 13) > 0.5 else BLUE_L)
    # 破损：舷侧破洞 + 烧焦边
    if damage >= 1:
        cv.rect(54, top + 4, 7, 5, INK)
        cv.hline(54, top + 4, 7, RED_D)
        cv.put(61, top + 6, RED_B)
    if damage >= 2:
        cv.rect(30, top + 5, 8, 5, INK)
        cv.hline(30, top + 5, 8, RED_D)
        cv.put(29, top + 7, STAR)
        # 舰艉下沉：右端整体再压一行
        cv.hline(80, bot + 1, 10, NIGHT)


# ------------------------------------------------------------ 上层建筑

def superstructure(cv: Canvas, sink: int = 0, damage: int = 0, frame: int = 0) -> None:
    s = sink
    # 320mm 主炮塔（三景舰的标志）：靠舰艏的梯形炮塔，粗炮管朝左
    for y in range(20 + s, 26 + s):
        inset = (y - (20 + s)) // 2
        cv.hline(21 + inset, y, 14 - inset * 2, PLUM_L)
    cv.hline(22, 20 + s, 12, GREY_P)
    cv.rect(24, 22 + s, 6, 2, INK)
    cv.hline(24, 22 + s, 6, PLUM_D)
    barrel_end = 11 if frame == 1 else 7  # 后坐帧炮管缩短
    cv.hline(barrel_end, 22 + s, 21 - barrel_end, GREY_P)
    cv.hline(barrel_end, 23 + s, 21 - barrel_end, PLUM_L)
    cv.rect(barrel_end - 1, 22 + s, 2, 2, INK)

    # 两根烟囱：柱身 + 左高光 + 顶部黑口 + 一道识别带
    for cx, cy in ((40, 11), (67, 9)):
        cv.rect(cx, cy + s, 6, 26 - cy + s, PLUM_D)
        cv.vline(cx, cy + s, 26 - cy + s, PLUM_M)
        cv.rect(cx, cy + s, 6, 2, INK)
        cv.hline(cx, 17 + s, 6, PLUM_L)
        cv.hline(cx, 18 + s, 6, RED_D)
        cv.put(cx + 5, cy + 3 + s, GREY_P)

    # 舰桥：窗、顶沿、探照灯
    cv.rect(47, 17 + s, 15, 9, PLUM_L)
    cv.hline(47, 17 + s, 15, GREY_P)
    cv.vline(47, 18 + s, 8, PLUM_M)
    cv.vline(61, 18 + s, 8, PLUM_D)
    for x in (50, 54, 58):
        cv.rect(x, 20 + s, 2, 2, INK)
        cv.put(x, 20 + s, BLUE_L if h2(x, 21) > 0.5 else INK)
    cv.rect(51, 14 + s, 5, 3, GREY_P)
    cv.rect(52, 15 + s, 3, 2, PAPER)
    cv.put(53, 15 + s, STAR)

    # 主桅 + 横桁 + 索具（破损帧断桅）
    mast_top = 5 + s if damage < 2 else 14 + s
    cv.vline(77, mast_top, 26 + s - mast_top, GREY_P)
    cv.vline(78, mast_top + 2, 24 + s - mast_top, PLUM_M)
    if damage < 2:
        cv.hline(71, 10 + s, 13, GREY_P)
        cv.hline(73, 13 + s, 9, PLUM_L)
        cv.line(77, 6 + s, 16, 25 + s, PLUM_M)
        cv.line(77, 6 + s, 90, 25 + s, PLUM_M)
        cv.put(77, 4 + s, STAR)
    # 前桅（短）+ 横桁
    cv.vline(15, 14 + s, 12, PLUM_L)
    cv.hline(11, 15 + s, 9, GREY_P)


def flag(cv: Canvas, sink: int, frame: int) -> None:
    """舰艉日章旗：白底红日。不是旧图那面英军十字旗。"""
    y = 11 + sink
    cv.vline(81, y - 3, 17, GREY_P)
    cv.rect(82, y, 13, 8, PAPER)
    # 实心圆日（r²≤5 补上 (±2,±1)/(±1,±2)，比 r=2 的菱形更像日章旗）
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            if dx * dx + dy * dy <= 8:
                cv.put(88 + dx, y + 4 + dy, RED)
    cv.put(88, y + 4, RED_B)
    cv.hline(82, y + 7, 13, LILAC)
    # 轻微飘动 / 破损角
    if frame % 2 == 1:
        cv.put(94, y + 5, None)
    if frame == 5:
        cv.put(94, y + 4, None)
        cv.put(93, y + 5, None)
        cv.put(87, y, PLUM_D)


# ---------------------------------------------------------------- 烟 / 火

def smoke(cv: Canvas, cx: int, cy: int, amount: int, seed: int, drift: int = 0) -> None:
    """颗粒状煤烟：从烟囱口向左上方展开成带状，但仍是离散像素。

    绝不能连成一整块近黑三角形（甲午远景条第一版踩过），也不能撒成满屏
    黑点（海面瓦片那次踩过）。越往上越向左飘、越宽，浓烟帧靠 amount 加密。
    """
    for k in range(amount * 5):
        t = h2(seed + k, 17)
        rise = int(h2(k * 3, seed + 5) * max(1, cy - 1))
        y = cy - rise
        span = 4 + rise // 2 + drift
        x = cx + 2 - rise // 3 - int(t * span)
        if y < 1 or not (0 <= x < W):
            continue
        if h2(k + 7, seed + 11) > (0.48 if drift else 0.66):
            continue
        r = h2(k * 5, seed + 13)
        cv.put(x, y, NIGHT if r > 0.74 else (PLUM_D if r > 0.40 else (PLUM_L if r > 0.18 else GREY_P)))


def muzzle_flash(cv: Canvas, x: int, y: int, big: bool, seed: int) -> None:
    """炮口焰：星黄/亮红短舌 + 白烟。整场唯一允许的亮色之一。"""
    length = 7 if big else 5
    for i in range(length):
        cv.put(x - i, y, STAR if i < 3 else RED_B)
        if big:
            cv.put(x - i, y - 1, RED_B if i < 4 else RED_D)
            if h2(i, seed) > 0.45:
                cv.put(x - i, y + 1, RED_D)
        if i < 2:
            cv.put(x - i, y, PAPER)
    for k in range(20 if big else 12):
        px = x - int(h2(k, seed + 3) * (length + 5))
        py = y - 2 + int(h2(k, seed + 7) * 5)
        if h2(k, seed + 9) > 0.42:
            cv.put(px, py, PAPER if h2(k, 23) > 0.4 else PLUM_L)


def fire(cv: Canvas, cx: int, cy: int, size: int, seed: int) -> None:
    """中弹火苗 + 上方烟柱。亮色只允许出现在火/炮口。"""
    for k in range(size * 3):
        x = cx + int((h2(k, seed) - 0.5) * (size * 2))
        y = cy - int(h2(k * 2, seed + 3) * size)
        if h2(k + 1, seed + 5) > 0.55:
            continue
        r = h2(k, seed + 7)
        cv.put(x, y, STAR if r > 0.78 else (RED_B if r > 0.45 else RED_D))
    smoke(cv, cx, cy - size, size, seed + 31, drift=5)


# ---------------------------------------------------------------- 六帧

def draw(frame: int) -> Canvas:
    cv = Canvas()
    damage = 1 if frame == 4 else (2 if frame == 5 else 0)
    sink = 2 if frame == 5 else 0
    hull(cv, sink, damage)
    superstructure(cv, sink, damage, frame)

    # 常态煤烟：idle 轻、smoke 帧浓、开炮帧中等
    base = {0: 16, 1: 20, 2: 42, 3: 24, 4: 34, 5: 46}[frame]
    smoke(cv, 42, 9 + sink, base, 100 + frame * 7, drift=2 if frame in (2, 4, 5) else 0)
    smoke(cv, 69, 7 + sink, int(base * 0.8), 200 + frame * 7, drift=2 if frame in (2, 4, 5) else 0)

    if frame == 1:
        # 主炮后坐：炮口一团明显的白烟（旧图 6 帧几乎一样，这里要一眼看出在开炮）
        muzzle_flash(cv, 6, 22 + sink, False, 310)
        for k in range(52):
            x = 7 - int(h2(k, 331) * 10)
            y = 19 + sink + int(h2(k, 337) * 7)
            if h2(k, 339) > 0.32:
                cv.put(x, y, PAPER if h2(k, 341) > 0.42 else GREY_P)
    elif frame == 3:
        # 舷炮齐射：五门速射炮同时开火
        for i, x in enumerate((18, 38, 58, 68, 78)):
            muzzle_flash(cv, x - 3, 32 + sink, True, 400 + i * 9)

    if damage >= 1:
        fire(cv, 55, 22 + sink, 5 if damage == 1 else 7, 500 + frame)
    if damage >= 2:
        fire(cv, 34, 24 + sink, 6, 600 + frame)
        # 断桅歪斜
        cv.hline(74, 16 + sink, 6, PLUM_D)

    flag(cv, sink, frame)
    return cv


def check(cv: Canvas) -> None:
    bad = {c for c in cv.px if c is not None and c not in PALETTE_24}
    assert not bad, f"出现 24 色盘之外的颜色：{bad}"


def main() -> None:
    frames = []
    for i in range(6):
        cv = draw(i)
        check(cv)
        frames.append(cv)
        p = OUT_DIR / f"matsushima_{i:02d}.png"
        write_png(p, cv.rgba())
        colors = len({c for c in cv.px if c is not None})
        opaque = sum(1 for c in cv.px if c is not None)
        print(f"matsushima_{i:02d}.png  颜色 {colors:2d}  不透明 {opaque:4d}  {p.stat().st_size} B")

    # 帧间差异：旧图 6 帧几乎一样，这次必须每帧都不同
    base = frames[0].px
    for i, cv in enumerate(frames[1:], 1):
        diff = sum(1 for a, b in zip(base, cv.px) if a != b)
        assert diff > 80, f"第 {i} 帧与 idle 差异只有 {diff} 像素，状态看不出来"
        print(f"  frame{i} vs idle 差异 {diff} 像素")

    if "--preview" in sys.argv:
        S, COLS, GAP = 4, 3, 10
        pw = COLS * (W * S + GAP) + GAP
        ph = 2 * (H * S + GAP) + GAP
        out = [bytearray(b"\x00" * (pw * 4)) for _ in range(ph)]
        for i, cv in enumerate(frames):
            ox = GAP + (i % COLS) * (W * S + GAP)
            oy = GAP + (i // COLS) * (H * S + GAP)
            for y in range(H):
                for x in range(W):
                    c = cv.get(x, y)
                    if c is None:
                        continue
                    px = bytes((c[0], c[1], c[2], 255))
                    for dy in range(S):
                        row = out[oy + y * S + dy]
                        for dx in range(S):
                            o = (ox + x * S + dx) * 4
                            row[o:o + 4] = px
        raw = b"".join(bytes(r) for r in out)
        def chunk(tag: bytes, body: bytes) -> bytes:
            return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        scan = b"".join(b"\x00" + raw[y * pw * 4:(y + 1) * pw * 4] for y in range(ph))
        PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        PREVIEW.write_bytes(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", pw, ph, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(scan, 9))
            + chunk(b"IEND", b"")
        )
        print(f"预览 {PREVIEW}")


if __name__ == "__main__":
    main()
