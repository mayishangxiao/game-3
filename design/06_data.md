# 第七章 数据表设计

> **设计原则**：改内容不动代码。新增一章 = 新增几个 JSON 文件 + 贴图，核心代码零改动。所有游戏逻辑由数据驱动，不做硬编码的事件、敌人、对话与掉落。

## 7.1 目录结构与加载流程

### 7.1.1 数据目录

```
/public/data/
├── index.json              # 章列表、版本号、加载依赖
├── config.json             # 全局数值平衡配置
├── chapters/
│   ├── ch00.json           # 章元数据 + 幕引用
│   ├── ch01.json
│   └── ...
├── acts/
│   ├── ch00_act1.json      # 幕定义：事件卡列表、地图、入口
│   └── ...
├── events/
│   ├── events_ch00.json    # 事件卡合集（一章一个文件）
│   └── ...
├── nodes/
│   ├── nodes_ch00.json     # 玩法节点（按原型分类，引用对话/敌人/地图）
│   └── ...
├── maps/
│   ├── map_ch00_act1a.json # 瓦片地图元数据
│   └── ...
├── dialogues/
│   ├── dlg_ch00.json       # 对话树（一章一个文件）
│   └── ...
├── enemies/
│   ├── enemies_ch00.json   # 敌人表（一章一个文件）
│   └── ...
├── equipment/
│   ├── items_base.json     # 装备模板（全作分量不大，一个文件）
│   └── drops.json          # 掉落配置表
├── knowledge/
│   ├── knowledge_all.json  # 全知识卡（每条 ≤ 800 字，总 < 100 KB）
│   └── ...
├── quiz/
│   ├── quiz_ch00.json      # 章末测验题库
│   └── ...
└── achievements/
    └── achievements.json   # 成就定义
```

### 7.1.2 加载流程

```
浏览器打开 → 加载 Phaser3 + 游戏主代码
  → 加载 index.json（章列表 + 版本号）
  → 加载 config.json（全局数值）
  → 加载 equipment/items_base.json + drops.json
  → 加载 knowledge/knowledge_all.json（轻量，全量预加载）
  → 检查 localStorage 存档 → 决定从哪章开始
  → 进入章节时：
       加载 chapters/chXX.json
       加载 events/events_chXX.json
       加载 enemies/enemies_chXX.json
       加载知识卡（已在内存）
  → 进入幕时：
       加载 acts/chXX_actY.json
       加载 nodes/nodes_chXX.json（本幕相关只）
       加载 maps/map_chXX_actY_*.json
       加载 dialogues/dlg_chXX.json（本幕相关只）
       异步加载本幕图集与音频
  → 幕通关后：卸载前幕非共享资源，进入下一幕
```

**性能守则**：
- 单次加载的 JSON 合计 ≤ 60 KB（gzip 后），否则分片。
- 不在一个 `nodes` 文件里写全章所有节点——按幕拆分写入、按需提取。
- `knowledge_all.json` 是例外：它只有 100+ 条，每条 300—600 字，总量 < 80 KB，加载一次后常驻内存。

## 7.2 JSON Schema 全集

以下所有字段表即为实际 JSON 的字段。**`type` 列标注 JavaScript 类型；`"?"` 后缀表示可选。**

### 7.2.1 `index.json` —— 全局索引

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | `number` | 数据结构版本，当前 = 2 |
| `chapters` | `array` | 章元数据数组 |

`chapters[i]` 结构：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 章 ID，例 `"ch00"` |
| `name` | `string` | 章名，例 `"觉醒年代"` |
| `period` | `string` | 时间范围，例 `"1840—1921"` |
| `acts` | `string[]` | 幕 ID 列表，例 `["ch00_act1","ch00_act2"]` |
| `bonus_acts` | `string[]?` | 章内补充节点 ID |
| `quiz_id` | `string` | 章末测验 ID |
| `level_range` | `[number,number]` | 推荐等级区间 |
| `unlock` | `string` | 解锁条件，`"chXX_complete"` 或 `"chXX_quiz_pass"` |

