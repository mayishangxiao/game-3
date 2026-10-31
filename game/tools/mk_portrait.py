"""把带棋盘格底（无 alpha 的 JPEG）的 AI 立绘转成游戏用的 96×112 透明 PNG。

用法:
    python tools/mk_portrait.py <src> <dst> [--cols 96] [--rows 112]

为什么不能直接缩图：用户给的是 JPEG，棋格底是**画上去的像素**，不是透明。
直接贴进对话框会看到一格一格的灰白方块。这里用「从边框泛洪」把与边框连通的
近白/近灰像素抠掉：仙鹤、扇面虽然有白色，但被黑色描边围住，泛洪到不了，所以安全。
"""
from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def background_mask(rgb: np.ndarray) -> np.ndarray:
    """棋格底判定：偏亮 + 低饱和。阈值放宽是有意的——
    人物内部的白（仙鹤、扇面）被黑描边围住，泛洪到不了，所以放宽只会多吃掉
    贴着轮廓的 JPEG 彩噪，不会啃人物。"""
    r, g, b = rgb[..., 0].astype(np.int16), rgb[..., 1].astype(np.int16), rgb[..., 2].astype(np.int16)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    return (mn >= 185) & ((mx - mn) <= 45)


def flood_from_border(mask: np.ndarray) -> np.ndarray:
    """从四边出发、只在 mask 内泛洪，返回连通到边框的部分（4 邻接）。"""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def push(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and mask[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)

    while q:
        y, x = q.popleft()
        push(y - 1, x)
        push(y + 1, x)
        push(y, x - 1)
        push(y, x + 1)
    return seen


def largest_component(mask: np.ndarray) -> np.ndarray:
    """只保留面积最大的 8 邻接连通域（人物），用来丢掉水印之类的小碎块。"""
    h, w = mask.shape
    best = np.zeros_like(mask, dtype=bool)
    best_n = 0
    seen = np.zeros_like(mask, dtype=bool)
    for sy in range(h):
        row = mask[sy]
        for sx in range(w):
            if not row[sx] or seen[sy, sx]:
                continue
            q: deque[tuple[int, int]] = deque([(sy, sx)])
            seen[sy, sx] = True
            cur: list[tuple[int, int]] = []
            while q:
                y, x = q.popleft()
                cur.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
            if len(cur) > best_n:
                best_n = len(cur)
                best = np.zeros_like(mask, dtype=bool)
                ys, xs = zip(*cur)
                best[list(ys), list(xs)] = True
    return best


def despeckle(arr: np.ndarray, rounds: int = 2) -> int:
    """去掉贴边孤立的彩噪点：邻域里不透明像素少于 3 个的，一律抹掉。"""
    killed = 0
    for _ in range(rounds):
        op = arr[..., 3] > 0
        nb = np.zeros(op.shape, dtype=np.int16)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                nb[1:-1, 1:-1] += op[1 + dy:op.shape[0] - 1 + dy, 1 + dx:op.shape[1] - 1 + dx]
        lone = op & (nb < 3)
        killed += int(lone.sum())
        arr[lone, 3] = 0
    return killed


def face_bbox(cut: Image.Image, top_frac: float = 0.62) -> tuple[int, int, int, int] | None:
    """在人物上半身找脸：肤色掩码里最大的那块（缩到 1/4 再找连通域，快了 16 倍）。

    为什么要找脸而不是按比例裁：立绘是全身像，头只占上面一小块；比例裁会切到帽子或胸，
    找不到脸就退回 None，调用方按比例兜底。
    """
    arr = np.array(cut)
    op = arr[..., 3] > 0
    ys = np.where(op.any(axis=1))[0]
    if len(ys) == 0:
        return None
    y0, y1 = int(ys[0]), int(ys[-1])
    limit = y0 + int((y1 - y0) * top_frac)

    r, g, b = (arr[..., i].astype(np.int16) for i in range(3))
    skin = op & (r > 185) & (g > 130) & (g < 232) & (b > 100) & (b < 210) & (r >= g) & ((r - b) > 22)
    skin[limit:] = False
    if skin.sum() < 40:
        return None

    scale = 4
    small = Image.fromarray((skin * 255).astype(np.uint8), 'L').resize(
        (max(1, cut.width // scale), max(1, cut.height // scale)), Image.BOX)
    m = largest_component(np.array(small) > 127)
    if not m.any():
        return None
    ys2, xs2 = np.where(m)
    x0, x1 = int(xs2.min()) * scale, int(xs2.max()) * scale
    ya0, ya1 = int(ys2.min()) * scale, int(ys2.max()) * scale
    if (x1 - x0) < 8 or (ya1 - ya0) < 8:
        return None
    return x0, ya0, x1, ya1


def bust_crop(cut: Image.Image, cols: int, rows: int) -> Image.Image:
    """把头（含帽子）与肩裁成 96×112 的胸像。

    「所有立绘只要头」是用户的要求（m05506）——全身像缩到 96×112 只剩一团糊，
    头肩特写才看得出是谁。

    为什么不按肤色找脸：AI 立绘里手、扇面、补子的白鹤都可能是肤色系，最大肤色块
    经常落在脖子/手上（第一次就裁到了胸口）。这里改成**按人物高度取 4%~40% 的横带**
    ——立绘都是站姿正面像，头+帽子稳定落在这个比例里，中心取上半段的水平重心。
    """
    arr = np.array(cut)
    op = arr[..., 3] > 0
    band = op[: max(1, int(cut.height * 0.5))]
    xs = np.where(band.any(axis=0))[0]
    cx = int((xs.min() + xs.max()) / 2) if len(xs) else cut.width // 2

    y0 = int(cut.height * 0.04)
    y1 = int(cut.height * 0.40)
    hh = y1 - y0
    ww = int(round(hh * cols / rows))
    if ww > cut.width:
        ww = cut.width
        hh = int(round(ww * rows / cols))
        y1 = y0 + hh
    left = max(0, min(cx - ww // 2, max(0, cut.width - ww)))
    return cut.crop((left, y0, left + ww, y1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--cols', type=int, default=96)
    ap.add_argument('--rows', type=int, default=112)
    ap.add_argument('--margin', type=int, default=2)
    ap.add_argument('--bust', action='store_true', help='只取头肩（游戏里所有立绘都用这个）')
    a = ap.parse_args()

    src = Path(a.src)
    img = Image.open(src).convert('RGBA')
    arr = np.array(img)
    rgb = arr[..., :3]

    # JPEG 在黑描边旁边有彩噪，先轻度中值掉，再判定背景
    img = img.filter(ImageFilter.MedianFilter(3))
    arr = np.array(img)

    bg = flood_from_border(background_mask(rgb))
    arr[bg, 3] = 0

    # 紧贴背景的一圈会留下浅色描边与彩噪，直接全透明（半透明会显出一圈杂色）
    edge = np.zeros_like(bg, dtype=bool)
    edge[1:, :] |= bg[:-1, :]
    edge[:-1, :] |= bg[1:, :]
    edge[:, 1:] |= bg[:, :-1]
    edge[:, :-1] |= bg[:, 1:]
    arr[edge & (arr[..., 3] > 0), 3] = 0

    # 全分辨率下先做一次「开运算」（先腐蚀后膨胀）：把贴着轮廓的 JPEG 彩噪整块吃掉，
# 人物本体远大于结构元，不受影响；等到缩到 96 宽再处理就来不及了。
    alpha_big = Image.fromarray(arr[..., 3], 'L')
    alpha_big = alpha_big.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    arr[..., 3] = np.where(alpha_big == 0, 0, arr[..., 3])

    # 水印（“AI生成”/“千问”）是浅灰字，和棋格底不是同一色，泛洪抠不掉；
    # 但它们与人物不连通，所以只保留最大的那块连通域。
    opaque = arr[..., 3] > 0
    keep = largest_component(opaque)
    arr[~keep, 3] = 0
    # 透明区的 RGB 留着棋格灰的话，缩小插值时会把灰混进轮廓；
    # 统一填黑，缩小时边缘自然收成一圈深色描边（像素风要的就是这个）。
    arr[~keep, :3] = 0
    dropped = int(opaque.sum() - keep.sum())

    cut = Image.fromarray(arr, 'RGBA')
    bbox = cut.getbbox()
    if bbox is None:
        print('抠完什么都没有了', file=sys.stderr)
        return 1
    cut = cut.crop(bbox)

    if a.bust:
        face = face_bbox(cut)
        cut = bust_crop(cut, a.cols, a.rows)
        print(f'胸像裁剪：face={face} → crop={cut.size}')

    maxw, maxh = a.cols - a.margin * 2, a.rows - a.margin * 2
    scale = min(maxw / cut.width, maxh / cut.height)
    new = (max(1, round(cut.width * scale)), max(1, round(cut.height * scale)))
    cut = cut.resize(new, Image.LANCZOS)

    # 缩小后残余的彩噪：把透明度低于 55% 的一律抹掉，避免边缘发花
    small = np.array(cut)
    small[small[..., 3] < 140, 3] = 0
    speck = despeckle(small, rounds=2)
    # 像素风不需要半透明：alpha 二值化，边缘不留灰雾
    small[..., 3] = np.where(small[..., 3] >= 128, 255, 0).astype(np.uint8)
    cut = Image.fromarray(small, 'RGBA')
    # 再把 alpha 收 1 px，防止灰边
    alpha = cut.getchannel('A').filter(ImageFilter.MinFilter(3))
    cut.putalpha(alpha)

    out = Image.new('RGBA', (a.cols, a.rows), (0, 0, 0, 0))
    out.paste(cut, ((a.cols - new[0]) // 2, a.rows - a.margin - new[1]))
    dst = Path(a.dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, 'PNG', optimize=True)

    op = np.array(out)[..., 3]
    print(f'源 {src.name} {img.width}x{img.height} → {dst} {a.cols}x{a.rows} '
          f'({dst.stat().st_size} B)，不透明像素 {int((op > 0).sum())}，丢弃小碎块 {dropped} px，裁剪 bbox={bbox}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())