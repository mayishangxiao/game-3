"""
按 w/h 表自动铺 Sunny Land 静态布景（找不到人肉布点时的省事版）。

为什么不人肉布点：30×16 的图有 480 格，肉眼挑「空地上、不压碰撞、不挡出口」的位置
要么漏要么压墙。这个脚本把规则写死，跑一遍就知道能放几件、放哪。

规则（按顺序筛）：
  1. 该格**可站**（碰撞层是 '.'）——布景不能埋进墙里/海里；
  2. 该格不在 `sky_rows` 远景带里（act1b 的顶 6 行是海与远帆，压了会像悬空）；
  3. 离已有物件（pickup / deposit / npc / exit / prop）至少 1 格，别和销烟池、出口撞脸；
  4. 同一种布景密度限流：每 100 格最多 3 件，避免变成「乐高堆」；
  5. 全部小件（rock/skulls/shrooms/spikes），大件（bigCrate/blockBig/door）不自动放——
     大件会把通道堵成视觉障碍物，必须人肉看截图定。

输出直接改 `game/public/data/maps/map_ch00_act1a.json` 的 objects（UTF-8 无 BOM，幂等）。
用法：python art_ref/autoplace_props.py [--dry]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / "game" / "public" / "data" / "maps" / "map_ch00_act1a.json"

SCENERY = {"rock": 2, "skulls": 2, "shrooms": 2, "spikes": 2}


def solid_rows(layer: list[str]) -> list[str]:
    return [str(r) for r in layer]


def find_layer(d: dict, name: str, names: list[str]) -> list[list[int]] | None:
    """碰撞层实际长这样：{"name": "collision", "data": [[0,0,3,...], ...]}，数字 **0 = 可走**。

    第一版按 rows 里的 '#'/'.' 字符串去读，读了个空列表，于是「可放 0 件」——
    这种错很安静（脚本照样 exit 0），所以这里找不到就直接抛。
    """
    for layer in d.get("layers", []):
        if layer.get("name") == name or str(layer.get("name", "")).lower() in names:
            data = layer.get("data")
            if not data or not isinstance(data[0], list):
                raise SystemExit(f"碰撞层 {name} 的 data 不是二维数组")
            return data
    return None


def main() -> int:
    dry = "--dry" in sys.argv
    d = json.loads(MAP.read_text(encoding="utf-8"))
    w, h = d["width"], d["height"]

    # 碰撞层：行是 '#'/'.' 之类的字符串；MapRenderer 认 '#'、'1'… 为实心，这里只认 '#' 与数字
    collision = find_layer(d, "collision", ["collision", "walls", "block", "碰撞"])
    if collision is None:
        print("找不到碰撞层")
        return 2
    sky = int(d.get("sky_rows") or 0)

    taken = {(o["x"], o["y"]) for o in d.get("objects", [])}
    near = set()
    for (x, y) in taken:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                near.add((x + dx, y + dy))

    placed = []
    for name, cap in SCENERY.items():
        n = 0
        picks: list[tuple[int, int]] = []
        for y in range(max(sky, 1), h):
            if n >= cap:
                break
            row = collision[y]
            for x in range(1, w - 1):
                if n >= cap:
                    break
                if row[x] != 0:
                    continue
                if (x, y) in near or (x, y) == (d["spawn"]["x"], d["spawn"]["y"]):
                    continue
                # 「贴地」才像布景：脚下那一格必须是实心地面（碰撞非 0），否则悬在空中像平台。
                # act1a 的碰撞层只在第 3 行（海水）与零星礁石上非 0，所以候选全挤在第 3 行——
                # 这是数据决定的，不是 bug；想多点位置就得先改地图碰撞。
                if y + 1 >= h or collision[y + 1][x] == 0:
                    continue
                picks.append((x, y))
                n += 1
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        near.add((x + dx, y + dy))
        # 铺在贴地行上时往均匀里挑：按 x 排序后等距取，避免全挤在左半边
        if len(picks) > cap:
            step = len(picks) / cap
            picks = [picks[int(i * step)] for i in range(cap)]
        placed += [{"kind": "prop", "payload": name, "x": x, "y": y} for (x, y) in picks]

    print(f"可放 {len(placed)} 件：", [(p["payload"], p["x"], p["y"]) for p in placed])
    if dry:
        return 0

    objs = [o for o in d.get("objects", []) if not (o.get("kind") == "prop" and o.get("payload") in SCENERY)]
    d["objects"] = objs + placed
    MAP.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("已写回", MAP)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())