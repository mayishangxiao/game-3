# -*- coding: utf-8 -*-
"""把观感修正打进 gen_spec.py（一次性补丁脚本）"""
import io

p = "gen_spec.py"
s = io.open(p, encoding="utf-8").read()
n = 0


def rep(old, new):
    global s, n
    assert old in s, old[:60]
    s = s.replace(old, new)
    n += 1


# ---------- F. 受击闪白：只洗亮部
rep(
    '    def K(role):\n'
    '        """取色；受击帧整体闪白（规格表 2.3 hurt = 受击闪白）"""\n'
    '        if flash and role != "ink" and c.get(role) != "ink":\n'
    '            return "paper"\n'
    '        return c.get(role, "ink")',
    '    DARK = {"ink", "night", "plumDark", "brownDeep", "brownDark", "greyPlum"}\n'
    '\n'
    '    def K(role):\n'
    '        """受击帧只把亮部洗白（规格表 2.3 hurt），描边与金属/皮革深色保留，\n'
    '        否则整只变成白幽灵、玩家认不出倒下的是谁。"""\n'
    '        v = c.get(role, "ink")\n'
    '        if flash and v not in DARK:\n'
    '            return "paper"\n'
    '        return v')

# ---------- E. 走路帧步幅加大
rep(
    '    elif leg == "a":        # 左腿前迈\n'
    '        g.rect(11, hem_top, 13, 36, K("legs"))\n'
    '        g.rect(18, hem_top, 20, 37, K("legs"))\n'
    '        draw_feet(g, cfg, K, 9, 12, foot_y)\n'
    '        draw_feet(g, cfg, K, 19, 22, foot_y)\n'
    '        g.row(11, 13, 30, K("legsShade") or K("legs"))\n'
    '    else:                   # b：右腿前迈\n'
    '        g.rect(11, hem_top, 13, 37, K("legs"))\n'
    '        g.rect(18, hem_top, 20, 36, K("legs"))\n'
    '        draw_feet(g, cfg, K, 10, 13, foot_y)\n'
    '        draw_feet(g, cfg, K, 20, 23, foot_y)\n'
    '        g.row(18, 20, 30, K("legsShade") or K("legs"))',
    '    elif leg == "a":        # 左腿前迈：前脚外探 3px，后脚抬 1px（落地脚仍压 y39）\n'
    '        g.rect(11, hem_top, 13, 35, K("legs"))\n'
    '        g.rect(18, hem_top, 20, 37, K("legs"))\n'
    '        draw_feet(g, cfg, K, 7, 11, foot_y)\n'
    '        draw_feet(g, cfg, K, 19, 22, foot_y - 1)\n'
    '        g.row(19, 22, foot_y, "ink")                     # 抬脚处留 1px 落地影\n'
    '        g.row(10, 13, hem_top, K("shade") or K("legs"))  # 衣摆随迈步甩出\n'
    '    else:                   # b：右腿前迈（镜像）\n'
    '        g.rect(11, hem_top, 13, 37, K("legs"))\n'
    '        g.rect(18, hem_top, 20, 35, K("legs"))\n'
    '        draw_feet(g, cfg, K, 10, 13, foot_y - 1)\n'
    '        draw_feet(g, cfg, K, 21, 25, foot_y)\n'
    '        g.row(11, 13, foot_y, "ink")\n'
    '        g.row(18, 21, hem_top, K("shade") or K("legs"))')

# ---------- A. 英军白羽收窄
rep(
    '        if cfg.get("plume"):\n'
    '            g.rect(9, y0 - 1, 11, y0 + 2, K("plume"))       # 羽饰收在帽墙一侧，不成白块\n'
    '            g.px(10, y0 - 2, K("plume"))',
    '        if cfg.get("plume"):\n'
    '            # 羽饰：帽墙左上探出，逐行 1-3-2-1 收窄；画成 3x4 白方块就会被读成白斑（踩过）\n'
    '            g.px(10, y0 - 2, K("plume"))\n'
    '            g.rect(9, y0 - 1, 11, y0 - 1, K("plume"))\n'
    '            g.rect(9, y0, 10, y0 + 1, K("plume"))\n'
    '            g.px(9, y0 + 2, K("plume"))')

