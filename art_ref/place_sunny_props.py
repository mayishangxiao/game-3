# -*- coding: utf-8 -*-
"""
把 Sunny Land 静态布景写进地图 JSON（`kind:'prop'` + payload=道具名）。

纪律：
  * 只用 Python 写 JSON（UTF-8 无 BOM）——PowerShell 的 Set-Content 会写 BOM，JSON.parse 直接炸。
  * 幂等：先删掉所有「payload 在 SUNNY_PROPS 里」的旧条目，再按 RELIEF 重铺。
  * 不碰碰撞层、不碰人群（door_N）、不碰 pickup/exit/npc——布景只画不挡路（见 LevelScene.spawnSunnyProp）。
  * 只摆在碰撞层的空地（`. `）上：压在墙上会让"石头从墙里长出来"。
"""
import json
import os

ROOT = r'D:\game_project\game 3\game\public\data\maps'
NAMES = {
    'crate', 'bigCrate', 'block', 'blockBig', 'door', 'doorOpened', 'rock',
    'bush', 'skulls', 'spikeSkull', 'sign', 'shrooms', 'spikes',
}

# 布景表：地图 → [(x, y, 道具名)]
RELIEF = {
    # 虎门销烟现场：木头栏杆、石墩、灌木，绕着销烟池摆一圈（池子在 18,10；人群在 14–22 行 7–12）
    'map_ch00_act1a.json': [
        (6, 13, 'sign'), (4, 9, 'bush'), (5, 5, 'blockBig'), (8, 15, 'rock'),
        (14, 4, 'bush'), (23, 4, 'bush'), (25, 4, 'sign'), (27, 8, 'crater'),
        (23, 15, 'blockBig'), (19, 15, 'shrooms'), (9, 6, 'bigCrate'),
        (2, 9, 'shrooms'), (13, 14, 'skulls'), (26, 12, 'skulls'),
    ],
    # 海滩：礁石 + 枯骨 + 尖刺（顶 6 行是远景带，别铺到那里去）
    'map_ch00_act1b.json': [
        (5, 12, 'rock'), (9, 13, 'rock'), (13, 12, 'rock'), (17, 13, 'rock'),
        (6, 9, 'bush'), (21, 9, 'bush'), (22, 12, 'bush'),
        (11, 9, 'skulls'), (15, 10, 'spikeSkull'), (19, 14, 'skulls'),
        (4, 14, 'spikes'), (20, 11, 'spikes'), (10, 6, 'bush'),
    ],
    # 兵营：木箱 / 石台 / 路牌
    'map_ch00_act2a.json': [
        (5, 10, 'crate'), (6, 10, 'crate'), (20, 5, 'block'), (21, 5, 'block'),
        (12, 4, 'sign'), (24, 11, 'blockBig'), (9, 12, 'shrooms'),
    ],
    # 炮台暗道：石门 + 骷髅
    'map_ch00_act2b.json': [
        (16, 12, 'door'), (19, 12, 'doorOpened'), (7, 6, 'skulls'),
        (24, 6, 'spikeSkull'), (12, 12, 'block'), (22, 12, 'block'),
    ],
    # 副本 1：租界暗巷（只能摆在可走的那几行：2–5）
    'map_dg01_alley.json': [
        (12, 3, 'crate'), (13, 3, 'crate'), (2, 5, 'skulls'), (27, 5, 'skulls'),
        (9, 2, 'blockBig'), (21, 2, 'blockBig'), (25, 2, 'rocks'),
    ],
    # 副本 2：匪寨
    'map_dg02_bandit.json': [
        (7, 12, 'bigCrate'), (8, 12, 'crate'), (22, 6, 'bush'), (24, 12, 'bush'),
        (14, 3, 'sign'), (5, 4, 'skulls'), (18, 13, 'skulls'), (26, 9, 'shrooms'),
    ],
    # 副本 3：码头
    'map_dg03_dock.json': [
        (10, 4, 'bigCrate'), (11, 4, 'crate'), (20, 12, 'crate'), (21, 12, 'crate'),
        (6, 4, 'rock'), (26, 3, 'rock'), (16, 14, 'skulls'), (3, 11, 'shrooms'),
    ],
}