### 7.2.2 `chapters/chXX.json` —— 章定义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 同 index |
| `name` | `string` | |
| `subtitle` | `string` | 章副标题（载入画面显示），例 `"开天辟地"` |
| `time_text` | `string` | 时期描述，例 `"1921.7 — 1923.2"` |
| `protagonist_chain` | `string[]` | 化身链 ID，按幕序，例 `["av_wang_huiwu","av_li_da"]` |
| `hub_map` | `string?` | 章节地图 ID（序章是时间轴长廊，第一章无→ `null`） |
| `corridor_bgm` | `string` | 章节地图 BGM |
| `new_weapon` | `string?` | 本章解锁的新武器 ID |
| `new_skill` | `string?` | 本章解锁的新技能 ID |
| `completion_weight` | `object` | 完成度权重 `{events:.4,knowledge:.3,quiz:.2,hidden:.1}` |

### 7.2.3 `acts/chXX_actY.json` —— 幕定义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 幕 ID，例 `"ch00_act1"` |
| `chapter_id` | `string` | 所属章 |
| `seq` | `number` | 章内序号，1 起 |
| `name` | `string` | 幕名，例 `"鸦片战争"` |
| `avatar` | `string` | 本幕化身 ID |
| `events` | `string[]` | 事件卡 ID 列表 |
| `primary_archetype` | `string` | 主原型，例 `"C"` |
| `secondary_archetypes` | `string[]` | 辅原型 |
| `map_refs` | `string[]` | 本幕使用的地图 ID |
| `bgm` | `string` | BGM ID |
| `first_clear_reward` | `string` | 首通必掉装备 ID |
| `exp_base` | `number` | 基础经验值（通关后） |
| `nodes` | `string[]` | 节点的加载引用（ID 列表，实际数据在 nodes 文件） |

### 7.2.4 `events/events_chXX.json` —— 事件卡

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 事件卡 ID，例 `"ev_1839_humen"` |
| `chapter_id` | `string` | 所属章 |
| `act_id` | `string` | 所属幕 |
| `title` | `string` | 事件名（权威表述） |
| `date` | `string` | 精确时间，例 `"1839.6.3—25"` |
| `place` | `string` | 地点，地名括注今名，例 `"广州虎门（今广东东莞虎门）"` |
| `figures` | `string[]` | 相关人物 ID |
| `document` | `string` | 相关文件/口号全称，无则 `""` |
| `result` | `string` | 历史结果（1—2 句，≤ 80 字） |
| `archetype` | `string` | 主原型 |
| `knowledge_id` | `string` | 知识卡 ID |
| `hidden` | `boolean` | 是否为隐藏卡 |
| `unlock_condition` | `string?` | 解锁条件描述，隐藏卡必填 |
| `five_element_check` | `string[]` | 五要素校验占位（校对时人工填写 `"OK"` 五条） |

### 7.2.5 `nodes/nodes_chXX.json` —— 玩法节点

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 节点 ID，例 `"nd_1839_humen_dialog"` |
| `event_id` | `string` | 所属事件卡 |
| `archetype` | `string` | 原型 |
| `type` | `string` | 具体玩法类型：`"dialog"` / `"combat"` / `"assembly"` / `"choice"` / `"management"` / `"rhythm"` / `"sort"` / `"puzzle"` / `"stealth"` / `"cutscene"` |
| `params` | `object` | 详见下表（按 type） |
| `dialogue_ref` | `string?` | 对话树引用 |
| `enemy_ref` | `string?` | 敌人配置引用（combat 专用） |
| `map_ref` | `string?` | 地图引用 |

### 7.2.6 `maps/map_*.json` —— 瓦片地图

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 地图 ID |
| `width` | `number` | 瓦片宽度，格 |
| `height` | `number` | 瓦片高度，格 |
| `tileset` | `string` | 瓦片集 ID |
| `layers` | `array` | 层数组 |

`layers[i]`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 层名，例 `"ground"`, `"collision"`, `"objects"`, `"foreground"` |
| `data` | `number[][]` | 瓦片网格，数值为 tileset 中的格号 |
| `collidable` | `boolean` | 该层是否可碰撞 |

### 7.2.7 `dialogues/dlg_chXX.json` —— 对话

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 对话块 ID，例 `"dlg_ch00_act1_intro"` |
| `speaker` | `string` | 说话人 ID（NPC 或化身） |
| `lines` | `array` | 对话行数组 |

