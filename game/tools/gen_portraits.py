#!/usr/bin/env python3
"""
生成对白立绘（96×112 胸像，RGBA PNG）——设计书 7.1「第二幕人物贴图与立绘 ⬜ 未做」。

为什么是脚本而不是画图：11 位说话人要有统一的脸型、帽型、画框内位置，手画必然
走形；脚本化之后「把曾国藩的胡子改短一点」是一行参数，不是重画一张。生成物进版本库，
脚本留在 tools/ 里说明它们怎么来的（与 gen_maps.py 一个道理）。

风格对齐现有的 `portrait_lin_zexu.png / portrait_guan_tianpei.png`：
  - 96×112、透明背景、只画到胸口；
  - 1px 墨色外描边（先填色，最后统一对「不透明↔透明」边界描边）；
  - 主色取 `src/core/constants.ts` 的 24 色板，明暗用与墨色/纸色的混合得到。

用法：
    python tools/gen_portraits.py                 # 生成全部
    python tools/gen_portraits.py hong_xiuquan    # 只生成某一位
"""
from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

W, H = 96, 112

# ---- 24 色板（与 core/constants.ts 的 PALETTE 一致；这里只列用得到的） ----
INK = (0x0D, 0x0B, 0x14)
NIGHT = (0x1C, 0x1A, 0x2B)
PLUM_DARK = (0x2F, 0x2B, 0x45)
PLUM_MID = (0x4A, 0x44, 0x68)
PLUM_LIGHT = (0x6B, 0x64, 0x89)
GREY_PLUM = (0x94, 0x8D, 0xAB)
GREY_LIGHT = (0xC2, 0xBC, 0xD1)
PAPER = (0xF2, 0xED, 0xE4)
CREAM = (0xE8, 0xCF, 0xA8)
SAND = (0xCF, 0xA2, 0x6A)
BROWN = (0xA8, 0x76, 0x3F)
BROWN_DARK = (0x7A, 0x4F, 0x2A)
BROWN_DEEP = (0x4E, 0x2F, 0x1A)
RED_DARK = (0x8C, 0x1C, 0x1C)
RED = (0xC0, 0x39, 0x2B)
RED_BRIGHT = (0xE8, 0x5C, 0x4A)
RED_SOFT = (0xF2, 0xA0, 0x8C)
GREEN_DARK = (0x4A, 0x7A, 0x2E)
GREEN = (0x7B, 0xA8, 0x4A)
GREEN_LIGHT = (0xA8, 0xD0, 0x70)
INDIGO = (0x2A, 0x5A, 0x8A)
BLUE = (0x4A, 0x90, 0xC8)
BLUE_LIGHT = (0x7B, 0xC0, 0xE8)
STAR = (0xD4, 0xA8, 0x40)

A = 255


def mix(c: tuple[int, int, int], other: tuple[int, int, int], t: float) -> tuple[int, int, int, int]:
    """按比例混色：t=0 全是 c，t=1 全是 other。用来做暗面/亮面。"""
    return (
        round(c[0] + (other[0] - c[0]) * t),
        round(c[1] + (other[1] - c[1]) * t),
        round(c[2] + (other[2] - c[2]) * t),
        A,
    )


def dark(c, t=0.32):
    return mix(c, INK, t)


def light(c, t=0.22):
    return mix(c, PAPER, t)


class Img:
    def __init__(self) -> None:
        self.px = [[(0, 0, 0, 0) for _ in range(W)] for _ in range(H)]

    def put(self, x: int, y: int, c) -> None:
        # 颜色一律补成 RGBA：调用方常常直接传 3 元组的色板值
        c = c if len(c) == 4 else (c[0], c[1], c[2], A)
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = c

    def rect(self, x0: int, y0: int, x1: int, y1: int, c) -> None:
        c = c if len(c) == 4 else (c[0], c[1], c[2], A)
        for y in range(max(0, y0), min(H, y1)):
            for x in range(max(0, x0), min(W, x1)):
                self.px[y][x] = c

    def hline(self, x0: int, x1: int, y: int, c) -> None:
        self.rect(x0, y, x1, y + 1, c)

    def vline(self, x: int, y0: int, y1: int, c) -> None:
        self.rect(x, y0, x + 1, y1, c)

    def poly(self, rows: list[tuple[int, int, int]], c) -> None:
        """rows = [(y, x0, x1), ...] 的梯形填充"""
        for y, x0, x1 in rows:
            self.rect(x0, y, x1, y + 1, c)

    def outline(self, color=None) -> None:
        """给「不透明↔透明」的边界上 1px 描边；内部色块之间不描（那是明暗交界）"""
        c = (color or INK) + (A,) if color else (INK[0], INK[1], INK[2], A)
        src = [row[:] for row in self.px]
        for y in range(H):
            for x in range(W):
                if src[y][x][3] == 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < W and 0 <= ny < H) or src[ny][nx][3] == 0:
                        self.px[y][x] = c
                        break

    def png(self, path: Path) -> None:
        raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in self.px)
        comp = zlib.compress(raw, 9)

        def chunk(tag: bytes, data: bytes) -> bytes:
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

        blob = b"\x89PNG\r\n\x1a\n"
        blob += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
        blob += chunk(b"IDAT", comp)
        blob += chunk(b"IEND", b"")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)


