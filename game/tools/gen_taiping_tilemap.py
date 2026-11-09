# -*- coding: utf-8 -*-
"""
太平天国篇章 · 瓦片地图包生成器（可重复执行，产出全部内容）

产出：
  public/art/tiles/tp/*.png                 36 张 16x16 瓦片（24 色锁定调色板 v2）
  public/art/tiles/tp/tp_act2_sheet.png     8 列拼版图块集（id 0 为透明）
  public/art/tiles/tp/tileset.json          Tiled / Phaser 双兼容图块集配置
  public/art/tiles/tp/layers/*.layers.json 四层编辑源（地形/建筑/装饰/碰撞）
  public/data/maps/map_ch00_tp_*.json      三张引擎可直接加载的 MapDef 地图
  design/taiping_tilemap_preview.html      自包含预览页（内嵌 base64 图片）

设计约束（来自 game/src/core/constants.ts、MapRenderer.ts、tests/*.test.ts）：
  TILE=16, VIEW_W=480, FIELD_H=256, FIELD_COLS=30, FIELD_ROWS=16
  MapDef 只认 ground / collision 两层（foreground 会挡住角色，禁用）
  单屏地图 30x16，边界整圈实心；sky_rows 行必须碰撞全实心
  objects 里 kind:'prop' 的 payload 必须落在 SUNNY_PROPS 表内
  数据文件 UTF-8 无 BOM

用法：
  python tools/gen_taiping_tilemap.py
"""
from __future__ import annotations

import base64
import json
import math
import struct
import sys
import zlib
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT.parent / "design"
TILE_DIR = ROOT / "public" / "art" / "tiles" / "tp"
LAYER_DIR = TILE_DIR / "layers"
MAP_DIR = ROOT / "public" / "data" / "maps"
for d in (TILE_DIR, LAYER_DIR, MAP_DIR, DESIGN):
    d.mkdir(parents=True, exist_ok=True)

W, H, TS = 30, 16, 16
SHEET_COLS = 8

# ---------------------------------------------------------------- 调色板 v2
# 唯一真相：game/src/core/constants.ts -> PALETTE（24 色锁定，禁止引入新色号）
PALETTE = {
    "ink": "#0D0B14", "night": "#1C1A2B", "plumDark": "#2F2B45",
    "plumMid": "#4A4468", "plumLight": "#6B6489", "greyPlum": "#948DAB",
    "greyLight": "#C2BCD1", "paper": "#F2EDE4", "cream": "#E8CFA8",
    "sand": "#CFA26A", "brown": "#A8763F", "brownDark": "#7A4F2A",
    "brownDeep": "#4E2F1A", "redDark": "#8C1C1C", "red": "#C0392B",
    "redBright": "#E85C4A", "redSoft": "#F2A08C", "greenDark": "#4A7A2E",
    "green": "#7BA84A", "greenLight": "#A8D070", "indigo": "#2A5A8A",
    "blue": "#4A90C8", "blueLight": "#7BC0E8", "star": "#D4A840",
}


def C(key: str, alpha: int = 255):
    h = PALETTE[key].lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def style_of(hexstr: str) -> str:
    """复刻 MapRenderer.tileStyleOf()，用于预估程序化渲染出来的材质。"""
    h = hexstr.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    mx, mn = max(r, g, b), min(r, g, b)
    if b - r >= 60 and b - g >= 20:
        return "sea"
    if mx - mn <= 46 and mx >= 60 and b >= g:
        return "stone"
    if r > 130 and g > 100 and b < g + 10:
        return "sand"
    if r > 90 and r > b + 30:
        return "wood"
    return "plain"


# ---------------------------------------------------------------- 极简 PNG
def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, w: int, h: int, buf: bytearray) -> None:
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(buf[y * stride:(y + 1) * stride])
    head = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    path.write_bytes(head + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + _chunk(b"IEND", b""))


class Img:
    def __init__(self, w: int = TS, h: int = TS, base: str | None = None):
        self.w, self.h = w, h
        self.buf = bytearray(w * h * 4)
        if base:
            self.fill(C(base))

    def fill(self, col) -> None:
        self.buf[:] = bytes(col) * (self.w * self.h)

    def dot(self, x: int, y: int, col) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 4
            self.buf[i:i + 4] = bytes(col)

    def rect(self, x: int, y: int, w: int, h: int, col) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.dot(xx, yy, col)

    def overlay_rect(self, x: int, y: int, w: int, h: int, col, alpha: float) -> None:
        """预览用：把半透明色块混成不透明像素，避免 PNG 出现半透明像素。"""
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                i = (yy * self.w + xx) * 4
                self.buf[i] = int(self.buf[i] * (1 - alpha) + col[0] * alpha)
                self.buf[i + 1] = int(self.buf[i + 1] * (1 - alpha) + col[1] * alpha)
                self.buf[i + 2] = int(self.buf[i + 2] * (1 - alpha) + col[2] * alpha)
                self.buf[i + 3] = 255

    def blit(self, src: "Img", ox: int, oy: int) -> None:
        """按 alpha 覆盖贴图（用于预览合成）。"""
        for y in range(src.h):
            for x in range(src.w):
                i = (y * src.w + x) * 4
                a = src.buf[i + 3]
                if a == 0:
                    continue
                col = (src.buf[i], src.buf[i + 1], src.buf[i + 2], 255) if a == 255 else (src.buf[i], src.buf[i + 1], src.buf[i + 2], a)
                self.dot(ox + x, oy + y, col)


ART_CHARS = {
    ".": None, "k": "ink", "n": "night", "p": "plumDark", "P": "plumMid",
    "q": "plumLight", "Q": "greyPlum", "x": "greyLight", "w": "paper",
    "c": "cream", "s": "sand", "S": "cream", "b": "brown", "d": "brownDark",
    "e": "brownDeep", "r": "redDark", "R": "red", "o": "redBright",
    "f": "redSoft", "g": "greenDark", "G": "green", "h": "greenLight",
    "i": "indigo", "u": "blue", "U": "blueLight", "y": "star",
}


def apply_ops(img: Img, ops) -> Img:
    for op in ops:
        k = op[0]
        if k == "rect":
            img.rect(op[1], op[2], op[3], op[4], C(op[5]))
        elif k == "dot":
            img.dot(op[1], op[2], C(op[3]))
        elif k == "specks":
            _, seed, n, key, x0, y0, x1, y1 = op
            h = seed * 1103515245 + 12345
            for _ in range(n):
                h = (h * 1103515245 + 12345) & 0x7FFFFFFF
                rx = x0 + (h >> 7) % max(1, x1 - x0)
                h = (h * 1103515245 + 12345) & 0x7FFFFFFF
                ry = y0 + (h >> 7) % max(1, y1 - y0)
                img.dot(rx, ry, C(key))
        elif k == "art":
            _, y0, rows = op
            for dy, line in enumerate(rows):
                for dx, ch in enumerate(line.ljust(TS, ".")[:TS]):
                    key = ART_CHARS.get(ch)
                    if key:
                        img.dot(dx, y0 + dy, C(key))
    return img


# ---------------------------------------------------------------- 瓦片定义
TILES: list[dict] = []


def T(name, cn, cat, scenes, collidable, hexkey, base, ops, note=""):
    TILES.append({
        "id": len(TILES) + 1, "name": name, "cn": cn, "category": cat,
        "scenes": scenes, "layer": "ground", "collidable": collidable,
        "engine_hex": PALETTE[hexkey], "render_style_hint": style_of(PALETTE[hexkey]),
        "base": base, "ops": ops, "note": note,
        "file": name + ".png",
    })


# --- 地形 1-12 ---
T("tp_terrain_grass_00", "草地·基", "terrain", ["village", "city"], False, "green", "green",
  [("specks", 3, 14, "greenLight", 0, 0, 16, 16), ("specks", 9, 8, "greenDark", 0, 0, 16, 16),
   ("rect", 3, 4, 1, 2, "greenDark"), ("rect", 11, 10, 1, 2, "greenDark")], "村口、城外草地")
T("tp_terrain_grass_01", "草地·变体", "terrain", ["village"], False, "green", "green",
  [("specks", 21, 10, "greenLight", 0, 0, 16, 16), ("rect", 7, 2, 1, 2, "greenLight"),
   ("rect", 8, 3, 1, 1, "greenDark"), ("rect", 13, 12, 1, 2, "greenDark")], "打散平铺重复感")
