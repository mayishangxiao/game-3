# -*- coding: utf-8 -*-
"""序章「虎门炮台守卫战」演示版数据补齐（一次性脚本，可重复执行）。"""
import io
import json

DATA = r'D:\game_project\game 3\game\public\data'


def load(rel):
    return json.load(io.open(DATA + '\\' + rel, encoding='utf-8'))


def save(rel, obj):
    io.open(DATA + '\\' + rel, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(obj, ensure_ascii=False, indent=2) + '\n'
    )


# ---------------- config.json ----------------
cfg = load('config.json')
cfg['dodge']['distance_px'] = 64
cfg['skills'] = {
    'humen_cannon': {
        'id': 'humen_cannon',
        'name': '虎门重炮',
        'cooldown_ms': 12000,
        'range_px': 300,
        'splash_px': 52,
        'kill_tiers': ['mob', 'standard'],
        'elite_hp_pct': 45,
        'boss_hp_pct': 3,
        'misfire_chance_pct': 10,
        'misfire_self_pct': 12,
        'desc': '关天培在虎门炮台亲自督放的岸炮：打小兵一发带走，打精英重伤，打军舰几乎不痛——装备差距就摆在这里。',
    }
}
save('config.json', cfg)

# ---------------- enemies ----------------
en = load('enemies\\enemies_ch00.json')
lst = en['enemies'] if isinstance(en, dict) else en
lst = [e for e in lst if e['id'] != 'en_gough']
gough = {
    'id': 'en_gough',
    'name': '郭富准将',
    'tier': 'elite',
    'hp_base': 210,
    'atk_base': 20,
    'def_base': 7,
    'spd': 0.8,
    'ai_params': {
        'detect_radius': 200,
        'attack_range': 34,
        'attack_windup_ms': 420,
        'attack_cooldown_ms': 360,
        'aura': {'radius': 220, 'atk_pct': 20},
    },
    'frames': 43,
    'atlas': 'placeholder',
    'boss_phases': None,
    'color': '#8C1F28',
    'size': {'w': 26, 'h': 34},
}
# 插在英军军官后面，便于阅读
idx = next(i for i, e in enumerate(lst) if e['id'] == 'en_uk_officer')
lst.insert(idx + 1, gough)
en['enemies'] = lst
save('enemies\\enemies_ch00.json', en)

# ---------------- act1 战斗节点 ----------------
nodes_doc = load('nodes\\nodes_ch00.json')
nodes = nodes_doc['nodes'] if isinstance(nodes_doc, dict) else nodes_doc
for n in nodes:
    if n['id'] != 'nd_1841_humen_battle':
        continue
    p = n['params']
    p['waves'] = [
        {'spawns': [{'enemy': 'en_uk_infantry', 'count': 4, 'spawn': 'right'}]},
        {'spawns': [{'enemy': 'en_uk_infantry', 'count': 3, 'spawn': 'right'},
                    {'enemy': 'en_uk_grenadier', 'count': 2, 'spawn': 'right'}]},
        {'spawns': [{'enemy': 'en_uk_infantry', 'count': 3, 'spawn': 'right'},
                    {'enemy': 'en_gough', 'count': 1, 'spawn': 'right'}]},
    ]
    p['boss'] = 'en_boss_steamfrigate'
    p['defeat_continues'] = True
    p['dynasty_delta'] = -38
    p['defeat_title'] = '虎门失守'
    p['defeat_lines'] = [
        '1841 年 2 月 26 日，英军攻破虎门各炮台。',
        '关天培亲燃大炮，力战殉国，年六十岁。',
        '清军的岸炮打不穿英舰的蒸汽铁壳船体——这不是勇气的问题。',
    ]
    p['treaty_lines'] = [
        '1842 年 8 月 29 日，英舰泊于南京下关江面。',
        '《南京条约》：割香港岛，赔款 2100 万银元，开五口通商。',
        '中国开始沦为半殖民地半封建社会。',
    ]
nodes_doc['nodes'] = nodes
save('nodes\\nodes_ch00.json', nodes_doc)

print('config skills:', cfg['skills']['humen_cannon']['name'], 'dodge', cfg['dodge']['distance_px'])
print('enemies:', len(lst), 'gough hp', gough['hp_base'])
print('battle node params keys:', sorted(n['params'].keys()) if isinstance(n, dict) else '-')
print('waves:', len([n for n in nodes if n['id'] == 'nd_1841_humen_battle'][0]['params']['waves']))