# ---------------- 零件 ----------------

def body(im: Img, robe, trim, collar: str) -> None:
    """肩膀：从颈下 y=72 向两侧张开到 86，下摆停在 112（画框底部）"""
    rows = []
    for y in range(72, H):
        t = (y - 72) / (H - 72)
        half = int(14 + 22 * t)
        rows.append((y, 48 - half, 48 + half))
    im.poly(rows, robe)
    # 左暗右亮：只给一条边，胸像才有体积
    for y, x0, x1 in rows:
        im.rect(x0, y, x0 + 4, y + 1, dark(robe, 0.45))
        im.rect(x1 - 3, y, x1, y + 1, light(robe, 0.16))
    # 衣领：V 字两条斜带
    for i in range(18):
        y = 74 + i
        im.rect(46 - i, y, 49 - i, y + 1, trim)
        im.rect(50 + i, y, 53 + i, y + 1, trim)
        # 领口内侧压一道暗边：不加的话浅色领带和袍子糊在一起，看着像没有领子
        im.rect(49 - i, y, 50 - i, y + 1, dark(trim, 0.5))
        im.rect(53 + i, y, 54 + i, y + 1, dark(trim, 0.5))
    if collar == "round":
        # 立领：胸口一条横带 + 中间纽扣
        im.rect(38, 74, 58, 79, trim)
        im.put(47, 82, STAR + (A,))
        im.put(48, 82, STAR + (A,))
        im.put(47, 83, STAR + (A,))
        im.put(48, 83, STAR + (A,))
    elif collar == "epaulette":
        # 西式军装：肩章 + 交叉皮带
        im.rect(20, 78, 40, 82, STAR)
        im.rect(56, 78, 76, 82, STAR)
        for i in range(20):
            im.rect(44 + i // 2, 88 + i, 46 + i // 2, 89 + i, BROWN_DEEP)
    elif collar == "v":
        im.put(47, 84, trim + (A,))
        im.put(48, 84, trim + (A,))


def head(im: Img, skin, jaw: int = 64) -> None:
    """脸：x 34..62、y 30..68，四角切 4px 做圆脸"""
    im.rect(38, 26, 58, 30, skin)          # 额头
    im.rect(34, 30, 62, jaw, skin)         # 脸
    for i in range(4):                      # 切角
        im.rect(34, 30 + i, 38 - i, 31 + i, (0, 0, 0, 0))
        im.rect(58 + i, 30 + i, 62, 31 + i, (0, 0, 0, 0))
        im.rect(34, jaw - 4 + i, 38 - i, jaw - 3 + i, (0, 0, 0, 0))
        im.rect(58 + i, jaw - 4 + i, 62, jaw - 3 + i, (0, 0, 0, 0))
    # 耳朵
    im.rect(31, 46, 34, 56, skin)
    im.rect(62, 46, 65, 56, skin)
    # 颧骨/下颌的暗面
    im.rect(34, jaw - 8, 38, jaw - 2, dark(skin, 0.14))
    im.rect(58, jaw - 8, 62, jaw - 2, dark(skin, 0.14))
    # 脖子：只画到 73，剩下的交给衣领（画 78 会把立领盖掉）
    im.rect(43, 64, 54, 73, dark(skin, 0.22))


def face(im: Img, brow_color, beard: str, beard_color, glasses: bool = False) -> None:
    """五官：两笔眉毛 + 两只眼 + 鼻影 + 嘴，胡须按型态加"""
    # 眉毛
    im.rect(38, 44, 46, 46, brow_color)
    im.rect(50, 44, 58, 46, brow_color)
    im.rect(37, 45, 38, 46, brow_color)
    im.rect(58, 45, 59, 46, brow_color)
    # 眼
    for ex in (38, 50):
        im.rect(ex, 48, ex + 8, 50, PAPER + (A,))
        im.rect(ex + 2, 48, ex + 5, 50, INK + (A,))
        im.put(ex + 3, 48, PAPER + (A,))   # 高光
    # 鼻
    im.rect(47, 51, 49, 57, dark(CREAM, 0.18))
    im.rect(46, 57, 50, 58, dark(CREAM, 0.28))
    # 嘴
    im.rect(43, 60, 53, 61, mix(CREAM, RED_DARK, 0.55))

    if glasses:
        for (x0, x1) in ((36, 47), (49, 60)):
            # 只画镜框，不擦镜片——擦掉就连眼睛一起没了
            im.hline(x0, x1, 46, INK + (A,))
            im.hline(x0, x1, 51, INK + (A,))
            im.vline(x0, 46, 52, INK + (A,))
            im.vline(x1 - 1, 46, 52, INK + (A,))
        im.hline(47, 49, 48, INK + (A,))

    if beard == "long":
        im.rect(41, 58, 55, 65, beard_color)      # 上唇须
        # 垂须分两缕、长短错开：一整块方块不管多窄都像围裙，分开才有毛的走向
        im.rect(44, 65, 47, 88, beard_color)
        im.rect(49, 65, 52, 84, beard_color)
        im.rect(47, 65, 49, 72, beard_color)
        im.rect(45, 88, 47, 92, dark(beard_color, 0.25))
        im.rect(50, 84, 52, 87, dark(beard_color, 0.25))
        im.rect(45, 70, 46, 84, dark(beard_color, 0.22))
        im.rect(50, 70, 51, 80, dark(beard_color, 0.22))
        im.rect(45, 61, 51, 64, (0, 0, 0, 0))     # 嘴露出来
    elif beard == "goatee":
        im.rect(40, 60, 44, 64, beard_color)
        im.rect(52, 60, 56, 64, beard_color)
        im.rect(45, 63, 51, 72, beard_color)
        im.rect(46, 72, 50, 75, dark(beard_color, 0.3))
    elif beard == "full":
        im.rect(36, 58, 60, 64, beard_color)
        im.rect(38, 64, 58, 76, beard_color)
        im.rect(42, 60, 54, 63, (0, 0, 0, 0))
    elif beard == "mustache":
        im.rect(39, 59, 57, 62, beard_color)
        im.rect(42, 61, 54, 63, (0, 0, 0, 0))


def hat(im: Img, kind: str, main, trim, bead=None) -> None:
    if kind == "qing":
        # 清官帽：圆顶 + 帽檐 + 顶珠
        im.rect(35, 14, 61, 34, main)
        im.rect(33, 16, 35, 32, dark(main, 0.3))
        im.rect(61, 16, 63, 32, dark(main, 0.3))
        im.rect(30, 32, 66, 36, trim)
        im.rect(30, 36, 66, 37, dark(trim, 0.4))
        if bead:
            im.rect(46, 9, 50, 13, bead)
    elif kind == "taiping":
        # 头巾：包头 + 额前一道亮带 + 发髻
        im.rect(34, 18, 62, 38, main)
        im.rect(32, 22, 34, 36, dark(main, 0.3))
        im.rect(62, 22, 64, 36, dark(main, 0.3))
        im.rect(33, 30, 63, 34, trim)
        im.rect(45, 14, 51, 19, dark(main, 0.35))
    elif kind == "cap":
        # 军帽：帽身 + 前檐
        im.rect(34, 18, 62, 34, main)
        im.rect(32, 30, 64, 34, trim)
        im.rect(30, 34, 66, 36, dark(trim, 0.45))
        im.rect(46, 20, 50, 30, trim)
    elif kind == "straw":
        # 斗笠：宽檐 + 锥顶
        im.poly([(y, 48 - int(6 + (y - 14) * 2.2), 48 + int(6 + (y - 14) * 2.2)) for y in range(14, 30)], main)
        im.rect(24, 28, 72, 32, trim)
        im.rect(24, 32, 72, 33, dark(trim, 0.45))
    elif kind == "top":
        # 西式礼帽：高筒 + 平檐 + 帽带
        im.rect(35, 8, 61, 30, main)
        im.rect(33, 10, 35, 30, dark(main, 0.3))
        im.rect(28, 28, 68, 32, main)
        im.rect(28, 32, 68, 33, dark(main, 0.5))
        im.rect(35, 22, 61, 26, trim)
    elif kind == "none":
        # 无帽：只画头发
        im.rect(34, 20, 62, 34, main)
        im.rect(34, 20, 62, 24, dark(main, 0.25))


# ---------------- 人物表 ----------------

PEOPLE = {
    # 太平天国
    "hong_xiuquan": dict(
        skin=CREAM, robe=STAR, trim=BROWN_DEEP, hat="taiping", hat_main=STAR,
        hat_trim=BROWN_DARK, beard="mustache", beard_color=INK, brow=INK, collar="round",
    ),
    "yang_xiuqing": dict(
        skin=SAND, robe=RED_DARK, trim=STAR, hat="taiping", hat_main=PLUM_MID,
        hat_trim=STAR, beard="full", beard_color=INK, brow=INK, collar="v",
    ),
    "wei_changhui": dict(
        skin=SAND, robe=GREEN_DARK, trim=CREAM, hat="taiping", hat_main=NIGHT,
        hat_trim=GREEN, beard="full", beard_color=BROWN_DEEP, brow=INK, collar="v",
    ),
    "shi_dakai": dict(
        skin=CREAM, robe=INDIGO, trim=GREY_LIGHT, hat="taiping", hat_main=PLUM_DARK,
        hat_trim=BLUE, beard="none", beard_color=INK, brow=INK, collar="v",
    ),
    "li_xiucheng": dict(
        skin=SAND, robe=INDIGO, trim=STAR, hat="cap", hat_main=NIGHT,
        hat_trim=BLUE, beard="mustache", beard_color=INK, brow=INK, collar="v",
    ),
    "hong_renxuan": dict(
        skin=CREAM, robe=GREY_PLUM, trim=PAPER, hat="taiping", hat_main=PLUM_DARK,
        hat_trim=PAPER, beard="long", beard_color=GREY_LIGHT, brow=INK, collar="round",
        glasses=True,
    ),
    "taiping_bing": dict(
        skin=SAND, robe=RED_DARK, trim=BROWN, hat="taiping", hat_main=RED,
        hat_trim=BROWN, beard="none", beard_color=INK, brow=INK, collar="v",
    ),
    "zeng_guofan": dict(
        skin=SAND, robe=PLUM_DARK, trim=STAR, hat="qing", hat_main=NIGHT,
        hat_trim=PLUM_MID, beard="goatee", beard_color=INK, brow=INK, collar="round",
        bead=STAR,
    ),
    # 鸦片战争（原来只有旁白与两位主角有图）
    "shuiyong": dict(
        skin=SAND, robe=RED_SOFT, trim=BROWN_DEEP, hat="cap", hat_main=BROWN_DARK,
        hat_trim=RED, beard="none", beard_color=INK, brow=INK, collar="v",
    ),
    "xiangmin": dict(
        skin=SAND, robe=BROWN, trim=CREAM, hat="straw", hat_main=SAND,
        hat_trim=BROWN_DARK, beard="mustache", beard_color=BROWN_DEEP, brow=INK, collar="v",
    ),
    "qiying": dict(
        skin=CREAM, robe=RED_DARK, trim=STAR, hat="qing", hat_main=NIGHT,
        hat_trim=PLUM_MID, beard="long", beard_color=PAPER, brow=GREY_PLUM, collar="round",
        bead=RED_BRIGHT,
    ),
    "pottinger": dict(
        skin=CREAM, robe=RED, trim=STAR, hat="top", hat_main=NIGHT,
        hat_trim=RED_DARK, beard="full", beard_color=BROWN_DARK, brow=BROWN_DARK,
        collar="epaulette",
    ),
}


def build(name: str, spec: dict) -> Img:
    im = Img()
    body(im, spec["robe"], spec["trim"], spec.get("collar", "v"))
    head(im, spec["skin"], jaw=spec.get("jaw", 64))
    hat(im, spec["hat"], spec["hat_main"], spec["hat_trim"], spec.get("bead"))
    face(
        im,
        spec["brow"],
        spec["beard"],
        spec["beard_color"] + (A,) if len(spec["beard_color"]) == 3 else spec["beard_color"],
        spec.get("glasses", False),
    )
    im.outline()
    return im


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "public" / "art"
    only = sys.argv[1] if len(sys.argv) > 1 else None
    made = []
    for name, spec in PEOPLE.items():
        if only and name != only:
            continue
        im = build(name, spec)
        out = root / f"portrait_{name}.png"
        im.png(out)
        made.append(out.name)
    print("generated:", ", ".join(made))


if __name__ == "__main__":
    main()
