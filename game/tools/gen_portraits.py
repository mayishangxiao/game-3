#!/usr/bin/env python3
"""把 AI 图生图产出的 1024×1024 肖像后处理成游戏用的 96×112 RGBA 立绘（v2.2）。

**这个文件以前是几何占位图生成器**：用 24 色板拼方块脸，产出 20 张
600 字节的「色块人」。甲方这轮要求「除关天培和林则徐外全部换成新头像，
画风须与现有林则徐头像统一」，那套方块脸已经作废——旧脚本留在 tools/ 里
一旦被人重跑，会把新立绘全部覆盖回占位图。所以本文件改成下图所示的
**AI 产物后处理链**，旧生成逻辑不再保留。

画风基准是 `public/art/portrait_lin_zexu.png`（96×112、透明底、精细渐变像素胸像）。
AI 以它为参考图逐张生成（`tools/_gen_portraits/_<id>_*.png`），但生成结果是：
  · 1024×1024 方图、RGB 无 alpha，背景有时纯白、有时 AI 把「透明」画成灰白棋盘格；
  · 右下角固定带平台水印；
  · 人物下半身铺满画布，直接用会变成「一颗大头」。
所以脚本做三件事：**裁掉水印区 → 按 96:112 比例取胸像 → 抠掉背景并降采样**。

裁切窗口固定：源图 y ∈ [0, 900)、x ∈ [(1024-771)//2, +771)，
既避开右下角水印（x≈900+、y≈950+），又正好 771:900 ≈ 96:112。
背景用「从四条边 flood fill」而不是全局按颜色删：人物眼白、白胡须、纸片也接近白，
但它们被深色描边围住、不与画边连通，不会被误抠成透明窟窿。

纯标准库（PNG 解码 / 编码都自己写）。产物：
    public/art/portrait_<id>.png             96×112 RGBA（关天培、林则徐两张不碰）
    tools/_cdp/portrait_contact_sheet.png    6 列联系表，肉眼一次看完全部

用法：
    python tools/gen_portraits.py           # 重出全部（需要 _gen_portraits 里的 AI 原图）
    python tools/gen_portraits.py --check  # 只校验产物尺寸与「不是占位图」的颜色数
"""

from __future__ import annotations

import json
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(__file__).resolve().parent / "_gen_portraits"
DST = ROOT / "public" / "art"
SHEET = Path(__file__).resolve().parent / "_cdp" / "portrait_contact_sheet.png"

W, H = 96, 112
SRC_W, SRC_H = 1024, 1024
CROP_Y0, CROP_H = 0, 900
CROP_W = round(CROP_H * W / H)  # 771
CROP_X0 = (SRC_W - CROP_W) // 2

# 两张最早生成的图 prompt 没带 id 前缀，按文件名里的中文名认领
LEGACY = [
    ("李鸿章", "li_hongzhang"),
    ("邓世昌", "deng_shichang"),
]
# 保留不重绘的两张（画风基准 + 甲方已确认的武将立绘）
KEEP = {"lin_zexu", "guan_tianpei"}


# ---------------------------------------------------------------- PNG 读写

