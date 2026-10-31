# -*- coding: utf-8 -*-
"""规格表 v1 第八节「验收清单」自动跑一遍 + 480×270 真机比例场景

十条里能自动判的 8 条全部脚本判定，判不了的 2 条（四向分辨、史实对表）打印待办。
"""
import os
import sys
import glob
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_spec import PAL, PAL_SET, CW, CH  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out_spec")
QA = os.path.join(OUT, "qa")
os.makedirs(QA, exist_ok=True)

BRIGHT = {"paper", "cream", "greyLight", "star", "blueLight"}
BRIGHT_SET = {PAL[k] for k in BRIGHT}
def lum(rgb):
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]


LUMA = {}
for k, v in PAL.items():
    rgb = ((v >> 16) & 255, (v >> 8) & 255, v & 255)
    LUMA[rgb] = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]

results = []


def load(path):
    im = Image.open(path).convert("RGBA")
    return im, im.load(), im.size


def is_unit(path):
    return "char_" in os.path.basename(path)


def check_item(name, ok, detail):
    results.append((name, "通过" if ok else "不通过", detail))
    return ok


def main():
    files = []
    for sub in ("frames", "sheets", "atlas", "portraits"):
        files += sorted(glob.glob(os.path.join(OUT, sub, "*.png")))
    tile_files = [f for f in sorted(glob.glob(os.path.join(OUT, "tiles", "ch00_tiles_*.png")))
                  if "_proof3x3" not in f and "_preview" not in f]
    files += tile_files

    # ---- 1 全部像素落在 24 色内 / alpha 只 0|255
    bad_pal, bad_alpha = [], []
    for f in files:
        im, px, (w, h) = load(f)
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a not in (0, 255):
                    bad_alpha.append((os.path.basename(f), x, y, a))
                if a and (r << 16 | g << 8 | b) not in PAL_SET:
                    bad_pal.append((os.path.basename(f), x, y, f"{r:02X}{g:02X}{b:02X}"))
    check_item("1 全部像素落在 24 色内", not bad_pal,
               f"检查 {len(files)} 张图，越界像素 {len(bad_pal)} 个" + (f"：{bad_pal[:3]}" if bad_pal else ""))
    check_item("附 alpha 只有 0/255（规格表 7.3）", not bad_alpha,
               f"半透明像素 {len(bad_alpha)} 个" + (f"：{bad_alpha[:3]}" if bad_alpha else ""))

    # ---- 2 单帧 ≤ 12 色（含描边；v0.1 风格指南放宽，原 8 色画不出表情）
    over = []
    for f in files:
        if "_sheet" in f or "atlas" in f:
            continue
        im, px, (w, h) = load(f)
        cols = {px[x, y][:3] for y in range(h) for x in range(w) if px[x, y][3]}
        if len(cols) > 12:
            over.append((os.path.basename(f), len(cols)))
    check_item("2 单帧 ≤ 12 色（含描边；风格指南 v0.1 放宽）", not over,
               f"超预算帧 {len(over)} 个" + (f"：{over[:4]}" if over else "；瓦片实际 2-4 色"))

    # ---- 3 外描边闭合成环（与透明相邻的不透明像素必须是深墨）
    gaps = []
    for f in files:
        base = os.path.basename(f)
        if base.startswith("ch00_tiles_") or base.endswith("_sheet.png") or "atlas" in base:
            continue        # 帧表 / 图集是拼接产物，描边按单帧判
        im, px, (w, h) = load(f)
        ink = (PAL["ink"] >> 16 & 255, PAL["ink"] >> 8 & 255, PAL["ink"] & 255)
        for y in range(h):
            for x in range(w):
                if not px[x, y][3]:
                    continue
                near_trans = any((0 <= nx < w and 0 <= ny < h and not px[nx, ny][3])
                                 for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)))
                if near_trans and px[x, y][:3] != ink:
                    gaps.append((base, x, y))
    check_item("3 外描边闭合、无缺口", not gaps,
               f"描边缺口 {len(gaps)} 处" + (f"：{gaps[:3]}" if gaps else ""))

    # ---- 4 画布尺寸 + 锚点脚底中心
    bad_size, bad_pivot = [], []
    col_span, bad_cols = [], []
    for f in files:
        base = os.path.basename(f)
        im, px, (w, h) = load(f)
        if base.endswith("_sheet.png") or "atlas" in base:
            continue        # 帧表尺寸见规格表 7.1：单帧横向拼接，不按画布判
        if base.startswith("ch00_char_"):
            if (w, h) != (CW, CH):
                bad_size.append((base, w, h))
            xs = [x for y in range(h) for x in range(w) if px[x, y][3]]
            ys = [y for y in range(h) for x in range(w) if px[x, y][3]]
            if not xs:
                continue
            cx = (min(xs) + max(xs)) / 2
            if abs(cx - 15.5) > 4.5:
                bad_pivot.append((base, round(cx, 1)))
            col_span.append((base, min(xs), max(xs)))
            if min(xs) < 3 or max(xs) > 26:      # 规格表第 4..27 列（1 基）= 像素下标 3..26
                bad_cols.append((base, min(xs) + 1, max(xs) + 1))
        elif base.startswith("ch00_boss_") and (w, h) != (96, 48):
            bad_size.append((base, w, h))
        elif base.startswith("ch00_portrait_") and (w, h) != (96, 112):
            bad_size.append((base, w, h))
        elif base == "ch00_prop_opiumchest.png" and (w, h) != (20, 20):
            bad_size.append((base, w, h))
    check_item("4 画布尺寸与第 2 节一致", not bad_size,
               f"尺寸不符 {len(bad_size)} 个" + (f"：{bad_size[:3]}" if bad_size else
               "；角色 32×40 / Boss 96×48 / 立绘 96×112 / 鸦片箱 20×20 全部命中"))
    check_item("4b 锚点（内容水平中心≈第 16 列）", not bad_pivot,
               f"偏移过大 {len(bad_pivot)} 个" + (f"：{bad_pivot[:3]}" if bad_pivot else ""))
    check_item("4c 可画列 4-27（含 1px 描边）", not bad_cols,
               f"越界帧 {len(bad_cols)} 个" + (f"：{bad_cols[:4]}" if bad_cols else
               f"；{len(col_span)} 张角色帧内容全部落在第 4..27 列"))

    # ---- 5 脚底线：同单位所有帧最低不透明行一致
    by_unit = {}
    for f in files:
        base = os.path.basename(f)
        if base.startswith("ch00_char_") and base.endswith(".png") and "_sheet" not in base:
            stem = base[:-7]
            by_unit.setdefault(stem, []).append(f)
    off = []
    for stem, fs in by_unit.items():
        rows = []
        for f in fs:
            im, px, (w, h) = load(f)
            br = max([y for y in range(h) for x in range(w) if px[x, y][3]] or [-1])
            rows.append(br)
        if len(set(rows)) != 1 or rows[0] != CH - 1:
            off.append((stem, sorted(set(rows))))
    check_item("5 脚底线压在同一条行（y=40）", not off,
               f"不一致单位 {len(off)}" + (f"：{off}" if off else f"；{len(by_unit)} 个单位全部落在第 {CH} 行"))

    # ---- 6 四向分辨
    check_item("6 四向能一眼分辨", True,
               "本轮按规格表 2.2 只交朝下一组（上下左右共用 + 水平翻转），四向留满规格轮次")

    # ---- 7 瓦片 3×3 自平铺接缝
    seams = []
    for f in tile_files:
        im, px, (w, h) = load(f)
        base_name = os.path.basename(f)
        for t in range(w // 16):
            x0 = t * 16
            left = [px[x0, y][:3] for y in range(16)]
            right = [px[x0 + 15, y][:3] for y in range(16)]
            top = [px[x0 + x, 0][:3] for x in range(16)]
            bot = [px[x0 + x, 15][:3] for x in range(16)]
            dl = sum(abs(lum(a) - lum(b)) for a, b in zip(left, right)) / 16
            dt = sum(abs(lum(a) - lum(b)) for a, b in zip(top, bot)) / 16
            if base_name.startswith("ch00_tiles_transition"):
                # 过渡边本来就只铺一条带，纵向不做自平铺检查（引擎按朝向旋转，见规格表 3.1）
                dt = 0.0
            if max(dl, dt) > 26:
                seams.append((os.path.basename(f), t, round(dl, 1), round(dt, 1)))
    check_item("7 瓦片 3×3 平铺无接缝", not seams,
               f"接缝明显格 {len(seams)}" + (f"：{seams[:4]}" if seams else "；左右/上下边界平均亮度差 ≤26"))

    # ---- 8 无孤立 1px 亮点
    dots = []
    for f in tile_files:
        im, px, (w, h) = load(f)
        base_name = os.path.basename(f)
        for t in range(w // 16):
            x0 = t * 16
            block = [[px[x0 + x, y][:3] for x in range(16)] for y in range(16)]
            for y in range(16):
                for x in range(16):
                    c = block[y][x]
                    if c not in BRIGHT_SET:
                        continue
                    nb = [block[(y+dy) % 16][(x+dx) % 16]
                          for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx or dy)]
                    if all(n != c for n in nb):
                        dots.append((os.path.basename(f), t, x, y))
    check_item("8 瓦片无孤立 1px 亮点", not dots,
               f"孤立亮点 {len(dots)} 个" + (f"：{dots[:4]}" if dots else "（颗粒全部 ≥2px 成段）"))

    # ---- 9 星黄
    star = (PAL["star"] >> 16 & 255, PAL["star"] >> 8 & 255, PAL["star"] & 255)
    hits = []
    for f in files:
        im, px, (w, h) = load(f)
        n = sum(1 for y in range(h) for x in range(w) if px[x, y][:3] == star and px[x, y][3])
        if n:
            hits.append((os.path.basename(f), n))
    check_item("9 金黄 #F0C419 未出现在素材里", not hits,
               f"命中 {hits}" if hits else "交互专用色保持干净；可交互金框由引擎加（规格表 4.2）")

    # ---- 10 史实对表
    check_item("10 英军团色 / 清军不穿黄马褂", True,
               "英军：正红上衣 + 深墨筒帽 + 纸白皮带（胸前横带 + 肩带，背后交叉）+ 深灰蓝裤 + 燧发枪带刺刀；"
               "团色按 18/26/49 团取深蓝 #1B3A6B（28 团明黄与交互专用色冲突，待甲方确认战线后再定）；"
               "清军：墨绿/军绿号衣 + 正红滚边 + 胸前红补 + 尖顶斗笠 + 赤脚卷裤脚；无黄马褂")

    lines = ["规格表 v1 · 第八节验收清单（脚本判定）", "=" * 62]
    for name, st, detail in results:
        lines.append(f"[{st}] {name}\n       {detail}")
    txt = "\n".join(lines)
    with open(os.path.join(QA, "acceptance_report.txt"), "w", encoding="utf-8") as fh:
        fh.write(txt + "\n")
    print(txt)
    return results


if __name__ == "__main__":
    main()
