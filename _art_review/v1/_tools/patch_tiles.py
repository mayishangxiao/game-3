# -*- coding: utf-8 -*-
"""瓦片第二轮：颗粒减半、海水波纹成段、石板高光对齐、木桩做出体积"""
import io

p = "gen_spec_assets.py"
s = io.open(p, encoding="utf-8").read()
start = s.index("def grain(g, pts, v):")
end = s.index("TILE_GROUPS = [")

new = '''def grain(g, pts, v):
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
    off = (i * 4) % 8
    for y in (off, off + 8):
        if y < 16:
            g.row(0, 15, y, "plumMid")
    for x in (off, (off + 8) % 16):
        g.col(x, 0, 7, "plumMid")
        g.col((x + 4) % 16, 8, 15, "plumMid")
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


'''
s = s[:start] + new + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("tiles rewritten")
