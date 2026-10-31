# -*- coding: utf-8 -*-
"""立绘第二轮：修掉「悬空白围嘴 / 脸侧飘色块 / 脖子断口」"""
import io

p = "gen_spec_assets.py"
s = io.open(p, encoding="utf-8").read()
start = s.index("def portrait_guan():")
end = s.index("# ============================================================ 主流程")

new = '''def face_shade(g, cx, cy, rx, ry, col, depth=3):
    """沿脸部椭圆右侧内收 3px 压暗，不要画成一块飘在脸外的竖条。"""
    for y in range(cy - ry, cy + ry + 1):
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
    face_shade(g, 48, 40, 17, 20, "indigo", 3)
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
    face_shade(g, 48, 42, 16, 19, "night", 3)
    g.row(40, 43, 35, "ink")
    g.row(52, 55, 35, "ink")
    g.rect(41, 40, 42, 40, "ink")
    g.rect(53, 54, 54, 54, "ink") if False else g.rect(53, 40, 54, 40, "ink")
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


'''
s = s[:start] + new + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("portraits rewritten")
