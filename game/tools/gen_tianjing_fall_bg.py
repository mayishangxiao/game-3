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

v1.4 清晰度修正（2026-11-10）
----------------------------
第一版把 1536x1024 的源图做 4x4 均值降采样 + 全局 Bayer 抖动，城墙 / 城楼 /
垛口全被平均成一片橙褐噪点，实拍里「背景主体看不清」。这次只改图像处理：

* **重排纵向映射**：旧映射把源图 y=560..660 的城墙挤到输出 y=32..39，
  正好落进「下沿压暗区」又被 1.6 倍裁切吃掉。新映射把「城楼飞檐 + 垛口 +
  火光 + 城墙」放在输出 y=19..39，即 HUD 之下、地砖之上的真正可视区。
* **保边采样**：均值之外混入 30% 的高亮子样本，火苗与屋檐亮边不会降采样后消失。
* **局部对比增强（unsharp）**：5x3 低通做底，`base + 0.70*(base-blur)`，
  让烟团边界 / 飞檐 / 墙线 / 火点有硬轮廓，不再糊成渐变。
* **自适应抖动**：抖动幅度随局部梯度下降（平滑区保色阶，边缘区不抖），
  火光高亮区再打个折。旧版固定幅度 10 的满屏椒盐是「看起来糊」的主因之一。
* **火光映照收敛**：0.60 -> 0.38 且只染烟层下缘，避免把整条烟染成一片橙。
* **分档量化**：不再取「24 色最近色」，改按暖度 + 亮度收敛成一组单调递增的
  硬边色阶（冷烟 -> 暖烟 -> 火晕 -> 火焰 -> 火核）。相邻档差太大时，最近色
  会把一点采样扰动放大成满屏散点，这正是「糊」的观感来源。
* **结构层**：降采样后烟与暗部城墙亮度差不足 10、量化落成同色，纯锐化读不出
  墙在哪。按源图构图坐标用 1px 暗色硬边描回墙顶线 / 垛口 / 城楼飞檐 / 门洞，
  只覆盖暗部像素，火光列整体让位给源图；颜色全在 24 色盘内且亮度压得很低。

以上均为背景像素本身的处理；尺寸、色盘、HUD 压暗、布局、文案、前景与其它素材不变。

硬性约束（改脚本前先读）
------------------------
* 输出**必须**是 480x64 RGBA PNG：`Backdrop.horizonImage()` 按 1.6 倍放大、
  水平居中裁切，`LevelScene.buildWorld()` 用 `HORIZON_H * 1.6` 算淡出带，
  尺寸变了会连带错位。瓦片是 16px、sky_rows=4 行 = 64px。
* 颜色只能取 `src/core/constants.ts` 的 24 色盘（美术规范 8.1「硬阴影不引入新色」）。
* 引擎把条带顶边贴 `y=0` 放大 1.6 倍，地砖从第 64 逻辑像素起盖住下半截，
  所以**真正可见的是原图 y=0..40 行**；顶部约 10~16 行又被战役条白字压着。
  构图把烟底 / 城楼 / 火光 / 城墙放在 y=16..40，是最重要的可视区。
* 顶部 9 行与右上角「暂停」区必须压暗，否则白字压在烟与火光上读不清
  （用户要求「不遮挡主要内容」）。9..17 行做渐亮过渡，不把主体一起压死。
* 源图右下角有生成水印，裁切窗口最远只到 y=830，完全避开。

纯标准库实现（本机没有 Pillow）：自写 PNG 解码（filter 0-4 / RGB 8bit）、
分段 y 映射、4x4 保边采样、5x3 unsharp、Bayer 4x4 自适应抖动、24 色盘分档量化、
1px 硬边结构层、zlib 编码。可重复执行，输出字节完全一致。
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
C24 = {k: ((v >> 16) & 255, (v >> 8) & 255, v & 255) for k, v in PALETTE.items()}

BAYER = (
    (0, 8, 2, 10),
    (12, 4, 14, 6),
    (3, 11, 1, 9),
    (15, 7, 13, 5),
)

