#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
地图「手工增项」复位器。

背景：`public/data/maps/*.json` 是 `gen_maps*.py` 的产物，**重跑生成器会把后来手工
加在 JSON 上的开关全部抹掉**（2026-11-05 就丢过一次 `battle_scars`）。
本脚本只做两件事，都可重复执行：

1. 给两张战场图补回 `battle_scars: true`（弹坑/血泊/尸骸/碎木 + 破烂炮台，
   见 `MapRenderer.paintScars/paintRuin`，纯装饰不挡人）。
2. **守住甲方的两条删除令**（`public/data/README.md` 第六节）：
   - 第一幕不留 `sky_rows`：远景带当年是靠「顶上几行做成实心」实现的，
     而甲方要求「除了边界全去掉」空气墙，`tests/art.test.ts` 有断言锁着；
   - 第一幕不留围观百姓（`kind:'prop'` + `payload:'door_N'`，甲方 m01249「把第一幕的观众也全去掉」）。
   这两样要是被谁（包括 AI）顺手加回来，这里直接清掉。

用法：python tools/fix_map_extras.py
"""
import json
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'maps')
BATTLE_MAPS = ['map_ch00_act1b.json', 'map_ch00_act2b.json']
ACT1_MAPS = ['map_ch00_act1a.json', 'map_ch00_act1b.json']


def load(name):
    with open(os.path.join(BASE, name), encoding='utf-8') as f:
        return json.load(f)


def save(name, data):
    path = os.path.join(BASE, name)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    if open(path, 'rb').read(3) == b'\xef\xbb\xbf':
        raise SystemExit('写出来带 BOM，JSON.parse 会炸')


def main():
    changed = []
    for name in BATTLE_MAPS:
        d = load(name)
        if not d.get('battle_scars'):
            d['battle_scars'] = True
            save(name, d)
            changed.append(f'{name}: battle_scars=true')
        print(f'{name}: battle_scars={d.get("battle_scars")}')

    for name in ACT1_MAPS:
        d = load(name)
        dirty = False
        if d.pop('sky_rows', None) is not None:
            dirty = True
            print(f'  {name}: 删掉 sky_rows（第一幕不许有远景实心带）')
        kept = [o for o in d.get('objects', []) if not (o.get('kind') == 'prop' and str(o.get('payload', '')).startswith('door_'))]
        if len(kept) != len(d.get('objects', [])):
            print(f'  {name}: 删掉 {len(d["objects"]) - len(kept)} 个围观百姓（甲方 m01249 已要求去掉）')
            d['objects'] = kept
            dirty = True
        if dirty:
            save(name, d)
            changed.append(name)

    # 复核：第一幕碰撞层只能有「一圈边 + 销烟池那两种装饰砖」。
    # 起点取「第一整行可走」的那行——上面几行是海/湿沙包边（act1a 顶部 3 行是海），
    # 和 `tests/art.test.ts` 的算法保持一致，否则这里会误报一堆包边格。
    for name in ACT1_MAPS:
        d = load(name)
        col = next(x for x in d['layers'] if x['name'] == 'collision')['data']
        gnd = next(x for x in d['layers'] if x['name'] == 'ground')['data']
        w = len(col[0])
        top = 0
        while top < len(col) and any(col[top][i] != 0 for i in range(1, w - 1)):
            top += 1
        interior = [
            (x, y)
            for y in range(top + 1, len(col) - 1)
            for x in range(1, w - 1)
            if col[y][x] != 0 and gnd[y][x] not in (6, 7)
        ]
        print(f'{name}: 首个整行可走 = r{top}，内部实心格 {len(interior)} 个' + ('' if not interior else f' -> {interior[:8]}'))
        if interior:
            raise SystemExit(f'{name} 又长出空气墙了，甲方会退回')

    print('OK' + ('（改动：' + ', '.join(changed) + '）' if changed else '（无需改动）'))


if __name__ == '__main__':
    main()
