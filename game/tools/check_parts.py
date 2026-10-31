"""Offline part-sheet inspector: every piece alone + a mock assembly, all at 8x.

Why: the in-game rig is animated, so a single screenshot cannot tell whether the
thing over the shoulder is the head or a saber with a red tassel. This lays out
each piece at 8x, then the assembly using the exact anchors the rig uses.

Usage: python tools/check_parts.py [unit ...]   -> tools/_parts_sheet.png
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / "public" / "art" / "parts"
OUT = ROOT / "tools" / "_parts_sheet.png"

SCALE = 8
ORDER = ["head", "torso", "arm", "leg", "weapon"]
FACINGS = ["front", "side"]

# 与 src/gfx/CharacterRig.ts 的 PIVOT 保持一致（改了那边记得改这里）
PIVOT = {
    "legTop": -12,
    "legSpread": 4,
    "torsoBottom": -9,
    "headBottom": -20,
    "shoulder": -19,
    "shoulderX": 4,
    "weaponInHand": 9,
    "weaponOutX": 4,
}
WEAPON_ANGLE = 0
WEAPON_MAX_H = 16

# 与 src/core/constants.ts 的 WEAPON_KIND 一致：兵器是现画的，不用甲方那版 18px 长刀
WEAPON_KIND = {
    "qing_officer": "saber",
    "qing_green": "saber",
    "qing_batou": "saber",
    "uk_infantry": "musket",
    "uk_grenadier": "musket",
    "gough": "saber",
    "lin_zexu": "none",
}
PAPER = (242, 237, 228, 255)
BROWN = (168, 118, 63, 255)
BROWN_DEEP = (78, 47, 26, 255)
GREY_LIGHT = (194, 188, 209, 255)

CELL_W, CELL_H = 30, 36
COLS = len(ORDER) + 1


def load(unit: str, facing: str, part: str) -> Image.Image | None:
    p = PARTS / f"{unit}_{facing}_{part}.png"
    return Image.open(p).convert("RGBA") if p.exists() else None


def pasted(canvas: Image.Image, img: Image.Image | None, cx: float, floor: float, ox: float, oy: float, origin: tuple[float, float]) -> None:
    if img is None:
        return
    x = cx + ox - img.width * origin[0]
    y = floor + oy - img.height * origin[1]
    canvas.alpha_composite(img, (int(round(x)), int(round(y))))


def draw_weapon(unit: str) -> Image.Image | None:
    """Vector weapon, same rectangles as CharacterRig.buildWeapon()."""
    kind = WEAPON_KIND.get(unit, "none")
    if kind == "none":
        return None
    pad = 12
    if kind == "saber":
        canvas = Image.new("RGBA", (2 + pad * 2, 14 + pad * 2), (0, 0, 0, 0))
        mid = canvas.width // 2
        base = 2 + pad  # guard row = y where the hand holds it
        draw = ImageDraw.Draw(canvas)
        draw.rectangle([mid - 1, base - 11, mid, base - 1], fill=PAPER)
        draw.rectangle([mid - 2, base - 1, mid + 2, base], fill=BROWN)
        draw.rectangle([mid - 1, base + 1, mid, base + 3], fill=BROWN_DEEP)
        return canvas.rotate(-WEAPON_ANGLE, expand=True, resample=Image.NEAREST)

    canvas = Image.new("RGBA", (3 + pad * 2, 16 + pad * 2), (0, 0, 0, 0))
    mid = canvas.width // 2
    base = 3 + pad
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([mid - 1, base - 13, mid, base], fill=GREY_LIGHT)
    draw.rectangle([mid - 1, base - 2, mid + 1, base + 2], fill=BROWN)
    draw.rectangle([mid - 1, base + 2, mid + 1, base + 3], fill=BROWN_DEEP)
    return canvas.rotate(-(WEAPON_ANGLE + 6), expand=True, resample=Image.NEAREST)


def assemble(unit: str, facing: str) -> Image.Image:
    """Origin = feet, y negative upward — same convention as the rig container."""
    canvas = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    cx = CELL_W / 2
    floor = CELL_H - 2.0

    leg = load(unit, facing, "leg")
    pasted(canvas, leg, cx, floor, -PIVOT["legSpread"], PIVOT["legTop"], (0.5, 0.0))
    pasted(canvas, leg, cx, floor, PIVOT["legSpread"], PIVOT["legTop"], (0.5, 0.0))
    pasted(canvas, load(unit, facing, "torso"), cx, floor, 0, PIVOT["torsoBottom"], (0.5, 1.0))
    pasted(canvas, load(unit, facing, "arm"), cx, floor, PIVOT["shoulderX"], PIVOT["shoulder"], (0.5, 0.0))
    pasted(canvas, load(unit, facing, "head"), cx, floor, 0, PIVOT["headBottom"], (0.5, 1.0))
    weapon = load(unit, facing, "weapon")
    if weapon is not None:
        # 与 CharacterRig.buildWeapon 一致：竖着挎，握把在胯部，刀尖朝上，高度封顶 16px
        scale = min(1.0, WEAPON_MAX_H / weapon.height)
        if scale < 1.0:
            weapon = weapon.resize(
                (max(1, round(weapon.width * scale)), max(1, round(weapon.height * scale))),
                Image.NEAREST,
            )
        pasted(
            canvas,
            weapon,
            cx,
            floor,
            PIVOT["shoulderX"] + PIVOT["weaponOutX"],
            PIVOT["shoulder"] + PIVOT["weaponInHand"],
            (0.5, 1.0),
        )
    else:
        fallback = draw_weapon(unit)
        if fallback is not None:
            pasted(
                canvas,
                fallback,
                cx,
                floor,
                PIVOT["shoulderX"] + PIVOT["weaponOutX"],
                PIVOT["shoulder"] + PIVOT["weaponInHand"],
                (0.5, 0.5),
            )
    return canvas


def main() -> None:
    units = sys.argv[1:] or sorted({p.name.split("_front_")[0] for p in PARTS.glob("*_front_*.png")})
    cw, chh = CELL_W * SCALE, CELL_H * SCALE
    rows = len(units) * len(FACINGS)
    sheet = Image.new("RGBA", (COLS * cw, rows * chh + 24 * len(units)), (28, 28, 38, 255))
    draw = ImageDraw.Draw(sheet)

    row_y = 0
    for unit in units:
        for facing in FACINGS:
            label = f"{unit} / {facing}"
            draw.text((6, row_y + 4), label, fill=(235, 225, 190, 255))
            if facing == FACINGS[0]:
                for ci, name in enumerate(ORDER + ["assembled"]):
                    draw.text((ci * cw + 6, row_y + 16), name, fill=(150, 150, 170, 255))
            base_y = row_y + 24
            for ci, part in enumerate(ORDER):
                piece = load(unit, facing, part)
                if piece is None:
                    continue
                big = piece.resize((piece.width * SCALE, piece.height * SCALE), Image.NEAREST)
                sheet.alpha_composite(big, (ci * cw + (cw - big.width) // 2, base_y + (chh - big.height) // 2))
                draw.rectangle([ci * cw, base_y, ci * cw + cw - 1, base_y + chh - 1], outline=(58, 58, 78, 255))
            ci = len(ORDER)
            fig = assemble(unit, facing).resize((cw, chh), Image.NEAREST)
            sheet.alpha_composite(fig, (ci * cw, base_y))
            draw.rectangle([ci * cw, base_y, ci * cw + cw - 1, base_y + chh - 1], outline=(210, 180, 90, 255))
            row_y = base_y + chh

    sheet.save(OUT)
    print(f"written {OUT} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()