# 源图 1536x1024 的纵向分段映射。源图里：浓烟 0..430、城楼飞檐 424..490、
# 垛口 / 墙顶 558、墙体 558..660、地面 700+。让主体占满 HUD 之下的可见区，
# 纯等比压缩会把城楼压成一条 3px 的糊线（v1.3 的毛病）。
# (out_y0, out_y1, src_y0, src_y1)
SEGMENTS = (
    (0, 10, 20, 300),     # 上部浓烟，压暗后给战役条做底
    (10, 19, 300, 450),   # 浓烟下缘，团块边界
    (19, 29, 430, 580),   # 主视觉上段：城楼飞檐 / 火光上冲 / 垛口
    (29, 39, 570, 700),   # 主视觉下段：城墙墙体 / 门洞火光 / 墙根烟
    (39, 64, 700, 830),   # 下沿暗部，多数被地砖盖住，只负责过渡
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


def lum(c: tuple[float, float, float]) -> float:
    return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114


def box_sample(rows: list[bytearray], sw: int, sh: int, x: int, y: int) -> tuple[float, float, float]:
    """4x4 子采样，均值之外混入高亮子样本——纯均值会把火苗和屋檐亮边直接抹平。"""
    sx0, sx1 = x * sw / W, (x + 1) * sw / W
    sy0, sy1 = src_y_range(y)
    if sy1 <= sy0:
        sy1 = sy0 + 1
    acc = [0.0, 0.0, 0.0]
    samples: list[tuple[float, float, float]] = []
    for j in range(4):
        sy = sy0 + (sy1 - sy0) * (j + 0.5) / 4
        iy = min(sh - 1, max(0, int(sy)))
        row = rows[iy]
        for k in range(4):
            sx = sx0 + (sx1 - sx0) * (k + 0.5) / 4
            ix = min(sw - 1, max(0, int(sx)))
            o = ix * 3
            c = (float(row[o]), float(row[o + 1]), float(row[o + 2]))
            samples.append(c)
            for ch in range(3):
                acc[ch] += c[ch]
    mean = (acc[0] / 16, acc[1] / 16, acc[2] / 16)
    hi = max(samples, key=lum)
    # 只在亮边确实明显时才提权，避免整幅图被抬亮、抢前景
    k = 0.30 if lum(hi) - lum(mean) > 26 else 0.08
    return tuple(mean[ch] * (1 - k) + hi[ch] * k for ch in range(3))  # type: ignore[return-value]


def lowpass(base: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    """5x3 可分离 box 模糊，只给 unsharp 当底，不参与输出。"""
    horiz: list[tuple[float, float, float]] = []
    for y in range(H):
        for x in range(W):
            a, b = max(0, x - 2), min(W, x + 3)
            acc = [0.0, 0.0, 0.0]
            for xx in range(a, b):
                c = base[y * W + xx]
                for ch in range(3):
                    acc[ch] += c[ch]
            horiz.append(tuple(v / (b - a) for v in acc))  # type: ignore[arg-type]
    out: list[tuple[float, float, float]] = []
    for y in range(H):
        a, b = max(0, y - 1), min(H, y + 2)
        for x in range(W):
            acc = [0.0, 0.0, 0.0]
            for yy in range(a, b):
                c = horiz[yy * W + x]
                for ch in range(3):
                    acc[ch] += c[ch]
            out.append(tuple(v / (b - a) for v in acc))  # type: ignore[arg-type]
    return out


def clamp(v: float) -> float:
    return 0.0 if v < 0 else (255.0 if v > 255 else v)


def tone_palette(r: float, g: float, b: float, d: float) -> tuple[int, int, int]:
    """全图分档量化：按「暖度 + 亮度」把 24 色盘收敛成一组有序色阶。

    为什么不用「最近色」：24 色盘在暗部相邻档亮度差 20~40，任何一点采样
    扰动都会让相邻像素跳到不同档，视觉上就是一片糊掉的散点。分档后
    「冷烟 -> 暖烟 -> 火晕 -> 火焰 -> 火核」是单调递增的硬边色阶，
    烟团 / 城墙 / 火光的边界成块，轮廓反而清楚，也不会凭空多出亮色抢眼。
    d 是自适应 Bayer 抖动，只给档与档的边界做像素级过渡。
    """
    L = lum((r, g, b)) + d
    warm = r - b
    # 高亮档门槛刻意收窄：分档后火光连成片，若不收窄会比旧图更抢眼，
    # 压过场上的角色与 HUD。只留少量火核到 star / redBright，其余落在
    # red / redDark / brownDark，仍能读出「火光四起」但不刺目。
    if warm > 105 and L > 150:
        return C24["star"]
    if warm > 82:
        return C24["redBright"] if L > 130 else C24["red"]
    if warm > 55:
        return C24["red"] if L > 112 else C24["redDark"]
    if warm > 32:
        return C24["brownDark"] if L > 88 else C24["brownDeep"]
    if warm > 16:
        return C24["brownDeep"] if L > 62 else C24["plumDark"]
    if L > 95:
        return C24["plumLight"]
    if L > 72:
        return C24["plumMid"]
    if L > 52:
        return C24["plumDark"]
    if L > 34:
        return C24["night"]
    return C24["ink"]


def edge_preserving_smooth(src: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    """3x3 边缘保持平滑：低对比区压成整块（去掉量化后的一地散点），
    真正的墙线 / 屋檐 / 火光边界原样保留。不先做这一步，unsharp 会把
    24 色量化的色阶跳变一起放大，画面反而更「糊」。
    """
    L = [lum(c) for c in src]
    out: list[tuple[float, float, float]] = []
    for y in range(H):
        for x in range(W):
            i = y * W + x
            a, b = max(0, y - 1), min(H, y + 2)
            c, d = max(0, x - 1), min(W, x + 2)
            vals = [src[yy * W + xx] for yy in range(a, b) for xx in range(c, d)]
            mean = tuple(sum(v[ch] for v in vals) / len(vals) for ch in range(3))
            g = max(abs(L[yy * W + xx] - L[i]) for yy in range(a, b) for xx in range(c, d))
            k = 0.85 if g < 14 else (0.35 if g < 30 else 0.0)
            out.append(tuple(src[i][ch] * (1 - k) + mean[ch] * k for ch in range(3)))  # type: ignore[arg-type]
    return out


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

    # 第二遍：先边缘保持平滑再局部对比增强。降采样把城墙线 / 飞檐 / 烟团边界
    # 磨成渐变，unsharp 把这些大尺度边缘找回来；平滑是前提，否则锐化只会放大
    # 量化色阶跳变，得到「更清楚的噪点」而不是「更清楚的轮廓」。
    clean = edge_preserving_smooth(base)
    blur = lowpass(clean)
    sharp: list[tuple[float, float, float]] = []
    for c, m in zip(clean, blur):
        sharp.append(tuple(clamp(c[ch] + 0.50 * (c[ch] - m[ch])) for ch in range(3)))  # type: ignore[arg-type]

    # 第三遍：局部梯度图，抖动幅度按边缘强度自适应（见下面 dither_amp）。
    sl = [lum(c) for c in sharp]
    edge = [0.0] * (W * H)
    for y in range(H):
        for x in range(W):
            gx = abs(sl[y * W + min(W - 1, x + 1)] - sl[y * W + max(0, x - 1)])
            gy = abs(sl[min(H - 1, y + 1) * W + x] - sl[max(0, y - 1) * W + x])
            edge[y * W + x] = min(1.0, (gx + gy) / 70.0)

    # 第四遍：逐列统计火光强度，用来把「战火映照」染到上方烟层与夜空。
    fire = [0.0] * W
    for y in range(18, 42):
        for x in range(W):
            r, g, b = sharp[y * W + x]
            fire[x] += max(0.0, (r - g) * 0.7 + (r - b) * 0.5) * (r / 255)
    spread = [sum(fire[max(0, x - 7):min(W, x + 8)]) /
              len(fire[max(0, x - 7):min(W, x + 8)]) for x in range(W)]
    peak = max(spread) or 1.0
    glow = [min(1.0, v / peak) for v in spread]

    out = bytearray(W * H * 4)
    for y in range(H):
        for x in range(W):
            i = y * W + x
            r, g, b = sharp[i]

            # 火光把上方的浓烟与夜空映成暗红橙：这是「战火映照」的主视觉。
            # v1.4 收敛强度与范围，避免把整条烟糊成一片橙（清晰度的反面）。
            if 9 <= y < 34 and glow[x] > 0.06:
                k = glow[x] * max(0.0, 1.0 - abs(y - 22) / 22) * 0.32
                r = min(255.0, r + 85 * k)
                g = min(255.0, g + 26 * k)
                b = min(255.0, b + 5 * k)

            # 火苗本身再推一档暖色，量化后才落得到 red / redBright / star
            if r > g * 1.18 and r > b * 1.30:
                r = min(255.0, r * 1.16)
                g = min(255.0, g * 1.05)
                b *= 0.88

            # 顶部战役条（白字）与右上角「暂停」区：压暗，保证不遮挡主要内容。
            # 9..17 行是 HUD 下沿到主体的过渡带，只做渐亮，不把城楼一起压死。
            if y < 9:
                k = 0.58 + 0.05 * (y / 9)
                r, g, b = r * k, g * k, b * (k + 0.04)
            elif y < 17:
                k = 0.72 + 0.28 * ((y - 9) / 8)
                r, g, b = r * k, g * k, b * k
            if x > 424 and y < 16:
                r, g, b = r * 0.64, g * 0.64, b * 0.68
            # 可见区之外的下沿：压成连成一体的暗色墙根/地面剪影，
            # 火光就有了「从墙后烧起来」的层次。阈值从 34 挪到 40，
            # 不再把刚映射进来的城墙主体一起压黑。
            if y >= 40 and not (r > g * 1.18 and r > b * 1.30):
                r, g, b = r * 0.80, g * 0.80, b * 0.82
            if y >= 50:
                k = 1.0 - 0.32 * ((y - 50) / 14)
                r, g, b = r * k, g * k, b * k

            # 自适应 Bayer 抖动：平滑区保色阶，边缘区几乎不抖（保护轮廓），
            # 火光高亮区再打折。旧版固定幅度 10 的满屏椒盐是「发糊」的主因。
            amp = 1.0 + 2.5 * (1.0 - edge[i])
            if lum((r, g, b)) > 110:
                amp *= 0.6
            d = (BAYER[y % 4][x % 4] / 16 - 0.5) * amp
            pr, pg, pb = tone_palette(r, g, b, d)
            o = i * 4
            out[o:o + 4] = bytes((pr, pg, pb, 255))
    return structure_layer(bytes(out), sharp, glow)


def structure_layer(pixels: bytes, sharp: list[tuple[float, float, float]], glow: list[float]) -> bytes:
    """只勾轮廓、不重画：把源图里被降采样抹掉的城墙结构用 1px 硬边找回来。

    为什么必须有这一步：24 色盘里「烟」和「暗部城墙」是相邻的两三档色，
    4x4 降采样后两者亮度差不足 10，量化后落成同一个颜色 —— 无论怎么锐化
    都读不出墙在哪。这里按源图固定的构图坐标（墙顶源 y=558 -> 输出 y=28）
    描一层低亮度的暖色硬边，只覆盖暗部像素，火光列整体让位给源图：

      * 墙顶受火光映照的 1px 亮线 + 每 12px 一齿的垛口；
      * 墙体的整块暖暗色（与上方冷紫烟层拉开色相，是最关键的识别特征）；
      * 中央城楼的屋脊 / 飞檐 / 檐线 / 立柱 / 门洞轮廓。

    全部取 PALETTE 内的暗色，不引入新配色；不碰 HUD 区（y<17）与前景。
    """
    out = bytearray(pixels)
    C = {k: ((v >> 16) & 255, (v >> 8) & 255, v & 255) for k, v in PALETTE.items()}

    def put(x: int, y: int, c: tuple[int, int, int]) -> None:
        if 0 <= x < W and 0 <= y < H:
            o = (y * W + x) * 4
            out[o:o + 4] = bytes((c[0], c[1], c[2], 255))

    def dark_at(x: int, y: int) -> bool:
        return lum(sharp[y * W + x]) < 78

    for x in range(W):
        if glow[x] > 0.45:  # 火光正往上烧的列，保留源图火苗
            continue
        # 墙顶线：整体压在 brownDeep 一档，只在火光边上借一点暖亮，
        # 否则一条贯穿全屏的高亮横线会盖过场上的角色与 HUD。
        put(x, 28, C["brownDark"] if glow[x] > 0.40 else C["brownDeep"])
        # 垛口：7px 齿 + 5px 缺口，齿顶留一线亮边，读作城墙而不是一排栅栏
        if x % 12 < 7:
            put(x, 26, C["brownDeep"])
            put(x, 27, C["plumDark"])
            if x % 12 == 0:
                put(x, 25, C["brownDeep"])
        # 墙体：只把暗部并成整块，亮部（火光、被照亮的砖）原样留着
        for y in range(29, 38):
            if dark_at(x, y):
                c = C["plumDark"] if (x // 9 + y // 4) % 4 == 0 else C["brownDeep"]
                put(x, y, c)
        # 墙根一道暗线，交代墙与地面的分界
        if dark_at(x, 38):
            put(x, 38, C["ink"])

    # 中央城楼（源图 x≈585..975 -> 输出 183..305）：只描边，不填成色块，
    # 免得在烟幕里贴上一块规则矩形。屋脊两端上翘，是「中式城楼」的识别点。
    tl, tr = 186, 300
    for x in range(tl, tr + 1):
        t = (x - tl) / (tr - tl)
        ridge = 17 + int(3 * (1 - 2 * abs(t - 0.5)))  # 中间低、两端翘
        put(x, ridge, C["brownDark"])
        put(x, ridge + 1, C["plumDark"])
        put(x, 23, C["brownDark"])  # 檐线
    for x in range(tl - 8, tl):
        put(x, 23 - (tl - x) // 3, C["brownDark"])
    for x in range(tr + 1, tr + 9):
        put(x, 23 - (x - tr) // 3, C["brownDark"])
    for x in (tl + 6, tl + 7, tr - 7, tr - 6):  # 楼身立柱
        for y in range(24, 28):
            put(x, y, C["brownDeep"])
    # 门洞：以暗框为主，只在中缝透出几星火光，不整块涂红（会太抢眼）
    for y in range(30, 38):
        for x in range(234, 250):
            lit = 240 <= x <= 245 and y >= 33 and (x + y) % 3 != 0
            put(x, y, C["redDark"] if lit else C["ink"])
    return bytes(out)


def clarity_metrics(pixels: bytes, y0: int, y1: int) -> tuple[float, float, float]:
    """(平均亮度, 结构边缘强度, 高频噪点)。

    结构边缘 = 3x3 低通后相邻差（噪点被滤掉，只留主体轮廓）；
    高频噪点 = 原图与低通之差的绝对值。清晰度修正的验收看这两个数。
    """
    L = [0.0] * (W * H)
    for y in range(H):
        for x in range(W):
            o = (y * W + x) * 4
            L[y * W + x] = (pixels[o] * 299 + pixels[o + 1] * 587 + pixels[o + 2] * 114) / 1000
    B = [0.0] * (W * H)
    for y in range(H):
        for x in range(W):
            a, b = max(0, y - 1), min(H, y + 2)
            c, d = max(0, x - 1), min(W, x + 2)
            B[y * W + x] = sum(L[yy * W + xx] for yy in range(a, b) for xx in range(c, d)) / ((b - a) * (d - c))
    n = 0
    tot = structE = noise = 0.0
    for y in range(y0, y1):
        for x in range(W):
            i = y * W + x
            n += 1
            tot += L[i]
            noise += abs(L[i] - B[i])
            if x + 1 < W:
                structE += abs(B[i + 1] - B[i])
            if y + 1 < H:
                structE += abs(B[i + W] - B[i])
    return tot / n, structE / n, noise / n


def self_check(pixels: bytes) -> None:
    assert len(pixels) == W * H * 4
    legal = set(RGB24)
    top_lum = 0
    hud_lum = 0  # 战役条 + 暂停按钮实际压到原图 y=0..16，整段都要够暗
    warm = 0
    for y in range(H):
        for x in range(W):
            o = (y * W + x) * 4
            c = (pixels[o], pixels[o + 1], pixels[o + 2])
            assert c in legal, f"非 24 色盘颜色 {c} @ ({x},{y})"
            assert pixels[o + 3] == 255
            if r_is_warm(*c):
                warm += 1
            l = (c[0] * 299 + c[1] * 587 + c[2] * 114) // 1000
            if y < 9:
                top_lum += l
            if y < 17:
                hud_lum += l
    avg_top = top_lum / (W * 9)
    avg_hud = hud_lum / (W * 17)
    warm_ratio = warm / (W * H)
    avg_lum, structure, noise = clarity_metrics(pixels, 16, 40)
    cool = {C24[k] for k in ("ink", "night", "plumDark", "plumMid", "plumLight", "greyPlum")}
    wall = {C24[k] for k in ("brownDeep", "brownDark", "redDark", "ink")}
    cool_top = sum(
        1 for y in range(17) for x in range(W)
        if (pixels[(y * W + x) * 4], pixels[(y * W + x) * 4 + 1], pixels[(y * W + x) * 4 + 2]) in cool
    )
    wall_hits = sum(
        1 for x in range(W)
        if (pixels[(28 * W + x) * 4], pixels[(28 * W + x) * 4 + 1], pixels[(28 * W + x) * 4 + 2]) in wall
    )
    cool_ratio = cool_top / (W * 17)
    wall_ratio = wall_hits / W
    assert avg_top < 72, f"顶部 HUD 区太亮（{avg_top:.1f}），白字会读不清"
    assert avg_hud < 42, f"战役条覆盖区太亮（{avg_hud:.1f}），白字会读不清"
    assert warm_ratio > 0.03, f"火光占比过低（{warm_ratio:.1%}），主视觉不成立"
    # v1.3 基线：可见区 avgLum 54.6 / structure 8.47。分档后轮廓靠硬边结构层
    # 保证（见 wall_ratio），结构边缘只需不低于基线即可。
    assert structure > 8.8, f"主体轮廓仍偏糊（结构边缘 {structure:.2f}，基线 8.47）"
    assert 40.0 < avg_lum < 68.0, f"可见区亮度跑出原有层次（{avg_lum:.1f}，基线 54.6）"
    assert cool_ratio > 0.45, f"上半部暖色过多会抢前景（冷色占比 {cool_ratio:.1%}）"
    assert wall_ratio > 0.55, f"墙顶轮廓线未成形（{wall_ratio:.1%}）"
    print(f"自检通过：{W}x{H} / 24 色盘内 / 顶部 9 行亮度 {avg_top:.1f} / HUD 区 17 行亮度 {avg_hud:.1f} / 暖色火光占比 {warm_ratio:.1%}")
    print(f"可见区 y16..40：平均亮度 {avg_lum:.1f} / 结构边缘 {structure:.2f}（基线 8.47）/ 高频 {noise:.2f}")
    print(f"上半部冷色占比 {cool_ratio:.1%}（不抢前景）/ 墙顶轮廓成形率 {wall_ratio:.1%}")


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