# ---------- B. 掷弹兵熊皮帽
rep(
    '    elif hat == "bear":\n'
    '        g.rect(11, y0 - 3, 20, y0 + 3, K("hat"))            # 掷弹兵高筒帽\n'
    '        g.row(11, 20, y0 - 3, K("hatLit") or K("hat"))\n'
    '        g.rect(14, y0, 17, y0 + 1, K("plate"))\n'
    '        g.row(11, 20, y0 + 3, "ink")',
    '    elif hat == "bear":\n'
    '        g.rect(11, y0 - 3, 20, y0 + 3, K("hat"))            # 掷弹兵熊皮高帽\n'
    '        g.row(12, 19, y0 - 3, K("hat"))                     # 顶角收进 1px，不成方黑箱\n'
    '        g.px(11, y0 - 2, None)\n'
    '        g.px(20, y0 - 2, None)\n'
    '        g.row(11, 20, y0 + 2, "ink")                        # 下缘鬃毛压深\n'
    '        g.rect(14, y0 - 1, 17, y0 + 1, K("plate"))          # 前额帽徽')

# ---------- C. 须髯锥形
rep(
    '    if cfg.get("beard"):\n'
    '        # 须髯居中，最后画（上一版被袍盖住的坑）\n'
    '        for yy in range(y0 + 8, y0 + 14):\n'
    '            hw = max(1, 3 - (yy - (y0 + 8)) // 2)\n'
    '            g.rect(15 - hw + 1, yy, 15 + hw, yy, K("beard"))\n'
    '        g.px(14, y0 + 8, K("beard"))',
    '    if cfg.get("beard"):\n'
    '        # 须髯：下颌起 4 行锥形，居中、最后画（上一版被袍盖住 / 糊成白围嘴的坑）\n'
    '        for i, w in enumerate((3, 3, 2, 1)):\n'
    '            g.rect(15 - w, y0 + 9 + i, 16 + w, y0 + 9 + i, K("beard"))\n'
    '        g.px(13, y0 + 8, K("beard"))\n'
    '        g.px(18, y0 + 8, K("beard"))')

# ---------- D. 把总令旗挪到左肩后
rep(
    '        if cfg.get("banner"):                         # 把总背令旗（精英识别）\n'
    '            g.col(25, t - 8, t + 2, K("bannerPole"))\n'
    '            g.rect(23, t - 8, 26, t - 4, K("banner"))\n'
    '            g.row(23, 26, t - 4, K("bannerShade"))',
    '        if cfg.get("banner"):                         # 把总背令旗：竖杆压在左肩后\n'
    '            g.col(6, t - 9, t + 1, K("bannerPole"))\n'
    '            g.rect(3, t - 9, 5, t - 6, K("banner"))\n'
    '            g.row(3, 5, t - 6, K("bannerShade"))')

# ---------- G. 郭富精英识别
rep(
    '        g.rect(18, t + 7, 21, t + 9, K("dark"))       # 弹药包（团色系，不用金黄）',
    '        g.rect(18, t + 7, 21, t + 9, K("dark"))       # 弹药包（团色系，不用金黄）\n'
    '        if cfg.get("elite"):\n'
    '            # 精英识别：肩章加宽成纸白双线 + 左肩到右胯斜绶带（星黄被禁，只能用纸白）\n'
    '            g.rect(9, t, 12, t + 1, K("bright"))\n'
    '            g.rect(19, t, 22, t + 1, K("bright"))\n'
    '            g.diag(10, t + 1, 21, t + 10, K("bright"))\n'
    '            g.diag(11, t + 1, 21, t + 9, K("bright"))\n'
    '            g.row(9, 12, t + 2, K("facing"))')

