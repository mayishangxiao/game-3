#!/usr/bin/env python3
"""生成洋务运动及之后的三张剧情地图（30×16，图集 tp_late_qing）。

替换掉的旧引用（都是第二幕太平天国的地图，时代背景不对）：
    nd_1865_jiangnan_manage   江南制造总局  ← map_ch00_tp_city（天京）
    nd_1898_coup_battle       戊戌政变之夜  ← map_ch00_tp_city（天京）
    nd_1911_wuchang_battle    武昌起义      ← map_ch00_tp_city（天京）

新图：
    map_ch00_act3_factory.json  1865 江南制造总局：红砖 / 水泥 / 窄轨 / 车床 / 锅炉 / 烟囱
    map_ch00_act4_beijing.json  1898 北京南海会馆外：青石板巷 / 灰瓦门楼 / 朱红大门 / 灯笼
    map_ch00_act5_wuchang.json  1911 武昌总督衙门：石阶 / 石狮 / 街垒 / 路灯 / 新军旗

三张图共用 `tp_late_qing`：靠**摆哪些装置**区分年代，而不是换配色凑数。
纯标准库，`python tools/gen_late_qing_maps.py` 可重出；`--check` 只校验结构。

布局不变量（改了会卡关，别随手挪）：
  · 外围一圈青砖墙是实心，玩家撞得住；
  · 中间主街 / 车间通道从 spawn 一直通到最右列 —— `spawnPoints('right')`
    从 col 28 往左找「本格与下一格都可走」的点，右边整列封死就刷不出兵；
  · 装置一律贴上下两边摆，不横断通道；
  · `objects` 留空：经营 / 战斗节点的交互全在 DOM 面板里，地图物件只会给
    `tests/data.test.ts` 的 BFS 可达性添约束。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "maps"
W, H = 30, 16

# id → 名称，与 gen_late_qing_tiles.py 的 TILESET 顺序（id 从 1 起）严格对齐
NAMES = [
    "stone_a", "stone_b", "cobble", "brick_floor", "cement", "plank", "track", "drain",
    "grass_edge", "brick_wall", "brick_wall_win", "tile_roof", "roof_edge", "red_pillar",
    "gate", "lattice", "plaque", "lantern", "notice", "tree", "machine", "boiler",
    "chimney", "pipe", "crate", "cannon_part", "rail_cart", "coal", "telegraph",
    "street_lamp", "stone_lion", "barricade", "flag", "cart", "awning", "steps",
]
ID = {name: i + 1 for i, name in enumerate(NAMES)}

# 回退配色（图集没加载时 MapRenderer 用 tile_colors 画程序化材质），只取项目调色板色
FALLBACK = {
    "stone_a": "#6B6489", "stone_b": "#6B6489", "cobble": "#4A4468",
    "brick_floor": "#7A4F2A", "cement": "#C2BCD1", "plank": "#A8763F",
    "track": "#7A4F2A", "drain": "#2A5A8A", "grass_edge": "#6B6489",
    "brick_wall": "#2F2B45", "brick_wall_win": "#2F2B45", "tile_roof": "#2F2B45",
    "roof_edge": "#8C1C1C", "red_pillar": "#8C1C1C", "gate": "#8C1C1C",
    "lattice": "#4E2F1A", "plaque": "#1C1A2B", "lantern": "#C0392B",
    "notice": "#F2EDE4", "tree": "#4A4468", "machine": "#948DAB",
    "boiler": "#948DAB", "chimney": "#7A4F2A", "pipe": "#948DAB",
    "crate": "#A8763F", "cannon_part": "#2F2B45", "rail_cart": "#7A4F2A",
    "coal": "#1C1A2B", "telegraph": "#7A4F2A", "street_lamp": "#D4A840",
    "stone_lion": "#C2BCD1", "barricade": "#E8CFA8", "flag": "#8C1C1C",
    "cart": "#A8763F", "awning": "#C0392B", "steps": "#948DAB",
}

# 哪些瓦片是「装置 / 建筑」：地面层画它，碰撞层同时标 1
SOLID = {
    "brick_wall", "brick_wall_win", "tile_roof", "roof_edge", "red_pillar", "gate",
    "lattice", "plaque", "lantern", "notice", "tree", "machine", "boiler", "chimney",
    "crate", "cannon_part", "rail_cart", "coal", "telegraph", "street_lamp",
    "stone_lion", "barricade", "flag", "cart", "awning",
}


class MapDraft:
    def __init__(self, base: str) -> None:
        self.g = [[ID[base] for _ in range(W)] for _ in range(H)]
        self.c = [[0 for _ in range(W)] for _ in range(H)]
        self.notes: list[str] = []

    def frame(self, wall: str = "brick_wall") -> None:
        for x in range(W):
            self.put(x, 0, wall)
            self.put(x, H - 1, wall)
        for y in range(H):
            self.put(0, y, wall)
            self.put(W - 1, y, wall)

    def put(self, x: int, y: int, name: str, solid: bool | None = None) -> None:
        if not (0 <= x < W and 0 <= y < H):
            return
        self.g[y][x] = ID[name]
        self.c[y][x] = 1 if (name in SOLID if solid is None else solid) else 0

    def rect(self, x0: int, y0: int, x1: int, y1: int, name: str, solid: bool | None = None) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, name, solid)

    def row(self, y: int, x0: int, x1: int, name: str) -> None:
        for x in range(x0, x1 + 1):
            self.put(x, y, name)

    def doc(self, text: str) -> None:
        self.notes.append(text)


def h2(x: int, y: int) -> float:
    v = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((v ^ (v >> 16)) & 0xFFFFFFFF) / 4294967295


def factory() -> MapDraft:
    """1865 江南制造总局：砖地车间 + 一条横贯的窄轨 + 两侧机器。"""
    m = MapDraft("brick_floor")
    m.doc("洋务运动 1865：江南制造总局机器局。红砖与水泥分块铺地，中间一条轻便铁轨运炮胚。")
    # 地面按 4×3 的「车间区块」分主色，块内抖动，避免整片棋盘格
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            block = (x // 4, y // 3)
            main = "cement" if h2(*block) > 0.55 else "brick_floor"
            if h2(x, y) > 0.86:
                main = "plank"
            m.put(x, y, main)
    # 横贯厂房的窄轨（可走）
    m.row(8, 2, 27, "track")
    # 上沿：厂房外墙开窗 + 灰瓦顶
    m.rect(1, 1, 27, 1, "tile_roof")
    m.rect(1, 2, 27, 2, "brick_wall_win")
    for x in (6, 13, 20, 26):
        m.put(x, 2, "lattice")
    # 下沿：砖墙 + 一根蒸汽管（管子可走，压在墙前）
    m.rect(1, 14, 27, 14, "brick_wall")
    m.row(13, 3, 24, "pipe")
    # 机器装置：贴上下沿摆成 2×1 的机组，不横断中间通道
    rigs = [
        (3, 3, "machine"), (4, 3, "boiler"), (7, 3, "chimney"),
        (10, 3, "machine"), (11, 3, "cannon_part"), (15, 3, "boiler"),
        (18, 3, "machine"), (21, 3, "crate"), (22, 3, "coal"),
        (3, 12, "crate"), (6, 12, "rail_cart"), (9, 12, "cannon_part"),
        (12, 12, "machine"), (15, 12, "coal"), (18, 12, "crate"),
        (21, 12, "chimney"), (24, 12, "rail_cart"),
    ]
    for x, y, name in rigs:
        m.put(x, y, name)
    # 车间立柱，留出主街
    for x in (2, 9, 16, 23):
        m.put(x, 5, "red_pillar")
        m.put(x, 10, "red_pillar")
    m.frame("brick_wall")
    # 右端留空：出怪点在这里
    m.rect(26, 5, 28, 11, "cement")
    return m


def beijing() -> MapDraft:
    """1898 北京南海会馆外：青石板胡同，北面会馆门楼，南面临街铺面。"""
    m = MapDraft("stone_a")
    m.doc("戊戌变法 1898：北京南海会馆外的胡同。青石板与碎石巷，灰瓦门楼、朱红大门、门匾灯笼。")
    for y in range(3, 13):
        for x in range(1, W - 1):
            k = h2(x // 3, y // 2)
            main = "cobble" if k > 0.66 else ("stone_b" if k > 0.33 else "stone_a")
            m.put(x, y, main)
    # 北面会馆：灰瓦顶 → 砖墙 → 门楼
    m.rect(1, 1, 27, 1, "tile_roof")
    m.rect(1, 2, 27, 2, "brick_wall")
    m.rect(9, 1, 18, 1, "roof_edge")
    m.rect(9, 2, 18, 2, "brick_wall_win")
    for x in (10, 17):
        m.put(x, 3, "red_pillar")
    m.put(13, 2, "plaque")
    m.put(14, 2, "plaque")
    m.put(12, 3, "gate")
    m.put(15, 3, "gate")
    m.put(11, 4, "lantern")
    m.put(16, 4, "lantern")
    # 南面临街铺面：布棚 / 格栅窗 / 告示 / 槐树
    m.rect(1, 13, 27, 14, "brick_wall")
    for x in (3, 4, 5, 20, 21, 22):
        m.put(x, 13, "awning")
    m.rect(7, 13, 9, 13, "lattice")
    m.put(12, 13, "notice")
    m.put(24, 13, "tree")
    m.put(6, 12, "tree")
    m.put(25, 12, "notice")
    # 街面细节：明沟与墙根荒草（都可走）
    m.row(11, 2, 8, "drain")
    m.row(11, 19, 27, "drain")
    for x in (2, 9, 18, 26):
        m.put(x, 4, "grass_edge")
        m.put(x, 12, "grass_edge")
    # 胡同口的电线杆与木轮车，贴边不挡路
    m.put(2, 6, "telegraph")
    m.put(26, 6, "cart")
    m.put(2, 10, "crate")
    m.frame("brick_wall")
    # 右侧巷口保持通透
    m.rect(27, 5, 28, 11, "stone_a")
    return m


def wuchang() -> MapDraft:
    """1911 武昌总督衙门：石阶、石狮、沙袋街垒、路灯、新军旗。"""
    m = MapDraft("stone_b")
    m.doc("辛亥革命 1911：武昌总督衙门前夜。石阶通向朱红大门，街垒横街、新军旗与煤气路灯。")
    for y in range(3, 13):
        for x in range(1, W - 1):
            k = h2(x // 3, y // 2)
            main = "stone_a" if k > 0.5 else "stone_b"
            if h2(x + 7, y) > 0.88:
                main = "cobble"
            m.put(x, y, main)
    # 北面督署院墙
    m.rect(1, 1, 27, 1, "tile_roof")
    m.rect(1, 2, 27, 2, "brick_wall")
    m.rect(20, 1, 27, 1, "roof_edge")
    # 南面民房
    m.rect(1, 14, 27, 14, "brick_wall")
    for x in (4, 5, 6, 12, 13, 18, 19):
        m.put(x, 14, "brick_wall_win")
    m.put(9, 13, "awning")
    m.put(23, 13, "tree")
    # 衙门：右侧一列石阶（可走）+ 门楼（门与柱实心，但中间留通道）
    m.rect(24, 6, 27, 10, "steps")
    m.rect(25, 3, 26, 5, "gate")
    m.put(24, 5, "red_pillar")
    m.put(27, 5, "red_pillar")
    m.put(23, 4, "stone_lion")
    m.put(28, 4, "stone_lion")
    m.put(25, 2, "plaque")
    m.put(26, 2, "plaque")
    m.put(24, 3, "lantern")
    m.put(27, 3, "lantern")
    # 起义军的沙袋街垒：横在 col 11..14，中间 row 8 留缺口
    for x in range(11, 15):
        for y in (5, 6, 10, 11):
            m.put(x, y, "barricade")
    m.put(10, 8, "crate")
    m.put(15, 8, "crate")
    # 近代街景：路灯、电线杆、旗、车
    for x, y in ((3, 4), (8, 12), (18, 4), (21, 12)):
        m.put(x, y, "street_lamp")
    for x, y in ((6, 3), (17, 12)):
        m.put(x, y, "telegraph")
    m.put(4, 10, "flag")
    m.put(19, 6, "flag")
    m.put(7, 13, "cart")
    m.frame("brick_wall")
    # 最右列中段保持可走，出怪点从这里找
    m.rect(28, 6, 28, 11, "stone_b")
    return m


SPECS = [
    ("map_ch00_act3_factory", "江南制造总局（1865）", (4, 9), factory),
    ("map_ch00_act4_beijing", "北京 · 南海会馆外（1898）", (4, 8), beijing),
    ("map_ch00_act5_wuchang", "武昌 · 总督衙门（1911）", (4, 9), wuchang),
]


def build_one(map_id: str, title: str, spawn: tuple[int, int], make) -> dict:
    m = make()
    assert m.g[spawn[1]][spawn[0]] not in {ID[n] for n in SOLID}, f"{map_id} 出生点压在实心格上"
    return {
        "id": map_id,
        "width": W,
        "height": H,
        "tileset": "tp_late_qing",
        "sky_rows": 0,
        "tile_colors": {str(ID[name]): color for name, color in FALLBACK.items()},
        "tile_styles": {"1": "stone", "2": "stone", "3": "stone", "4": "wood", "5": "plain",
                        "6": "wood", "7": "wood", "8": "sea", "9": "stone",
                        "10": "stone", "11": "stone", "12": "stone", "13": "wood",
                        "14": "wood", "15": "wood", "16": "wood", "17": "plain",
                        "18": "wood", "19": "plain", "20": "stone", "21": "stone",
                        "22": "stone", "23": "wood", "24": "wood", "25": "wood",
                        "26": "stone", "27": "wood", "28": "stone", "29": "wood",
                        "30": "plain", "31": "stone", "32": "sand", "33": "wood",
                        "34": "wood", "35": "wood", "36": "stone"},
        "spawn": {"x": spawn[0], "y": spawn[1]},
        "layers": [
            {"name": "ground", "data": m.g, "collidable": False},
            {"name": "collision", "data": m.c, "collidable": True},
        ],
        "triggers": [],
        "objects": [],
        "meta": {
            "title": title,
            "era": "洋务运动及之后（1861—1912）",
            "tileset_note": "tp_late_qing：青砖巷 / 灰瓦门楼 / 机器厂房 / 近代街景；不复用 tp_act2 的太平天国乡野图",
            "generator": "tools/gen_late_qing_maps.py",
            "notes": m.notes,
        },
    }


def check(data: dict) -> int:
    g, c = data["layers"][0]["data"], data["layers"][1]["data"]
    ok = (len(g) == H and all(len(r) == W for r in g) and len(c) == H
          and all(len(r) == W for r in c))
    # 右端必须找得到「本格与下一格都可走」的出怪点
    right = sum(
        1 for col in range(W - 2, 0, -1)
        for y in range(2, H - 2)
        if not c[y][col] and not c[y + 1][col]
    )
    floor = sum(1 for y in range(H) for x in range(W) if not c[y][x])
    print(f"{data['id']}: {W}x{H} walkable={floor} right-spawn={right} -> {'OK' if ok and right > 0 else 'FAIL'}")
    return 0 if ok and right > 0 else 1


def main(argv: list[str]) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    bad = 0
    for map_id, title, spawn, make in SPECS:
        data = build_one(map_id, title, spawn, make)
        if "--check" not in argv:
            (OUT / f"{map_id}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        bad |= check(data)
    return bad


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