ALIAS = {'crater': 'rock', 'rocks': 'rock'}

# 判定「墙顶」要看地面层：碰撞层只说「能不能走」，地面层才说「这一格是什么材质」。
# MapRenderer.tileStyleOf 里 5/6/7 是石头（mx-mn≤46 且 mx≥60 且 b≥g），海浪 3 太亮会被判成 plain。
DECO_SOLID = {5, 6, 7}
# 列步长：每几列取一处。太小会变成栏杆，太大又看不出「废墟感」。
COL_STEP = 3
MAX_PER_MAP = 10

# 这几张图的合法落点是「平地」（碰撞层里本来就是一大片可走地面，墙顶几乎没有）；
# 其余图走「墙顶」规则。判定理由写在 is_flat / is_column_cap 的注释里。
# act1b 的场地已经完全围死、内部一格实心都没有（甲方：「除了边界全去掉」），
# 墙顶规则在那里一件都摆不出来，只能走平地规则。
FLAT_MAPS = {'map_ch00_act1b.json', 'map_ch00_act1a.json'}
# dg01 的碰撞层只有中段一条走廊可走，行扫描会补到同一行上——不如少铺几件。
FLAT_MAPS_NO_ROW_FILL = {'map_dg01_alley.json'}

# 注意：RELIEF 的 (x,y,name) 已被 below 的自动选点取代，只保留作历史参考。
# 教训（写在这免得再犯）：第一版是**手挑的坐标**，看着避开了碰撞层，实际全铺在空气里，
# 截图里是一地浮空的石头/骨头/草。地图 JSON 里「能不能走」和「看起来合不合理」几乎无关：
# act1a 的碰撞层只有海水与零星礁石，其余全是空气，任何 standing 的布景都会飘。
# 所以后来改成「只认墙顶」，两侧（横墙）一律不选。

# 这几张图的碰撞格全铺满实心（整张图**根本走不了**，只有人形出生点能站），
# 布景会有一半埋在墙里。等地图数据补上地面/碰撞再开，别提前铺。
# （2026-11 核实：act2a/act2b/dg01/dg02/dg03 的碰撞层不一致——dg01 只剩 3 行走廊，
#   act2a/act2b/dg02/dg03 则是第二行到倒数第二行全实心。）
SKIP_MAPS = set()