`lines[i]`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | 对话文本，≤ 54 字（3×18） |
| `emotion` | `string?` | 表情标签，`"neutral"/"angry"/"sad"/"proud"/"worried"` |
| `action` | `object?` | 动作指令，如 `{"type":"spawn","item":"kc_1839_humen"}` |
| `next` | `string?` | 下一条 ID，省略则顺延 |
| `branch` | `object?` | 分支 `{"prompt":"…","options":[{"label":"…","next":"dlg_…"},…]}` |

### 7.2.8 `enemies/enemies_chXX.json` —— 敌人定义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 敌人 ID，例 `"en_uk_infantry"` |
| `name` | `string` | 显示名 |
| `tier` | `string` | 分级 `"mob"/"standard"/"ranged"/"elite"/"boss"` |
| `hp_base` | `number` | 基准 HP |
| `atk_base` | `number` | 基准 ATK |
| `def_base` | `number` | 基准 DEF |
| `spd` | `number` | 移速乘数（0.4—2.2） |
| `ai_params` | `object` | 见 6.1.6 的参数表 |
| `frames` | `number` | 动画帧数 |
| `atlas` | `string` | 图集引用 |
| `boss_phases` | `array?` | Boss 专属 |

`boss_phases[i]`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hp_pct` | `[number,number]` | 血量区间 [起,止] |
| `attacks` | `string[]` | 该阶段可用的攻击招式 ID |
| `adds` | `string?` | 召唤的敌人 ID |
| `weakpoint` | `boolean` | 是否暴露弱点 |

### 7.2.9 `equipment/items_base.json` —— 装备模板

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 装备 ID，例 `"eq_wp_bow_blue_01"` |
| `slot` | `string` | 槽位 `"weapon"/"head"/"body"/"legs"/"accessory"` |
| `quality` | `string` | 品质 `"white"/"blue"/"purple"` |
| `name` | `string` | 显示名，例 `"虎门猎弓"` |
| `stat` | `string` | 主属性名 |
| `base_value` | `number` | 主属性基准值 |
| `quality_multiplier` | `number` | 品质倍率 |
| `source` | `string` | 获取方式 `"drop"/"quest"/"first_clear"` |
| `flavor` | `string` | 一行风味文字，例 `"道光二十年造，曾守虎门三昼夜。"` |

### 7.2.10 `equipment/drops.json` —— 掉落配置

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source_type` | `string` | `"mob"/"standard"/"ranged"/"elite"/"boss"` |
| `drop_chance` | `number` | 掉落概率（0—1） |
| `slot_weights` | `object` | 五槽位权重，例 `{"weapon":20,"head":20,…}` |
| `quality_weights` | `object` | 品质权重，例 `{"white":72,"blue":23,"purple":5}` |
| `level_coeff` | `number` | 关卡等级系数应用于属性的倍数 |
| `pity` | `object` | 保底 `{"threshold":5,"boost":25}` |

### 7.2.11 `knowledge/knowledge_all.json` —— 知识卡

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 知识卡 ID |
| `chapter_id` | `string` | 所属章 |
| `title` | `string` | 标题 |
| `summary` | `string` | 正文（150—300 字） |
| `detail` | `string` | 扩展解读（300—600 字，条件解锁） |
| `source` | `string` | 依据文献，例 `"《中国共产党简史》"` |
| `tags` | `string[]` | 标签，例 `["鸦片战争","列强侵略"]` |
| `links` | `string[]` | 关联事件卡 ID |
| `hidden` | `boolean` | 是否为隐藏卡 |
| `unlock_hint` | `string?` | 解锁提示，中文一句话 |

### 7.2.12 `quiz/quiz_chXX.json` —— 章末测验

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 测验 ID |
| `chapter_id` | `string` | |
| `pool` | `array` | 题库（≥ 12 条） |

`pool[i]`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 题号 |
| `question` | `string` | 题干 |
| `options` | `string[4]` | 四个选项 |
| `answer` | `number` | 正确答案索引（0—3） |
| `explanation` | `string` | 无论对错都显示的简短解释 |
| `knowledge_ref` | `string` | 对应知识卡 ID |

