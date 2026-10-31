# -*- coding: utf-8 -*-
"""
生成三个副本的地图（均为 30 × 16，保证视口宽度够，靠墙体做出「窄」的感觉）。
  map_dg01_alley   租界暗巷    —— 上下砖墙夹出的横向窄巷 + 几处壁龛
  map_dg02_bandit  广州城外匪寨 —— 寨门广场 + 高台
  map_dg03_dock    沪上码头    —— 码头空地 + 货箱堆与吊机位
"""
import json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = r"D:\game_project\game 3\game\public\data\maps"
os.makedirs(ROOT, exist_ok=True)
W, H = 30, 16


def blank(v=0):
    return [[v for _ in range(W)] for _ in range(H)]


def build(map_id, colors, ground, collision, spawn, objects=None, triggers=None):
    m = {
        "id": map_id,
        "width": W,
        "height": H,
        "tileset": "placeholder",
        "tile_colors": colors,
        "spawn": spawn,
        "layers": [
            {"name": "ground", "data": ground, "collidable": False},
            {"name": "collision", "data": collision, "collidable": True},
        ],
        "triggers": triggers or [],
        "objects": objects or [],
    }
    path = os.path.join(ROOT, map_id + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
    solid = sum(1 for row in collision for v in row if v)
    print(f"wrote {path}  solid={solid}")
    return m


# ---------- 1) 租界暗巷 ----------
ALLEY = {
    "1": "#6B6489",  # 浅紫灰：巷道石板
    "2": "#2F2B45",  # 深紫灰：砖墙（碰撞）
    "3": "#4A4468",  # 中紫灰：砖墙内凹
    "4": "#4E2F1A",  # 焦褐：竹尖坑（陷阱，视觉提示）
    "5": "#A8763F",  # 褐：木箱
    "6": "#F0C419",  # 星黄：铜锣
}
g = blank(1)
c = blank(0)
# 上下砖墙，留出 1—4 行的 6 格高巷道，靠墙处有断口形成宽窄变化
for x in range(W):
    for y in list(range(0, 2)) + list(range(6, H)):
        g[y][x] = 2
        c[y][x] = 2
# 中段更窄：y=2、y=5 加墙
for x in range(10, 20):
    g[2][x] = 3
    c[2][x] = 3
    g[5][x] = 3
    c[5][x] = 3
# 壁龛（可躲）
for x in (6, 7, 23, 24):
    g[1][x] = 1
    c[1][x] = 0
# 竹尖坑
for x in (14, 15, 16):
    g[4][x] = 4
# 木箱（掩体，碰撞）
for (x, y) in [(4, 3), (5, 3), (21, 4), (26, 3)]:
    g[y][x] = 5
    c[y][x] = 5
# 铜锣
g[3][10] = 6
bandit_alley = build("map_dg01_alley", ALLEY, g, c, {"x": 2, "y": 3})

# ---------- 2) 广州城外匪寨 ----------
CAMP = {
    "1": "#CFA26A",  # 沙黄：寨内地面
    "2": "#7A4F2A",  # 深褐：木栅墙（碰撞）
    "3": "#A8763F",  # 褐：寨门木桩
    "4": "#6B6489",  # 浅紫灰：高台石地
    "5": "#4E2F1A",  # 焦褐：货堆
    "6": "#C62828",  # 正红：匪旗
}
g = blank(1)
c = blank(0)
for x in range(W):
    g[0][x] = 2
    c[0][x] = 2
    g[H - 1][x] = 2
    c[H - 1][x] = 2
for y in range(H):
    g[y][0] = 2
    c[y][0] = 2
    g[y][W - 1] = 2
    c[y][W - 1] = 2
# 寨门（中间留口）
for y in range(2, 6):
    g[y][12] = 3
    c[y][12] = 3
g[3][12] = 1
g[4][12] = 1
# 高台
for y in range(2, 7):
    for x in range(20, 27):
        g[y][x] = 4
# 货堆
for (x, y) in [(5, 9), (6, 9), (17, 10), (24, 11)]:
    g[y][x] = 5
    c[y][x] = 5
# 匪旗
g[3][22] = 6
bandit_camp = build("map_dg02_bandit", CAMP, g, c, {"x": 3, "y": 8})

# ---------- 3) 沪上码头 ----------
DOCK = {
    "1": "#4A4468",  # 中紫灰：码头地面
    "2": "#2F6BA8",  # 中蓝：江水（碰撞）
    "3": "#A8763F",  # 褐：货箱（碰撞）
    "4": "#7A4F2A",  # 深褐：木栈道
    "5": "#948DAB",  # 灰紫：吊机轨道
    "6": "#F0C419",  # 星黄：汽灯
}
g = blank(1)
c = blank(0)
# 上方是江
for x in range(W):
    for y in range(0, 3):
        g[y][x] = 2
        c[y][x] = 2
# 栈道
for x in range(W):
    g[3][x] = 4
# 货箱堆
for (x0, y0, w, h) in [(6, 6, 2, 2), (13, 8, 2, 2), (22, 6, 3, 2)]:
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            g[y][x] = 3
            c[y][x] = 3
# 吊机轨道（横向一条）
for x in range(8, 24):
    g[5][x] = 5
# 汽灯
for x in (9, 18, 27):
    g[11][x] = 6
bandit_dock = build("map_dg03_dock", DOCK, g, c, {"x": 4, "y": 10})

print("done")