#!/usr/bin/env python3
"""生成「黄海海战」地图：`public/data/maps/map_ch00_act3_sea.json`。

画面读法（俯视）：
    ┌──────────────────────────────┐
    │ 远景带（sky_rows=4，不画地砖） │  ← 由 Backdrop 叠黄昏双舰全景
    ├──────────────────────────────┤
    │ 海   ╔══════════════════╗  海 │
    │ 海   ║  定远舰甲板（可走）║ 敌舰 │  ← Boss 锚点贴在右舷外 (21,8)
    │ 海   ╚══════════════════╝  海 │
    └──────────────────────────────┘

为什么是「一条甲板 + 四周海」而不是整片海：战斗内核是近战 / 走位，
玩家必须有落脚面；直接做成「海上漂浮的小人」既不史实也不好玩。
所以地图是**海洋**（海占可视面积的三分之二），可走区只有中间那条舰甲板，
Boss 舰停在右舷水面上——接舷后玩家能砍到它（近战 60px）。

生成规则固定、可重跑：
    python tools/gen_sea_map.py           # 重写地图（覆盖）
    python tools/gen_sea_map.py --check   # 只校验现有文件的结构与尺寸

地图规格：
    30 列 × 16 行，每格 16px = 480×256（正好一屏，不滚动）
    行 0..3 天空带（ground 全 0，碰撞全 1）
    舷墙外圈：col 1..19 × row 4..13 的边界（碰撞 1）
    甲板可走：col 2..18 × row 5..12
    其余全部海面（碰撞 1）
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "maps" / "map_ch00_act3_sea.json"

COLS, ROWS = 30, 16
SKY_ROWS = 4

# 瓦片 id（与 public/art/tiles/sea/tileset.json 一致）
SEA_A, SEA_B, SEA_WAVE, SEA_FOAM, SEA_SWELL = 1, 2, 3, 4, 5
DECK_A, DECK_B, DECK_SEAM = 6, 7, 8
EDGE_N, EDGE_S, EDGE_W, EDGE_E = 9, 10, 11, 12
CORNER_NW, CORNER_NE, CORNER_SW, CORNER_SE = 13, 14, 15, 16
GUN, CANNON, HATCH, MAST, FUNNEL, AMMO = 17, 18, 19, 20, 21, 22
WRECK, ROCK = 23, 24

# 回退配色：图集没加载时 MapRenderer 按它画程序化材质（海蓝 / 甲板棕 / 舷墙深棕）
TILE_COLORS = {
    "1": "#2A5A8A", "2": "#2A5A8A", "3": "#4A90C8", "4": "#7BC0E8", "5": "#2A5A8A",
    "6": "#7A4F2A", "7": "#7A4F2A", "8": "#7A4F2A",
    "9": "#4E2F1A", "10": "#4E2F1A", "11": "#4E2F1A", "12": "#4E2F1A",
    "13": "#4E2F1A", "14": "#4E2F1A", "15": "#4E2F1A", "16": "#4E2F1A",
    "17": "#4A4468", "18": "#4A4468", "19": "#2F2B45", "20": "#7A4F2A",
    "21": "#2F2B45", "22": "#7A4F2A", "23": "#4E2F1A", "24": "#6B6489",
}

# 甲板上的固定装置：(列, 行, 瓦片, 说明)
FIXTURES = [
    (18, 7, GUN, "前主炮"),
    (18, 11, GUN, "后主炮"),
    (6, 7, CANNON, "左舷炮位"),
    (6, 11, CANNON, "左舷炮位"),
    (10, 8, MAST, "主桅"),
    (13, 9, FUNNEL, "烟囱"),
    (16, 9, HATCH, "弹药舱口"),
    (15, 7, AMMO, "弹药箱"),
    (15, 11, AMMO, "弹药箱"),
]

# 海面上的定点装饰：(列, 行, 瓦片)
SEA_DECO = [
    (25, 6, WRECK),
    (27, 11, ROCK),
    (23, 14, SEA_FOAM),
    (26, 14, SEA_SWELL),
    (1, 6, SEA_WAVE),
    (0, 12, SEA_FOAM),
]


def h2(x: int, y: int) -> int:
    """稳定伪随机，重跑脚本结果一致（避免每次生成的海面装饰都在变）。"""
    v = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
    return (v ^ (v >> 16)) & 0xFFFFFFFF


def build() -> dict:
    ground = [[0] * COLS for _ in range(ROWS)]
    collision = [[0] * COLS for _ in range(ROWS)]

    # ① 天空带 + 四周默认「海 + 不可走」
    for y in range(ROWS):
        for x in range(COLS):
            if y < SKY_ROWS:
                ground[y][x] = 0
                collision[y][x] = 1
                continue
            # 按 3×2 的「水块」定主色，块内再抖 12% 换成浪/沫。
            # 第一版是逐格随机，四种海瓦片像撒芝麻一样均匀铺开，
            # 远看是噪点；成块之后才有「一片深水、一带浪线」的层次。
            block = h2(x // 3, y // 2) % 100
            jitter = h2(x, y) % 100
            if jitter < 7:
                tile = SEA_FOAM
            elif jitter < 16:
                tile = SEA_WAVE
            elif jitter < 18:
                tile = SEA_SWELL
            elif block < 55:
                tile = SEA_A
            else:
                tile = SEA_B
            ground[y][x] = tile
            collision[y][x] = 1

    # ② 定点海面装饰（沉船 / 礁石）盖掉上面随机出来的那一格
    for x, y, tile in SEA_DECO:
        ground[y][x] = tile

    # ③ 甲板外圈：col 3..20 × row 5..13
    # 第一版甲板是 col 1..19 × row 4..13，占掉六成画面，海只剩右边一条，
    # 用户要的是「地图是海洋」，所以四周各让出一圈海：左右 3 格、上下 1~2 行。
    x0, x1 = 3, 20
    y0, y1 = 5, 13
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            edge_x = x in (x0, x1)
            edge_y = y in (y0, y1)
            if edge_x or edge_y:
                if x == x0 and y == y0:
                    tile = CORNER_NW
                elif x == x1 and y == y0:
                    tile = CORNER_NE
                elif x == x0 and y == y1:
                    tile = CORNER_SW
                elif x == x1 and y == y1:
                    tile = CORNER_SE
                elif y == y0:
                    tile = EDGE_N
                elif y == y1:
                    tile = EDGE_S
                elif x == x0:
                    tile = EDGE_W
                else:
                    tile = EDGE_E
                ground[y][x] = tile
                collision[y][x] = 1

    # ④ 甲板内圈：col 4..19 × row 6..12，可走
    for y in range(y0 + 1, y1):
        for x in range(x0 + 1, x1):
            # 每隔 4 列一道纵向拼缝（读作「一块块甲板拼起来」），其余两色横板交替
            if (x - 4) % 4 == 0 and x not in (18,):
                tile = DECK_SEAM
            else:
                tile = DECK_A if (y + x) % 2 == 0 else DECK_B
            ground[y][x] = tile
            collision[y][x] = 0

    # ⑤ 甲板上的固定装置（阻挡）
    for x, y, tile, _name in FIXTURES:
        ground[y][x] = tile
        collision[y][x] = 1

    return {
        "id": "map_ch00_act3_sea",
        "width": COLS,
        "height": ROWS,
        "tileset": "tp_sea",
        "tile_colors": TILE_COLORS,
        "sky_rows": SKY_ROWS,
        "spawn": {"x": 5, "y": 9},
        # 敌舰：船体贴图 96×48、脚点在吃水线。锚点 (21,9) → 世界 (344,152)，
        # 船体左缘落在 x≈296，压住甲板右舷外沿（x=336）内侧 40px —— 接舷。
        # 玩家站在 col 19 中心（312）时与舰心相距 32px < 近战 60px，砍得到。
        "boss_anchor": {"x": 21, "y": 9},
        "layers": [
            {"name": "ground", "data": ground, "collidable": False},
            {"name": "collision", "data": collision, "collidable": True},
        ],
        "triggers": [],
        "objects": [],
        "meta": {
            "scene_type": "海战（接舷战）",
            "scene_name": "黄海 · 大东沟海面",
            "year": "1894 · 甲午海战",
            "act": "ch00_act3",
            "purpose": "Boss 战（北洋定远舰甲板 vs 日本联合舰队松岛舰）",
            "node_hint": "nd_1894_jiawu_battle",
            "bounds": "可走区 col 4..19 × row 6..12（定远舰甲板）；col 3..20 × row 5..13 的边界是舷墙（碰撞）；其余为海（碰撞）",
            "special": "sky_rows=4 + tp_sea 图集 + boss_anchor；右侧整列是海，出怪由 spawnPoints 的『最右可走列』兜底落到甲板右舷",
            "tileset": "tp_sea",
            "grid": {"tile_px": 16, "cols": COLS, "rows": ROWS, "world_px": [COLS * 16, ROWS * 16]},
            "layer_map": {
                "terrain": "ground.data（海面 + 甲板）",
                "building": "ground.data（舷墙 / 舰炮 / 舱口 / 桅杆 / 烟囱 / 弹药箱）",
                "collision": "collision.data（0/1）",
                "foreground": "禁用（会遮挡角色）",
            },
            "generator": "tools/gen_sea_map.py",
            "version": "1.0",
        },
    }


def check(path: Path) -> int:
    if not path.exists():
        print(f"缺少 {path.name}")
        return 1
    m = json.loads(path.read_text(encoding="utf-8"))
    ok = True
    if (m.get("width"), m.get("height")) != (COLS, ROWS):
        print(f"尺寸不对: {m.get('width')}×{m.get('height')}")
        ok = False
    g = m["layers"][0]["data"]
    c = m["layers"][1]["data"]
    if len(g) != ROWS or any(len(r) != COLS for r in g):
        print("ground 层行列数不对")
        ok = False
    walkable = sum(1 for r in c for v in r if not v)
    print(f"{path.name}: {COLS}×{ROWS} 可走格 {walkable}  图集 {m.get('tileset')}")
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    if "--check" in argv:
        return check(OUT)
    doc = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    walkable = sum(1 for row in doc["layers"][1]["data"] for v in row if not v)
    print(f"{OUT.relative_to(ROOT)}  {COLS}×{ROWS}  可走 {walkable} 格")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