### 7.2.13 `config.json` —— 全局平衡配置

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `exp_curve` | `object` | 经验曲线 `{base:300,slope:60}`（公式见 6.4.2） |
| `hp_formula` | `object` | HP `{base:100,per_level:18}` |
| `atk_formula` | `object` | ATK `{base:10,per_level:2.2}` |
| `def_formula` | `object` | DEF `{base:4,per_level:1.2}` |
| `damage` | `object` | 伤害 `{random_min:0.95,random_max:1.05,def_factor:0.5,boss_weakpoint_mult:2.5,level_suppress_threshold:5,level_suppress_def_factor:0.7}` |
| `dodge` | `object` | 闪避 `{invincible_ms:180,cooldown_ms:1200,distance_px:200}` |
| `combat_feedback` | `object` | 打击感 `{flash_ms:60,knockback_melee:18,knockback_ranged:8,screenshake_amp:2,…}` |
| `knowledge` | `object` | 知识 `{bonus_per_10:2,bonus_cap:20}` |
| `drop` | `object` | 掉落 `{pitty_threshold:5,pitty_boost:25}` |
| `ui` | `object` | UI `{dialog_speed:40,text_chars_per_line:18,max_lines:3}` |

## 7.3 示例数据（节选）

### 7.3.1 事件卡：`ev_1839_humen`

```json
{
  "id": "ev_1839_humen",
  "chapter_id": "ch00", "act_id": "ch00_act1",
  "title": "虎门销烟",
  "date": "1839.6.3—25",
  "place": "广州虎门（今广东东莞虎门镇）",
  "figures": ["lin_zexu", "guan_tianpei"],
  "document": "",
  "result":
    "林则徐在虎门海滩公开销毁鸦片237万余斤，"
    "历时23天，向全世界表明了中国人民反抗"
    "外来侵略的坚强意志。",
  "archetype": "F",
  "knowledge_id": "kc_1839_humen",
  "hidden": false,
  "unlock_condition": null,
  "five_element_check":
    ["OK","OK","OK","OK","OK"]
}
```

### 7.3.2 敌人：`en_uk_infantry`

```json
{
  "id": "en_uk_infantry",
  "name": "英军步兵",
  "tier": "standard",
  "hp_base": 60, "atk_base": 8, "def_base": 3,
  "spd": 0.75,
  "ai_params": {
    "detect_radius": 120,
    "attack_range": 26,
    "attack_windup_ms": 300,
    "attack_cooldown_ms": 350
  },
  "frames": 43,
  "atlas": "atlas_ch00_enemies",
  "boss_phases": null
}
```

### 7.3.3 装备模板：`eq_wp_dao_white_01`

```json
{
  "id": "eq_wp_dao_white_01",
  "slot": "weapon", "quality": "white",
  "name": "腰刀",
  "stat": "atk", "base_value": 12,
  "quality_multiplier": 1.00,
  "source": "quest",
  "flavor": "虎门水勇标配，刀身短而沉。"
}
```

### 7.3.4 知识卡：`kc_1839_humen`

```json
{
  "id": "kc_1839_humen",
  "chapter_id": "ch00",
  "title": "虎门销烟：世界上第一次大规模的禁毒行动",
  "summary":
    "1839年6月3日至25日，林则徐在虎门海滩"
    "主持销毁鸦片237万余斤。采用海水浸泡加"
    "石灰的方法，将鸦片彻底销毁，历时23天。",
  "detail":
    "销烟的具体方法是：在海滩上挖池，引入海水，"
    "投入鸦片浸泡半日，再加石灰搅拌，使其沸腾"
    "溶解。池水退潮时排入大海，不留残余。这一"
    "方法科学有效，杜绝了事后挖掘的可能性。",
  "source": "《中国共产党简史》《鸦片战争史》",
  "tags": ["鸦片战争","虎门","林则徐"],
  "links": ["ev_1840_war","ev_1841_humen_fort"],
  "hidden": false,
  "unlock_hint": null
}
```

### 7.3.5 章末测验题：`qz_ch00_q01`

```json
{
  "id": "qz_ch00_q01",
  "question": "虎门销烟发生在哪一年？",
  "options": [
    "1839年", "1840年", "1842年", "1843年"
  ],
  "answer": 0,
  "explanation":
    "虎门销烟于1839年6月3日开始，"
    "共23天。1840年是鸦片战争爆发的时间。",
  "knowledge_ref": "kc_1839_humen"
}
```

## 7.4 数值参考表

以下为游戏运行时从 `config.json` 派生的全部数值。**本文档即验收基准**；若游戏内数值与下表不符，以游戏代码中的 `config.json` 为准。

