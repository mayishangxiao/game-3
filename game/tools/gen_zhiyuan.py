#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成第三幕我方军舰「致远舰」的 3 帧贴图 96×48。

为什么必须有这艘船
------------------
v2.6 之前，黄海海战里只有**敌方**一艘军舰（松岛/吉野），玩家站在一条空甲板上。
用户的要求是「我方也应有军舰，设定为致远舰，敌方命名为吉野号」，所以这版补上
北洋水师的致远舰，和 `tools/gen_yoshino.py` 的吉野号成对使用：

  * 开场「双舰对照」卡：致远在左（0.9 倍）、吉野在右（1.3 倍），舰体规模一眼分得出；
  * 战场远景：致远以 0.6 倍停在海面左上，玩家看得见「我方也有船」；
  * 结算的「致远撞向吉野」演出：第 2 帧（charge）从画面左侧冲入。

五维实力差都画在图里（史实口径，不写成数值表）
----------------------------------------------
    舰体：致远 2300 吨、舰身短一截、圆钝旧式艏；吉野 4150 吨、拉到画布两端、飞剪艏
    火力：致远 7 门旧式裸露炮位 + 1 座 210mm 双联；吉野 11 门带盾速射炮 + 2 座 152mm
    速度：致远 18 节、单烟囱、煤烟直上；吉野 23 节、双烟囱、烟横拖 + 尖艏破浪
    装甲：致远穹甲薄、炮位裸露、无连续装甲带；吉野炮位带护盾、装甲带与铆钉成排
    态势：致远孤舰带伤、黄龙旗；吉野以多打少、日章旗

史实口径：致远舰管带邓世昌在弹尽舰伤后下令冲向日舰吉野，中雷沉没，全舰两百余人殉国。
这不是「打赢了」——Boss 血条清空后的收束演出是**撞上去**，随后才是战史收尾对白。

三帧
----
    0 idle    完整、轻煤烟、黄龙旗舒展
    1 damaged 舷侧中弹破洞、舰桥起火、黑烟柱
    2 charge  前倾冲刺、艏浪加大、烟与旗全部向后横拖、炮位熄火

硬性约束（与 gen_yoshino.py 一致）
--------------------------------
* 颜色只能取 `src/core/constants.ts → PALETTE` 的 24 色盘（美术规范 8.1）。
* 纯标准库、确定性：不用 random，任何人重跑都得到同样的字节。
* 背景透明；96×48；第 40 行是吃水线，水下只留 2px 暗影，不画整条蓝水线。
* 旗面用**黄底 + 青龙 + 红日**（黄龙旗），绝不能画成吉野那面白底红日。

用法：
    python tools/gen_zhiyuan.py
    python tools/gen_zhiyuan.py --preview   # 额外出 4 倍放大联系表（不入库）
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "art" / "ship"
PREVIEW = ROOT / "tools" / "_cdp" / "_zhiyuan_preview.png"

W, H = 96, 48
WATER_Y = 40

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
    """RGBA 画板；None = 全透明。"""

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

    def rgba(self) -> bytes:
        out = bytearray(W * H * 4)
        for i, c in enumerate(self.px):
            if c is not None:
                out[i * 4:i * 4 + 4] = bytes((c[0], c[1], c[2], 255))
        return bytes(out)


def write_png(path: Path, raw: bytes, w: int = W, h: int = H) -> None:
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    scan = b"".join(b"\x00" + raw[y * w * 4:(y + 1) * w * 4] for y in range(h))
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scan, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


# ---------------------------------------------------------------- 舰体