def main() -> None:
    for file, items in RELIEF.items():
        p = os.path.join(ROOT, file)
        with open(p, encoding='utf-8') as f:
            m = json.load(f)
        # 先无条件清掉旧的布景条目（包括被 SKIP 的图：上一版脚本可能已经铺过）
        objs = [o for o in m['objects'] if not (o.get('kind') == 'prop' and o.get('payload') in NAMES)]
        if file in SKIP_MAPS:
            m['objects'] = objs
            with open(p, 'w', encoding='utf-8', newline='\n') as f:
                json.dump(m, f, ensure_ascii=False, indent=1)
                f.write('\n')
            print(f'{file}: 碰撞不可走，跳过（清掉旧布景，剩 {len(objs)} 个物件）')
            continue
        col = next(l for l in m['layers'] if l['name'] == 'collision')['data']
        deco = next(l for l in m['layers'] if l['name'] == 'ground')['data']
        solid = {int(t) for t in DECO_SOLID}
        sky = int(m.get('sky_rows') or 0)

        # 两种合法落点，按图分开用（同一张图混用会一半像台面一半像地面）：
        #   cap  —— 列墙的顶格：上面空气、下面还是墙。act2a 的兵营是横平竖直的砖墙。
        #   flat —— 平地一格：本格与脚下都可走，且材质不是海。act1b 的海滩是这种，墙顶几乎全是海。
        def deco_style(x, y):
            t = deco[y][x]
            if t in (1, 2, 4):
                return 'plain'
            if t in (5, 6, 7):
                return 'stone'
            if t in (0, 3):
                return 'sea'
            return 'other'

        def is_column_cap(x: int, y: int) -> bool:
            if col[y][x] == 0 or y == 0:
                return False
            return (col[y - 1][x] == 0 and y + 1 < m['height'] and col[y + 1][x] != 0
                    and deco_style(x, y) in ('plain', 'stone'))

        def is_flat(x: int, y: int) -> bool:
            if col[y][x] != 0 or deco_style(x, y) != 'plain':
                return False
            # 横向不能贴海：贴海那一格是沙滩边，摆石头看着像从水里长出来
            for dx in (-1, 0, 1):
                nx = x + dx
                if 0 <= nx < m['width'] and deco_style(nx, y) == 'sea':
                    return False
            return True

        flat = file in FLAT_MAPS
        ok = is_flat if flat else is_column_cap

        # 这张图场地上已经有一排**可交互物件**（箱子 / 出口 / NPC）——布景只画不挡路，
        # 但压在箱子上会让人看不清哪个是能捡的。按物件所在列整列禁用（各留 1 列余量）。
        # 布景自己的 payload 是道具名、真物件的 payload 不是（或没有），用这个区分。
        blocked_cols = {o['x'] for o in objs if o.get('payload') not in NAMES}
        blocked_cols |= {c + d for c in blocked_cols for d in (-1, 1)}

        spots = []
        if flat:
            # 先按列取（每 COL_STEP 列一个），列不够再按行补第二遍——
            # 只按列扫会在窄走廊里排成一条竖线（dg01 / act1b 都是这种图）
            for x in range(1, m['width'] - 1, COL_STEP):
                if x in blocked_cols:
                    continue
                for y in range(max(sky + 1, 1), m['height'] - 1, 2):
                    if is_flat(x, y) and not any(o['x'] == x and o['y'] == y for o in objs):
                        spots.append((x, y))
                        break
            if len(spots) < MAX_PER_MAP and file not in FLAT_MAPS_NO_ROW_FILL:
                for y in range(max(sky + 1, 1), m['height'] - 1, 2):
                    for x in range(1, m['width'] - 1, 2):
                        if (x, y) in spots:
                            continue
                        if is_flat(x, y) and not any(o['x'] == x and o['y'] == y for o in objs):
                            if all(abs(x - sx) > 2 or abs(y - sy) > 2 for sx, sy in spots):
                                spots.append((x, y))
                        if len(spots) >= MAX_PER_MAP:
                            break
                    if len(spots) >= MAX_PER_MAP:
                        break
        else:
            for x in range(1, m['width'] - 1, COL_STEP):
                for y in range(max(1, sky), m['height'] - 1):
                    if is_column_cap(x, y) and not any(o['x'] == x and o['y'] == y for o in objs):
                        spots.append((x, y))
                        break
        # 循环表里**不放 bush**：亮绿灌木在紫灰砖地上是全场最跳的一块（甲方看了直接要求去掉）。
        # 剩下三件都是低饱和的土色/骨色，跟战场调色板一致；数量靠循环补足。
        order = ['rock', 'skulls', 'rock', 'spikeSkull', 'rock', 'spikes', 'skulls', 'rock']

        n = 0
        for i, (x, y) in enumerate(spots[:MAX_PER_MAP]):
            name = ALIAS.get(order[i % len(order)], order[i % len(order)])
            assert name in NAMES, (file, name)
            assert 0 <= x < m['width'] and 0 <= y < m['height'], (file, x, y)
            # 布景只画不挡路，所以不要求碰撞格为空——但**必须**落在台面/平地上，否则观感错
            assert ok(x, y), f'{file} 的布景 {name} 落点不合法 ({x},{y})'
            assert all(not (o['x'] == x and o['y'] == y) for o in objs), f'{file} 布景撞到已有物件 ({x},{y})'
            n += 1
            objs.append({'id': f'obj_prop_{file.split("_")[-1].replace(".json", "")}_{i + 1}',
                         'kind': 'prop', 'x': x, 'y': y, 'label': '', 'payload': name})
        m['objects'] = objs
        with open(p, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(m, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print(f'{file}: +{n} props, total objects {len(objs)}')


if __name__ == '__main__':
    main()