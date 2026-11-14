# -*- coding: utf-8 -*-
"""
生成序章第一幕的两张地图 JSON（30 × 16 瓦片）。
避免手写 480 个格号出错，地图由脚本产出，改布局改这里再跑一次即可。

注意：`map_ch00_act1a.json` 的箱子坐标后来为避开右下虚拟按键手工调过，
本脚本里那份仍是历史值——**不要整表重跑覆盖**；改池子时按下面的注释同步脚本与 JSON 即可。
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
# 例外：销烟池池沿（x=15..21 / y=8..11，7×4 格）仍是有意为之的实心格，
# 玩家只能站在池边交互；除此之外场地内部没有隐形障碍。
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
# 销烟池池沿（7 宽 × 4 高，中偏右）：只在**碰撞层**用 6(木框)/7(石灰) 标实心，
# 玩家只能站在池边交互。v1.8.8 起地面层这 28 格一律保持沙地 `1`——
# 以前地面层也画 6/7，于是「地面装饰大砖池」+「obj_pool 的 40×26 小池」= 两个长方体。
# 现在池子只由 obj_pool 画一个 112×64 的大长方体（`core/constants.ts → HUMEN_POOL`）。
# `MapRenderer.paintWalls()` 同时认地面层和碰撞层的 6/7 并跳过墙皮，否则池沿会透出石墙。
# 重跑本脚本时这三处（碰撞层 / obj_pool 坐标 / HUMEN_POOL）必须一起对得上。
for x in range(15, 22):
    collision[8][x] = 6
    collision[11][x] = 6
for y in range(9, 11):
    collision[y][15] = 6
    collision[y][21] = 6
    for x in range(16, 21):
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
            # 池区 x=15..21 / y=8..11 的几何中心；渲染尺寸见 HUMEN_POOL (7×4 格)
            "y": 9.5,
            "label": "投入销烟池",
            "color": "#948DAB",
            "payload": "pool",
        },
        {
            "id": "obj_linzexu",
            "kind": "npc",
            # v1.8.9：从池沿里挪到池子正下方偏左，整个人形包围盒出池区。
            # NPC 贴图 24×32、origin(0.5,1) 放在格心 +8；旧 (15,12) 的头顶在
            # y=176，会插进池子(128..192)并被池水/池沿盖掉整个头。
            # 新 (17,13.5) 的包围盒是 x=268..292 / y=200..232，离池下沿 7px。
            # 不能只下移到 (15,13)：那里距 interact 键 (240,240) 只有 25.3px，
            # 会落进它的 26px 命中圈，人物又被圆形按键盖住。
            "x": 17,
            "y": 13.5,
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