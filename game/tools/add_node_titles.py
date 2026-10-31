"""给节点补上 HUD 用的「这一场叫什么 + 年份」（title / year）。

左上角战役条要显示「幕名 · 这一场　年份」，节点原本只有 id/type。
写法：读-改-写，UTF-8 无 BOM，可重复执行。
"""
from __future__ import annotations

import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / 'public' / 'data' / 'nodes' / 'nodes_ch00.json'

# 史实年份取自节点 id 前缀；title 是玩家看得懂的场景名
TITLES: dict[str, tuple[str, int]] = {
    'nd_1839_humen_dialog': ('林则徐赴粤', 1839),
    'nd_1839_humen_pool': ('虎门销烟', 1839),
    'nd_1841_humen_battle': ('虎门炮台守卫战', 1841),
    'nd_1842_nanjing_choice': ('南京条约', 1842),
    'nd_1851_jintian_escort': ('金田村突围', 1851),
    'nd_1853_tianjing_manage': ('天京经营', 1853),
    'nd_1856_intrigue': ('天京事变', 1856),
    'nd_1864_tianjing_fall': ('天京陷落', 1864),
    'nd_1864_limitation': ('农民阶级的局限性', 1864),
}


def main() -> int:
    data = json.loads(PATH.read_text(encoding='utf-8'))
    nodes = data['nodes']
    missing = [n['id'] for n in nodes if n['id'] not in TITLES]
    if missing:
        raise SystemExit(f'这些节点还没有 title/year：{missing}')

    changed = 0
    for n in nodes:
        title, year = TITLES[n['id']]
        # 按字段顺序插在 type 之后，便于人工审阅
        if n.get('title') == title and n.get('year') == year:
            continue
        n['title'] = title
        n['year'] = year
        changed += 1

    PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
        newline='\n',
    )
    print(f'节点 {len(nodes)} 个，更新 {changed} 个')
    for n in nodes:
        print(f"  {n['id']:<26} {n['year']}  {n['title']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())