# -*- coding: utf-8 -*-
"""第二轮观感微调：须髯收窄、补子加边、阵亡头部层次"""
import io
p = "gen_spec.py"
s = io.open(p, encoding="utf-8").read()
n = 0


def rep(old, new):
    global s, n
    assert old in s, old[:70]
    s = s.replace(old, new)
    n += 1


# 须髯：7px 宽的白围嘴 → 5px 锥形，且让出嘴部
rep('        for i, w in enumerate((3, 3, 2, 1)):\n'
    '            g.rect(15 - w, y0 + 9 + i, 16 + w, y0 + 9 + i, K("beard"))\n'
    '        g.px(13, y0 + 8, K("beard"))\n'
    '        g.px(18, y0 + 8, K("beard"))',
    '        for i, w in enumerate((2, 2, 1, 1)):\n'
    '            g.rect(15 - w, y0 + 10 + i, 16 + w, y0 + 10 + i, K("beard"))\n'
    '        g.px(13, y0 + 9, K("beard"))          # 两鬓垂下，中间留出嘴\n'
    '        g.px(18, y0 + 9, K("beard"))')

# 关天培补子：加一圈金属边，蓝袍上才看得出来
rep('        g.rect(12, t + 3, 17, t + 8, K("patch"))\n'
    '        g.px(14, t + 5, K("patchLit"))\n'
    '        g.px(16, t + 6, K("patchLit"))',
    '        g.rect(12, t + 3, 17, t + 8, K("patch"))\n'
    '        g.row(12, 17, t + 3, K("patchLit"))          # 补子边框\n'
    '        g.row(12, 17, t + 8, K("patchLit"))\n'
    '        g.px(14, t + 5, K("patchLit"))               # 武补走兽，两格点到为止\n'
    '        g.px(16, t + 6, K("patchLit"))\n'
    '        g.px(15, t + 7, K("patchLit"))')

# 阵亡帧：先画脸再压帽，头不会糊成一坨黑
rep('    g.ellipse(6, 35, 3, 3, K("skin"))\n'
    '    if cfg["hat"] == "conical":',
    '    g.ellipse(6, 35, 3, 3, K("skin"))\n'
    '    g.px(5, 35, "ink")                               # 闭眼（阵亡识别）\n'
    '    g.px(7, 35, "ink")\n'
    '    if cfg["hat"] == "conical":')

io.open(p, "w", encoding="utf-8").write(s)
print("patched", n)