# ---------- I. 枪口爆点
rep(
    '        if wpn == "out":\n'
    '            g.px(24 + dx, 6 + dy, K("bright"))\n'
    '            g.px(25 + dx, 6 + dy, K("metal"))',
    '        if wpn == "out":\n'
    '            # 击发反馈：枪口前一格纸白爆点，再前一格弹丸\n'
    '            g.px(24 + dx, 6 + dy, K("bright"))\n'
    '            g.px(25 + dx, 6 + dy, K("metal"))\n'
    '            g.px(24 + dx, 4 + dy, K("bright"))')

# ---------- H. 阵亡帧
rep(
    'def draw_body_down(g, cfg, K):\n'
    '    """阵亡帧：横卧，最低不透明像素仍压在第 40 行"""\n'
    '    g.rect(8, 34, 20, 38, K("body"))\n'
    '    g.rect(8, 38, 20, 38, K("shade") or K("body"))\n'
    '    g.ellipse(5, 36, 3, 3, K("skin"))\n'
    '    if cfg["hat"] in ("conical",):\n'
    '        g.rect(2, 32, 8, 33, K("hat"))\n'
    '    else:\n'
    '        g.rect(2, 33, 8, 34, K("hat"))\n'
    '    g.rect(21, 36, 26, 38, K("legs"))\n'
    '    draw_feet(g, cfg, K, 25, 27, FOOT)\n'
    '    draw_feet(g, cfg, K, 20, 22, FOOT)\n'
    '    g.row(9, 12, 39, "ink")\n'
    '    g.row(21, 26, 39, "ink")\n'
    '    g.px(7, 36, "ink")\n'
    '    g.px(4, 36, "ink")\n'
    '    if cfg["weapon"] != "none":\n'
    '        g.col(28, 36, 39, K("metal"))',
    'def draw_body_down(g, cfg, K):\n'
    '    """阵亡帧：头在左、躯干横陈、腿在右；最低不透明像素仍压在第 40 行（脚底线纪律）"""\n'
    '    g.ellipse(6, 35, 3, 3, K("skin"))\n'
    '    if cfg["hat"] == "conical":\n'
    '        g.poly([(2, 34), (10, 34), (6, 30)], K("hat"))       # 斗笠滚落到头侧\n'
    '    else:\n'
    '        g.rect(3, 31, 9, 33, K("hat"))\n'
    '    g.rect(9, 33, 21, 37, K("body"))\n'
    '    g.row(9, 21, 37, K("shade") or K("body"))\n'
    '    g.rect(11, 34, 14, 35, K("sleeve") or K("body"))         # 搭在身上的手臂\n'
    '    g.rect(21, 35, 25, 37, K("legs"))\n'
    '    draw_feet(g, cfg, K, 25, 27, FOOT)\n'
    '    g.row(3, 27, FOOT, "ink")                                # 地面接触影\n'
    '    if cfg["weapon"] != "none":\n'
    '        g.row(13, 22, 31, K("metal"))                        # 掉落的兵器横在一旁\n'
    '        g.px(23, 31, K("hilt") or K("metal"))')

# ---------- 单位表补充：elite 标记 + 掷弹兵熊皮配色
rep('UK_GREN.update({"name": "ch00_char_en_uk_grenadier", "cn": "英军掷弹兵",\n'
    '                "hat": "bear", "weapon": "musket", "plume": False})',
    'UK_GREN.update({"name": "ch00_char_en_uk_grenadier", "cn": "英军掷弹兵",\n'
    '                "hat": "bear", "weapon": "musket", "plume": False})\n'
    'UK_GREN["c"] = dict(UK_INF["c"])\n'
    'UK_GREN["c"]["hat"] = "plumDark"      # 熊皮用深紫灰，才不会被 1px 描边糊成方黑箱')
rep('UK_BRIG.update({"name": "ch00_char_en_uk_brigadier", "cn": "郭富准将（精英）",\n'
    '                "weapon": "sword", "plume": False})',
    'UK_BRIG.update({"name": "ch00_char_en_uk_brigadier", "cn": "郭富准将（精英）",\n'
    '                "weapon": "sword", "plume": False, "elite": True})')

io.open(p, "w", encoding="utf-8").write(s)
print("patched", n, "spots")