def decode_png(path: Path) -> tuple[int, int, list[list[tuple[int, int, int, int]]]]:
    b = path.read_bytes()
    assert b[:8] == b"\x89PNG\r\n\x1a\n", f"{path} 不是 PNG"
    pos, dat = 8, b""
    w = h = bd = ct = 0
    while pos < len(b):
        ln = struct.unpack(">I", b[pos:pos + 4])[0]
        tag, body = b[pos + 4:pos + 8], b[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if tag == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            dat += body
        elif tag == b"IEND":
            break
    assert bd == 8 and ct in (2, 6), f"{path} 只支持 8bit RGB/RGBA，实际 {bd}/{ct}"
    bpp = 3 if ct == 2 else 4
    raw = zlib.decompress(dat)
    stride = w * bpp
    rows: list[list[tuple[int, int, int, int]]] = []
    prev = bytearray(stride)
    i = 0
    for _y in range(h):
        ft = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            bb = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ft == 1:
                line[x] = (line[x] + a) & 255
            elif ft == 2:
                line[x] = (line[x] + bb) & 255
            elif ft == 3:
                line[x] = (line[x] + ((a + bb) // 2)) & 255
            elif ft == 4:
                p = a + bb - c
                pa, pb, pc = abs(p - a), abs(p - bb), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (bb if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append([
            (line[x * bpp], line[x * bpp + 1], line[x * bpp + 2],
             line[x * bpp + 3] if bpp == 4 else 255)
            for x in range(w)
        ])
        prev = line
    return w, h, rows


def png_bytes(w: int, h: int, rows: list[list[tuple[int, int, int, int]]]) -> bytes:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for r, g, b, a in rows[y]:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


# ---------------------------------------------------------------- 背景抠除

def is_bg(r: int, g: int, b: int) -> bool:
    """纯白，或 AI 画出来的灰白棋盘格（两档浅灰）。"""
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn > 18:
        return False
    return mn >= 206


def remove_bg(rows: list[list[tuple[int, int, int, int]]], w: int, h: int) -> list[list[tuple[int, int, int, int]]]:
    """只删「与四边连通」的背景色，人物内部的眼白 / 白须不会被误伤。"""
    seen = [[False] * w for _ in range(h)]
    q: list[tuple[int, int]] = []
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    head = 0
    while head < len(q):
        x, y = q[head]
        head += 1
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        r, g, b, a = rows[y][x]
        if a < 8 or not is_bg(r, g, b):
            continue
        seen[y][x] = True
        q.append((x + 1, y))
        q.append((x - 1, y))
        q.append((x, y + 1))
        q.append((x, y - 1))
    out = [list(row) for row in rows]
    for y in range(h):
        for x in range(w):
            r, g, b, a = rows[y][x]
            if seen[y][x] or a < 8:
                out[y][x] = (r, g, b, 0)
            else:
                out[y][x] = (r, g, b, 255)
    return out


def downsample(rows: list[list[tuple[int, int, int, int]]]) -> list[list[tuple[int, int, int, int]]]:
    """区域平均（alpha 预乘），771×900 → 96×112，保留柔和渐变而不糊成一团。"""
    sw, sh = CROP_W, CROP_H
    out: list[list[tuple[int, int, int, int]]] = []
    for y in range(H):
        y0, y1 = CROP_Y0 + y * sh // H, CROP_Y0 + (y + 1) * sh // H
        line: list[tuple[int, int, int, int]] = []
        for x in range(W):
            x0, x1 = CROP_X0 + x * sw // W, CROP_X0 + (x + 1) * sw // W
            sr = sg = sb = sa = 0
            n = 0
            for yy in range(y0, max(y1, y0 + 1)):
                for xx in range(x0, max(x1, x0 + 1)):
                    r, g, b, a = rows[yy][xx]
                    sr += r * a
                    sg += g * a
                    sb += b * a
                    sa += a
                    n += 1
            if sa == 0:
                line.append((0, 0, 0, 0))
            else:
                line.append((sr // sa, sg // sa, sb // sa, min(255, sa // max(n, 1))))
        out.append(line)
    return out


# ---------------------------------------------------------------- 主流程

def npc_ids() -> list[str]:
    """立绘 id 真值 = 对白 npcs 表（除旁白与两张保留图），按长度倒序做前缀匹配。"""
    dlg = json.loads((ROOT / "public/data/dialogues/dlg_ch00.json").read_text(encoding="utf-8"))
    ids = [k for k in dlg["npcs"] if k != "narrator" and k not in KEEP]
    return sorted(ids, key=len, reverse=True)


def collect() -> dict[str, Path]:
    ids = npc_ids()
    found: dict[str, Path] = {}
    for p in sorted(SRC.glob("*.png")):
        name = p.name.lstrip("_")
        matched = next((rid for rid in ids if name.startswith(rid + "_") or name.startswith(rid + ".")), None)
        if matched:
            found[matched] = p
            continue
        for cn, rid in LEGACY:
            if cn in name and rid in ids:
                found.setdefault(rid, p)
    return found


def contact_sheet(items: list[tuple[str, list[list[tuple[int, int, int, int]]]]]) -> None:
    scale, cols = 3, 6
    cw, ch = W * scale, H * scale
    rows_n = (len(items) + cols - 1) // cols
    bg = (0x2F, 0x2B, 0x45, 255)
    canvas = [[bg for _ in range(cols * cw)] for _ in range(rows_n * ch)]
    for idx, (_rid, rows) in enumerate(items):
        ox, oy = (idx % cols) * cw, (idx // cols) * ch
        for y in range(H):
            for x in range(W):
                r, g, b, a = rows[y][x]
                if a < 8:
                    continue
                for dy in range(scale):
                    for dx in range(scale):
                        canvas[oy + y * scale + dy][ox + x * scale + dx] = (r, g, b, 255)
    SHEET.parent.mkdir(parents=True, exist_ok=True)
    SHEET.write_bytes(png_bytes(cols * cw, rows_n * ch, canvas))


def main(argv: list[str]) -> int:
    if "--check" in argv:
        bad = []
        for p in sorted(DST.glob("portrait_*.png")):
            w, h, rows = decode_png(p)
            colors = len({(r, g, b) for row in rows for r, g, b, a in row if a > 0})
            if (w, h) != (W, H):
                bad.append(f"{p.name} 尺寸 {w}x{h}")
            elif p.stem.removeprefix("portrait_") not in KEEP and colors < 400:
                bad.append(f"{p.name} 只有 {colors} 色（疑似占位图）")
        print(f"checked {len(list(DST.glob('portrait_*.png')))} portraits; " + ("OK" if not bad else "; ".join(bad)))
        return 1 if bad else 0

    src = collect()
    print(f"found {len(src)} AI portraits in {SRC}")
    items: list[tuple[str, list[list[tuple[int, int, int, int]]]]] = []
    for rid in sorted(src):
        w, h, rows = decode_png(src[rid])
        if (w, h) != (SRC_W, SRC_H):
            print(f"  skip {rid}: {w}x{h} 不是 {SRC_W}x{SRC_H}")
            continue
        rows = remove_bg(rows, w, h)
        small = downsample(rows)
        opaque = sum(1 for row in small for _r, _g, _b, a in row if a > 0)
        colors = len({(r, g, b) for row in small for r, g, b, a in row if a > 0})
        (DST / f"portrait_{rid}.png").write_bytes(png_bytes(W, H, small))
        items.append((rid, small))
        print(f"  {rid:20} opaque={opaque:5} colors={colors:4} -> portrait_{rid}.png")
    for keep in KEEP:
        _w, _h, rows = decode_png(DST / f"portrait_{keep}.png")
        items.append((keep, rows))
    contact_sheet(sorted(items))
    print(f"contact sheet -> {SHEET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
