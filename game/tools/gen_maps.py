# -*- coding: utf-8 -*-
"""
生成序章第一幕的两张地图 JSON（30 × 16 瓦片）。
避免手写 480 个格号出错，地图由脚本产出，改布局改这里再跑一次即可。
"""
import json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = r"D:\game_project\game 3\game\public\data\maps"
os.makedirs(ROOT, exist_ok=True)

W, H = 30, 16

# 颜色取自设计书 8.1 的 24 色调色板
BEACH_COLORS = {
    "1": "#CFA26A",  # 沙黄：干沙
    "2": "#A8763F",  # 褐：湿沙（销烟池周边）
    "3": "#2F6BA8",  # 中蓝：海水
    "4": "#7A4F2A",  # 深褐：木栈道
    "5": "#6B6489",  # 浅紫灰：礁石
    "6": "#4E2F1A",  # 焦褐：销烟池木框
    "7": "#948DAB",  # 灰紫：销烟池石灰
}

FORT_COLORS = {
    "1": "#6B6489",  # 浅紫灰：炮台石地
    "2": "#4A4468",  # 中紫灰：石墙
    "3": "#2F6BA8",  # 中蓝：海面
    "4": "#1B3A6B",  # 深靛：深水
    "5": "#A8763F",  # 褐：炮位木架
    "6": "#2F2B45",  # 深紫灰：垛口
}


def blank(v=0):
    return [[v for _ in range(W)] for _ in range(H)]


# ---------------- 地图 A：虎门海滩 ----------------
ground = blank(1)
collision = blank(0)

# 海水 rows 0-2（可行走边界之外，设为碰撞）
for y in range(0, 3):
    for x in range(W):
        ground[y][x] = 3
        collision[y][x] = 3
# 湿沙过渡带
for x in range(W):
    ground[3][x] = 2
# 左侧礁石群
for (x, y) in [(0, 4), (0, 5), (1, 4), (28, 12), (29, 12), (29, 13), (0, 14), (1, 14)]:
    ground[y][x] = 5
    collision[y][x] = 5
# 木栈道一条
for x in range(6, 24):
    ground[6][x] = 4
# 销烟池（3×2 的木框 + 石灰），位于中偏右
for x in range(16, 20):
    ground[9][x] = 6
    ground[10][x] = 7
for x in range(17, 19):
    collision[9][x] = 0  # 池子可走近但不能站进去
for x in range(16, 20):
    collision[10][x] = 6

map_a = {
    "id": "map_ch00_act1a",
    "width": W,
    "height": H,
    "tileset": "placeholder",
    "tile_colors": BEACH_COLORS,
    "spawn": {"x": 4, "y": 13},
    "layers": [
        {"name": "ground", "data": ground, "collidable": False},
        {"name": "collision", "data": collision, "collidable": True},
    ],
    "triggers": [],
    "objects": [
        *[
            {
                "id": f"obj_crate_{i+1}",
                "kind": "pickup",
                "x": x,
                "y": y,
                "label": "搬起鸦片箱",
                "color": "#7A4F2A",
                "payload": "crate",
            }
            for i, (x, y) in enumerate(
                [(7, 11), (10, 12), (13, 11), (22, 11), (24, 12), (11, 14), (20, 13), (26, 10)]
            )
        ],
        {
            "id": "obj_pool",
            "kind": "deposit",
            "x": 18,
            "y": 10,
            "label": "投入销烟池",
            "color": "#948DAB",
            "payload": "pool",
        },
        {
            "id": "obj_linzexu",
            "kind": "npc",
            "x": 15,
            "y": 12,
            "label": "与林则徐交谈",
            "color": "#1B3A6B",
            "dialogue_ref": "dlg_ch00_act1_intro",
        },
        {
            "id": "obj_exit_fort",
            "kind": "exit",
            "x": 27,
            "y": 4,
            "label": "前往威远炮台",
            "color": "#C62828",
            "node_ref": "nd_1841_humen_battle",
        },
    ],
}

# ---------------- 地图 B：虎门威远炮台（夜战） ----------------
fground = blank(1)
fcollision = blank(0)

# 海面（炮台外侧）在右侧 6 格
for y in range(H):
    for x in range(24, W):
        fground[y][x] = 3
        if y < 5 or y > 11:
            fground[y][x] = 4
        fcollision[y][x] = 3 if y < 5 or y > 11 else 3
# 外墙
for x in range(W):
    fground[0][x] = 2
    fcollision[0][x] = 2
    fground[H - 1][x] = 2
    fcollision[H - 1][x] = 2
for y in range(H):
    fground[y][0] = 2
    fcollision[y][0] = 2
# 垛口（在 x=23 一线留出射口，其余为掩体）
for y in range(1, H - 1):
    if y in (3, 4, 10, 11, 12):
        continue
    fground[y][23] = 6
    fcollision[y][23] = 6
# 炮位
for (x, y) in [(20, 4), (20, 11), (16, 7)]:
    fground[y][x] = 5
# 内部石柱
for (x, y) in [(8, 4), (8, 11), (14, 4), (14, 11)]:
    for dy in range(2):
        fground[y + dy][x] = 2
        fcollision[y + dy][x] = 2

map_b = {
    "id": "map_ch00_act1b",
    "width": W,
    "height": H,
    "tileset": "placeholder",
    "tile_colors": FORT_COLORS,
    "spawn": {"x": 3, "y": 8},
    "layers": [
        {"name": "ground", "data": fground, "collidable": False},
        {"name": "collision", "data": fcollision, "collidable": True},
    ],
    "triggers": [],
    "objects": [
        {
            "id": "obj_cannon",
            "kind": "prop",
            "x": 20,
            "y": 4,
            "label": "查看炮位",
            "color": "#C62828",
            "dialogue_ref": "dlg_ch00_act1_cannon",
        },
        {
            "id": "obj_exit_beach",
            "kind": "exit",
            "x": 2,
            "y": 8,
            "label": "退回海滩",
            "color": "#2F8F5B",
            "node_ref": "nd_1839_humen_dialog",
        },
    ],
}

for m in (map_a, map_b):
    path = os.path.join(ROOT, m["id"] + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
    print("wrote", path, f"({m['width']}x{m['height']})")