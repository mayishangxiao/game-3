# -*- coding: utf-8 -*-
"""
追加副本所需的敌人、装备与副本定义。
"""
import json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

DATA = r"D:\game_project\game 3\game\public\data"


def load(rel):
    with open(os.path.join(DATA, rel), encoding="utf-8") as f:
        return json.load(f)


def save(rel, obj):
    p = os.path.join(DATA, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print("wrote", rel)


# ---------- 敌人 ----------
enemies = load("enemies/enemies_ch00.json")
have = {e["id"] for e in enemies["enemies"]}

NEW_ENEMIES = [
    # 租界暗巷
    {
        "id": "en_concession_patrol", "name": "租界巡捕", "tier": "mob",
        "hp_base": 50, "atk_base": 7, "def_base": 2, "spd": 0.8,
        "ai_params": {"detect_radius": 130, "attack_range": 26, "attack_windup_ms": 320, "attack_cooldown_ms": 380},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#1B3A6B", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_thug", "name": "流氓打手", "tier": "standard",
        "hp_base": 65, "atk_base": 9, "def_base": 3, "spd": 0.9,
        "ai_params": {"detect_radius": 140, "attack_range": 28, "attack_windup_ms": 340, "attack_cooldown_ms": 400},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#4E2F1A", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_elite_informant", "name": "包打听", "tier": "elite",
        "hp_base": 200, "atk_base": 16, "def_base": 5, "spd": 1.0,
        "ai_params": {"detect_radius": 190, "attack_range": 30, "attack_windup_ms": 420, "attack_cooldown_ms": 380},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#2F2B45", "size": {"w": 26, "h": 34},
    },
    # 广州城外匪寨
    {
        "id": "en_bandit", "name": "匪兵", "tier": "mob",
        "hp_base": 48, "atk_base": 7, "def_base": 2, "spd": 0.75,
        "ai_params": {"detect_radius": 120, "attack_range": 26, "attack_windup_ms": 320, "attack_cooldown_ms": 400},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#7A4F2A", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_bandit_crossbow", "name": "匪弩手", "tier": "ranged",
        "hp_base": 52, "atk_base": 13, "def_base": 2, "spd": 0.6,
        "ai_params": {"detect_radius": 170, "attack_range": 190, "attack_windup_ms": 520, "attack_cooldown_ms": 1000},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#A8763F", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_boss_bandit_chief", "name": "匪寨头目", "tier": "boss",
        "hp_base": 620, "atk_base": 24, "def_base": 7, "spd": 0.8,
        "ai_params": {"detect_radius": 220, "attack_range": 36, "attack_windup_ms": 500, "attack_cooldown_ms": 480},
        "frames": 43, "atlas": "placeholder",
        "boss_phases": [
            {"hp_pct": [100, 60], "attacks": ["broadside"], "adds": None, "weakpoint": False},
            {"hp_pct": [60, 25], "attacks": ["broadside", "landing_boat"], "adds": "en_bandit", "weakpoint": False},
            {"hp_pct": [25, 0], "attacks": ["ram"], "adds": None, "weakpoint": True},
        ],
        "color": "#8C1C1C", "size": {"w": 30, "h": 38},
    },
    # 沪上码头
    {
        "id": "en_gang_thug", "name": "帮会打手", "tier": "standard",
        "hp_base": 68, "atk_base": 10, "def_base": 3, "spd": 0.85,
        "ai_params": {"detect_radius": 140, "attack_range": 28, "attack_windup_ms": 330, "attack_cooldown_ms": 400},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#4E2F1A", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_factory_overseer", "name": "烟厂监工", "tier": "ranged",
        "hp_base": 58, "atk_base": 14, "def_base": 2, "spd": 0.55,
        "ai_params": {"detect_radius": 180, "attack_range": 200, "attack_windup_ms": 540, "attack_cooldown_ms": 1100},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#1F5C3A", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_elite_dock", "name": "码头把头", "tier": "elite",
        "hp_base": 230, "atk_base": 19, "def_base": 6, "spd": 0.9,
        "ai_params": {"detect_radius": 200, "attack_range": 32, "attack_windup_ms": 440, "attack_cooldown_ms": 400},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#2F6BA8", "size": {"w": 26, "h": 34},
    },
]
for e in NEW_ENEMIES:
    if e["id"] not in have:
        enemies["enemies"].append(e)
save("enemies/enemies_ch00.json", enemies)

# ---------- 装备 ----------
items = load("equipment/items_base.json")
have_i = {i["id"] for i in items["items"]}
NEW_ITEMS = [
    {
        "id": "eq_leg_dock_blue_01", "slot": "legs", "quality": "blue",
        "name": "码头工装", "stat": "spd", "base_value": 5, "quality_multiplier": 1.15,
        "source": "quest", "flavor": "裤脚卷到膝盖，赤脚踩在跳板上。",
    },
    {
        "id": "eq_head_patrol_blue_01", "slot": "head", "quality": "blue",
        "name": "巡捕帽", "stat": "def", "base_value": 5, "quality_multiplier": 1.15,
        "source": "drop", "flavor": "帽檐压得很低，看不清脸。",
    },
    {
        "id": "eq_body_bandit_purple_01", "slot": "body", "quality": "purple",
        "name": "匪寨皮甲", "stat": "hp", "base_value": 20, "quality_multiplier": 1.32,
        "source": "drop", "flavor": "缝得粗糙，但挡过刀。",
    },
    {
        "id": "eq_wp_dao_dock_blue_01", "slot": "weapon", "quality": "blue",
        "name": "码头撬棍", "stat": "atk", "base_value": 14, "quality_multiplier": 1.15,
        "source": "drop", "flavor": "一头扁一头圆，撬箱子也撬人。",
    },
]
for i in NEW_ITEMS:
    if i["id"] not in have_i:
        items["items"].append(i)
save("equipment/items_base.json", items)

# ---------- 副本定义 ----------
DUNGEONS = {
    "dungeons": [
        {
            "id": "dg01_alley",
            "name": "租界暗巷",
            "chapter_id": "ch00",
            "map_ref": "map_dg01_alley",
            "unlock_act": "ch00_act1",
            "recommended_level": 3,
            "desc": "窄巷、竹尖坑与铜锣。练的是用地形，不是拼手速。",
            "waves": [
                {"spawns": [{"enemy": "en_concession_patrol", "count": 3, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_concession_patrol", "count": 2, "spawn": "right"},
                            {"enemy": "en_thug", "count": 3, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_thug", "count": 2, "spawn": "right"},
                            {"enemy": "en_elite_informant", "count": 1, "spawn": "right"}]},
            ],
            "boss": None,
            "quality_weights": {"white": 45, "blue": 40, "purple": 15},
            "unique_drop": "eq_acc_concession_blue_01",
        },
        {
            "id": "dg02_bandit",
            "name": "广州城外匪寨",
            "chapter_id": "ch00",
            "map_ref": "map_dg02_bandit",
            "unlock_act": "ch00_act2",
            "recommended_level": 5,
            "desc": "寨门广场与高台。匪兵成阵、弩手压阵，最后是头目。",
            "waves": [
                {"spawns": [{"enemy": "en_bandit", "count": 4, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_bandit", "count": 3, "spawn": "right"},
                            {"enemy": "en_bandit_crossbow", "count": 2, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_bandit", "count": 3, "spawn": "right"},
                            {"enemy": "en_bandit_crossbow", "count": 2, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_bandit", "count": 4, "spawn": "right"}]},
            ],
            "boss": "en_boss_bandit_chief",
            "quality_weights": {"white": 40, "blue": 42, "purple": 18},
            "unique_drop": "eq_wp_dao_bandit_blue_01",
        },
        {
            "id": "dg03_dock",
            "name": "沪上码头",
            "chapter_id": "ch00",
            "map_ref": "map_dg03_dock",
            "unlock_act": "ch00_act2",
            "recommended_level": 6,
            "desc": "货箱、吊机与汽灯。打手成群，监工在远处放冷枪。",
            "waves": [
                {"spawns": [{"enemy": "en_gang_thug", "count": 4, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_gang_thug", "count": 3, "spawn": "right"},
                            {"enemy": "en_factory_overseer", "count": 2, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_gang_thug", "count": 4, "spawn": "right"},
                            {"enemy": "en_factory_overseer", "count": 1, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_gang_thug", "count": 2, "spawn": "right"},
                            {"enemy": "en_elite_dock", "count": 1, "spawn": "right"}]},
            ],
            "boss": None,
            "quality_weights": {"white": 40, "blue": 42, "purple": 18},
            "unique_drop": "eq_leg_dock_blue_01",
        },
    ]
}
save("dungeons/dungeons.json", DUNGEONS)

# ---------- 图鉴：修掉自指链接 ----------
knowledge = load("knowledge/knowledge_all.json")
fixed = 0
for c in knowledge["cards"]:
    if c["id"] == "kc_1853_tianjing" and "ev_1853_tianjing" in c.get("links", []):
        c["links"] = [x for x in c["links"] if x != "ev_1853_tianjing"]
        fixed += 1
save("knowledge/knowledge_all.json", knowledge)
print(f"knowledge 自指链接修复: {fixed}")

print("\n--- 汇总 ---")
print("敌人:", len(load("enemies/enemies_ch00.json")["enemies"]))
print("装备:", len(load("equipment/items_base.json")["items"]))
print("副本:", len(load("dungeons/dungeons.json")["dungeons"]))