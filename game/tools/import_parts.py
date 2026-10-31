# -*- coding: utf-8 -*-
"""把甲方（豆包）出的「一张图五个部件」切成可拼装的 PNG。

输入：C:\\Users\\Lecoo\\Doubao\\chats\\2026-10-30\\new-chat\\积木小人分件精灵图\\<兵种>_<正面|侧面>.jpeg
输出：public/art/parts/<unit>_<front|side>_<part>.png（24×32 世界内的部件尺寸）

做法：品红底抠图 -> 按透明列切件 -> 按目标高度等比缩放（预乘 alpha，边缘不脏）
      -> 吸附到 24 色盘 -> 硬边化。最后拼一张 4 倍放大对照图给人工看。

用法：python tools/import_parts.py
"""
import pathlib
import sys

import numpy as np
from PIL import Image

SRC = pathlib.Path(r"C:\Users\Lecoo\Doubao\chats\2026-10-30\new-chat\积木小人分件精灵图")
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "art" / "parts"
MOCK = ROOT / "tools" / "_parts_mock.png"

# 中文文件名 -> 代码里的兵种 id（和 public/art/units 的命名对齐）
UNITS = {
    "亲兵": "qing_officer",
    "绿营兵": "qing_green",
    "把总": "qing_batou",
    "英军步兵": "uk_infantry",
    "英军掷弹兵": "uk_grenadier",
    "郭富准将": "gough",
    "林则徐": "lin_zexu",
}
FACINGS = {"正面": "front", "侧面": "side"}

# 每个部件在 24×32 小人里的目标高度（宽按比例）
# 头给 13：包含帽子和脖子，正好盖住上身的领口
TARGET_H = {"head": 13, "torso": 12, "arm": 11, "leg": 12, "weapon": 18}
# 出图里部件的先后顺序（模型照我说的顺序画的）
ORDER = ["head", "torso", "arm", "leg", "weapon"]

# 24 色盘（和 src/core/constants.ts 的 PALETTE 一致）
PALETTE = [
    (0x0D, 0x0B, 0x14), (0x1C, 0x1A, 0x2B), (0x2F, 0x2B, 0x45), (0x4A, 0x44, 0x68),
    (0x94, 0x8D, 0xAB), (0xC2, 0xBC, 0xD1), (0xF2, 0xED, 0xE4), (0xE8, 0xCF, 0xA8),
    (0xCF, 0xA2, 0x6A), (0xA8, 0x76, 0x3F), (0x7A, 0x4F, 0x2A), (0x8C, 0x1C, 0x1C),
    (0xC6, 0x28, 0x28), (0xF2, 0xA0, 0x8C), (0x1F, 0x5C, 0x3A), (0x2F, 0x8F, 0x5B),
    (0x1B, 0x3A, 0x6B), (0x2F, 0x6B, 0xA8), (0x7F, 0xB2, 0xD9), (0xF0, 0xC4, 0x19),
]


def key_magenta(im):
    """品红底 -> alpha。返回 RGBA float 数组（0..1）。

    品红 (255,0,255) 和青蓝/紫/SKIN 的距离都够远，直接按「离品红多远」给 alpha，
    边缘混合像素会得到半透明，预乘缩放后不会留紫边。
    """
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # 品红度：红蓝都高、绿很低
    mag = np.minimum(r, b) - g          # 纯品红 = 255
    alpha = np.clip((150.0 - mag) / 90.0, 0.0, 1.0)   # mag>=150 全透，mag<=60 全不透
    # 半透明像素把偏品红的成分往中间拉，减少紫边
    edge = (alpha > 0.02) & (alpha < 0.98)
    if edge.any():
        lum = (r * 0.299 + g * 0.587 + b * 0.114)[..., None]
        a = np.where(edge[..., None], a * 0.35 + lum * 0.65, a)
    return a, alpha


def slice_parts(rgb, alpha):
    """按「整列全透明」的竖缝把图切成若干件，返回 [(x0,x1)]。"""
    col_used = (alpha > 0.12).any(axis=0)
    spans, start = [], None
    for x, used in enumerate(col_used):
        if used and start is None:
            start = x
        elif not used and start is not None:
            spans.append((start, x))
            start = None
    if start is not None:
        spans.append((start, len(col_used)))
    # 去掉过窄的噪点缝（<0.5% 宽度）
    min_w = max(6, int(0.005 * alpha.shape[1]))
    spans = [s for s in spans if s[1] - s[0] >= min_w]
    return spans