def hull(cv: Canvas, damage: int = 0, charge: bool = False) -> None:
    """致远舰：2300 吨 / 18 节，比吉野短一截、艏更圆钝、干舷更高。y=29..40。

    同样是 96×48 画布，靠「左右各留一段空白、只有一根烟囱、7 个裸露炮门、
    没有连续装甲带」读出更小更老；开场卡里再按 0.9 / 1.3 倍对比。
    """
    top = 29
    bot = 39
    for y in range(top, bot + 1):
        # 旧式圆钝艏：比吉野的飞剪艏短 12px，且左端不随层数前伸
        left = 14 if y < top + 8 else 17
        right = 82 if y < top + 9 else 79
        cv.hline(left, y, right - left, PLUM_M if y < top + 4 else PLUM_D)
    # 顶边舷墙（薄穹甲：只一条亮边，不像吉野那样铺一整排铆钉装甲带）
    cv.hline(18, top, 61, PLUM_L)
    cv.hline(15, top + 1, 4, PLUM_L)
    cv.hline(18, top + 1, 61, PLUM_M)
    # 水线暗带 + 吃水 + 水下 2px 暗影（不画蓝水线）
    cv.hline(17, bot - 2, 63, PLUM_D)
    cv.hline(16, bot - 1, 65, PLUM_D)
    cv.hline(14, bot, 67, NIGHT)
    cv.hline(18, bot + 1, 59, PLUM_D)
    cv.hline(22, bot + 2, 51, NIGHT)
    # 铆钉稀疏错列（吉野是成排 7px 一列，这里只有零星几颗）
    for x in range(23, 77, 11):
        cv.put(x, top + 3, GREY_P if h2(x, 3) > 0.5 else PLUM_L)
    # 舷侧受光：只在上沿点几下，不连成亮线
    for x in range(20, 76, 7):
        if h2(x, 23) > 0.58:
            cv.put(x, top + 4, PLUM_L)
    # 7 门旧式炮位：**裸露、无炮盾**（吉野 11 门全带护盾）
    # 这就是「火力配置」差的落点：旧式架退炮打一发要装填一分多钟。
    for x in range(22, 76, 8):
        cv.rect(x, top + 5, 3, 3, INK)
        cv.put(x + 1, top + 6, NIGHT)
        cv.put(x - 1, top + 5, PLUM_L)  # 只有一点受光，没有炮盾上沿
    # 木甲板与栏杆
    cv.hline(17, top - 1, 63, BROWN_D)
    cv.hline(17, top - 2, 63, WOOD)
    for x in range(18, 80, 4):
        cv.put(x, top - 2, PLUM_L)
    # 舰艏破浪白沫：charge 帧明显加大（冲刺的视觉证据）
    n = 14 if charge else 7
    for i in range(n):
        x = 8 + i
        y = bot + (1 if i % 2 else 0)
        if h2(i, 11) > (0.22 if charge else 0.38):
            cv.put(x, y, PAPER if h2(i, 13) > 0.45 else BLUE_L)
    if charge:
        cv.hline(6, bot + 1, 9, PAPER)
        cv.hline(4, bot + 2, 7, BLUE_L)
    # 破损：舷侧破洞 + 烧焦边
    if damage >= 1:
        cv.rect(48, top + 4, 7, 5, INK)
        cv.hline(48, top + 4, 7, RED_D)
        cv.put(55, top + 6, RED_B)
        cv.rect(27, top + 5, 5, 4, INK)


# ------------------------------------------------------------ 上层建筑

