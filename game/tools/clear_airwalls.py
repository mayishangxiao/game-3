#!/usr/bin/env python3
"""清除地图里的「孤立空气墙」：场地内部四邻皆空的单格阻挡。

背景：现行地图的实心格多数对应看得见的墙 / 建筑 / 装置，但内部散落的单格
装置（路灯、石狮、木箱、掩体）会挡住去路却和地面装饰混在一起，玩家撞上去
只会以为卡住。本脚本把这类**完全孤立**的阻挡连同其瓦片一起清掉，让通道开阔。

严格保留（这些不是空气墙，删了会穿墙 / 掉出地图 / 破坏关卡）：
  · 最外圈边界（含 MapRenderer 的越界实心兜底）
  · 销烟池碰撞值 6/7 的 28 格
  · 海战图 map_ch00_act3_sea（整图跳过，海面 = 不可走的蓝）
  · sky_rows 声明的远景行
  · objects 所在格（交互物不能被掏空）

用法：
  python tools/clear_airwalls.py          # 就地清理并打印每图清掉的格数
  python tools/clear_airwalls.py --check  # 只报告，不改文件（CI / 回归用）
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / "public" / "data" / "maps"

# 海面本身就是「蓝 = 不可走」，它的孤立格是浪里的礁石，不是空气墙。
SKIP_MAPS = {"map_ch00_act3_sea.json"}
# 销烟池：碰撞层 6（木框）/ 7（石灰），共 7×4 = 28 格，历史测试锁死。
POOL_TILES = {6, 7}

CHECK_ONLY = "--check" in sys.argv


def neighbour_solid(col: list[list[int]], x: int, y: int) -> bool:
    h, w = len(col), len(col[0])
    return any(col[ny][nx] for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
               if 0 <= nx < w and 0 <= ny < h)


def ground_neighbour(layer: list[list[int]], x: int, y: int, avoid: set[int], fallback: int) -> int:
    """给被清掉的格补一块邻居地面；四周都是装置时用全场最常见的地面瓦片，绝不留透明洞。"""
    h, w = len(layer), len(layer[0])
    for nx, ny in ((x, y - 1), (x, y + 1), (x - 1, y), (x + 1, y)):
        if 0 <= nx < w and 0 <= ny < h:
            v = layer[ny][nx]
            if v and v not in avoid:
                return v
    return fallback


def clear_one(path: Path) -> tuple[int, list[tuple[int, int]]]:
    raw = path.read_text(encoding="utf-8")
    d = json.loads(raw)
    if path.name in SKIP_MAPS:
        return 0, []
    layers = {l["name"]: l for l in d.get("layers", [])}
    col_layer = next((l for l in d.get("layers", []) if l["name"] == "collision" and l.get("collidable")), None)
    if col_layer is None:
        return 0, []
    col = col_layer["data"]
    sky = int(d.get("sky_rows", 0) or 0)
    h, w = len(col), len(col[0])
    occupied = {(int(o.get("x", -1)), int(o.get("y", -1))) for o in d.get("objects", [])}
    # 装置瓦片值：清格时要记下来，别拿另一块装置去补地面
    solid_values = {v for row in col for v in row if v}
    # 某类装置在整张图只剩一个时是叙事道具（会馆灯笼 / 武昌军旗），清掉会破坏关卡身份
    counts: dict[int, int] = {}
    for layer in d["layers"]:
        if layer["name"] == "collision":
            continue
        for row in layer["data"]:
            for v in row:
                if v:
                    counts[v] = counts.get(v, 0) + 1

    targets: list[tuple[int, int]] = []
    for y in range(max(1, sky), h - 1):
        for x in range(1, w - 1):
            if not col[y][x] or col[y][x] in POOL_TILES or (x, y) in occupied:
                continue
            if neighbour_solid(col, x, y):
                continue
            on_top = {layer["data"][y][x] for layer in d["layers"]
                      if layer["name"] != "collision" and layer["data"][y][x]}
            if any(counts.get(v, 0) <= 1 for v in on_top):
                continue
            targets.append((x, y))

    if not targets or CHECK_ONLY:
        return len(targets), targets

    # 被装置完全包围时用「全场最常见的非装置地面」补格。
    ground_layer = next((l["data"] for l in d["layers"] if l["name"] == "ground"), None)
    fallback = 0
    if ground_layer:
        plain: dict[int, int] = {}
        for y in range(h):
            for x in range(w):
                v = ground_layer[y][x]
                if v and v not in solid_values and not (col[y][x] and v in POOL_TILES):
                    plain[v] = plain.get(v, 0) + 1
        if plain:
            fallback = max(plain, key=plain.get)

    for x, y in targets:
        # counts 必须边清边减：两个同类装置都孤立时，静态统计会以为对方还在，
        # 结果两个都被清掉，唯一留存的叙事道具（武昌军旗）就这么消失了。
        on_top = {layer["data"][y][x] for layer in d["layers"]
                  if layer["name"] != "collision" and layer["data"][y][x]}
        if any(counts.get(v, 0) <= 1 for v in on_top):
            continue
        col[y][x] = 0
        for v in on_top:
            counts[v] -= 1
        # 多层地图（tp_*）：terrain 保留，building / decoration 上的装置清掉即可。
        # 单层 ground：用上方 / 下方邻居的地面瓦片补回；补不到就撤销这一格。
        for layer in d["layers"]:
            if layer["name"] == "collision":
                continue
            data = layer["data"]
            v = data[y][x]
            if v in POOL_TILES or layer["name"] == "terrain":
                continue
            if layer["name"] in ("building", "decoration"):
                data[y][x] = 0
            else:
                data[y][x] = ground_neighbour(data, x, y, solid_values, fallback or v)

    out = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    if out != raw:
        path.write_text(out, encoding="utf-8", newline="\n")
    return len(targets), targets


def main() -> int:
    total = 0
    for path in sorted(MAPS.glob("map_*.json")):
        n, cells = clear_one(path)
        if n:
            total += n
            print(f"{'WOULD CLEAR' if CHECK_ONLY else 'cleared':11s} {path.name:34s} {n:3d}  {cells[:6]}")
    verb = "found" if CHECK_ONLY else "cleared"
    print(f"{verb} {total} isolated blockers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
