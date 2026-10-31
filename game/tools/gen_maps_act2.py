# -*- coding: utf-8 -*-
"""
生成序章第二幕的两张地图 JSON（30 × 16 瓦片）。

map_ch00_act2a  金田村山地 —— 护送关卡的从左到右走廊
map_ch00_act2b  天京城     —— 经营模块的背景（角色冻结，纯界面）
"""
import json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = r"D:\game_project\game 3\game\public\data\maps"
os.makedirs(ROOT, exist_ok=True)
W, H = 30, 16


def blank(v=0):
    return [[v for _ in range(W)] for _ in range(H)]


# ---------------- 地图 A：金田村山地 ----------------
GRASS_COLORS = {
    "1": "#2F8F5B",  # 军绿：草地
    "2": "#7A4F2A",  # 深褐：土路
    "3": "#1F5C3A",  # 墨绿：山林（碰撞）
    "4": "#7EC08A",  # 浅绿：稻田
    "5": "#6B6489",  # 浅紫灰：山石（碰撞）
    "6": "#CFA26A",  # 沙黄：打谷场
}

g = blank(1)
col = blank(0)

# 上下山脊（不可通行）
for x in range(W):
    g[0][x] = 3
    col[0][x] = 3
    g[1][x] = 3
    col[1][x] = 3
    g[H - 1][x] = 3
    col[H - 1][x] = 3
    g[H - 2][x] = 5
    col[H - 2][x] = 5

# 一条从左到右的土路（保证护送路径可通行）
for x in range(W):
    row = 7 if x % 6 < 3 else 8
    g[row][x] = 2
    g[row + 1][x] = 2

# 稻田块
for (x0, y0, w, h) in [(3, 3, 5, 3), (11, 3, 4, 3), (19, 3, 5, 3), (4, 10, 5, 3), (13, 10, 4, 3), (21, 11, 5, 2)]:
    for y in range(y0, min(y0 + h, H)):
        for x in range(x0, min(x0 + w, W)):
            if g[y][x] == 1:
                g[y][x] = 4

# 打谷场（起点附近）
for y in range(9, 12):
    for x in range(2, 6):
        if g[y][x] == 4:
            g[y][x] = 6

# 树木与山石（碰撞），刻意留出通路
TREES = [(8, 3), (9, 2), (16, 2), (17, 3), (25, 3), (26, 2), (7, 12), (8, 13), (18, 12), (19, 13), (27, 11), (10, 6), (22, 8), (13, 13), (5, 4)]
for (x, y) in TREES:
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = 3
        col[y][x] = 3
ROCKS = [(6, 5), (14, 5), (23, 5), (12, 8), (20, 10), (24, 12)]
for (x, y) in ROCKS:
    if 0 <= x < W and 0 <= y < H and g[y][x] != 2:
        g[y][x] = 5
        col[y][x] = 5

map_a = {
    "id": "map_ch00_act2a",
    "width": W,
    "height": H,
    "tileset": "placeholder",
    "tile_colors": GRASS_COLORS,
    "spawn": {"x": 3, "y": 9},
    "layers": [
        {"name": "ground", "data": g, "collidable": False},
        {"name": "collision", "data": col, "collidable": True},
    ],
    "triggers": [],
    "objects": [],
}

# ---------------- 地图 B：天京城 ----------------
CITY_COLORS = {
    "1": "#6B6489",  # 浅紫灰：石板街
    "2": "#4A4468",  # 中紫灰：城墙（碰撞）
    "3": "#A8763F",  # 褐：木楼
    "4": "#7A4F2A",  # 深褐：屋顶（碰撞）
    "5": "#F0C419",  # 星黄：王府与旗
    "6": "#E8CFA8",  # 米黄：墙面
}

cg = blank(1)
ccol = blank(0)

# 城墙（四周）
for x in range(W):
    cg[0][x] = 2
    ccol[0][x] = 2
    cg[H - 1][x] = 2
    ccol[H - 1][x] = 2
for y in range(H):
    cg[y][0] = 2
    ccol[y][0] = 2
    cg[y][W - 1] = 2
    ccol[y][W - 1] = 2

# 街区：成排民居（屋顶为碰撞，门前留出街道）
BLOCKS = [(3, 3, 4, 3), (9, 3, 4, 3), (3, 10, 4, 3), (9, 10, 4, 3), (21, 3, 4, 3), (21, 10, 4, 3)]
for (x0, y0, w, h) in BLOCKS:
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            cg[y][x] = 4 if y < y0 + h - 1 else 3
            if y < y0 + h - 1:
                ccol[y][x] = 4

# 天王府（中央偏右，气派一些）
for y in range(4, 10):
    for x in range(15, 20):
        edge = (y in (4, 9)) or (x in (15, 19))
        cg[y][x] = 5 if edge else 6
        if edge:
            ccol[y][x] = 2
# 府门（可进入的门洞）
cg[9][17] = 6
ccol[9][17] = 0

map_b = {
    "id": "map_ch00_act2b",
    "width": W,
    "height": H,
    "tileset": "placeholder",
    "tile_colors": CITY_COLORS,
    "spawn": {"x": 13, "y": 8},
    "layers": [
        {"name": "ground", "data": cg, "collidable": False},
        {"name": "collision", "data": ccol, "collidable": True},
    ],
    "triggers": [],
    "objects": [],
}

for m in (map_a, map_b):
    path = os.path.join(ROOT, m["id"] + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
    solid = sum(1 for row in m["layers"][1]["data"] for v in row if v)
    print(f"wrote {path}  solid={solid}")