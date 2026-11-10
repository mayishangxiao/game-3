#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「天京城破之夜」战争氛围源图压成游戏用的 480x64 像素远景条。

只产出一张背景图：public/art/bg/bg_strip_tianjing_fall.png

为什么需要它
------------
`map_ch00_tp_battlefield`（1864 天京陷落 / 城破之战）原来和第一幕虎门海战
共用 `bg_strip_dusk.png`（黄昏双舰海景）。天京不靠海，语义不对，规格书第 10 节
把它登记为已知限制。新的远景条以火光四起、战火映照、浓烟弥漫为主视觉，
只在 `tileset === 'tp_act2'` 且 `sky_rows > 0` 的关卡启用，其它战斗关卡不受影响。

硬性约束（改脚本前先读）
------------------------
* 输出**必须**是 480x64 RGBA PNG：`Backdrop.horizonImage()` 按 1.6 倍放大、
  水平居中裁切，`LevelScene.buildWorld()` 用 `HORIZON_H * 1.6` 算淡出带，
  尺寸变了会连带错位。瓦片是 16px、sky_rows=4 行 = 64px。
* 颜色只能取 `src/core/constants.ts` 的 24 色盘（美术规范 8.1「硬阴影不引入新色」）。
* 引擎把条带顶边贴 `y=0` 放大 1.6 倍，地砖从第 64 逻辑像素起盖住下半截，
  所以**真正可见的是原图 y=0..40 行**；顶部约 10 行又被战役条白字压着。
  构图把烟底 / 城楼 / 火光 / 城墙放在 y=8..38，是最重要的可视区。
* 顶部 9 行与右上角「暂停」区必须压暗，否则白字压在烟与火光上读不清
  （用户要求「不遮挡主要内容」）。
* 源图右下角有生成水印，裁切窗口最远只到 y=830，完全避开。

纯标准库实现（本机没有 Pillow）：自写 PNG 解码（filter 0-4 / RGB 8bit）、
分段 y 映射、4x4 box 采样、Bayer 4x4 有序抖动、24 色最近色量化、zlib 编码。
可重复执行，输出字节完全一致。
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tools/_art_in/tianjing_fall_src.png"
OUT = ROOT / "public/art/bg/bg_strip_tianjing_fall.png"

W, H = 480, 64

# src/core/constants.ts · PALETTE（24 色锁 v2）
PALETTE: dict[str, int] = {
    "ink": 0x0D0B14, "night": 0x1C1A2B, "plumDark": 0x2F2B45,
    "plumMid": 0x4A4468, "plumLight": 0x6B6489, "greyPlum": 0x948DAB,
    "greyLight": 0xC2BCD1, "paper": 0xF2EDE4, "cream": 0xE8CFA8,
    "sand": 0xCFA26A, "brown": 0xA8763F, "brownDark": 0x7A4F2A,
    "brownDeep": 0x4E2F1A, "redDark": 0x8C1C1C, "red": 0xC0392B,
    "redBright": 0xE85C4A, "redSoft": 0xF2A08C, "greenDark": 0x4A7A2E,
    "green": 0x7BA84A, "greenLight": 0xA8D070, "indigo": 0x2A5A8A,
    "blue": 0x4A90C8, "blueLight": 0x7BC0E8, "star": 0xD4A840,
}
RGB24 = [((c >> 16) & 255, (c >> 8) & 255, c & 255) for c in PALETTE.values()]

BAYER = (
    (0, 8, 2, 10),
    (12, 4, 14, 6),
    (3, 11, 1, 9),
    (15, 7, 13, 5),
)

# 源图 1536x1024 的纵向分段映射：把「烟底 + 城楼 + 火光 + 城墙」这段
# 视觉重点分配更多输出行，纯等比压缩会把火光挤成一条模糊的线。
# (out_y0, out_y1, src_y0, src_y1)
SEGMENTS = (
    (0, 10, 40, 300),     # 上部浓烟，压暗后给战役条做底
    (10, 42, 250, 700),   # 主视觉：翻滚浓烟下缘 / 燃烧城楼 / 火光 / 城墙剪影
    (42, 64, 700, 830),   # 下沿暗部，多数被地砖盖住，只负责过渡
)


# --------------------------------------------------------------------------- PNG

