# -*- coding: utf-8 -*-
"""把甲方给的 GIF 特效拆成游戏用的 PNG 帧序列。

用法（在 game/ 目录下）：

    python tools/import_fx.py "<源 gif 路径>" art/fx/cannon_blast [--size 96] [--every 1] [--drop-tail 8]

做什么
1. 用 Pillow 逐帧读出 GIF（保留每一帧的完整画面，不做逐帧叠加/局部刷新）；
2. 裁掉四周全透明的空白，统一对齐到「特效中心」；
3. 等比缩放到 `--size` 见方（默认 96×96，正好是战场直读分辨率下 6×6 个像素块大）；
4. 丢掉开头/结尾全透明的空帧，其余按 `fx_00.png, fx_01.png …` 顺序写入目标目录；
5. 打印每帧的尺寸与不透明像素数，方便肉眼核对有没有空帧。

为什么要「裁 + 对齐」而不是直接缩小整张 256×256：
原图是 256×256 的大画布，爆炸团只占中间约 150×155，直接缩到 96 会让效果只剩 55 像素宽；
而且各帧的爆心在画布上会漂移（源动画里爆心从 x=70 漂到 x=132），
不重新对齐的话叠到地图上会看到火球在「游走」。

注意：`public/art/` 下的文件不带 `public` 前缀（Vite 会把 public/ 当根）。
"""
from __future__ import annotations

import argparse
import os
import sys

from PIL import Image

# 爆心在这一帧的累积画面上最稳（白核 + 火球都在）；改这里要重新核对对齐
_CENTER_PROBE_FRAME = 20

# 源 GIF 的内容在这一侧的跨度（256 画布上最大 bbox 约 201 宽）
# 统一按它缩放：--size 96 时是 0.478 倍，爆炸团缩到约 72px，正好是一个 16px 瓦片的 4.5 倍
_CONTENT_SPAN = 201


def _alpha_bbox(im: Image.Image, thr: int = 8) -> tuple[int, int, int, int] | None:
    a = im.getchannel("A").point(lambda v: 255 if v > thr else 0)
    return a.getbbox()


def _bright_centroid(im: Image.Image) -> tuple[float, float]:
    """白核 + 火球的质心：用来当"爆心"（比 alpha 包围盒中心稳，因为烟往一侧飘）。"""
    px = im.load()
    w, h = im.size
    sx = sy = n = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 150 and r > 200 and g > 150 and b < 160:
                sx += x
                sy += y
                n += 1
    if n == 0:
        return (w / 2, h / 2)
    return (sx / n, sy / n)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="源 GIF 路径")
    ap.add_argument("outdir", help="目标目录（相对 game/），例如 art/fx/cannon_blast")
    ap.add_argument("--size", type=int, default=96, help="输出每帧的边长（默认 96）")
    ap.add_argument("--every", type=int, default=1, help="抽帧步长（源 40ms/帧，游戏默认 50ms/帧，1 即可）")
    ap.add_argument("--prefix", default="fx", help="文件名前缀，默认 fx → fx_00.png")
    ap.add_argument("--keep-tail", type=int, default=3, help="结尾保留几帧完全透明的空帧（默认 3，让烟散干净）")
    ap.add_argument("--keep-head", type=int, default=2, help="开头保留几帧空帧（默认 2，别让火球凭空出现）")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.src):
        print(f"找不到源文件: {args.src}", file=sys.stderr)
        return 2

    gif = Image.open(args.src)
    total = getattr(gif, "n_frames", 1)
    # 先把每一帧解成完整画面（GIF 的局部刷新必须靠 seek 累加，Pillow 会替我们处理）
    frames: list[Image.Image] = []
    for i in range(total):
        gif.seek(i)
        frames.append(gif.convert("RGBA").copy())

    probe = frames[min(_CENTER_PROBE_FRAME, len(frames) - 1)]
    cx, cy = _bright_centroid(probe)
    if not any(_alpha_bbox(f) for f in frames):
        print("源 GIF 全是空帧（alpha 全 0），拒绝生成。", file=sys.stderr)
        return 3

    # 内容帧范围：两头各有若干全透明帧，剪掉大部分，只保留少量让淡入淡出不突兀
    content = [i for i, f in enumerate(frames) if _alpha_bbox(f) is not None]
    first, last = content[0], content[-1]
    keep_from = max(0, first - args.keep_head)
    keep_to = min(len(frames) - 1, last + args.keep_tail)

    os.makedirs(args.outdir, exist_ok=True)
    for old in os.listdir(args.outdir):
        if old.startswith(args.prefix + "_") and old.endswith(".png"):
            os.remove(os.path.join(args.outdir, old))

    # 所有帧先用同一个缩放系数、围绕同一个爆心缩放，
    # 再把每帧自己的不透明包围盒中心搬到画布正中。
    # 为什么必须先缩放再按帧对齐：源 GIF 的爆心在画布上会从 x=70 漂到 x=132（动画本身在"游走"），
    # 如果按一个固定爆心开窗裁切，前段刚喷出的火舌和后段的烟会被裁掉（试过，火舌少了一半）。
    # 统一缩放保证帧与帧之间的大小关系不变，逐帧居中保证叠到地图上不飘。
    scale = args.size / _CONTENT_SPAN
    written = 0
    for idx in range(keep_from, keep_to + 1, max(1, args.every)):
        f = frames[idx]
        bb = _alpha_bbox(f)
        canvas = Image.new("RGBA", (args.size, args.size), (0, 0, 0, 0))
        if bb is not None:
            scaled = f.resize(
                (max(1, round(f.width * scale)), max(1, round(f.height * scale))),
                Image.LANCZOS,
            )
            sbb = _alpha_bbox(scaled) or (0, 0, scaled.width, scaled.height)
            ox = (args.size - (sbb[2] - sbb[0])) // 2 - sbb[0]
            oy = (args.size - (sbb[3] - sbb[1])) // 2 - sbb[1]
            canvas.alpha_composite(scaled, (ox, oy))
        name = f"{args.prefix}_{written:02d}.png"
        canvas.save(os.path.join(args.outdir, name))
        cbb = _alpha_bbox(canvas)
        opaque = sum(1 for v in canvas.getchannel("A").getdata() if v > 8)
        print(f"{name}  bbox={cbb}  opaque={opaque}")
        written += 1

    print(f"\n共写出 {written} 帧到 {args.outdir}（源 {total} 帧，爆心 ({cx:.1f}, {cy:.1f})）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))