def superstructure(cv: Canvas, damage: int = 0, charge: bool = False) -> None:
    # 210mm 双联主炮塔（旧式大口径，只有一座；吉野是两座带盾 152mm 速射炮）
    for y in range(23, 29):
        inset = (y - 23) // 3
        cv.hline(20 + inset, y, 13 - inset * 2, PLUM_L)
    cv.hline(20, 23, 13, GREY_P)
    cv.rect(24, 25, 7, 2, INK)
    # 两根朝左的旧式大炮管（比吉野的速射炮粗、长，但只有两根）
    cv.hline(10, 25, 10, GREY_P)
    cv.hline(10, 26, 10, PLUM_M)
    cv.hline(12, 25, 8, INK)
    cv.rect(10, 25, 2, 2, INK)

    # 单烟囱：柱身 + 左高光 + 顶部黑口 + 一道识别带（吉野是两根）
    cv.rect(50, 12, 7, 17, PLUM_D)
    cv.vline(50, 12, 17, PLUM_M)
    cv.rect(50, 12, 7, 2, INK)
    cv.hline(50, 19, 7, PLUM_L)
    cv.hline(50, 20, 7, RED_D)
    cv.put(56, 15, GREY_P)

    # 舰桥：窗、顶沿（比吉野矮小，没有探照灯）
    cv.rect(43, 20, 12, 8, PLUM_L)
    cv.hline(43, 20, 12, GREY_P)
    cv.vline(43, 21, 7, PLUM_M)
    cv.vline(54, 21, 7, PLUM_D)
    for x in (46, 49, 52):
        cv.rect(x, 23, 2, 2, INK)
        cv.put(x, 23, BLUE_L if h2(x, 21) > 0.5 else INK)

    # 主桅 + 横桁 + 索具（charge 帧前倾）
    mast_x = 74 + (2 if charge else 0)
    mast_top = 6 if damage < 1 else 13
    cv.vline(mast_x, mast_top, 29 - mast_top, GREY_P)
    cv.vline(mast_x + 1, mast_top + 2, 27 - mast_top, PLUM_M)
    cv.hline(mast_x - 6, 11, 12, GREY_P)
    cv.hline(mast_x - 4, 14, 8, PLUM_L)
    cv.line(mast_x, 7, 16, 28, PLUM_M)
    cv.line(mast_x, 7, 82, 28, PLUM_M)
    cv.put(mast_x, 5, STAR)
    # 前桅（短）
    cv.vline(16, 16, 12, PLUM_L)
    cv.hline(12, 17, 8, GREY_P)


def dragon_flag(cv: Canvas, damage: int, charge: bool) -> None:
    """舰艉黄龙旗：黄底 + 靛青龙身 + 红日。绝不能画成吉野的白底红日。"""
    y = 12
    cv.vline(79, y - 3, 16, GREY_P)
    cv.rect(80, y, 14, 9, CREAM)
    cv.hline(80, y, 14, STAR)
    cv.hline(80, y + 8, 14, SAND)
    # 龙身：一条错落的靛青折线 + 两处爪，像素画里够读出「不是白旗」
    for i in range(9):
        x = 81 + i
        yy = y + 3 + (1 if i % 3 == 0 else 0) - (1 if i > 5 else 0)
        cv.put(x, yy, INDIGO)
        if i % 3 == 1:
            cv.put(x, yy + 1, BLUE)
    cv.put(83, y + 2, INK)
    cv.put(86, y + 5, INK)
    # 右上角红日（小，别盖过整面黄旗）
    cv.put(91, y + 2, RED)
    cv.put(92, y + 2, RED_B)
    cv.put(91, y + 3, RED_D)
    # 冲刺 / 破损时旗向后飘、缺角
    if charge:
        cv.put(93, y, None)
        cv.put(93, y + 4, None)
        cv.hline(94, y + 2, 2, CREAM)
    if damage:
        cv.put(93, y + 7, None)
        cv.put(92, y + 8, None)
        cv.put(84, y, PLUM_D)


# ---------------------------------------------------------------- 烟 / 火

def smoke(cv: Canvas, cx: int, cy: int, amount: int, seed: int, drift: int = 0) -> None:
    """颗粒状煤烟。致远速度慢 → 烟直上；charge 帧才向右横拖。"""
    for k in range(amount * 5):
        t = h2(seed + k, 17)
        rise = int(h2(k * 3, seed + 5) * max(1, cy - 1))
        y = cy - rise
        span = 3 + rise // 3 + drift
        x = cx + 2 - rise // 6 + int(t * span) if drift else cx + 2 - rise // 6 - int(t * span)
        if y < 1 or not (0 <= x < W):
            continue
        if h2(k + 7, seed + 11) > (0.46 if drift else 0.64):
            continue
        r = h2(k * 5, seed + 13)
        cv.put(x, y, NIGHT if r > 0.74 else (PLUM_D if r > 0.40 else (PLUM_L if r > 0.18 else GREY_P)))