T("tp_terrain_grass_edge", "草地·田埂边", "terrain", ["village"], False, "greenLight", "greenLight",
  [("rect", 0, 0, 16, 2, "greenDark"), ("specks", 5, 8, "green", 1, 3, 15, 15),
   ("rect", 0, 14, 16, 1, "brown")], "田埂与地块分界")
T("tp_terrain_dirt_path", "土路", "terrain", ["village", "battlefield"], False, "sand", "sand",
  [("specks", 11, 12, "brownDark", 0, 0, 16, 16), ("rect", 0, 5, 16, 1, "brown"),
   ("rect", 0, 12, 16, 1, "brown")], "护送主路，宽 3 格")
T("tp_terrain_dirt_path_01", "土路·变体", "terrain", ["village"], False, "sand", "sand",
  [("specks", 31, 9, "cream", 0, 0, 16, 16), ("rect", 2, 9, 4, 1, "brownDark"),
   ("dot", 12, 3, "greyPlum")], "车辙与碎石")
T("tp_terrain_paddy", "水田/稻田", "terrain", ["village"], False, "brown", "brown",
  [("rect", 0, 3, 16, 1, "indigo"), ("rect", 0, 8, 16, 1, "indigo"),
   ("rect", 0, 13, 16, 1, "indigo"), ("specks", 7, 12, "greenLight", 0, 0, 16, 16)], "金田村稻田")
T("tp_terrain_stone_road", "青石板街", "terrain", ["city"], False, "plumLight", "plumLight",
  [("rect", 0, 5, 16, 1, "plumDark"), ("rect", 0, 11, 16, 1, "plumDark"),
   ("rect", 4, 0, 1, 5, "plumDark"), ("rect", 11, 6, 1, 5, "plumDark"),
   ("rect", 6, 12, 1, 4, "plumDark")], "天京城主街")
T("tp_terrain_stone_road_01", "青石板·变体", "terrain", ["city", "battlefield"], False, "greyPlum", "greyPlum",
  [("rect", 0, 4, 16, 1, "plumMid"), ("rect", 0, 10, 16, 1, "plumMid"),
   ("rect", 8, 0, 1, 4, "plumMid"), ("rect", 3, 5, 1, 5, "plumMid")], "街面明暗变化")
T("tp_terrain_rampart", "城墙砖面", "terrain", ["city", "battlefield"], False, "plumMid", "plumMid",
  [("rect", 0, 5, 16, 2, "plumDark"), ("rect", 0, 12, 16, 2, "plumDark"),
   ("rect", 5, 0, 2, 5, "plumDark"), ("rect", 12, 7, 2, 5, "plumDark"),
   ("rect", 0, 0, 16, 1, "greyPlum")], "大砖错缝 + 压顶")
T("tp_terrain_water", "护城河", "terrain", ["city", "battlefield"], True, "indigo", "indigo",
  [("rect", 1, 3, 6, 1, "blueLight"), ("rect", 9, 8, 5, 1, "blueLight"),
   ("rect", 3, 13, 7, 1, "blue"), ("rect", 0, 15, 16, 1, "ink")], "水体自带阻挡")
T("tp_terrain_shore", "岸线", "terrain", ["city", "village"], False, "cream", "cream",
  [("rect", 0, 0, 16, 5, "sand"), ("rect", 0, 6, 16, 2, "greyPlum"),
   ("rect", 0, 8, 16, 8, "indigo"), ("rect", 2, 9, 6, 1, "blueLight"),
   ("rect", 10, 12, 5, 1, "blueLight")], "水陆过渡，禁止画成半透明")
T("tp_terrain_scorched", "焦土瓦砾", "terrain", ["battlefield"], False, "brownDeep", "brownDeep",
  [("specks", 17, 18, "ink", 0, 0, 16, 16), ("specks", 23, 8, "greyPlum", 0, 0, 16, 16),
   ("rect", 4, 6, 3, 1, "plumDark"), ("rect", 11, 11, 3, 1, "plumDark")], "1864 城破后的地表")

# --- 建筑 13-24 ---
T("tp_building_village_roof", "村舍瓦顶", "building", ["village"], True, "brownDark", "brownDark",
  [("rect", 0, 0, 16, 2, "brown"), ("rect", 2, 3, 1, 13, "brownDeep"),
   ("rect", 6, 3, 1, 13, "brownDeep"), ("rect", 10, 3, 1, 13, "brownDeep"),
   ("rect", 14, 3, 1, 13, "brownDeep"), ("rect", 0, 15, 16, 1, "brownDeep")], "屋顶整块阻挡")
T("tp_building_village_wall", "村舍土墙", "building", ["village"], True, "cream", "cream",
  [("rect", 0, 0, 16, 1, "brownDark"), ("rect", 0, 15, 16, 1, "brownDark"),
   ("rect", 1, 1, 2, 14, "brown"), ("rect", 13, 1, 2, 14, "brown"),
   ("rect", 6, 4, 5, 6, "indigo"), ("rect", 8, 4, 1, 6, "brownDark")], "木框 + 窗")
T("tp_building_village_door", "村舍门洞", "building", ["village"], True, "brownDeep", "brownDeep",
  [("rect", 2, 1, 12, 15, "brown"), ("rect", 4, 3, 8, 13, "ink"),
   ("dot", 10, 9, "star"), ("rect", 2, 0, 12, 1, "brownDark")], "门是视觉，不是传送点")
T("tp_building_fence", "竹篱笆", "building", ["village"], True, "green", "green",
  [("rect", 1, 2, 2, 14, "brownDark"), ("rect", 6, 2, 2, 14, "brownDark"),
   ("rect", 11, 2, 2, 14, "brownDark"), ("rect", 0, 5, 16, 2, "greenLight"),
   ("rect", 0, 11, 16, 2, "greenLight")], "田块隔断，阻挡")
T("tp_building_granary", "粮仓/圣库", "building", ["village", "city"], True, "brown", "brown",
  [("rect", 0, 0, 16, 5, "sand"), ("rect", 0, 5, 16, 1, "brownDark"),
   ("rect", 5, 7, 6, 9, "brownDeep"), ("rect", 7, 9, 2, 7, "ink"),
   ("dot", 8, 12, "star")], "圣库是经营玩法目标物")
T("tp_building_city_wall", "城墙段", "building", ["city", "battlefield"], True, "plumLight", "plumLight",
  [("rect", 0, 0, 16, 3, "greyPlum"), ("rect", 2, 0, 3, 3, "plumLight"),
   ("rect", 9, 0, 3, 3, "plumLight"), ("rect", 0, 4, 16, 1, "plumDark"),
   ("rect", 0, 10, 16, 1, "plumDark"), ("rect", 7, 5, 1, 5, "plumDark"),
   ("rect", 3, 11, 1, 5, "plumDark"), ("rect", 12, 11, 1, 5, "plumDark")], "垛口 + 错缝砖")
T("tp_building_city_gate", "城门洞", "building", ["city"], True, "plumDark", "plumDark",
  [("rect", 0, 0, 16, 3, "greyPlum"), ("rect", 3, 4, 10, 12, "ink"),
   ("rect", 5, 7, 6, 9, "brownDeep"), ("specks", 13, 6, "star", 5, 7, 11, 16),
   ("rect", 0, 2, 16, 1, "redDark")], "城门在本包里是布景（阻挡）")
T("tp_building_watchtower", "箭楼", "building", ["city", "battlefield"], True, "greyPlum", "greyPlum",
  [("rect", 0, 1, 16, 3, "brownDark"), ("rect", 2, 5, 4, 5, "ink"),
   ("rect", 10, 5, 4, 5, "ink"), ("rect", 0, 11, 16, 5, "plumMid"),
   ("rect", 7, 0, 1, 4, "brownDeep"), ("rect", 8, 0, 5, 3, "red")], "角楼 + 太平军红旗")
T("tp_building_palace_roof", "王府琉璃顶", "building", ["city"], True, "star", "star",
  [("rect", 0, 0, 16, 2, "brown"), ("rect", 2, 3, 1, 13, "brownDark"),
   ("rect", 6, 3, 1, 13, "brownDark"), ("rect", 10, 3, 1, 13, "brownDark"),
   ("rect", 14, 3, 1, 13, "brownDark"), ("rect", 0, 15, 16, 1, "redDark")], "天王府专用")
