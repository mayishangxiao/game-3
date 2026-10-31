# -*- coding: utf-8 -*-
"""
向现有数据文件追加序章第二幕「太平天国」的全部内容，并新建幕定义、更新章索引。
读取-修改-写回，避免手写大段 JSON 出错。
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


# ============ 1) 敌人 ============
enemies = load("enemies/enemies_ch00.json")
have = {e["id"] for e in enemies["enemies"]}
NEW_ENEMIES = [
    {
        "id": "en_qing_green",
        "name": "清军绿营兵",
        "tier": "mob",
        "hp_base": 45,
        "atk_base": 6,
        "def_base": 2,
        "spd": 0.6,
        "ai_params": {"detect_radius": 110, "attack_range": 26, "attack_windup_ms": 380, "attack_cooldown_ms": 420},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#1F5C3A", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_qing_cavalry",
        "name": "清军马队",
        "tier": "standard",
        "hp_base": 70,
        "atk_base": 15,
        "def_base": 3,
        "spd": 1.4,
        "ai_params": {"detect_radius": 200, "attack_range": 200, "attack_windup_ms": 620, "attack_cooldown_ms": 950},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#4E2F1A", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_qing_batou",
        "name": "清军把总",
        "tier": "elite",
        "hp_base": 150,
        "atk_base": 18,
        "def_base": 5,
        "spd": 0.85,
        "ai_params": {"detect_radius": 170, "attack_range": 32, "attack_windup_ms": 460, "attack_cooldown_ms": 420},
        "frames": 43, "atlas": "placeholder", "boss_phases": None,
        "color": "#2F2B45", "size": {"w": 24, "h": 32},
    },
    {
        "id": "en_boss_xiangarmy_a",
        "name": "湘军统领",
        "tier": "boss",
        "hp_base": 700,
        "atk_base": 28,
        "def_base": 8,
        "spd": 0.7,
        "ai_params": {"detect_radius": 220, "attack_range": 40, "attack_windup_ms": 520, "attack_cooldown_ms": 520},
        "frames": 43, "atlas": "placeholder",
        "boss_phases": [
            {"hp_pct": [100, 66], "attacks": ["broadside"], "adds": None, "weakpoint": False},
            {"hp_pct": [66, 33], "attacks": ["broadside", "landing_boat"], "adds": "en_qing_green", "weakpoint": False},
            {"hp_pct": [33, 0], "attacks": ["ram"], "adds": None, "weakpoint": True},
        ],
        "color": "#4A4468", "size": {"w": 28, "h": 36},
    },
    {
        "id": "en_boss_xiangarmy_b",
        "name": "洋枪队队长",
        "tier": "boss",
        "hp_base": 400,
        "atk_base": 35,
        "def_base": 5,
        "spd": 0.6,
        "ai_params": {"detect_radius": 240, "attack_range": 200, "attack_windup_ms": 700, "attack_cooldown_ms": 1400},
        "frames": 43, "atlas": "placeholder",
        "boss_phases": [
            {"hp_pct": [100, 50], "attacks": ["broadside"], "adds": None, "weakpoint": False},
            {"hp_pct": [50, 0], "attacks": ["broadside", "landing_boat"], "adds": "en_qing_cavalry", "weakpoint": True},
        ],
        "color": "#1B3A6B", "size": {"w": 28, "h": 36},
    },
]
for e in NEW_ENEMIES:
    if e["id"] not in have:
        enemies["enemies"].append(e)
save("enemies/enemies_ch00.json", enemies)

# ============ 2) 事件卡 ============
events = load("events/events_ch00.json")
have_ev = {e["id"] for e in events["events"]}
NEW_EVENTS = [
    {
        "id": "ev_1851_jintian", "chapter_id": "ch00", "act_id": "ch00_act2",
        "title": "金田起义", "date": "1851.1.11", "place": "广西桂平金田村（今广西桂平市）",
        "figures": ["hong_xiuquan", "yang_xiuqing"], "document": "",
        "result": "洪秀全等在金田村起义，建号太平天国。此后两年间转战数省，队伍迅速扩大。",
        "archetype": "C", "knowledge_id": "kc_1851_jintian", "hidden": False,
        "unlock_condition": None, "five_element_check": ["OK", "OK", "OK", "OK", "OK"],
    },
    {
        "id": "ev_1853_tianjing", "chapter_id": "ch00", "act_id": "ch00_act2",
        "title": "定都天京", "date": "1853.3", "place": "南京（改称天京）",
        "figures": ["hong_xiuquan"], "document": "《天朝田亩制度》",
        "result": "太平军攻占南京并定都于此，改称天京，建立起与清王朝对峙的农民政权。《天朝田亩制度》提出了平均分配土地的方案。",
        "archetype": "G", "knowledge_id": "kc_1853_tianjing", "hidden": False,
        "unlock_condition": None, "five_element_check": ["OK", "OK", "OK", "OK", "OK"],
    },
    {
        "id": "ev_1856_intrigue", "chapter_id": "ch00", "act_id": "ch00_act2",
        "title": "天京事变", "date": "1856.9", "place": "天京",
        "figures": [], "document": "",
        "result": "领导集团内部自相残杀，东王杨秀清、北王韦昌辉相继被杀，翼王石达开出走，太平天国由盛转衰。",
        "archetype": "J", "knowledge_id": "kc_1856_intrigue", "hidden": False,
        "unlock_condition": None, "five_element_check": ["OK", "OK", "OK", "OK", "OK"],
    },
    {
        "id": "ev_1859_zizheng", "chapter_id": "ch00", "act_id": "ch00_act2",
        "title": "《资政新篇》", "date": "1859", "place": "天京",
        "figures": ["hong_renxuan"], "document": "《资政新篇》",
        "result": "洪仁玕提出学习西方、发展工商业、改革内政的方案，是中国最早的系统性近代化纲领之一，但因缺乏条件未能实行。",
        "archetype": "I", "knowledge_id": "kc_1859_zizheng", "hidden": True,
        "unlock_condition": "在天京经营中连续三个月三项都达到 2（进入盛世），洪仁玕会到访",
        "five_element_check": ["OK", "OK", "OK", "OK", "OK"],
    },
    {
        "id": "ev_1864_tianjing_fall", "chapter_id": "ch00", "act_id": "ch00_act2",
        "title": "天京陷落", "date": "1864.7", "place": "天京",
        "figures": ["li_xiucheng"], "document": "",
        "result": "湘军攻破天京，太平天国运动失败。李秀成被俘后就义。",
        "archetype": "C", "knowledge_id": "kc_1864_tianjing_fall", "hidden": False,
        "unlock_condition": None, "five_element_check": ["OK", "OK", "OK", "OK", "OK"],
    },
    {
        "id": "ev_1864_limitation", "chapter_id": "ch00", "act_id": "ch00_act2",
        "title": "农民阶级的局限性", "date": "1864", "place": "",
        "figures": [], "document": "",
        "result": "太平天国运动是中国历史上规模最大的农民战争，沉重打击了中外反动势力；但它没有科学理论指导，没有先进阶级领导，不能领导中国革命走向胜利。",
        "archetype": "I", "knowledge_id": "kc_1864_limitation", "hidden": False,
        "unlock_condition": None, "five_element_check": ["OK", "OK", "OK", "OK", "OK"],
    },
]
for e in NEW_EVENTS:
    if e["id"] not in have_ev:
        events["events"].append(e)
save("events/events_ch00.json", events)

# ============ 3) 知识卡 ============
knowledge = load("knowledge/knowledge_all.json")
have_k = {c["id"] for c in knowledge["cards"]}
NEW_CARDS = [
    {
        "id": "kc_1851_jintian", "chapter_id": "ch00",
        "title": "金田起义与太平天国运动的兴起",
        "summary": "1851 年 1 月 11 日，洪秀全等在广西桂平金田村起义，建号太平天国。起义军随后北上，两年间转战数省，队伍从两万人发展到数十万人。",
        "detail": "太平天国运动爆发于鸦片战争之后阶级矛盾与民族矛盾交织的年代。它的参加者主要是农民、手工业者和部分会党群众，斗争目标直指封建统治与外国侵略势力。",
        "source": "《中国共产党简史》", "tags": ["太平天国", "金田起义", "农民战争"],
        "links": ["ev_1853_tianjing", "ev_1864_limitation"], "hidden": False, "unlock_hint": None,
    },
    {
        "id": "kc_1853_tianjing", "chapter_id": "ch00",
        "title": "《天朝田亩制度》：农民对土地的渴望",
        "summary": "1853 年定都天京后，太平天国颁布《天朝田亩制度》，提出“凡天下田，天下人同耕”的平均分配土地方案，企图建立一个“无处不均匀，无人不饱暖”的社会。",
        "detail": "这一方案反映了千百年来农民对土地的强烈渴望，具有鲜明的反封建色彩。但它把自给自足的自然经济理想化，否定商品经济与生产分工，在实践中无法实行——这也从侧面说明，单靠农民阶级无法设计出通向近代化的道路。",
        "source": "《中国近现代史纲要》", "tags": ["天朝田亩制度", "土地", "平均主义"],
        "links": ["ev_1853_tianjing", "ev_1864_limitation"], "hidden": False, "unlock_hint": None,
    },
    {
        "id": "kc_1856_intrigue", "chapter_id": "ch00",
        "title": "天京事变：农民政权的内部崩塌",
        "summary": "1856 年 9 月，太平天国领导集团内讧，东王杨秀清被杀，北王韦昌辉被处死，翼王石达开被迫出走。这场事变使太平天国元气大伤，由盛转衰。",
        "detail": "定都天京后，领导集团逐渐腐化，等级森严、争权夺利。事变不是偶然的个人冲突，而是农民政权无法建立科学政治制度的必然结果——政权一旦失去制度约束，就只能在权力斗争中自我消耗。",
        "source": "《中国近现代史纲要》", "tags": ["天京事变", "内讧", "教训"],
        "links": ["ev_1853_tianjing", "ev_1864_limitation"], "hidden": False, "unlock_hint": None,
    },
    {
        "id": "kc_1859_zizheng", "chapter_id": "ch00",
        "title": "《资政新篇》：中国最早的系统性近代化方案",
        "summary": "1859 年，洪仁玕提出《资政新篇》，主张学习西方、兴办工矿交通、发展金融、改革内政与司法，是近代中国最早的系统性近代化纲领。",
        "detail": "《资政新篇》的视野远超同时代的多数方案，但它没有触及土地问题，也缺乏实行的社会条件与阶级基础，因此未能在太平天国内部推行。它的出现说明：先进的主张若没有先进阶级来承担，终究只能停留在纸面上。",
        "source": "《中国近现代史纲要》", "tags": ["资政新篇", "洪仁玕", "近代化"],
        "links": ["ev_1859_zizheng", "ev_1864_limitation"], "hidden": True,
        "unlock_hint": "在天京经营中连续三个月三项都达到 2，洪仁玕会到访",
    },
    {
        "id": "kc_1864_tianjing_fall", "chapter_id": "ch00",
        "title": "天京陷落与太平天国运动的失败",
        "summary": "1864 年 7 月，湘军攻破天京，太平天国运动失败。忠王李秀成被俘后就义。这场持续十四年的农民战争就此结束。",
        "detail": "太平天国运动失败的原因是多方面的：中外反动势力联合镇压是外部原因；农民阶级不是新的生产力代表，提不出科学的革命纲领，无法克服自身的分散性、保守性与宗派性，则是根本原因。",
        "source": "《中国共产党简史》", "tags": ["天京陷落", "李秀成", "失败原因"],
        "links": ["ev_1864_limitation"], "hidden": False, "unlock_hint": None,
    },
    {
        "id": "kc_1864_limitation", "chapter_id": "ch00",
        "title": "为什么农民阶级不能领导中国革命取得胜利",
        "summary": "太平天国运动是中国历史上规模最大的农民战争，沉重打击了中外反动势力。但它没有科学的理论指导，没有先进的阶级领导，因而不能领导中国革命走向胜利。",
        "detail": "农民阶级是民主革命的主力军，中国革命的胜利离不开农民的支持与参加。但农民阶级与落后的生产方式相联系，不是新的生产力的代表，看不清历史发展的方向。历史证明：中国革命必须由新的阶级、新的政党来领导。",
        "source": "《中国共产党简史》", "tags": ["农民阶级", "局限性", "结论"],
        "links": ["ev_1851_jintian", "ev_1853_tianjing", "ev_1856_intrigue", "ev_1864_tianjing_fall"],
        "hidden": False, "unlock_hint": None,
    },
]
for c in NEW_CARDS:
    if c["id"] not in have_k:
        knowledge["cards"].append(c)
save("knowledge/knowledge_all.json", knowledge)

# ============ 4) 对话 ============
dlg = load("dialogues/dlg_ch00.json")
have_d = {d["id"] for d in dlg["dialogues"]}
NEW_DLG = [
    {
        "id": "dlg_ch00_act2_intro", "speaker": "li_xiucheng",
        "lines": [
            {"text": "我是李秀成。\n从金田村出来的那一天，\n我们只有两万人。", "emotion": "neutral"},
            {"text": "清军在后面追。\n带着这三个弟兄走，\n一个都不能少。", "emotion": "worried"},
            {"text": "往东。", "emotion": "proud", "action": {"type": "bgm", "value": "bgm_battle"}},
        ],
    },
    {
        "id": "dlg_ch00_act2_tianjing", "speaker": "hong_xiuquan",
        "lines": [
            {"text": "定都天京了。\n从今往后，这里就是\n太平天国的都城。", "emotion": "proud"},
            {"text": "粮草、兵员、民心。\n三件事，每月只有六点可分。", "emotion": "neutral"},
            {"text": "《天朝田亩制度》上写着\n“无人不饱暖”。\n你去分分看。", "emotion": "worried",
             "action": {"type": "knowledge", "item": "kc_1853_tianjing"}},
        ],
    },
    {
        "id": "dlg_ch00_act2_intrigue", "speaker": "narrator",
        "lines": [
            {"text": "咸丰六年八月，天京。", "emotion": "sad"},
            {"text": "东王杨秀清被杀，\n北王韦昌辉被处死，\n翼王石达开带兵出走。", "emotion": "sad"},
            {"text": "几个月前还是\n“无处不均匀”的天京，\n如今血流在宫墙下。", "emotion": "sad"},
            {"text": "不是哪一个人的错。\n是这个政权\n没有办法约束自己。", "emotion": "sad",
             "action": {"type": "knowledge", "item": "kc_1856_intrigue"}},
        ],
    },
    {
        "id": "dlg_ch00_act2_fall", "speaker": "li_xiucheng",
        "lines": [
            {"text": "同治三年六月，天京。\n城墙被轰开的时候，\n粮仓早就空了。", "emotion": "sad"},
            {"text": "十四年，从金田到天京。\n我们打过很多胜仗。", "emotion": "sad"},
            {"text": "可我们终究没能\n走出一条新路。", "emotion": "sad",
             "action": {"type": "knowledge", "item": "kc_1864_tianjing_fall"}},
            {"text": "把这件事记下来。\n后来的人会明白，\n光靠农民，是不行的。", "emotion": "neutral", "action": {"type": "end"}},
        ],
    },
]
for d in NEW_DLG:
    if d["id"] not in have_d:
        dlg["dialogues"].append(d)
dlg.setdefault("npcs", {}).update({
    "li_xiucheng": "李秀成",
    "hong_xiuquan": "洪秀全",
    "hong_renxuan": "洪仁玕",
})
save("dialogues/dlg_ch00.json", dlg)

# ============ 5) 玩法节点 ============
nodes = load("nodes/nodes_ch00.json")
have_n = {n["id"] for n in nodes["nodes"]}
NEW_NODES = [
    {
        "id": "nd_1851_jintian_escort", "event_id": "ev_1851_jintian", "archetype": "C",
        "type": "dialog", "dialogue_ref": "dlg_ch00_act2_intro", "enemy_ref": None,
        "map_ref": "map_ch00_act2a",
        "params": {
            "mode": "escort", "recommended_level": 4, "allies": 3,
            "waves": [
                {"spawns": [{"enemy": "en_qing_green", "count": 4, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_qing_green", "count": 3, "spawn": "right"},
                            {"enemy": "en_qing_cavalry", "count": 2, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_qing_green", "count": 3, "spawn": "right"},
                            {"enemy": "en_qing_batou", "count": 1, "spawn": "right"}]},
            ],
            "reward_knowledge": "kc_1851_jintian",
        },
    },
    {
        "id": "nd_1853_tianjing_manage", "event_id": "ev_1853_tianjing", "archetype": "G",
        "type": "management", "dialogue_ref": "dlg_ch00_act2_tianjing", "enemy_ref": None,
        "map_ref": "map_ch00_act2b",
        "params": {
            "mode": "management", "recommended_level": 5, "months": 8,
            "reward_knowledge": "kc_1853_tianjing", "hidden_knowledge": "kc_1859_zizheng",
        },
    },
    {
        "id": "nd_1856_intrigue", "event_id": "ev_1856_intrigue", "archetype": "J",
        "type": "cutscene", "dialogue_ref": "dlg_ch00_act2_intrigue", "enemy_ref": None,
        "map_ref": None,
        "params": {"mode": "cutscene", "recommended_level": 5, "reward_knowledge": "kc_1856_intrigue"},
    },
    {
        "id": "nd_1864_tianjing_fall", "event_id": "ev_1864_tianjing_fall", "archetype": "C",
        "type": "combat", "dialogue_ref": None, "enemy_ref": None, "map_ref": "map_ch00_act2b",
        "params": {
            "mode": "combat", "recommended_level": 5,
            "waves": [
                {"spawns": [{"enemy": "en_qing_green", "count": 5, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_qing_green", "count": 4, "spawn": "right"},
                            {"enemy": "en_qing_cavalry", "count": 2, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_qing_green", "count": 4, "spawn": "right"},
                            {"enemy": "en_qing_batou", "count": 1, "spawn": "right"}]},
                {"spawns": [{"enemy": "en_qing_batou", "count": 2, "spawn": "right"}]},
            ],
            "boss": "en_boss_xiangarmy_a", "boss_extra": ["en_boss_xiangarmy_b"],
            "reward_knowledge": "kc_1864_tianjing_fall",
        },
    },
    {
        "id": "nd_1864_limitation", "event_id": "ev_1864_limitation", "archetype": "I",
        "type": "choice", "dialogue_ref": "dlg_ch00_act2_fall", "enemy_ref": None, "map_ref": None,
        "params": {
            "mode": "choice", "recommended_level": 5,
            "prompt": "十四年，两万人到几十万人，最后还是败了。太平天国为什么不能成功？",
            "options": [
                {"label": "因为没有好的武器和更多的兵",
                 "outcome": "清军的洋枪确实厉害。但十四年里，太平军也打过许多胜仗。"},
                {"label": "因为没有科学理论指导、没有先进阶级领导",
                 "outcome": "这正是历史的结论。农民阶级是革命的主力军，但不是新的生产力的代表。"},
                {"label": "因为运气不好，天京事变来得太早",
                 "outcome": "事变是结果，不是原因。一个无法约束自己的政权，迟早会走到这一步。"},
            ],
            "must_pick": 1, "reward_knowledge": "kc_1864_limitation",
        },
    },
]
for n in NEW_NODES:
    if n["id"] not in have_n:
        nodes["nodes"].append(n)
save("nodes/nodes_ch00.json", nodes)

# ============ 6) 幕定义 ============
save("acts/ch00_act2.json", {
    "id": "ch00_act2",
    "chapter_id": "ch00",
    "seq": 2,
    "name": "太平天国运动",
    "avatar": "av_lixiucheng",
    "events": ["ev_1851_jintian", "ev_1853_tianjing", "ev_1856_intrigue",
               "ev_1859_zizheng", "ev_1864_tianjing_fall", "ev_1864_limitation"],
    "primary_archetype": "G",
    "secondary_archetypes": ["C", "J", "I"],
    "map_refs": ["map_ch00_act2a", "map_ch00_act2b"],
    "bgm": "bgm_ch00_act2",
    "first_clear_reward": "eq_leg_taiping_blue_01",
    "exp_base": 480,
    "nodes": [
        "nd_1851_jintian_escort",
        "nd_1853_tianjing_manage",
        "nd_1856_intrigue",
        "nd_1864_tianjing_fall",
        "nd_1864_limitation",
    ],
})

# ============ 7) 章索引 ============
idx = load("index.json")
for ch in idx["chapters"]:
    if ch["id"] == "ch00":
        ch["acts"] = ["ch00_act1", "ch00_act2"]
        ch["acts_planned"] = ["ch00_act3", "ch00_act4", "ch00_act5", "ch00_act6", "ch00_act7"]
save("index.json", idx)

print("\n--- 汇总 ---")
print("敌人:", len(load("enemies/enemies_ch00.json")["enemies"]))
print("事件卡:", len(load("events/events_ch00.json")["events"]))
print("知识卡:", len(load("knowledge/knowledge_all.json")["cards"]))
print("对话块:", len(load("dialogues/dlg_ch00.json")["dialogues"]))
print("节点:", len(load("nodes/nodes_ch00.json")["nodes"]))