def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def load_rgb_png(path: Path) -> tuple[int, int, list[bytearray]]:
    """解码 8bit RGB / RGBA、非交错的 PNG，返回 (w, h, 每行 RGB 字节)。"""
    b = path.read_bytes()
    assert b[:8] == b"\x89PNG\r\n\x1a\n", f"{path} 不是 PNG"
    pos, idat = 8, bytearray()
    w = h = bd = ct = inter = None
    while pos < len(b):
        ln = struct.unpack(">I", b[pos:pos + 4])[0]
        tag = b[pos + 4:pos + 8]
        data = b[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if tag == b"IHDR":
            w, h, bd, ct, _comp, _filt, inter = struct.unpack(">IIBBBBB", data)
        elif tag == b"IDAT":
            idat += data
        elif tag == b"IEND":
            break
    assert bd == 8 and ct in (2, 6) and inter == 0, f"不支持的 PNG 格式 bd={bd} ct={ct} inter={inter}"
    bpp = 3 if ct == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = w * bpp
    rows: list[bytearray] = []
    prev = bytearray(stride)
    i = 0
    for _y in range(h):
        f = raw[i]
        i += 1
        cur = bytearray(raw[i:i + stride])
        i += stride
        if f == 1:
            for x in range(bpp, stride):
                cur[x] = (cur[x] + cur[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                cur[x] = (cur[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0
                cur[x] = (cur[x] + ((a + prev[x]) // 2)) & 255
        elif f == 4:
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0
                up = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + up - c
                pa, pb, pc = abs(p - a), abs(p - up), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (up if pb <= pc else c)
                cur[x] = (cur[x] + pr) & 255
        elif f != 0:
            raise ValueError(f"未知 PNG filter {f}")
        rows.append(cur)
        prev = cur
    if bpp == 4:  # RGBA -> RGB（本条带不需要 alpha，引擎用不到）
        rows = [bytearray(v for j in range(0, w * 4, 4) for v in row[j:j + 3]) for row in rows]
    return w, h, rows


def write_rgba_png(path: Path, pixels: bytes, w: int, h: int) -> None:
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += pixels[y * stride:(y + 1) * stride]
    png = (b"\x89PNG\r\n\x1a\n"
           + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + _chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


# --------------------------------------------------------------------------- 采样

def src_y_range(out_y: float) -> tuple[float, float]:
    for y0, y1, s0, s1 in SEGMENTS:
        if y0 <= out_y < y1:
            t = (out_y - y0) / (y1 - y0)
            u = (out_y + 1 - y0) / (y1 - y0)
            return s0 + (s1 - s0) * t, s0 + (s1 - s0) * min(u, 1.0)
    return SEGMENTS[-1][2], SEGMENTS[-1][3]


def box_sample(rows: list[bytearray], sw: int, sh: int, x: int, y: int) -> tuple[float, float, float]:
    """每个输出像素取 4x4 子样本平均，避免照片降采样后的椒盐噪点。"""
    sx0, sx1 = x * sw / W, (x + 1) * sw / W
    sy0, sy1 = src_y_range(y)
    if sy1 <= sy0:
        sy1 = sy0 + 1
    acc = [0.0, 0.0, 0.0]
    n = 0
    for j in range(4):
        sy = sy0 + (sy1 - sy0) * (j + 0.5) / 4
        iy = min(sh - 1, max(0, int(sy)))
        row = rows[iy]
        for k in range(4):
            sx = sx0 + (sx1 - sx0) * (k + 0.5) / 4
            ix = min(sw - 1, max(0, int(sx)))
            o = ix * 3
            acc[0] += row[o]
            acc[1] += row[o + 1]
            acc[2] += row[o + 2]
            n += 1
    return acc[0] / n, acc[1] / n, acc[2] / n


def nearest_palette(r: float, g: float, b: float) -> tuple[int, int, int]:
    best = RGB24[0]
    best_d = float("inf")
    for pr, pg, pb in RGB24:
        dr, dg, db = r - pr, g - pg, b - pb
        d = dr * dr + dg * dg + (db * db) * 0.82  # 蓝通道稍降权，保住暖色火光
        if d < best_d:
            best_d, best = d, (pr, pg, pb)
    return best


def build(rows: list[bytearray], sw: int, sh: int) -> bytes:
    # 第一遍：采样 + gamma 提亮。源图是夜景，线性提亮会把暗部烟层全压成 ink，
    # gamma 0.72 把 20~70 的暗部抬到 plumDark/greyPlum 一档，浓烟才有层次。
    base: list[tuple[float, float, float]] = []
    for y in range(H):
        for x in range(W):
            r, g, b = box_sample(rows, sw, sh, x, y)
            base.append((255 * (r / 255) ** 0.72,
                         255 * (g / 255) ** 0.72,
                         255 * (b / 255) ** 0.72))

    # 第二遍：逐列统计火光强度，用来把「战火映照」染到上方烟层与夜空。
    fire = [0.0] * W
    for y in range(14, 46):
        for x in range(W):
            r, g, b = base[y * W + x]
            fire[x] += max(0.0, (r - g) * 0.7 + (r - b) * 0.5) * (r / 255)
    spread = [sum(fire[max(0, x - 7):min(W, x + 8)]) /
              len(fire[max(0, x - 7):min(W, x + 8)]) for x in range(W)]
    peak = max(spread) or 1.0
    glow = [min(1.0, v / peak) for v in spread]

    out = bytearray(W * H * 4)
    for y in range(H):
        for x in range(W):
            r, g, b = base[y * W + x]

            # 火光把上方的浓烟与夜空映成暗红橙：这是「战火映照」的主视觉
            if 5 <= y < 30 and glow[x] > 0.06:
                k = glow[x] * max(0.0, 1.0 - abs(y - 17) / 20) * 0.60
                r = min(255.0, r + 105 * k)
                g = min(255.0, g + 30 * k)
                b = min(255.0, b + 6 * k)

            # 火苗本身再推一档暖色，量化后才落得到 red / redBright / star
            if r > g * 1.18 and r > b * 1.30:
                r = min(255.0, r * 1.20)
                g = min(255.0, g * 1.06)
                b *= 0.86

            # 顶部战役条（白字）与右上角「暂停」区：压暗，保证不遮挡主要内容
            if y < 8:
                k = 0.58 + 0.05 * (y / 8)
                r, g, b = r * k, g * k, b * (k + 0.04)
            if x > 424 and y < 14:
                r, g, b = r * 0.64, g * 0.64, b * 0.68
            # 可见区下沿：非火光部分压成连成一体的暗色城墙/地面剪影，
            # 火光就有了「从墙后烧起来」的层次，也避免暗部抖出一地噪点。
            if y >= 34 and not (r > g * 1.18 and r > b * 1.30):
                r, g, b = r * 0.72, g * 0.72, b * 0.76
            # 其余下沿渐暗，避免与第一排地砖出现刀刃般的硬线
            if y >= 50:
                k = 1.0 - 0.32 * ((y - 50) / 14)
                r, g, b = r * k, g * k, b * k

            # Bayer 4x4 有序抖动：暗部烟层保留层次，不出现大块色带；
            # 幅度压到 10，再大就会读成满屏椒盐噪点（第一版 20、第二版 14 实拍都偏脏）。
            d = (BAYER[y % 4][x % 4] / 16 - 0.5) * 10
            pr, pg, pb = nearest_palette(r + d, g + d, b + d)
            o = (y * W + x) * 4
            out[o:o + 4] = bytes((pr, pg, pb, 255))
    return bytes(out)


def self_check(pixels: bytes) -> None:
    assert len(pixels) == W * H * 4
    legal = set(RGB24)
    top_lum = 0
    warm = 0
    for y in range(H):
        for x in range(W):
            o = (y * W + x) * 4
            c = (pixels[o], pixels[o + 1], pixels[o + 2])
            assert c in legal, f"非 24 色盘颜色 {c} @ ({x},{y})"
            assert pixels[o + 3] == 255
            if r_is_warm(*c):
                warm += 1
            if y < 9:
                top_lum += (c[0] * 299 + c[1] * 587 + c[2] * 114) // 1000
    avg_top = top_lum / (W * 9)
    warm_ratio = warm / (W * H)
    assert avg_top < 72, f"顶部 HUD 区太亮（{avg_top:.1f}），白字会读不清"
    assert warm_ratio > 0.03, f"火光占比过低（{warm_ratio:.1%}），主视觉不成立"
    print(f"自检通过：{W}x{H} / 24 色盘内 / 顶部 HUD 区平均亮度 {avg_top:.1f} / 暖色火光占比 {warm_ratio:.1%}")


def r_is_warm(r: int, g: int, b: int) -> bool:
    return r > g + 28 and r > b + 38 and r > 90


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"缺少源图 {SRC}（AI 生成的城破之夜全景）")
    sw, sh, rows = load_rgb_png(SRC)
    print(f"源图 {SRC.name} {sw}x{sh}")
    pixels = build(rows, sw, sh)
    self_check(pixels)
    write_rgba_png(OUT, pixels, W, H)
    print(f"输出 {OUT.relative_to(ROOT)} {W}x{H} {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