### 7.4.1 经验曲线

| 等级 | 升到下一级需求 | 等级 | 升到下一级需求 |
| --- | --- | --- | --- |
| 1 | 300 | 28 | 1920 |
| 2 | 360 | 29 | 1980 |
| 3 | 420 | 30 | 2040 |
| 4 | 480 | 31 | 2100 |
| 5 | 540 | 32 | 2160 |
| 6 | 600 | 33 | 2220 |
| 7 | 660 | 34 | 2280 |
| 8 | 720 | 35 | 2340 |
| 9 | 780 | 36 | 2400 |
| 10 | 840 | 37 | 2460 |
| 11 | 900 | 38 | 2520 |
| 12 | 960 | 39 | 2580 |
| 13 | 1020 | 40 | 2640 |
| 14 | 1080 | 41 | 2700 |
| 15 | 1140 | 42 | 2760 |
| 16 | 1200 | 43 | 2820 |
| 17 | 1260 | 44 | 2880 |
| 18 | 1320 | 45 | 2940 |
| 19 | 1380 | 46 | 3000 |
| 20 | 1440 | 47 | 3060 |
| 21 | 1500 | 48 | 3120 |
| 22 | 1560 | 49 | 3180 |
| 23 | 1620 | 50 | 3240 |
| 24 | 1680 | 51 | 3300 |
| 25 | 1740 | 52 | 3360 |
| 26 | 1800 | 53 | 3420 |
| 27 | 1860 | 54 | 3480 |

### 7.4.2 玩家属性与等级

| Lv | HP | ATK | DEF | Lv | HP | ATK | DEF |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100 | 10 | 4 | 28 | 586 | 69 | 36 |
| 5 | 172 | 19 | 9 | 32 | 658 | 78 | 41 |
| 8 | 226 | 25 | 12 | 37 | 748 | 89 | 47 |
| 12 | 298 | 34 | 17 | 42 | 838 | 100 | 53 |
| 17 | 388 | 45 | 23 | 45 | 892 | 107 | 57 |
| 22 | 478 | 56 | 29 | 50 | 982 | 118 | 63 |
| 27 | 568 | 67 | 35 | 54 | 1054 | 127 | 68 |

### 7.4.3 关卡等级系数

| 关卡推荐等级 L | 系数 | 关卡推荐等级 L | 系数 |
| --- | --- | --- | --- |
| 1 | 1.00 | 25 | 3.04 |
| 5 | 1.34 | 30 | 3.47 |
| 8 | 1.60 | 35 | 3.89 |
| 12 | 1.94 | 40 | 4.32 |
| 17 | 2.36 | 45 | 4.74 |
| 22 | 2.79 | 50 | 5.17 |

`系数 = 1.00 + 0.085 × (L − 1)`

### 7.4.4 掉落权重表

| 来源 | 白 | 蓝 | 紫 | 掉落率 | 每紫保底 |
| --- | --- | --- | --- | --- | --- |
| 普通敌人 | 72% | 23% | 5% | 8% | 无 |
| 精英敌人 | 35% | 45% | 20% | 100% | 无 |
| Boss | 15% | 50% | 35% | 100%（2 件） | 无 |
| 副本（首次） | 30% | 45% | 25% | — | 6 次不出紫→ +25% |
| 副本（重复） | 40% | 42% | 18% | — | 同上 |

### 7.4.5 词条池与权重

| # | 词条 | 区间 | 权重 |
| --- | --- | --- | --- |
| 1 | 吸血 | 3%—6% | 12 |
| 2 | 暴击率 | 4%—8% | 14 |
| 3 | 暴击伤害 | 15%—30% | 12 |
| 4 | 经验加成 | 8%—15% | 10 |
| 5 | 移速 | 5%—10% | 12 |
| 6 | 攻速 | 6%—12% | 12 |
| 7 | 知识加成 | 10%—20% | 8 |
| 8 | 击退增强 | 20%—40% | 6 |
| 9 | 受击减伤 | 4%—8% | 8 |
| 10 | 对精英伤害 | 10%—20% | 6 |
| **合计** | | | **100** |

抽词条流程：先掷词条数（1 条 50% / 2 条 35% / 3 条 15%），再按权重无放回抽，数值在区间内取整。