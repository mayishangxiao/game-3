# -*- coding: utf-8 -*-
"""按《美术资产规格表 v1》重做：Boss / 瓦片 / 鸦片箱 / 立绘

全部沿用 gen_spec.py 的 Grid 与 24 色表，逐帧自检 ≤8 色、禁星黄。
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
from gen_spec import (Grid, PAL, WARNINGS, FR, SH, PV, TL, PT, AT, QA, BUDGET)

BW, BH = 96, 48
WATERLINE = 39          # 规格表 2.4：吃水线固定 y=40（0-based 39）
MATURE = ImageFont.truetype(r"C:\Windows\Fonts\simhei.ttf", 16)


def thicken_left(g, y1, y2, extra=1):
    """规格表 4.3：左侧轮廓线厚一点（左上光），右侧靠暗色面板压暗"""
    for y in range(y1, y2 + 1):
        xs = [x for x in range(g.w) if g.get(x, y)]
        if xs:
            for k in range(1, extra + 1):
                g.px(xs[0] - k, y, "ink")
    return g


def rgb(name):
    v = PAL[name]
    return (v >> 16 & 255, v >> 8 & 255, v & 255)


def save(g, folder, name, preview=None, pcols=None, plabels=None, psc=8):
    g.check(name)
    g.to_img(1).save(os.path.join(folder, name + ".png"))
    if preview:
        sc = psc
        cols = pcols or 1
        rows = (len(preview) + cols - 1) // cols
        cw, chh = g.w * sc + 12, g.h * sc + 30
        img = Image.new("RGBA", (cw * cols + 8, chh * rows + 34), rgb("night") + (255,))
        d = ImageDraw.Draw(img)
        for i, gg in enumerate(preview):
            r, c = divmod(i, cols)
            im = gg.to_img(sc)
            bg = Image.new("RGBA", (gg.w * sc, gg.h * sc), rgb("plumDark") + (255,))
            bg.paste(im, (0, 0), im)
            x, y = 8 + c * cw, 30 + r * chh
            img.paste(bg, (x, y))
            lab = (plabels[i] if plabels else str(i))
            d.text((x, y + gg.h * sc + 2), lab, font=MATURE, fill=rgb("greyLight"))
        img.save(os.path.join(PV, name + "_preview8x.png"))
    return g


# ============================================================ Boss 蒸汽炮舰
BOSS_POSES = [
    "idle", "recoil", "smoke", "broadside", "broken_a", "broken_b"]


def boss_frame(idx):
    g = Grid(BW, BH)
    dx = {-1: 0, 0: 0, 1: -1, 2: 0, 3: 1, 4: 0, 5: 1}[idx]
    broken = idx in (4, 5)
    dense = idx in (2, 3, 5)
    lit_all = idx == 3
    lit_one = idx == 1

    # ---- 水面（40-47 行，只画在船底之下，浪花与倒影不许越界）
    for x in range(4, 94):
        top = WATERLINE + 1 + ((x // 7) % 2)
        g.col(x, top, 47, "blue")
    for x in range(6, 92, 9):
        g.row(x, x + 3, 43, "blueLight")
        g.row(x + 4, x + 6, 46, "blueLight")
    for x in range(10, 88, 6):                 # 船侧倒影
        g.col(x, WATERLINE + 2, WATERLINE + 3, "greyPlum")

    # ---- 船体（船头朝左，最宽 92px：x 2..93）
    g.poly([(12, 28), (93, 28), (93, WATERLINE), (8, WATERLINE), (4, 34), (9, 30)], "plumDark")
    g.row(13, 92, 28, "greyPlum")               # 左上光：舷墙顶提亮
    g.row(13, 92, 29, "brown")                  # 甲板
    g.row(13, 90, WATERLINE, "blue")            # 吃水线固定这一行
    g.row(9, 92, 36, "ink")                     # 船体下缘暗带
    # 炮门（深墨方块），开火帧点亮
    ports = list(range(18, 88, 8))
    for i, px in enumerate(ports):
        lit = lit_all or (lit_one and i == 3)
        g.rect(px + dx, 32, px + 2 + dx, 34, "paper" if lit else "ink")
        if lit:
            g.px(px - 1 + dx, 33, "paper")
            g.px(px + 3 + dx, 33, "paper")

    # ---- 单烟囱
    g.rect(52 + dx, 18, 58 + dx, 27, "plumDark")
    g.col(52 + dx, 18, 27, "greyPlum")
    g.rect(52 + dx, 17, 58 + dx, 17, "ink")

    # ---- 三桅与收帆（破损帧掉前桅）
    masts = [(22, True), (42, True), (70, True)]
    for mx, alive in masts:
        if broken and mx == 22:
            continue
        g.col(mx + dx, 9, 27, "greyPlum")
        g.row(mx - 5 + dx, mx + 5 + dx, 12, "greyPlum")     # 横桁
        g.rect(mx - 4 + dx, 13, mx + 4 + dx, 15, "paper")   # 收起的帆卷
        g.row(mx - 4 + dx, mx + 4 + dx, 15, "greyPlum")
    # 船头斜桅
    g.diag(12 + dx, 26, 3 + dx, 20, "greyPlum")

    # ---- 米字旗解除：红底 + 纸白十字（规格表 6.3）
    g.rect(71 + dx, 4, 80 + dx, 9, "red")
    g.col(75 + dx, 4, 9, "paper")
    g.row(71 + dx, 80 + dx, 6, "paper")

    # ---- 黑烟（先画烟再画桅，避免烟把桅杆切断——上一版踩过）
    # 两遍法：先整片铺实心，再统一取外缘提亮。逐团提亮会在团与团的内接缝乱亮、读成串珠
    puffs = ((55, 14, 2), (52, 11, 3), (48, 8, 3), (43, 6, 4), (37, 5, 3), (31, 4, 2))
    if dense:
        puffs = ((55, 14, 3), (51, 11, 4), (46, 8, 4), (40, 6, 5), (33, 5, 4), (26, 4, 3), (19, 3, 2))
    smoke = set()
    for cx, cy, r in puffs:
        for yy in range(max(0, cy - r), min(BH, cy + r + 1)):
            for xx in range(cx - r, cx + r + 1):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r and g.get(xx, yy) is None:
                    g.px(xx, yy, "ink")
                    smoke.add((xx, yy))
    for xx, yy in sorted(smoke, key=lambda p: (p[1], p[0])):
        if g.get(xx, yy) != "ink":
            continue
        if (g.get(xx - 1, yy - 1) is None
                and (g.get(xx, yy - 1) is None or g.get(xx - 1, yy) is None)):
            g.px(xx, yy, "greyPlum")

    # ---- 破损：掉一块桅、船身焦黑
    if broken:
        g.rect(30 + dx, 30, 41 + dx, 36, "ink")
        g.px(34 + dx, 29, "ink")
        g.px(38 + dx, 29, "ink")
        if idx == 5:
            g.rect(60 + dx, 31, 68 + dx, 36, "ink")
    g.outline("ink")
    return g


# ============================================================ 瓦片 6 组
def grain(g, pts, v):
    for x, y in pts:
        g.px(x, y, v)


def dash(g, x, y, n, v):
    """颗粒一律成段（≥2px）：单像素点在 30x16 铺开后就是满地噪点（规格表 三/九）"""
    for k in range(n):
        g.px(x + k, y, v)


def tile_beach(i):
    """沙滩底 4 格：极细颗粒，比 v1 再稀一档，且不画碎贝壳"""
    g = Grid(16, 16, fill="sand")
    ox, oy = ((0, 0), (4, 7), (9, 3), (12, 11))[i]
    for x, y, n in ((1, 2, 2), (7, 5, 2), (3, 10, 2), (11, 13, 2)):
        dash(g, (x + ox) % 16, (y + oy) % 16, n, "brown")
    for x, y in ((13, 8), (5, 14)):
        g.px((x + ox) % 16, (y + oy) % 16, "brownDark")
    return g


def tile_sandspot(i):
    """沙面点缀 3 格：稀疏褐斑，接缝处可拼"""
    g = Grid(16, 16, fill="sand")
    for x, y, n in ((1, 2, 3), (10, 6, 3), (4, 12, 2)):
        dash(g, x, y, n, "brown")
    for x, y, n in ((6, 4, 2), (13, 10, 2)):
        dash(g, x, y, n, "brownDark")
    if i == 1:
        dash(g, 12, 1, 3, "brown")
        dash(g, 2, 8, 2, "brown")
    if i == 2:
        dash(g, 2, 6, 2, "brown")
        dash(g, 11, 13, 3, "brown")
    return g


def tile_sea(i):
    """海水 4 格：只有横向波纹，波纹成段 4px，不要浪花、不要深色杂点"""
    g = Grid(16, 16, fill="blue")
    plan = [(2, 1, 5), (6, 9, 4), (10, 3, 4), (13, 11, 5)]
    y0, x0, n0 = plan[i]
    dash(g, x0, y0, n0, "blueLight")
    dash(g, (x0 + 9) % 13, y0 + 1, 3, "blueLight")
    y1 = (y0 + 7) % 16
    dash(g, (x0 + 5) % 12, y1, 4, "blueLight")
    dash(g, 0, (y0 + 12) % 16, 3, "blueLight")
    return g


def tile_transition(i):
    """过渡边 6 格：沙→水 3 种 + 沙→石 3 种，朝向由引擎旋转"""
    if i < 3:
        g = Grid(16, 16, fill="sand")
        edge = 4 + i * 3
        for x in range(16):
            top = edge + (1 if x % 5 == i else 0)
            g.col(x, top, 15, "blue")
        for x in range(0, 16, 4):
            dash(g, x, edge - 1, 2, "blueLight")     # 湿沙带：成段，不留单点
        dash(g, 2, edge + 3, 4, "blueLight")
        dash(g, 9, edge + 6, 4, "blueLight")
        return g
    g = Grid(16, 16, fill="sand")
    edge = 4 + (i - 3) * 3
    g.rect(0, edge, 15, 15, "plumLight")
    g.row(0, 15, edge, "greyPlum")                   # 石板压沙的硬边
    for x in (0, 8):
        g.col(x, edge + 3, 15, "plumMid")
    dash(g, 3, edge + 5, 2, "greyPlum")
    return g


def tile_stone(i):
    """石板/城墙 4 格：砖缝对齐 16 格，高光只给每砖一格，避免彩纸感"""
    g = Grid(16, 16, fill="plumLight")
    # 砖缝固定在行 4 / 行 12：上下边缘都落在砖面上，纵向平铺才不会出现「每 16 格一道亮线」
    g.row(0, 15, 4, "plumMid")
    g.row(0, 15, 12, "plumMid")
    off = 2 + (i * 4) % 8                       # 错缝：每格砖的竖缝位置不同
    for x in (off, (off + 8) % 16):
        g.col(x, 5, 11, "plumMid")
    for x in ((off + 4) % 16, (off + 12) % 16):
        g.col(x, 13, 15, "plumMid")
        g.col(x, 0, 3, "plumMid")
    dash(g, 2, 2, 2, "greyPlum")
    dash(g, 10, 10, 2, "greyPlum")
    dash(g, 6, 13, 2, "plumDark")
    dash(g, 13, 5, 2, "plumDark")
    return g


def tile_wood(i):
    """木/土 4 格：栈桥木板；木桩靠高光+投影出体积，不许整格铺深色"""
    g = Grid(16, 16, fill="brown")
    if i < 3:
        for x in (3, 11):
            g.col(x, 0, 15, "brownDark")
        g.row(0, 15, (i * 5 + 2) % 16, "brownDeep")
        dash(g, 0, (i * 5 + 5) % 16, 2, "sand")
        dash(g, 7, (i * 5 + 9) % 16, 2, "sand")
    else:
        g.rect(0, 0, 15, 15, "sand")                 # 木桩立在沙地上
        g.rect(5, 4, 10, 12, "brown")
        g.row(5, 10, 4, "sand")                      # 桩顶受光
        g.col(5, 4, 12, "brownDark")                 # 左侧轮廓
        g.col(10, 5, 12, "brownDeep")                # 右侧背光
        g.rect(6, 13, 11, 14, "brownDeep")           # 落影
    return g


TILE_GROUPS = [
    ("ch00_tiles_beach", "沙滩底", [tile_beach(i) for i in range(4)]),
    ("ch00_tiles_sandspot", "沙面点缀", [tile_sandspot(i) for i in range(3)]),
    ("ch00_tiles_transition", "过渡边（沙→水 / 沙→石）", [tile_transition(i) for i in range(6)]),
    ("ch00_tiles_sea", "海水", [tile_sea(i) for i in range(4)]),
    ("ch00_tiles_stone", "石板/城墙", [tile_stone(i) for i in range(4)]),
    ("ch00_tiles_wood", "木/土", [tile_wood(i) for i in range(4)]),
]


def strip(tiles):
    img = Image.new("RGBA", (16 * len(tiles), 16), (0, 0, 0, 0))
    for i, t in enumerate(tiles):
        img.paste(t.to_img(1), (i * 16, 0))
    return img


def proof3x3(tiles, name, cn):
    """规格表 3.1：验收时拿 3×3 平铺图看接缝"""
    n = len(tiles)
    img = Image.new("RGBA", (48 * 6, 48 * 2), rgb("night") + (255,))
    for r in range(2):
        for c in range(3):
            for dy in range(3):
                for dx in range(3):
                    k = (dx + dy * 3 + c) % n
                    img.paste(tiles[k].to_img(1), (c * 144 + dx * 16 + 8, r * 96 + dy * 16 + 8))
    d = ImageDraw.Draw(img)
    d.text((8, 0), f"{cn}  3x3 平铺接缝检查（{n} 格轮换）", font=MATURE, fill=rgb("paper"))
    img.save(os.path.join(TL, name + "_proof3x3.png"))


# ============================================================ 鸦片箱 20×20
def opium_chest():
    """严格 20×20；木纹三横板 + 一竖撑；角铁包边用褐/深褐（星黄是交互专用色，不许用）"""
    g = Grid(20, 20)
    g.rect(0, 0, 19, 19, "brown")
    for y in (5, 11, 17):                       # 三条横板缝
        g.row(0, 19, y, "brownDark")
    g.col(9, 0, 19, "brownDeep")                # 中间一竖撑
    for x in (0, 19):                           # 角铁包边（褐系，不用金黄）
        g.col(x, 0, 19, "brownDeep")
    for y in (0, 19):
        g.row(0, 19, y, "brownDeep")
    for x, y in ((1, 1), (18, 1), (1, 18), (18, 18)):
        g.px(x, y, "ink")                       # 四角铆钉
    g.rect(7, 7, 12, 12, "paper")               # 6×6 标签，箱面正中
    g.rect(9, 7, 10, 12, "red")
    g.rect(7, 9, 12, 10, "red")
    g.px(18, 1, "paper")                        # 右上角 1px 纸白高光
    g.px(1, 18, "brownDark")
    g.outline("ink")
    return g


# ============================================================ 对话立绘 96×112
def face_shade(g, cx, cy, rx, ry, col, depth=2):
    """沿脸部椭圆右侧内收 2px 压暗（左上光的对侧），不要画成飘在脸外的竖条。
    只压到下颌以上，否则脖子会跟着变一条深色带子。"""
    for y in range(cy - ry + 4, cy + ry - 3):
        t = 1 - ((y - cy) / ry) ** 2
        if t <= 0:
            continue
        edge = round(cx + rx * t ** 0.5)
        for k in range(depth):
            if g.get(edge - k, y):
                g.px(edge - k, y, col)
    return g


def beard(g, cx, y0, widths, col):
    """须髯贴着下颌往下收，宽度逐行递减；不许画成悬在胸口中间的方块。"""
    for i, w in enumerate(widths):
        g.rect(cx - w, y0 + i, cx + w, y0 + i, col)
    return g


def portrait_guan():
    """关天培胸像 96x112｜8 色：ink blue indigo red cream greyLight greyPlum brownDark"""
    g = Grid(96, 112)
    # 肩与袍（梯形，底边铺满）
    g.poly([(8, 111), (88, 111), (74, 62), (22, 62)], "blue")
    g.poly([(76, 66), (88, 111), (70, 111)], "indigo")          # 右侧压暗
    g.row(22, 74, 62, "indigo")                                  # 肩线
    g.rect(42, 52, 54, 66, "cream")                              # 脖子（补上断口）
    g.row(42, 54, 65, "indigo")
    # 头盔
    g.rect(30, 16, 66, 30, "brownDark")
    g.px(30, 16, None)
    g.px(66, 16, None)
    g.row(31, 65, 16, "brownDark")
    g.poly([(27, 30), (69, 30), (67, 35), (29, 35)], "greyPlum")  # 盔檐
    g.row(29, 67, 35, "ink")
    g.rect(45, 8, 51, 15, "greyLight")                            # 盔顶缨
    g.px(48, 6, "greyLight")
    # 脸
    g.ellipse(48, 40, 17, 20, "cream")
    face_shade(g, 48, 40, 17, 20, "indigo", 2)
    g.row(40, 43, 33, "ink")                                      # 眉
    g.row(52, 55, 33, "ink")
    g.rect(41, 38, 42, 38, "ink")                                 # 一眼一格，别画成对眼
    g.rect(53, 38, 54, 38, "ink")
    g.px(48, 44, "ink")                                           # 鼻
    g.row(46, 50, 48, "ink")                                      # 嘴
    beard(g, 48, 50, (6, 5, 4, 3, 2, 1), "greyLight")             # 长须贴下颌
    g.px(38, 46, "greyLight")                                     # 两鬓
    g.px(58, 46, "greyLight")
    # 领口滚边（先画领，再画补子，红线不能横穿补子）
    g.diag(40, 63, 47, 70, "red")
    g.diag(56, 63, 49, 70, "red")
    # 武官补子
    g.rect(34, 72, 62, 96, "indigo")
    g.row(34, 62, 72, "greyPlum")
    g.row(34, 62, 96, "greyPlum")
    g.col(34, 72, 96, "greyPlum")
    g.col(62, 72, 96, "greyPlum")
    g.px(44, 80, "greyPlum")
    g.px(48, 84, "greyPlum")
    g.px(52, 79, "greyPlum")
    g.px(55, 88, "greyPlum")
    g.row(14, 84, 104, "indigo")                                  # 大带
    g.row(14, 84, 106, "red")
    thicken_left(g, 62, 111, 2)                                   # 规格表 4.3：左侧轮廓加厚
    g.outline("ink")
    return g


def portrait_lin():
    """林则徐胸像 96x112｜8 色：ink indigo night blue red cream paper greyPlum"""
    g = Grid(96, 112)
    g.poly([(10, 111), (86, 111), (72, 64), (24, 64)], "indigo")
    g.poly([(74, 68), (86, 111), (68, 111)], "night")
    g.row(24, 72, 64, "night")
    g.rect(42, 54, 54, 68, "cream")
    g.row(42, 54, 67, "night")
    # 乌纱帽
    g.rect(30, 18, 66, 32, "ink")
    g.px(30, 18, None)
    g.px(66, 18, None)
    g.rect(16, 26, 30, 30, "ink")                                 # 左右展角
    g.rect(66, 26, 80, 30, "ink")
    g.row(30, 66, 33, "night")
    g.px(48, 14, "red")                                           # 顶戴
    g.rect(46, 15, 50, 16, "red")
    # 脸
    g.ellipse(48, 42, 16, 19, "cream")
    face_shade(g, 48, 42, 16, 19, "indigo", 2)
    g.row(40, 43, 35, "ink")
    g.row(52, 55, 35, "ink")
    g.rect(41, 40, 42, 40, "ink")
    g.rect(53, 40, 54, 40, "ink")
    g.px(48, 46, "ink")
    g.row(46, 50, 50, "ink")
    beard(g, 48, 52, (5, 4, 3, 2, 1), "greyPlum")
    g.px(38, 48, "greyPlum")
    g.px(58, 48, "greyPlum")
    # 交领右衽：白护领 + 蓝缘，止于大带
    g.diag(38, 66, 54, 86, "paper")
    g.diag(41, 66, 57, 86, "paper")
    g.diag(40, 66, 55, 84, "blue")
    g.rect(24, 88, 72, 94, "night")                               # 大带
    g.row(24, 72, 92, "red")
    thicken_left(g, 64, 111, 2)
    g.outline("ink")
    return g


# ============================================================ 主流程
def main():
    boss = [boss_frame(i) for i in range(6)]
    for i, b in enumerate(boss):
        save(b, FR, f"ch00_boss_steamfrigate_{i:02d}")
    sheet = Image.new("RGBA", (BW * 6, BH), (0, 0, 0, 0))
    for i, b in enumerate(boss):
        sheet.paste(b.to_img(1), (i * BW, 0))
    sheet.save(os.path.join(SH, "ch00_boss_steamfrigate_sheet.png"))
    # Boss 8 倍预览（3×2 排布）
    cols, sc = 3, 8
    img = Image.new("RGBA", ((BW * sc + 12) * cols + 8, (BH * sc + 30) * 2 + 34), rgb("night") + (255,))
    d = ImageDraw.Draw(img)
    d.text((8, 4), "蒸汽炮舰 Boss 96x48  吃水线 y=40  6 帧（4 战斗 + 2 破损）", font=MATURE, fill=rgb("paper"))
    for i, b in enumerate(boss):
        r, c = divmod(i, cols)
        im = b.to_img(sc)
        bg = Image.new("RGBA", im.size, rgb("blue") + (255,))
        bg.paste(im, (0, 0), im)
        x, y = 8 + c * (BW * sc + 12), 30 + r * (BH * sc + 30)
        img.paste(bg, (x, y))
        d.text((x, y + BH * sc + 2), BOSS_POSES[i], font=MATURE, fill=rgb("greyLight"))
    img.save(os.path.join(PV, "ch00_boss_steamfrigate_preview8x.png"))

    for name, cn, tiles in TILE_GROUPS:
        for i, t in enumerate(tiles):
            t.check(f"{name}/{i}")
        strip(tiles).save(os.path.join(TL, name + ".png"))
        proof3x3(tiles, name, cn)
        st = strip(tiles)
        st.resize((st.width * 8, st.height * 8), Image.NEAREST).save(
            os.path.join(PV, name + "_preview8x.png"))
        print(f"{cn:<22} {len(tiles)} 格  最大色数 {max(len(t.colors()) for t in tiles)}")

    chest = opium_chest()
    save(chest, FR, "ch00_prop_opiumchest", preview=[chest], pcols=1, plabels=["20x20"])
    for fn, nm in ((portrait_guan, "ch00_portrait_guantianpei"),
                   (portrait_lin, "ch00_portrait_linxzexu")):
        p = fn()
        save(p, PT, nm, preview=[p], pcols=1, plabels=["96x112"], psc=3)
    for w in WARNINGS:
        print("WARN", w)
    print("Boss 最大色数", max(len(b.colors()) for b in boss))


if __name__ == "__main__":
    main()
