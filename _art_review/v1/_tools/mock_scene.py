# -*- coding: utf-8 -*-
"""480×270 真机比例场景（规格表 十：以游戏截图为准，不以放大预览为准）

地面用本轮瓦片集铺，实体用本轮 32×40 帧，HUD 按现在游戏里的程序画法占位。
"""
import os
import sys
import random
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_spec import PAL, CW, CH

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out_spec")
QA = os.path.join(OUT, "qa")
os.makedirs(QA, exist_ok=True)

VW, VH, TILE, FIELD_ROWS, HUD_H = 480, 270, 16, 16, 14
random.seed(7)


def rgb(name):
    v = PAL[name]
    return (v >> 16 & 255, v >> 8 & 255, v & 255)


def cell(group, i, flip=False):
    im = Image.open(os.path.join(OUT, "tiles", f"ch00_tiles_{group}.png")).convert("RGBA")
    t = im.crop((i * 16, 0, i * 16 + 16, 16))
    if flip:
        t = t.transpose(Image.FLIP_TOP_BOTTOM)
    return t


def unit(name, idx=0):
    return Image.open(os.path.join(OUT, "frames", f"{name}_{idx:02d}.png")).convert("RGBA")


def build():
    img = Image.new("RGBA", (VW, VH), rgb("night") + (255,))
    # ---- 地面：0-3 海，4 水陆过渡，5-15 沙滩（局部石板炮台 + 木栈桥）
    for r in range(FIELD_ROWS):
        for c in range(VW // TILE):
            if r < 4:
                t = cell("sea", (c + r) % 4)
            elif r == 4:
                t = cell("transition", (c + r) % 3, flip=True)
            else:
                pick = random.random()
                t = cell("sandspot", int(pick * 3)) if pick > 0.82 else cell("beach", (c + r) % 4)
            img.paste(t, (c * TILE, r * TILE), t)
    # 炮台石台（3 行石板，上下各接一行过渡边，只在占位列范围内）
    for r in range(6, 9):
        for c in range(2, 9):
            img.paste(cell("stone", (c + r) % 4), (c * TILE, r * TILE))
    for c in range(2, 9):
        img.paste(cell("transition", 3 + (c % 3)), (c * TILE, 5 * TILE))       # 沙→石：石台顶部
    for c in range(2, 9):
        img.paste(cell("transition", 4, flip=True), (c * TILE, 9 * TILE))      # 石→沙：石台底边
    # 木栈桥（0-2 是甲板木纹，第 4 格是沙地系缆桩，单独摆在桥头外侧）
    for r in range(11, 14):
        for c in range(20, 24):
            img.paste(cell("wood", (c + r) % 3), (c * TILE, r * TILE))
    for c in (19, 24):
        img.paste(cell("wood", 3), (c * TILE, 14 * TILE))
    # ---- Boss 在海上（船头朝左）
    boss = Image.open(os.path.join(OUT, "frames", "ch00_boss_steamfrigate_03.png")).convert("RGBA")
    img.paste(boss, (300, 8), boss)
    # ---- 鸦片箱（引擎会加金框，这里手动模拟一下交互态）
    for (x, y), glow in (((236, 172), True), ((266, 182), False)):
        ch = Image.open(os.path.join(OUT, "frames", "ch00_prop_opiumchest.png")).convert("RGBA")
        img.paste(ch, (x, y), ch)
        if glow:
            d = ImageDraw.Draw(img, "RGBA")
            d.rectangle((x - 1, y - 1, x + 20, y + 20), outline=rgb("star") + (255,), width=1)
    # ---- 单位（脚底所在行瓦片的底边 = 32×40 画布第 40 行）
    cast = [
        ("ch00_char_qing_guantianpei", 0, 68, 8),
        ("ch00_char_qing_greencamp", 3, 116, 8),
        ("ch00_char_qing_greencamp", 0, 148, 11),
        ("ch00_char_qing_bazong", 5, 60, 12),
        ("ch00_char_qing_linxzexu", 0, 196, 11),
        ("ch00_char_en_uk_infantry", 2, 288, 7),
        ("ch00_char_en_uk_infantry", 0, 332, 9),
        ("ch00_char_en_uk_grenadier", 4, 376, 7),
        ("ch00_char_en_uk_brigadier", 1, 420, 11),
    ]
    for name, frame, x, row in cast:
        u = unit(name, frame)
        img.paste(u, (x, (row + 1) * TILE - CH), u)
    # ---- HUD（14px：血条 + 摇杆 + 按键，全部程序画的占位）
    d = ImageDraw.Draw(img, "RGBA")
    d.rectangle((0, 256, VW, VH), fill=rgb("ink") + (240,))
    d.line((0, 256, VW, 256), fill=rgb("greyPlum") + (255,), width=1)
    d.rectangle((6, 259, 126, 267), outline=rgb("greyPlum") + (255,), width=1)
    d.rectangle((7, 260, 92, 266), fill=rgb("red") + (255,))
    d.text((130, 259), "关天培", font=None, fill=rgb("paper"))
    for i, lab in enumerate(("攻", "技", "闪", "炮")):
        cx = 300 + i * 46
        d.ellipse((cx, 258, cx + 40, 268), outline=rgb("greyPlum") + (255,), width=1)
    d.ellipse((150, 258, 190, 268), outline=rgb("greyPlum") + (255,), width=1)
    return img


def main():
    img = build()
    img.save(os.path.join(QA, "mock_480x270.png"))
    img.resize((VW * 2, VH * 2), Image.NEAREST).save(os.path.join(QA, "mock_960x540.png"))
    # 比例对照：16×16 瓦片 vs 32×40 角色 vs 96×48 Boss
    sc = 4
    cmp = Image.new("RGBA", (420, CH * sc + 40), rgb("night") + (255,))
    d = ImageDraw.Draw(cmp)
    t = cell("beach", 0)
    cmp.paste(t.resize((16 * sc, 16 * sc), Image.NEAREST), (8, 40))
    u = unit("ch00_char_qing_guantianpei", 0)
    cmp.paste(u.resize((CW * sc, CH * sc), Image.NEAREST), (90, 8))
    b = Image.open(os.path.join(OUT, "frames", "ch00_boss_steamfrigate_00.png")).convert("RGBA")
    cmp.paste(b.resize((96 * 2, 48 * 2), Image.NEAREST), (230, 40))
    d.text((8, 22), "16x16 tile", fill=rgb("greyLight"))
    d.text((90, 22), "32x40 unit", fill=rgb("greyLight"))
    d.text((230, 22), "96x48 boss @2x", fill=rgb("greyLight"))
    cmp.save(os.path.join(QA, "ratio_check.png"))
    print("mock scene ->", os.path.join(QA, "mock_960x540.png"))


if __name__ == "__main__":
    main()