T("tp_building_palace_wall", "王府红墙", "building", ["city"], True, "redDark", "redDark",
  [("rect", 0, 0, 16, 2, "red"), ("rect", 0, 14, 16, 2, "plumDark"),
   ("specks", 19, 7, "star", 1, 3, 15, 13), ("rect", 6, 4, 4, 8, "paper"),
   ("rect", 7, 5, 2, 6, "redDark")], "金钉 + 窗")
T("tp_building_shop_front", "街市铺面", "building", ["city"], True, "brownDark", "brownDark",
  [("rect", 0, 0, 16, 4, "red"), ("rect", 0, 4, 16, 1, "star"),
   ("rect", 1, 6, 14, 4, "cream"), ("rect", 0, 11, 16, 5, "brown"),
   ("rect", 3, 12, 3, 3, "brownDeep"), ("rect", 10, 12, 3, 3, "brownDeep")], "幌子 + 柜台")
T("tp_building_bridge", "护城河木桥", "building", ["city"], False, "brownDark", "brownDark",
  [("rect", 0, 0, 16, 1, "brown"), ("rect", 0, 15, 16, 1, "brown"),
   ("rect", 0, 3, 16, 1, "brownDeep"), ("rect", 0, 7, 16, 1, "brownDeep"),
   ("rect", 0, 11, 16, 1, "brownDeep"), ("dot", 3, 5, "greyPlum"),
   ("dot", 12, 9, "greyPlum")], "唯一可通行的跨水瓦片")

# --- 装饰 25-36（自带不透明地表底色，单层 ground 也能直接显示） ---
PINE = [".......gg.......", "......gGGg......", ".....gGhhGg.....", "....gGhhhhGg....",
        "...gGhhGGhhGg...", "..gGhhGGGGhhGg..", ".gGhhGGhhGGhhGg.", "gGhhGGhhhhGGhhGg",
        "..gGhhGGGGhhGg..", "...gGhhGGhhGg...", "....gGhhhhGg....", ".....gGhhGg.....",
        "......gGGg......", ".......dd.......", ".......dd.......", "......eedd......"]
BAMBOO = ["..h...h...h.....", ".hGh.hGh.hGh....", ".hGh.hGh.hGh....", "..h..hGh..h.....",
          ".hG..hGh.hGh....", ".hGh.hGh.hGh....", "..h..hGh..h.....", ".hGh.hGh.hGh....",
          ".hGh.hGh.hGh....", "..h..hGh..h.....", ".hG..hGh.hG.....", ".hGh.hGh.hGh....",
          "..h...h...h.....", "................", "................", "................"]
BANNER = ["..d.............", "..dddddddddd....", "..dyyyyyyyyR....", "..dyRRRRRRyR....",
          "..dyRyyyyyRR....", "..dyRRyRRRyR....", "..dyyyyyyyyR....", "..dddddddddR....",
          "..d........R....", "..d.......R.....", "..d.............", "..d.............",
          "..d.............", "..d.............", ".eee............", ".eee............"]
LANTERN = [".......d........", "......ddd.......", ".......d........", ".....rrrrr......",
           "....rRRRRRr.....", "...rRoRRRoRr....", "...rRoRRRoRr....", "...rRoRRRoRr....",
           "...rRooRooRr....", "....rRRRRRr.....", ".....rrrrr......", "......yyy.......",
           "......yyy.......", ".......y........", "................", "................"]
CRATE = ["................", "..dddddddddd....", "..dbbbbbbbbd....", "..dbKbbbbKbd....",
         "..dbbKbbKbbd....", "..dbbbKKbbbd....", "..dbbbKKbbbd....", "..dbbKbbKbbd....",
         "..dbKbbbbKbd....", "..dbbbbbbbbd....", "..dddddddddd....", "................",
         "................", "................", "................", "................"]
BARREL = ["................", "....dddddd......", "...dbbbbbbd.....", "..dbbbbbbbbd....",
          "..dbbssssbbd....", "..dbbssssbbd....", "..dbbssssbbd....", "..dyyyyyyyyd....",
          "..dbbbbbbbbd....", "..dbbssssbbd....", "..dbbssssbbd....", "..dyyyyyyyyd....",
          "...dbbbbbbd.....", "....dddddd......", "................", "................"]
WELL = ["................", "..QQQQQQQQQQ....", "..QppppppppQ....", "..QpUUUUUUpQ....",
        "..QpUiiiiUpQ....", "..QpUiUUiUpQ....", "..QpUiiiiUpQ....", "..QpUUUUUUpQ....",
        "..QppppppppQ....", "..QQQQQQQQQQ....", "..QQQQQQQQQQ....", "...Q......Q.....",
        "...Q......Q.....", "..QQQQQQQQQQ....", "................", "................"]
SANDBAG = ["................", "................", "...ssss..ssss...", "..sSSSSssSSSSs..",
           "..sSssSSssSsSs..", "..ssssssssssss..", ".ssss..ssss..ss.", ".sSSSSsSSSSsSSs.",
           ".sSssSSssSSsSSs.", ".ssssssssssssss.", "..dddddddddddd..", "..eeeeeeeeeeee..",
           "................", "................", "................", "................"]
BARRICADE = ["................", "..w..........w..", "..d..........d..", "...d........d...",
             "....d......d....", ".....d....d.....", "..ddddddddddd...", "...d.......d....",
             "....d.....d.....", ".....d...d......", "..ddddddddddd...", ".....d...d......",
             "....d.....d.....", "...d.......d....", "..d.........d...", ".w...........w.."]
CANNON = ["................", "................", "..kkkkkkkkk.....", "..kQQQQQQQkk....",
          "..kQQQQQQQkkk...", "..kkkkkkkkkkk...", "....dddd........", "...d......d.....",
          "..dd..dd..dd....", "..dd..dd..dd....", "...d......d.....", "....dddd........",
          "................", "................", "................", "................"]
TENT = ["................", ".......w........", "......wwc.......", ".....wcccc......",
        "....wccsscc.....", "...wccsssscc....", "..wccsssssscc...", ".wccsssssssscc..",
        "wccssKKKKssssccw", "wccssKKKKssssccw", "wccssKKKKssssccw", "wccssKKKKssssccw",
        "dddddddddddddddd", "................", "................", "................"]
BREACH = ["QQQQQkkkkkkQQQQQ", "qqqqqkkkkkkqqqqq", "QQqqqkPPPPkqqQQQ", ".qqQqkPPPPkqQqq.",
          "..qQQkkPPkkQQq..", "...qQkqqqqkQq...", "....qqkqqkqq....", ".....QkqqkQ.....",
          "......kkkk......", "..q...kkkk...q..", ".QQq........qQQ.", "qqqq........qqqq",
          "................", ".q...q..q...q...", "..QQ......QQ....", "................"]

T("tp_deco_pine", "松树/山林", "decoration", ["village"], True, "greenDark", "greenDark",
  [("art", 0, PINE)], "村落上下边界的实心山林（深底亮冠，形成清晰的边界带）")
T("tp_deco_bamboo", "竹丛", "decoration", ["village"], False, "greenLight", "green",
  [("art", 0, BAMBOO)], "不阻挡，纯布景")
T("tp_deco_banner", "太平军黄旗", "decoration", ["village", "city", "battlefield"], False, "red", "plumLight",
  [("art", 0, BANNER)], "史实：太平军黄旗红边，不用清军龙旗")
T("tp_deco_lantern", "街市灯笼", "decoration", ["city"], False, "redBright", "plumLight",
  [("art", 0, LANTERN)], "夜景光点，星黄不用于美术主体")
T("tp_deco_crate", "木箱", "decoration", ["village", "city"], False, "brown", "sand",
  [("art", 0, CRATE)], "与 objects 的 pickup 区分：这个是布景")
T("tp_deco_barrel", "粮桶", "decoration", ["village", "city", "battlefield"], False, "brown", "brownDeep",
  [("art", 0, BARREL)], "圣库/军粮")
T("tp_deco_well", "水井", "decoration", ["village"], True, "greyPlum", "green",
  [("art", 0, WELL)], "村落水井，阻挡")
T("tp_deco_sandbag", "沙袋工事", "decoration", ["battlefield"], True, "sand", "brownDeep",
  [("art", 0, SANDBAG)], "战场掩体，阻挡")
T("tp_deco_barricade", "鹿角拒马", "decoration", ["battlefield"], True, "brownDark", "brownDeep",
  [("art", 0, BARRICADE)], "战场掩体，阻挡")
