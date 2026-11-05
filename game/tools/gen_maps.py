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

# 碰撞网格（甲方 2026-11 要求：「第一幕怎么那么多空气墙，除了边界全去掉」）：
# 只保留一圈不可走的边界，场地内部**不再有任何隐形障碍**。
#   * 上边界 = 海（行 0-2）与湿沙带（行 3）——湿沙原本可走，现在并入边界，看上去仍是沙滩；
#   * 下边界 = 行 15 改成湿沙、整行实心。以前行 15 是一整条空气（走到底就撞看不见的边），
#     与其说是墙不如说是「漏出来的边角」，改成沙滩边更像海滩；
#   * 左右边界 = 第 0 / 29 列，地面改成礁石，撞上去有东西可看。
# 销烟池（16-19 列、9-10 行）原来也是两排实心，现在同样可走：池子在画面里照画，
# 但玩家能走过去（`spawnWorldObject` 里的 deposit 物件仍可交互）。
for y in range(0, 3):
    for x in range(W):
        ground[y][x] = 3
        collision[y][x] = 3
for x in range(W):
    ground[3][x] = 2
    collision[3][x] = 2
for x in range(W):
    ground[15][x] = 2
    collision[15][x] = 2
for y in range(H):
    for x in (0, W - 1):
        ground[y][x] = 5
        collision[y][x] = 5
# 木栈道一条
for x in range(6, 24):
    ground[6][x] = 4
# 销烟池（7 宽 × 4 高的木框 + 石灰），位于中偏右——甲方 2026-11 要求「做大、人进不去」：
# 整圈木框 + 内部石灰全部实心，玩家只能站在池边交互；paintWalls 对 6/7 号砖留了例外，不画墙皮。
for x in range(15, 22):
    ground[8][x] = 6
    ground[11][x] = 6
    collision[8][x] = 6
    collision[11][x] = 6
for y in range(9, 11):
    ground[y][15] = 6
    ground[y][21] = 6
    collision[y][15] = 6
    collision[y][21] = 6
for y in range(9, 11):
    for x in range(16, 21):
        ground[y][x] = 7
        collision[y][x] = 7

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
                [(7, 11), (10, 12), (13, 11), (22, 11), # 下面三个必须离右下角三键（炮/攻/闪）远
                (10, 13), (9, 12), (17, 14), (27, 9)]
            )
        ],
        {
            "id": "obj_pool",
            "kind": "deposit",
            "x": 18,
            "y": 12,
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
# 同样是「只留边界」：以前右 6 列海面整片实心、外加 4 根 2 格高的柱子，都会变成空气墙。
# 这版**四周一圈都实心**（上=垛口墙、下=内墙、左=外墙，右=海面），场地内部一格不挡。
#   * 右边界做成海：原来那一列垛口已经放在边界上了，所以是「海」而不是「栏」——
#     撞上去看到的是水，不会有隐形墙的感觉；把海再往右延出去也没用，相机只显示 30 列。
#   * `sky_rows` 已去掉：那 6 行原来是实心的远景带，属于要清的空气墙。远景条由
#     LevelScene 自己叠在地图上方，不依赖 sky_rows。
# 碰撞值一律写 `1`（可走地面）。以前往碰撞层里写 2 / 3 / 6 会让 `MapRenderer.paintWalls`
# 把它们画成石墙色块，这也是「明明能走却撞墙」的来源之一。
fground = blank(1)
fcollision = blank(0)

for y in range(H):
    for x in range(24, W):
        fground[y][x] = 3
        if y < 5 or y > 11:
            fground[y][x] = 4
for x in range(W):
    fground[0][x] = 2
    fcollision[0][x] = 1
    fground[H - 1][x] = 2
    fcollision[H - 1][x] = 1
for y in range(H):
    fground[y][0] = 2
    fcollision[y][0] = 1
    fcollision[y][W - 1] = 1
# 炮位（地面装饰，不挡人）
for (x, y) in [(20, 4), (20, 11), (16, 7)]:
    fground[y][x] = 5

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