def fire(cv: Canvas, cx: int, cy: int, size: int, seed: int) -> None:
    for k in range(size * 3):
        x = cx + int((h2(k, seed) - 0.5) * (size * 2))
        y = cy - int(h2(k * 2, seed + 3) * size)
        if h2(k + 1, seed + 5) > 0.55:
            continue
        r = h2(k, seed + 7)
        cv.put(x, y, STAR if r > 0.78 else (RED_B if r > 0.45 else RED_D))
    smoke(cv, cx, cy - size, size, seed + 31, drift=4)


# ---------------------------------------------------------------- 三帧

def draw(frame: int) -> Canvas:
    cv = Canvas()
    damage = 1 if frame == 1 else 0
    charge = frame == 2
    hull(cv, damage, charge)
    superstructure(cv, damage, charge)

    # 常态煤烟：旧船单烟囱、烟直上；冲刺帧烟被风压向舰艉
    base = {0: 18, 1: 34, 2: 26}[frame]
    smoke(cv, 52, 10, base, 100 + frame * 7, drift=6 if charge else 0)

    if frame == 1:
        fire(cv, 50, 23, 6, 500)
        fire(cv, 29, 27, 4, 600)
        cv.hline(69, 18, 7, PLUM_D)  # 断索
    if frame == 2:
        # 炮位熄火：7 个炮门全部压暗，读得出「弹尽」
        for x in range(22, 76, 8):
            cv.rect(x - 1, 34, 5, 4, NIGHT)

    dragon_flag(cv, damage, charge)
    return cv


def check(cv: Canvas) -> None:
    bad = {c for c in cv.px if c is not None and c not in PALETTE_24}
    assert not bad, f"出现 24 色盘之外的颜色：{bad}"


def main() -> None:
    frames = []
    for i in range(3):
        cv = draw(i)
        check(cv)
        frames.append(cv)
        p = OUT_DIR / f"zhiyuan_{i:02d}.png"
        write_png(p, cv.rgba())
        colors = len({c for c in cv.px if c is not None})
        opaque = sum(1 for c in cv.px if c is not None)
        print(f"zhiyuan_{i:02d}.png  颜色 {colors:2d}  不透明 {opaque:4d}  {p.stat().st_size} B")

    base = frames[0].px
    for i, cv in enumerate(frames[1:], 1):
        diff = sum(1 for a, b in zip(base, cv.px) if a != b)
        assert diff > 80, f"第 {i} 帧与 idle 差异只有 {diff} 像素，状态看不出来"
        print(f"  frame{i} vs idle 差异 {diff} 像素")

    # 黄龙旗必须是黄底，绝不能退化成吉野的白底红日
    for i, cv in enumerate(frames):
        yellow = sum(1 for c in cv.px if c in (CREAM, STAR, SAND))
        assert yellow >= 20, f"第 {i} 帧黄龙旗黄底只剩 {yellow} 像素"
        print(f"  frame{i} 黄龙旗黄底 {yellow} 像素")

    if "--preview" in sys.argv:
        S, COLS, GAP = 4, 3, 10
        pw = COLS * (W * S + GAP) + GAP
        ph = (H * S + GAP) + GAP
        out = [bytearray(b"\x00" * (pw * 4)) for _ in range(ph)]
        for i, cv in enumerate(frames):
            ox = GAP + i * (W * S + GAP)
            oy = GAP
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
        PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        write_png(PREVIEW, raw, pw, ph)
        print(f"预览 {PREVIEW}")


if __name__ == "__main__":
    main()