T("tp_deco_cannon", "炮位", "decoration", ["battlefield"], True, "ink", "brownDeep",
  [("art", 0, CANNON)], "湘军/洋枪队炮位，阻挡")
T("tp_deco_tent", "营帐", "decoration", ["battlefield"], True, "cream", "brownDeep",
  [("art", 0, TENT)], "军帐，阻挡")
T("tp_deco_breach", "城墙缺口", "decoration", ["battlefield"], False, "plumLight", "plumMid",
  [("art", 0, BREACH)], "1864 城破处，可通行（视觉焦点）")

TILE_BY_ID = {t["id"]: t for t in TILES}
TILE_BY_NAME = {t["name"]: t for t in TILES}
TILE_IMGS: dict[int, Img] = {}


def build_tiles() -> None:
    for t in TILES:
        img = apply_ops(Img(TS, TS, t["base"]), t["ops"])
        TILE_IMGS[t["id"]] = img
        write_png(TILE_DIR / t["file"], TS, TS, img.buf)
    rows = math.ceil((len(TILES) + 1) / SHEET_COLS)
    sheet = Img(SHEET_COLS * TS, rows * TS)
    for t in TILES:
        i = t["id"]
        sheet.blit(TILE_IMGS[i], (i % SHEET_COLS) * TS, (i // SHEET_COLS) * TS)
    write_png(TILE_DIR / "tp_act2_sheet.png", sheet.w, sheet.h, sheet.buf)
    print(f"[tiles] {len(TILES)} 张 16x16 PNG + sheet {sheet.w}x{sheet.h} (8 列 x {rows} 行)")


def build_tileset_json() -> dict:
    rows = math.ceil((len(TILES) + 1) / SHEET_COLS)
    tiles = []
    for t in TILES:
        tiles.append({
            "id": t["id"],
            "name": t["name"],
            "cn": t["cn"],
            "type": t["category"],
            "file": t["file"],
            "sheet_cell": {"col": t["id"] % SHEET_COLS, "row": t["id"] // SHEET_COLS},
            "category": t["category"],
            "layer": t["layer"],
            "scenes": t["scenes"],
            "collidable": t["collidable"],
            "engine_hex": t["engine_hex"],
            "render_style_hint": t["render_style_hint"],
            "note": t["note"],
            "properties": [
                {"name": "category", "type": "string", "value": t["category"]},
                {"name": "collidable", "type": "bool", "value": t["collidable"]},
                {"name": "scene", "type": "string", "value": ",".join(t["scenes"])},
            ],
        })
    cfg = {
        "name": "tp_act2",
        "version": "1.0",
        "description": "太平天国篇章（序章第二幕 1851-1864）通用图块集：村落 / 城池 / 战场",
        "engine": "Phaser 3 (MapDef JSON) + Tiled 兼容字段",
        # --- Tiled 标准字段 ---
        "tilewidth": TS, "tileheight": TS,
        "tilecount": len(TILES) + 1, "columns": SHEET_COLS,
        "image": "tp_act2_sheet.png", "imagewidth": SHEET_COLS * TS,
        "imageheight": rows * TS, "margin": 0, "spacing": 0,
        "tiles": tiles,
        # --- 引擎侧绑定 ---
        "grid": {"tile_px": TS, "cols": W, "rows": H, "world_px": [W * TS, H * TS],
                 "single_screen": True, "camera_scroll": False},
        "palette": PALETTE,
        "palette_rule": "24 色锁定 v2，唯一真相 game/src/core/constants.ts -> PALETTE；禁止新增色号、禁止半透明像素、禁止渐变",
        "layers": [
            {"name": "terrain", "cn": "地形", "collidable": False, "engine_layer": "ground", "order": 0},
            {"name": "building", "cn": "建筑", "collidable": "per_tile", "engine_layer": "ground", "order": 1},
            {"name": "decoration", "cn": "装饰", "collidable": "per_tile", "engine_layer": "ground", "order": 2},
            {"name": "collision", "cn": "碰撞", "collidable": True, "engine_layer": "collision", "order": 3},
        ],
        "layer_fold_rule": "ground = terrain 底图，被 building 非零格覆盖，再被 decoration 非零格覆盖；"
                           "collision 层取各层 collidable 瓦片的并集（0/1）。foreground 禁用（会遮挡角色）。",
        "engine_binding": {
            "map_field": "tileset",
            "value": "tp_act2",
            "tile_colors": {str(t["id"]): t["engine_hex"] for t in TILES},
            "note": "当前 MapRenderer 不读 PNG，只按 tile_colors 的 hex 推断材质（sea/sand/stone/wood/plain）；"
                    "render_style_hint 就是该推断结果。接入真图块时按 sheet_cell 取帧，见 design/12_taiping_tilemap_spec.md 第 8 节。",
        },
        "files": {
            "single_tiles": "public/art/tiles/tp/tp_*.png（每瓦片一张，16x16）",
            "sheet": "public/art/tiles/tp/tp_act2_sheet.png",
            "config": "public/art/tiles/tp/tileset.json（本文件）",
            "edit_source": "public/art/tiles/tp/layers/*.layers.json（四层编辑源）",
            "engine_maps": "public/data/maps/map_ch00_tp_*.json",
        },
    }
    (TILE_DIR / "tileset.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg


# ---------------------------------------------------------------- 四层地图编辑源
def blank():
    return [[0 for _ in range(W)] for _ in range(H)]


def new_layers():
    return {"terrain": blank(), "building": blank(), "decoration": blank(), "collision": blank()}


def put(L, layer: str, x: int, y: int, tid: int):
    if not (0 <= x < W and 0 <= y < H):
        return
    L[layer][y][x] = tid
    if TILE_BY_ID[tid]["collidable"]:
        L["collision"][y][x] = 1


def fill_rect(L, layer, x0, y0, x1, y1, tid):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(L, layer, x, y, tid)


def tid(name: str) -> int:
    return TILE_BY_NAME[name]["id"]


def fold(L):
    """四层编辑源 -> 引擎两层 MapDef 数据。"""
    g = [row[:] for row in L["terrain"]]
    for layer in ("building", "decoration"):
        for y in range(H):
            for x in range(W):
                if L[layer][y][x]:
                    g[y][x] = L[layer][y][x]
    return g, [row[:] for row in L["collision"]]


# --- 场景 A：村落（金田村，1851 护送） ---
def build_village():
    L = new_layers()
    for y in range(H):
        for x in range(W):
            put(L, "terrain", x, y, tid("tp_terrain_grass_00") if (x * 7 + y * 3) % 5 else tid("tp_terrain_grass_01"))
    # 上下山林边界（各 2 行）
    for x in range(W):
        for y in (0, 1, H - 2, H - 1):
            put(L, "decoration", x, y, tid("tp_deco_pine") if (x + y) % 3 else tid("tp_deco_bamboo"))
            L["collision"][y][x] = 1
    for y in range(H):
        for x in (0, W - 1):
            put(L, "decoration", x, y, tid("tp_deco_pine"))
            L["collision"][y][x] = 1
    # 三格宽主路（护送走廊，x=1..28 全通）
    for x in range(1, W - 1):
        for y in (7, 8, 9):
            put(L, "terrain", x, y, tid("tp_terrain_dirt_path") if (x + y) % 4 else tid("tp_terrain_dirt_path_01"))
            L["collision"][y][x] = 0
    # 稻田块与田埂（上半 / 下半）
    for (x0, y0, w, h) in [(3, 3, 6, 3), (12, 3, 5, 3), (20, 3, 6, 3),
                           (4, 11, 6, 3), (13, 11, 5, 3), (21, 11, 6, 3)]:
        fill_rect(L, "terrain", x0, y0, x0 + w - 1, y0 + h - 1, tid("tp_terrain_paddy"))
        for x in range(x0, x0 + w):
            put(L, "terrain", x, y0, tid("tp_terrain_grass_edge"))
    # 打谷场（起点附近）
    fill_rect(L, "terrain", 2, 11, 5, 12, tid("tp_terrain_dirt_path"))
    # 村舍三组：屋顶行 + 墙行，都阻挡；门前留空
    for (x0, y0) in [(6, 3), (16, 3), (24, 11)]:
        fill_rect(L, "building", x0, y0, x0 + 3, y0, tid("tp_building_village_roof"))
        fill_rect(L, "building", x0, y0 + 1, x0 + 3, y0 + 1, tid("tp_building_village_wall"))
        put(L, "building", x0 + 1, y0 + 1, tid("tp_building_village_door"))
    # 粮仓（圣库）与篱笆
    fill_rect(L, "building", 10, 11, 11, 12, tid("tp_building_granary"))
    for x in range(19, 24):
        put(L, "building", x, 5, tid("tp_building_fence"))
    # 装饰：竹丛、旗、粮桶、木箱、水井（都不压主路）
    for (x, y) in [(2, 5), (9, 5), (18, 2), (26, 5), (3, 13), (14, 13), (27, 13)]:
        put(L, "decoration", x, y, tid("tp_deco_bamboo"))
    for (x, y) in [(2, 6), (27, 6), (12, 2)]:
        put(L, "decoration", x, y, tid("tp_deco_banner"))
    for (x, y) in [(8, 6), (22, 6), (17, 13)]:
        put(L, "decoration", x, y, tid("tp_deco_crate"))
    put(L, "decoration", 2, 10, tid("tp_deco_well"))
    put(L, "decoration", 26, 10, tid("tp_deco_barrel"))
    objects = [
        {"id": "obj_tp_village_01", "kind": "pickup", "x": 4, "y": 6, "label": "军粮", "payload": "crate"},
        {"id": "obj_tp_village_02", "kind": "pickup", "x": 12, "y": 8, "label": "抬枪", "payload": "crate"},
        {"id": "obj_tp_village_03", "kind": "pickup", "x": 20, "y": 6, "label": "药包", "payload": "crate"},
        {"id": "obj_tp_village_04", "kind": "prop", "x": 9, "y": 9, "label": "山石", "payload": "rock"},
        {"id": "obj_tp_village_05", "kind": "prop", "x": 22, "y": 9, "label": "路牌", "payload": "sign"},
    ]
    return L, objects, {"x": 2, "y": 8}, 0, False


# --- 场景 B：城池（天京城，1853 经营） ---
def build_city():
    L = new_layers()
    for y in range(H):
        for x in range(W):
            # 街区底用浅砖、主街用深砖，十字街在俯视图里一眼可辨
            put(L, "terrain", x, y, tid("tp_terrain_stone_road_01") if (x + y) % 6 else tid("tp_terrain_stone_road"))
    # 城墙四边（实心），城门在顶边中央
    fill_rect(L, "building", 0, 0, W - 1, 0, tid("tp_building_city_wall"))
    fill_rect(L, "building", 0, H - 1, W - 1, H - 1, tid("tp_building_city_wall"))
    for y in range(H):
        put(L, "building", 0, y, tid("tp_building_city_wall"))
        put(L, "building", W - 1, y, tid("tp_building_city_wall"))
    for x in (14, 15):
        put(L, "building", x, 0, tid("tp_building_city_gate"))
    # 护城河 + 桥（y=14 一层水，桥在 x=14/15）
    fill_rect(L, "terrain", 1, 14, W - 2, 14, tid("tp_terrain_water"))
    fill_rect(L, "terrain", 1, 13, W - 2, 13, tid("tp_terrain_shore"))
    for x in (14, 15):
        put(L, "building", x, 14, tid("tp_building_bridge"))
        L["collision"][14][x] = 0
    # 主街（横 3 格 + 纵 2 格），保证 BFS 连通
    for x in range(1, W - 1):
        for y in (7, 8, 9):
            put(L, "terrain", x, y, tid("tp_terrain_stone_road"))
            L["collision"][y][x] = 0
    for y in range(1, 14):
        for x in (14, 15):
            put(L, "terrain", x, y, tid("tp_terrain_stone_road"))
            L["collision"][y][x] = 0
    # 街市铺面（上排）与民居（下排）
    fill_rect(L, "building", 2, 2, 6, 3, tid("tp_building_shop_front"))
    fill_rect(L, "building", 9, 2, 12, 3, tid("tp_building_village_wall"))
    fill_rect(L, "building", 2, 11, 6, 12, tid("tp_building_village_roof"))
    fill_rect(L, "building", 9, 11, 12, 12, tid("tp_building_granary"))
    # 天王府（右上，琉璃顶 + 红墙），府门开在 y=6 / x=18
    fill_rect(L, "building", 18, 2, 24, 2, tid("tp_building_palace_roof"))
    fill_rect(L, "building", 18, 3, 18, 6, tid("tp_building_palace_wall"))
    fill_rect(L, "building", 24, 3, 24, 6, tid("tp_building_palace_wall"))
    fill_rect(L, "building", 19, 6, 23, 6, tid("tp_building_palace_wall"))
    put(L, "building", 20, 6, tid("tp_building_village_door"))
    L["collision"][6][20] = 0
    # 箭楼两座
    put(L, "building", 2, 4, tid("tp_building_watchtower"))
    put(L, "building", 26, 4, tid("tp_building_watchtower"))
    # 装饰：灯笼、黄旗、货箱、粮桶
    for (x, y) in [(3, 5), (8, 5), (17, 5), (25, 5), (3, 10), (22, 10)]:
        put(L, "decoration", x, y, tid("tp_deco_lantern"))
    for (x, y) in [(13, 2), (16, 2), (13, 11)]:
        put(L, "decoration", x, y, tid("tp_deco_banner"))
    for (x, y) in [(11, 5), (20, 10), (26, 10)]:
        put(L, "decoration", x, y, tid("tp_deco_crate"))
    put(L, "decoration", 6, 10, tid("tp_deco_barrel"))
    objects = [
        {"id": "obj_tp_city_01", "kind": "pickup", "x": 5, "y": 8, "label": "圣库账册", "payload": "crate"},
        {"id": "obj_tp_city_02", "kind": "pickup", "x": 12, "y": 6, "label": "米粮", "payload": "crate"},
        {"id": "obj_tp_city_03", "kind": "prop", "x": 21, "y": 8, "label": "石墩", "payload": "rock"},
        {"id": "obj_tp_city_04", "kind": "prop", "x": 23, "y": 9, "label": "告示牌", "payload": "sign"},
    ]
    return L, objects, {"x": 13, "y": 8}, 0, False


# --- 场景 C：战场（天京城墙夜战，1864 Boss） ---
def build_battlefield():
    L = new_layers()
    for y in range(H):
        for x in range(W):
            base = tid("tp_terrain_scorched") if (x * 5 + y * 7) % 4 else tid("tp_terrain_stone_road_01")
            put(L, "terrain", x, y, base)
    # sky_rows = 4：0..3 行是远景带，不画地面但必须整行实心
    for y in range(4):
        for x in range(W):
            put(L, "terrain", x, y, tid("tp_terrain_water") if y < 2 else tid("tp_terrain_rampart"))
            L["collision"][y][x] = 1
    # 城墙残段（y=4），中央 x=14..17 为缺口
    for x in range(W):
        put(L, "building", x, 4, tid("tp_building_city_wall"))
        L["collision"][4][x] = 1
    for x in range(14, 18):
        put(L, "decoration", x, 4, tid("tp_deco_breach"))
        L["collision"][4][x] = 0
    # 四周边界
    for y in range(4, H):
        for x in (0, W - 1):
            put(L, "building", x, y, tid("tp_building_city_wall"))
            L["collision"][y][x] = 1
    for x in range(W):
        put(L, "building", x, H - 1, tid("tp_building_city_wall"))
        L["collision"][H - 1][x] = 1
    # 中央通道（y=8..10 全通）与开阔右侧（敌人出生区）
    for x in range(1, W - 1):
        for y in (8, 9, 10):
            put(L, "terrain", x, y, tid("tp_terrain_scorched"))
            L["collision"][y][x] = 0
    # 掩体：左侧玩家侧、右侧敌方侧，刻意不封死
    for (x, y) in [(4, 6), (5, 6), (9, 6), (22, 6), (23, 6), (26, 7)]:
        put(L, "decoration", x, y, tid("tp_deco_sandbag"))
    for (x, y) in [(3, 12), (8, 12), (20, 12), (26, 12)]:
        put(L, "decoration", x, y, tid("tp_deco_barricade"))
    for (x, y) in [(11, 6), (24, 6)]:
        put(L, "decoration", x, y, tid("tp_deco_cannon"))
    for (x, y) in [(2, 5), (17, 13), (21, 13)]:
        put(L, "decoration", x, y, tid("tp_deco_tent"))
    for (x, y) in [(6, 7), (27, 5)]:
        put(L, "decoration", x, y, tid("tp_deco_banner"))
    for (x, y) in [(7, 7), (19, 7), (25, 11)]:
        put(L, "decoration", x, y, tid("tp_deco_barrel"))
    objects = [
        {"id": "obj_tp_battle_01", "kind": "pickup", "x": 6, "y": 9, "label": "弹药箱", "payload": "crate"},
        {"id": "obj_tp_battle_02", "kind": "pickup", "x": 18, "y": 5, "label": "火药", "payload": "crate"},
        {"id": "obj_tp_battle_03", "kind": "prop", "x": 10, "y": 10, "label": "遗骸", "payload": "skulls"},
        {"id": "obj_tp_battle_04", "kind": "prop", "x": 22, "y": 11, "label": "拒马残骸", "payload": "spikes"},
    ]
    return L, objects, {"x": 3, "y": 9}, 4, True


SCENES = [
    {
        "id": "map_ch00_tp_village", "short": "village",
        "scene_type": "村落（山地村寨）", "name": "金田村 · 山地村道",
        "year": "1851 · 金田起义", "purpose": "护送 / 探索（从左到右的走廊，找物资、对话、护送家眷）",
        "node_hint": "nd_1851_jintian_escort", "builder": build_village,
        "bounds": "可玩区 x=1..28, y=2..13；上下各 2 行山林 + 左右各 1 列为实心边界",
        "special": "主路 y=7..9 三格宽全通，右端 x=27/28 可达（护送终点）",
    },
    {
        "id": "map_ch00_tp_city", "short": "city",
        "scene_type": "城池（都城街市）", "name": "天京城 · 街市与天王府",
        "year": "1853 · 定都天京", "purpose": "经营 / 管理 / 对话（圣库、粮秣、街市；经营面板覆盖时角色冻结）",
        "node_hint": "nd_1853_tianjing_manage", "builder": build_city,
        "bounds": "可玩区 x=1..28, y=1..12；四边城墙实心，y=14 护城河实心，x=14/15 有木桥",
        "special": "横街 y=7..9 与纵街 x=14..15 十字贯通；王府门洞 (20,6) 可进入",
    },
    {
        "id": "map_ch00_tp_battlefield", "short": "battlefield",
        "scene_type": "战场（城墙夜战）", "name": "天京城墙 · 城破之夜",
        "year": "1864 · 天京陷落", "purpose": "Boss 战 / 守城（湘军统领 + 洋枪队队长；掩体与炮位）",
        "node_hint": "nd_1864_tianjing_fall", "builder": build_battlefield,
        "bounds": "可玩区 x=1..28, y=5..14；y=0..3 远景带（透明 + 实心），y=4 城墙残段中央有缺口",
        "special": "sky_rows=4 + battle_scars=true；右侧 x>=16 留开阔地供敌人出生",
    },
]


# ---------------------------------------------------------------- 校验
CONTROL_LAYOUT = {
    "stick": (56, 200, 34), "attack": (404, 192, 26), "cannon": (330, 222, 24),
    "dodge": (440, 244, 18), "interact": (240, 240, 18),
}
SUNNY_PROPS = {"crate", "bigCrate", "block", "blockBig", "door", "doorOpened", "rock",
               "bush", "skulls", "spikeSkull", "sign", "shrooms", "spikes"}


def validate(m: dict, L: dict) -> None:
    mid = m["id"]
    g = m["layers"][0]["data"]
    col = m["layers"][1]["data"]
    colors = m["tile_colors"]
    # 1. 尺寸、瓦片号、颜色
    assert m["width"] == W and m["height"] == H, f"{mid} 尺寸不是 {W}x{H}"
    for row in g:
        for v in row:
            assert v != 0 and str(v) in colors, f"{mid} 出现未定义瓦片号 {v}"
    # 2. 边界整圈实心
    for x in range(W):
        assert col[0][x] and col[H - 1][x], f"{mid} 上下边界漏了 ({x})"
    for y in range(H):
        assert col[y][0] and col[y][W - 1], f"{mid} 左右边界漏了 ({y})"
    # 3. sky_rows 行必须全实心（art.test.ts 同名断言）
    sky = m.get("sky_rows", 0)
    for y in range(sky):
        assert all(v != 0 for v in col[y]), f"{mid} 第 {y} 行远景带可走"
    # 4. 出生点
    sx, sy = m["spawn"]["x"], m["spawn"]["y"]
    assert 0 <= sx < W and 0 <= sy < H and not col[sy][sx], f"{mid} 出生点在实心格上"
    # 5. BFS 可达：物件四邻 / 右侧 55% 敌人出生 / 护送右端
    seen, stack = set(), [(sx, sy)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < W and 0 <= y < H) or col[y][x]:
            continue
        seen.add((x, y))
        stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    for o in m["objects"]:
        nb = [(o["x"], o["y"]), (o["x"] + 1, o["y"]), (o["x"] - 1, o["y"]),
              (o["x"], o["y"] + 1), (o["x"], o["y"] - 1)]
        assert any(p in seen for p in nb), f"{mid} 物件 {o['id']} 走不到"
        if o["kind"] == "prop":
            assert o.get("payload") in SUNNY_PROPS, f"{mid} 布景 payload 未登记：{o.get('payload')}"
        # 虚拟按键避让（单屏地图，世界坐标 == 屏幕坐标）
        cx, cy = (o["x"] + 0.5) * TS, (o["y"] + 0.5) * TS
        margin = 8 + (10 if o["kind"] == "pickup" else 0)
        for bx, by, r in CONTROL_LAYOUT.values():
            assert math.hypot(cx - bx, cy - by) > r + margin, f"{mid} 物件 {o['id']} 压在虚拟按键下"
    min_col = math.floor(W * 0.55)
    spawns = sum(1 for x in range(min_col, W - 1) for y in range(2, H - 3)
                 if not col[y][x] and not col[y + 1][x])
    assert spawns > 0, f"{mid} 右侧 55% 之后没有敌人出生点"
    if m["meta"]["scene_type"].startswith("村落"):
        assert any((x, y) in seen for x in (W - 3, W - 2, W - 1) for y in range(H)), f"{mid} 护送右端不可达"
    # 6. 四层折叠一致性
    g2, c2 = fold(L)
    assert g2 == g and c2 == col, f"{mid} 四层折叠结果与引擎数据不一致"
    print(f"[ok] {mid}: solid={sum(v for r in col for v in r)} reachable={len(seen)} enemySpawn={spawns}")


# ---------------------------------------------------------------- 预览图
def render_map_png(L: dict, view: str, sky: int = 0) -> Img:
    """view: terrain / building / decoration / collision；sky 行模拟引擎的远景带（不画地面）。"""
    out = Img(W * TS, H * TS, "ink")
    terrain, building, decoration, col = L["terrain"], L["building"], L["decoration"], L["collision"]
    sky_bands = ["ink", "night", "plumDark", "indigo"]
    for y in range(H):
        for x in range(W):
            if y < sky:
                # 引擎在 sky_rows 上不画地砖，由 LevelScene 叠 480x64 远景条；预览用夜空色替代
                out.rect(x * TS, y * TS, TS, TS, C(sky_bands[min(y, 3)]))
                if (x * 7 + y * 11) % 13 == 0:
                    out.dot(x * TS + 4, y * TS + 5, C("star"))
                    out.dot(x * TS + 11, y * TS + 10, C("greyLight"))
            else:
                t = terrain[y][x]
                if view in ("building", "decoration", "collision") and building[y][x]:
                    t = building[y][x]
                if view in ("decoration", "collision") and decoration[y][x]:
                    t = decoration[y][x]
                if not t:
                    t = tid("tp_terrain_grass_00")
                out.blit(TILE_IMGS[t], x * TS, y * TS)
            if view == "collision" and col[y][x]:
                out.overlay_rect(x * TS, y * TS, TS, TS, C("red"), 0.45)
    return out


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def main():
    build_tiles()
    cfg = build_tileset_json()
    preview = {}
    maps_meta = []
    for s in SCENES:
        L, objects, spawn, sky, scars = s["builder"]()
        g, col = fold(L)
        m = {
            "id": s["id"], "width": W, "height": H, "tileset": "tp_act2",
            "tile_colors": {str(t["id"]): t["engine_hex"] for t in TILES},
            "spawn": spawn,
            "layers": [
                {"name": "ground", "data": g, "collidable": False},
                {"name": "collision", "data": col, "collidable": True},
            ],
            "triggers": [], "objects": objects,
        }
        if sky:
            m["sky_rows"] = sky
        if scars:
            m["battle_scars"] = True
        m["meta"] = {
            "scene_type": s["scene_type"], "scene_name": s["name"], "year": s["year"],
            "act": "ch00_act2", "purpose": s["purpose"], "node_hint": s["node_hint"],
            "bounds": s["bounds"], "special": s["special"],
            "tileset": "tp_act2",
            "grid": {"tile_px": TS, "cols": W, "rows": H, "world_px": [W * TS, H * TS]},
            "layer_map": {
                "terrain": "ground.data（底图）", "building": "ground.data（覆盖非零格）",
                "decoration": "ground.data（覆盖非零格） + objects[] 布景",
                "collision": "collision.data（0/1）", "foreground": "禁用（会遮挡角色）",
            },
            "source_layers": f"art/tiles/tp/layers/{s['id']}.layers.json",
            "generator": "tools/gen_taiping_tilemap.py", "version": "1.0",
        }
        validate(m, L)
        (MAP_DIR / f"{s['id']}.json").write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
        # 四层编辑源
        src = {
            "map_id": s["id"], "tileset": "tp_act2",
            "size": {"cols": W, "rows": H, "tile_px": TS},
            "layers": [
                {"name": "terrain", "cn": "地形", "collidable": False, "data": L["terrain"]},
                {"name": "building", "cn": "建筑", "collidable": "per_tile", "data": L["building"]},
                {"name": "decoration", "cn": "装饰", "collidable": "per_tile", "data": L["decoration"]},
                {"name": "collision", "cn": "碰撞", "collidable": True, "data": L["collision"]},
            ],
            "fold_rule": cfg["layer_fold_rule"],
            "engine_output": f"data/maps/{s['id']}.json",
        }
        (LAYER_DIR / f"{s['id']}.layers.json").write_text(json.dumps(src, ensure_ascii=False, indent=2), encoding="utf-8")
        # 四个图层视图预览
        views = {}
        for view in ("terrain", "building", "decoration", "collision"):
            p = TILE_DIR / f"preview_{s['short']}_{view}.png"
            write_png(p, W * TS, H * TS, render_map_png(L, view, sky).buf)
            views[view] = b64(p)
        preview[s["short"]] = views
        maps_meta.append({k: s[k] for k in ("id", "short", "scene_type", "name", "year", "purpose", "node_hint", "bounds", "special")} |
                         {"spawn": spawn, "sky_rows": sky, "battle_scars": scars,
                          "solid": sum(v for r in col for v in r),
                          "objects": len(objects)})
        print(f"[map ] {s['id']}.json + 四层编辑源 + 4 张预览")

    write_html(cfg, preview, maps_meta)
    print("[done] 全部产出完成")


# ---------------------------------------------------------------- HTML 预览
def write_html(cfg, preview, maps_meta):
    sheet = b64(TILE_DIR / "tp_act2_sheet.png")
    tiles = [{k: t[k] for k in ("id", "name", "cn", "category", "scenes", "collidable",
                                "engine_hex", "render_style_hint", "note", "sheet_cell")}
             for t in cfg["tiles"]]
    data = {"tiles": tiles, "palette": cfg["palette"], "maps": maps_meta,
            "layerNames": {"terrain": "地形", "building": "+ 建筑", "decoration": "+ 装饰", "collision": "+ 碰撞"}}
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    imgs = json.dumps(preview).replace("</", "<\\/")
    html = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>太平天国篇章 · 瓦片地图包</title>
<style>
:root{--bg:#f7f6f3;--card:#fff;--line:#e2ded6;--ink:#23202a;--muted:#6b6572;--accent:#8c1c1c;--gold:#d4a840}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 -apple-system,"Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:32px 24px 64px}
h1{font-size:27px;margin:0 0 6px;letter-spacing:.5px}h2{font-size:19px;margin:36px 0 14px;padding-left:11px;border-left:4px solid var(--accent)}
.lead{color:var(--muted);margin:0 0 22px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi b{display:block;font-size:22px;color:var(--accent);line-height:1.2}.kpi span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);font-size:13px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{background:#f0ede7;font-weight:600}
.tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;background:#eee9df;color:#5c5548;margin-right:4px}
.tag.t{background:#e6f0dc;color:#3f6b25}.tag.b{background:#e5e2f0;color:#4a4468}.tag.d{background:#f7e7d8;color:#8a5a25}
.scene{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:18px}
.scene h3{margin:0 0 4px;font-size:17px}.scene .sub{color:var(--muted);font-size:12px;margin-bottom:12px}
.tabs{display:flex;gap:6px;margin:12px 0 10px}.tabs button{cursor:pointer;border:1px solid var(--line);background:#faf9f6;color:var(--ink);
padding:5px 13px;border-radius:6px;font-size:12px}.tabs button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.mapimg{width:960px;max-width:100%;height:auto;image-rendering:pixelated;border:1px solid var(--line);background:#0d0b14}
.sheet-grid{display:grid;grid-template-columns:repeat(9,1fr);gap:8px}
.tilecard{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px;text-align:center}
.tile{width:64px;height:64px;margin:0 auto 6px;background-image:url(data:image/png;base64,__SHEET__);
background-repeat:no-repeat;background-size:512px 320px;image-rendering:pixelated;border:1px solid var(--line)}
.tilecard .id{font-size:11px;color:var(--muted)}.tilecard .nm{font-size:11px;font-weight:600;line-height:1.3}
.tilecard .hex{font:10px monospace;color:var(--muted)}
.swatches{display:flex;flex-wrap:wrap;gap:6px}.sw{width:62px;text-align:center;font:10px monospace}
.sw i{display:block;height:26px;border:1px solid var(--line);border-radius:4px}
pre{background:#f3f1ec;border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font:12px/1.6 Consolas,monospace}
.note{background:#fbf4e6;border:1px solid #e8d9b0;border-radius:8px;padding:12px 14px;font-size:13px}
.small{font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">
<h1>太平天国篇章 · 瓦片地图包 v1.0</h1>
<p class="lead">党史像素 RPG · 序章第二幕（1851—1864）｜引擎：Phaser 3 + TypeScript｜生成脚本 <code>game/tools/gen_taiping_tilemap.py</code></p>
<div class="cards" id="kpi"></div>
<h2>一、场景类型与关卡用途</h2>
<table id="sceneTable"></table>
<h2>二、图层结构：四层编辑源 → 引擎两层</h2>
<table><tr><th>逻辑层</th><th>内容</th><th>落地到 MapDef</th><th>碰撞</th></tr>
<tr><td><span class="tag t">L0</span> 地形 terrain</td><td>草地 / 土路 / 稻田 / 石板 / 城墙砖 / 水 / 焦土</td><td><code>layers[0].name = "ground"</code>（底图）</td><td>否</td></tr>
<tr><td><span class="tag b">L1</span> 建筑 building</td><td>村舍 / 城墙 / 城门 / 箭楼 / 王府 / 铺面 / 粮仓 / 木桥</td><td>覆盖 ground 同格瓦片号</td><td>逐瓦片（多数阻挡）</td></tr>
<tr><td><span class="tag d">L2</span> 装饰 decoration</td><td>松 / 竹 / 旗 / 灯笼 / 箱桶 / 沙袋 / 拒马 / 炮位 / 营帐</td><td>覆盖 ground 同格瓦片号 + <code>objects[]</code> 布景</td><td>逐瓦片（掩体阻挡）</td></tr>
<tr><td>L3 碰撞 collision</td><td>边界 + 建筑 + 阻挡装饰的并集，0/1</td><td><code>layers[1].name = "collision"</code></td><td>是</td></tr>
<tr><td colspan="4"><b>foreground 层禁用</b>：设计书 10 号规定它会挡住角色；远景用 <code>sky_rows</code> 交给 LevelScene 叠远景条。</td></tr></table>
<div class="note">折叠规则：<code>ground = terrain → building 非零覆盖 → decoration 非零覆盖</code>；<code>collision</code> 取各层 <code>collidable</code> 瓦片并集。四层原始数组保存在 <code>public/art/tiles/tp/layers/*.layers.json</code>，美术改完重跑生成器即可得到引擎 JSON。</div>
<h2>三、地图预览（点击切换图层）</h2>
<div id="maps"></div>
<h2>四、图块集（36 张 16×16，8 列拼版，24 色锁定）</h2>
<p class="small">缩略图由 <code>tp_act2_sheet.png</code> 按 sheet_cell 切出并放大 4 倍。<code>engine_hex</code> 同时写进地图的 <code>tile_colors</code>，<code>render_style_hint</code> 是现有 MapRenderer.tileStyleOf() 的推断材质。</p>
<div class="sheet-grid" id="sheet"></div>
<h2>五、24 色锁定调色板 v2</h2>
<div class="swatches" id="palette"></div>
<h2>六、命名与文件组织</h2>
<pre>game/
  public/data/maps/
    map_ch00_tp_village.json         村落 · 金田村（护送）
    map_ch00_tp_city.json            城池 · 天京城（经营）
    map_ch00_tp_battlefield.json     战场 · 天京城墙夜战（Boss）
  public/art/tiles/tp/
    tp_terrain_&lt;名&gt;_&lt;两位变体&gt;.png     地形，id 1-12
    tp_building_&lt;名&gt;.png                 建筑，id 13-24
    tp_deco_&lt;名&gt;.png                     装饰，id 25-36
    tp_act2_sheet.png                    8 列拼版（id 0 = 透明）
    tileset.json                         Tiled / 引擎双兼容配置
    layers/&lt;map_id&gt;.layers.json          四层编辑源
    preview_&lt;scene&gt;_&lt;layer&gt;.png          图层预览（12 张）
  tools/gen_taiping_tilemap.py        唯一生成源
design/
  12_taiping_tilemap_spec.md          规格说明书
  taiping_tilemap_preview.html        本页</pre>
<div class="note"><b>命名规则</b>：<code>tp_&lt;类别&gt;_&lt;语义&gt;[_两位变体]</code>，全小写 snake_case；地图 <code>map_ch00_tp_&lt;场景&gt;</code>；物件 <code>obj_tp_&lt;场景&gt;_&lt;两位序号&gt;</code>。id 0 恒为透明空瓦片，1..36 与 <code>tile_colors</code> 键一一对应，禁止复用或跳号。</div>
<h2>七、接入状态（v1.1 已上线）</h2>
<pre>// 1) 第二幕三个节点已换图（game/public/data/nodes/nodes_ch00.json）
nd_1851_jintian_escort  -&gt; map_ch00_tp_village      (escort)
nd_1853_tianjing_manage -&gt; map_ch00_tp_city         (management)
nd_1864_tianjing_fall   -&gt; map_ch00_tp_battlefield  (combat)

// 2) acts/ch00_act2.json 的 map_refs 同步为上面三张
// 3) LevelScene.preload() 预载 ART.tpSheet；MapRenderer.drawGround() 在
//    tileset === "tp_act2" 时按 sheet_cell 从拼版取 16x16 帧；
//    旧图 tileset === "placeholder" 保持程序化材质不变</pre>
<p class="small">36 张真瓦片 PNG 已在引擎生效（规格书第 8.3 节）。图集缺失或帧号越界会自动回退到 <code>tile_colors</code> 程序化材质，不会黑屏；<code>tests/art.test.ts</code> 有断言锁住图集尺寸、帧号范围与三张地图的 <code>tileset</code> 声明。</p>
<h2>八、边界与硬性约束</h2>
<table><tr><th>项</th><th>值</th><th>依据</th></tr>
<tr><td>瓦片 / 网格</td><td>16×16 px；30 列 × 16 行 = 480×256 px，单屏不滚动</td><td><code>constants.ts</code> TILE / FIELD_COLS / FIELD_ROWS</td></tr>
<tr><td>坐标范围</td><td>格 x=0..29, y=0..15；世界 x=0..479, y=0..255；外圈 1 格实心</td><td>MapRenderer.isSolidAtWorld 越界视为实心</td></tr>
<tr><td>通道净宽</td><td>≥ 2 格（32 px），推荐 3 格；角色 24×32，脚底四角采样</td><td>Player.moveWithCollision / footBlocked</td></tr>
<tr><td>出生点</td><td>村落 (2,8)、城池 (13,8)、战场 (3,9)，均非实心</td><td>data.test.ts</td></tr>
<tr><td>远景带</td><td>战场 <code>sky_rows=4</code>，0..3 行透明且碰撞全实心</td><td>art.test.ts / HORIZON_ROWS=4</td></tr>
<tr><td>残破贴花</td><td>仅战场 <code>battle_scars=true</code>（村道/城池不加）</td><td>MapRenderer.paintScars</td></tr>
<tr><td>物件避让</td><td>物件中心离虚拟按键圆心 &gt; r + 8（pickup 再 +10）</td><td>CONTROL_LAYOUT / data.test.ts</td></tr>
<tr><td>布景 payload</td><td>只能取 SUNNY_PROPS 表内名字（rock / sign / skulls / spikes…）</td><td>art.test.ts</td></tr>
</table>
</div>
<script>
const D=__DATA__, IMG=__IMGS__;
document.getElementById('kpi').innerHTML=[
 ['16 × 16','瓦片像素'],['30 × 16','网格 / 单屏 480×256'],['36','瓦片类型（3 类）'],['4 → 2','逻辑层 → 引擎层']
].map(x=>`<div class="kpi"><b>${x[0]}</b><span>${x[1]}</span></div>`).join('');
document.getElementById('sceneTable').innerHTML='<tr><th>地图 ID</th><th>场景类型 / 名称</th><th>史实时点</th><th>关卡用途</th><th>建议节点</th><th>出生点</th><th>边界 / 特殊</th></tr>'+
 D.maps.map(m=>`<tr><td><code>${m.id}</code></td><td><b>${m.scene_type}</b><br>${m.name}</td><td>${m.year}</td><td>${m.purpose}</td><td><code>${m.node_hint}</code></td><td>(${m.spawn.x}, ${m.spawn.y})</td><td>${m.bounds}<br><span class="small">${m.special}${m.sky_rows?' · sky_rows='+m.sky_rows:''}${m.battle_scars?' · battle_scars':''}</span></td></tr>`).join('');
document.getElementById('sheet').innerHTML=D.tiles.map(t=>{
 const p=-t.sheet_cell.col*64, q=-t.sheet_cell.row*64;
 const tag=t.category==='terrain'?'t':t.category==='building'?'b':'d';
 return `<div class="tilecard"><div class="tile" style="background-position:${p}px ${q}px"></div>
 <div class="id">#${t.id} <span class="tag ${tag}">${t.category}</span>${t.collidable?'⛔':''}</div>
 <div class="nm">${t.cn}</div><div class="hex">${t.engine_hex}</div><div class="small">${t.name.replace('tp_terrain_','T·').replace('tp_building_','B·').replace('tp_deco_','D·')}</div></div>`;
}).join('');
document.getElementById('palette').innerHTML=Object.entries(D.palette).map(([k,v])=>`<div class="sw"><i style="background:${v}"></i>${v}<br>${k}</div>`).join('');
document.getElementById('maps').innerHTML=D.maps.map((m,i)=>`<div class="scene"><h3>${m.scene_type} · ${m.name}</h3>
 <div class="sub">${m.year} ｜ ${m.purpose} ｜ 阻挡格 ${m.solid} ｜ 可交互物 ${m.objects} ｜ ${m.bounds}</div>
 <div class="tabs" data-map="${i}">${Object.entries(D.layerNames).map(([k,v],j)=>`<button data-view="${k}" class="${j===2?'on':''}">${v}</button>`).join('')}</div>
 ${Object.keys(D.layerNames).map(k=>`<img class="mapimg" data-map="${i}" data-view="${k}" style="display:${k==='decoration'?'block':'none'}" src="data:image/png;base64,${IMG[m.short][k]}" alt="${m.short} ${k}">`).join('')}
 </div>`).join('');
document.querySelectorAll('.tabs').forEach(box=>box.addEventListener('click',e=>{
 const b=e.target.closest('button'); if(!b)return; const mi=box.dataset.map,v=b.dataset.view;
 box.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
 document.querySelectorAll(`img.mapimg[data-map="${mi}"]`).forEach(im=>im.style.display=im.dataset.view===v?'block':'none');
}));
</script></body></html>"""
    html = (html.replace("__SHEET__", sheet).replace("__DATA__", payload).replace("__IMGS__", imgs))
    (DESIGN / "taiping_tilemap_preview.html").write_text(html, encoding="utf-8")
    print(f"[html] design/taiping_tilemap_preview.html ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