def trim(rgb, alpha, box):
    """裁到内容外包框。"""
    x0, x1 = box
    sub = alpha[:, x0:x1]
    rows = np.where((sub > 0.12).any(axis=1))[0]
    cols = np.where((sub > 0.12).any(axis=0))[0]
    if len(rows) == 0:
        return None
    y0, y1 = rows[0], rows[-1] + 1
    cx0, cx1 = x0 + cols[0], x0 + cols[-1] + 1
    return rgb[y0:y1, cx0:cx1], alpha[y0:y1, cx0:cx1]


def scale_to_h(rgb, alpha, target_h):
    h, w = alpha.shape
    scale = target_h / h
    tw, th = max(1, round(w * scale)), max(1, target_h)
    # 预乘 alpha 再缩，边缘不会串色
    rgba = np.dstack([rgb, alpha * 255.0])
    pm = rgba.copy()
    pm[..., :3] *= (pm[..., 3:4] / 255.0)
    img = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), "RGBA")
    # 大幅缩小用 BOX 更稳（NEAREST 会丢整块），已经是像素画，BOX 后硬边化
    img = img.resize((tw, th), Image.BOX)
    arr = np.asarray(img, dtype=np.float32)
    a2 = arr[..., 3:4] / 255.0
    rgb2 = np.where(a2 > 0.004, arr[..., :3] / np.maximum(a2, 1e-3), 0)
    return np.clip(rgb2, 0, 255), a2[..., 0]


def quantize(rgb, alpha):
    """吸附到 24 色盘 + 硬边（alpha 二值化）。"""
    pal = np.array(PALETTE, dtype=np.float32)
    flat = rgb.reshape(-1, 3)
    d = ((flat[:, None, :] - pal[None, :, :]) ** 2).sum(axis=2)
    idx = d.argmin(axis=1)
    out = pal[idx].reshape(rgb.shape)
    a = np.where(alpha > 0.5, 255.0, 0.0)
    # 全透明像素颜色清零，避免 PNG 里留彩色底
    out = np.where(a[..., None] > 0, out, 0)
    return np.dstack([out, a]).astype(np.uint8)


def process(path, unit, facing):
    im = Image.open(path)
    rgb, alpha = key_magenta(im)
    spans = slice_parts(rgb, alpha)
    names = ORDER[: len(spans)]
    # 件数对不上时按顺序分配，多出来的丢掉（模型偶尔多画一个配件）
    parts = []
    for name, box in zip(names, spans):
        t = trim(rgb, alpha, box)
        if t is None:
            continue
        r2, a2 = scale_to_h(t[0], t[1], TARGET_H[name])
        img = Image.fromarray(quantize(r2, a2), "RGBA")
        OUT.mkdir(parents=True, exist_ok=True)
        dst = OUT / f"{unit}_{facing}_{name}.png"
        img.save(dst)
        parts.append((name, img))
    return parts, len(spans)


def assemble(preview_parts, facing):
    """把部件按锚点拼成一个 24×32 小人，返回放大的 Image（只用于人眼检查）。"""
    W, H, Z = 24, 32, 6
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # 锚点（和 CharacterRig.PART_ANCHORS 保持一致）
    place = {
        "leg": (12, 24),      # 顶部中心（胯）
        "torso": (12, 25),    # 底部中心（腰）
        "arm": (5, 15),       # 顶部中心（肩）
        "head": (12, 14),     # 底部中心（脖子）
        "weapon": (19, 22),   # 握把
    }
    order = ["leg", "leg", "torso", "arm", "head", "weapon"]
    d = {n: im for n, im in preview_parts}
    for name in order:
        if name not in d:
            continue
        im = d[name]
        if name == "leg" and order[order.index("leg") + 1] is not None:
            pass
        ax, ay = place[name]
        x = ax - im.width // 2 if name != "weapon" else ax - 2
        y = ay - im.height if name in ("head", "torso") else ay
        canvas.alpha_composite(im, (max(0, x), max(0, y)))
    return canvas.resize((W * Z, H * Z), Image.NEAREST)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    mock_rows = []
    for cn, unit in UNITS.items():
        for cnf, facing in FACINGS.items():
            p = SRC / f"{cn}_{cnf}.jpeg"
            if not p.exists():
                print("missing", p.name)
                continue
            parts, n = process(p, unit, facing)
            print(f"{cn}_{cnf} -> {unit}_{facing}: {n} 件 {[n for n, _ in parts]}")
            mock_rows.append((f"{unit}_{facing}", assemble(parts, facing)))
    if mock_rows:
        w = max(im.width for _, im in mock_rows) + 8
        h = sum(im.height + 6 for _, im in mock_rows)
        sheet = Image.new("RGBA", (w, h), (0x1C, 0x1A, 0x2B, 255))
        y = 4
        for _, im in mock_rows:
            sheet.alpha_composite(im, (4, y))
            y += im.height + 6
        sheet.save(MOCK)
        print("mock ->", MOCK, sheet.size)


if __name__ == "__main__":
    main()