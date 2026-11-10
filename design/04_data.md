# 第五章 数据表设计

> **设计原则**：改内容不动代码。新增一章 = 新增几个 JSON 文件 + 贴图，核心代码零改动。所有游戏逻辑由数据驱动，不做硬编码的事件、敌人、对话与掉落。

## 5.1 目录结构与加载流程

### 5.1.1 数据目录

```
/public/data/
├── index.json                 # 章列表 + 版本号（本期只有 ch00）
├── config.json                # 全局数值平衡配置
├── chapters/
│   └── ch00.json              # 章元数据 + 幕引用
├── acts/
│   ├── ch00_act1.json         # 幕定义：事件卡列表、地图、首通奖励
│   └── ch00_act2.json
├── events/
│   └── events_ch00.json       # 事件卡合集（本章 11 张，含 1 张隐藏卡）
├── nodes/
│   └── nodes_ch00.json        # 玩法节点（本章 9 个，引用对话/敌人/地图）
├── maps/
│   ├── map_ch00_act1a.json    # 关卡图 4 张
│   ├── map_ch00_act1b.json
│   ├── map_ch00_act2a.json
│   ├── map_ch00_act2b.json
│   ├── map_dg01_alley.json    # 副本图 3 张
│   ├── map_dg02_bandit.json
│   └── map_dg03_dock.json
├── dialogues/
│   └── dlg_ch00.json          # 对话树
├── enemies/
│   └── enemies_ch00.json      # 敌人表（19 种，含 4 Boss）
├── equipment/
│   ├── items_base.json        # 装备模板
│   └── drops.json             # 掉落配置表
├── dungeons/
│   └── dungeons.json          # 副本定义（解锁条件、波次、掉落权重、唯一掉落）
├── knowledge/
│   └── knowledge_all.json     # 知识卡（12 张）
└── quiz/
    └── quiz_ch00.json         # 章末测验题库（12 题）
```

> 目录里的文件数量与实测一致（`Get-ChildItem` 可复核）。**没有 `achievements/` 与 `characters/` 目录**——成就系统与角色数值表本期都未实现，`achievements` 只是存档里的一个空数组字段。

### 5.1.2 加载流程

```
浏览器打开 → 加载 Phaser3 + 游戏主代码
  → 加载 index.json（章列表 + 版本号）
  → 加载 config.json（全局数值）
  → 加载 equipment/items_base.json + drops.json
  → 加载 knowledge/knowledge_all.json（轻量，全量预加载）
  → 加载 dungeons/dungeons.json（副本定义，长廊要显示副本入口）
  → 检查 localStorage 存档 → 决定从哪一章 / 哪一幕继续
  → 进入章节时：
       加载 chapters/ch00.json
       加载 events/events_ch00.json
       加载 enemies/enemies_ch00.json
       加载知识卡（已在内存）
  → 进入幕时：
       加载 acts/ch00_actY.json
       加载 nodes/nodes_ch00.json（只取本幕相关）
       加载 maps/map_ch00_actY_*.json
       加载 dialogues/dlg_ch00.json（只取本幕相关）
  → 幕通关后：卸载前幕非共享资源，进入下一幕
```

**性能守则**：
- 单次加载的 JSON 合计 ≤ 60 KB（gzip 后），否则分片。
- 不在一个 `nodes` 文件里写全章所有节点——按幕拆分写入、按需提取。
- `knowledge_all.json` 是例外：它只有 100+ 条，每条 300—600 字，总量 < 80 KB，加载一次后常驻内存。

## 5.2 JSON Schema 全集

以下所有字段表即为实际 JSON 的字段。**`type` 列标注 JavaScript 类型；`"?"` 后缀表示可选。**

### 5.2.1 `index.json` —— 全局索引

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | `number` | 数据结构版本，当前 = 2 |
| `chapters` | `array` | 章元数据数组 |

`chapters[i]` 结构：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 章 ID，例 `"ch00"` |
| `name` | `string` | 章名，例 `"觉醒年代"` |
| `period` | `string` | 时间范围，例 `"1840—1864"` |
| `acts` | `string[]` | 幕 ID 列表，例 `["ch00_act1","ch00_act2"]` |
| `quiz_id` | `string` | 章末测验 ID |
| `level_range` | `[number,number]` | 推荐等级区间 |
| `unlock` | `string` | 解锁条件，`"start"` 或 `"chXX_complete"` / `"chXX_quiz_pass"` |

> **`acts` 只列已实现的幕。** 旧版还有一个 `acts_planned` 字段，用来在长廊上显示"未来会有哪些幕"——本期两幕全部做完，这个字段已从数据与代码里删除（`HubScene` 不再读取它）。

### 5.2.2 `chapters/chXX.json` —— 章定义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 同 index |
| `name` | `string` | |
| `subtitle` | `string` | 章副标题（载入画面显示），例 `"旧中国试过的两条路"` |
| `time_text` | `string` | 时期描述，例 `"1840.6 — 1864.7"` |
| `protagonist_chain` | `string[]` | 化身链 ID，按幕序，例 `["av_guan_tianpei","av_lixiucheng"]` |
| `hub_map` | `string?` | 章节地图 ID（序章是时间轴长廊） |
| `corridor_bgm` | `string` | 章节地图 BGM |
| `new_weapon` | `string?` | 本章解锁的新武器 ID |
| `new_skill` | `string?` | 本章解锁的新技能 ID |
| `completion_weight` | `object` | 完成度权重 `{events:.4,knowledge:.3,quiz:.2,hidden:.1}` |

### 5.2.3 `acts/chXX_actY.json` —— 幕定义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 幕 ID，例 `"ch00_act1"` |
| `chapter_id` | `string` | 所属章 |
| `seq` | `number` | 章内序号，1 起 |
| `name` | `string` | 幕名，例 `"鸦片战争"` |
| `avatar` | `string` | 本幕化身 ID |
| `events` | `string[]` | 事件卡 ID 列表 |
| `primary_archetype` | `string` | 主原型，例 `"F"`（第一幕）/ `"G"`（第二幕） |
| `secondary_archetypes` | `string[]` | 辅原型 |
| `map_refs` | `string[]` | 本幕使用的地图 ID |
| `bgm` | `string` | BGM ID |
| `first_clear_reward` | `string` | 首通必掉装备 ID |
| `exp_base` | `number` | 基础经验值（通关后） |
| `nodes` | `string[]` | 节点的加载引用（ID 列表，实际数据在 nodes 文件） |

### 5.2.4 `events/events_chXX.json` —— 事件卡

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

### 5.2.5 `nodes/nodes_chXX.json` —— 玩法节点

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 节点 ID，例 `"nd_1839_humen_dialog"` |
| `event_id` | `string` | 所属事件卡 |
| `archetype` | `string` | 原型 |
| `type` | `string` | 具体玩法类型。**本期只实现 5 种**：`"dialog"`（对话/过场）/ `"combat"`（战斗）/ `"choice"`（抉择）/ `"management"`（经营分配）/ `"cutscene"`（纯展示）。设计稿里还有 `"assembly"` / `"rhythm"` / `"sort"` / `"puzzle"` / `"stealth"` / `"explore"` 等类型，属于未实现的原型，代码里没有对应分支 |
| `params` | `object` | 详见下表（按 type） |
| `dialogue_ref` | `string?` | 对话树引用 |
| `enemy_ref` | `string?` | 敌人配置引用（combat 专用） |
| `map_ref` | `string?` | 地图引用 |

### 5.2.6 `maps/map_*.json` —— 瓦片地图

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

### 5.2.7 `dialogues/dlg_chXX.json` —— 对话

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

### 5.2.8 `enemies/enemies_chXX.json` —— 敌人定义

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 敌人 ID，例 `"en_uk_infantry"` |
| `name` | `string` | 显示名 |
| `tier` | `string` | 分级 `"mob"/"standard"/"ranged"/"elite"/"boss"` |
| `hp_base` | `number` | 基准 HP |
| `atk_base` | `number` | 基准 ATK |
| `def_base` | `number` | 基准 DEF |
| `spd` | `number` | 移速乘数（0.4—2.2） |
| `ai_params` | `object` | 见 4.1.6 的参数表 |
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

### 5.2.9 `equipment/items_base.json` —— 装备模板

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
| `weapon_ref` | `string?` | **可选**，仅武器槽：指向 `config.json.weapons` 的 id，装备后进关卡真的换手上的武器（射程 / 攻速 / 倍率 / 颜色）。缺省不触发，老存档零影响；详见 `03_systems.md` 4.3.7 |

### 5.2.10 `equipment/drops.json` —— 掉落配置

顶层三个字段：`rules`（按敌人分级的掉落规则）、`level_coeff`（属性随关卡等级的放大倍数，本期 1.0）、`pity`（保底）。

`rules[i]`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source_type` | `string` | `"mob"` / `"standard"` / `"ranged"` / `"elite"` / `"boss"` |
| `drop_chance` | `number` | 掉落概率（0—1）。杂兵三类 0.08，精英与 Boss 1.0 |
| `slot_weights` | `object` | 五槽位权重。杂兵均分 20/20/20/20/20；精英与 Boss 24/19/19/19/19 |
| `quality_weights` | `object` | 品质权重。杂兵 `{"white":72,"blue":23,"purple":5}`；精英 35/45/20；Boss 15/50/35 |
| `pity` | `object` | 保底 `{"threshold":5,"boost":25}`：连续 5 次不出紫，则把白装权重挪 25 点到紫装（见 `core/dungeon.ts` 的 `PITY_BOOST`） |

> 副本的掉落不走 `drops.json`，而是写在 `dungeons/dungeons.json` 每个副本自己的 `quality_weights` 与 `unique_drop` 上——副本要固定风格、固定唯一掉落，不能用通用规则。

### 5.2.11 `knowledge/knowledge_all.json` —— 知识卡

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

### 5.2.12 `quiz/quiz_chXX.json` —— 章末测验

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

### 5.2.13 `config.json` —— 全局平衡配置

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `exp_curve` | `object` | 经验曲线 `{base:300,slope:60}`（公式见 4.4.2） |
| `hp_formula` | `object` | HP `{base:100,per_level:18}` |
| `atk_formula` | `object` | ATK `{base:10,per_level:2.2}` |
| `def_formula` | `object` | DEF `{base:4,per_level:1.2}` |
| `damage` | `object` | 伤害 `{random_min:0.95,random_max:1.05,def_factor:0.5,boss_weakpoint_mult:2.5,level_suppress_threshold:5,level_suppress_def_factor:0.7}` |
| `player_damage_mult` | `number` | 玩家伤害总倍率，当前 `0.5`（见 4.1.3 的说明） |
| `dodge` | `object` | 闪避 `{invincible_ms:180,cooldown_ms:1200,distance_px:64}` |
| `level_coeff` | `object` | 敌人随关卡等级的系数 `{base:1.0,per_level:0.085}`（见 4.4.3） |
| `weapons` | `object` | 武器数值表，键为 `wp_dao` / `wp_bow` / `wp_matchlock` / `wp_mg`（本期只用前两把，见 4.2.1） |
| `enemy_tiers` | `object` | 五档敌人模板 `mob/standard/ranged/elite/boss` |
| `affixes` | `array` | 10 条装备词条 `{id,name,min,max,weight}` |
| `quality_multiplier` | `object` | 品质倍率 `{white:1.0,blue:1.15,purple:1.32}` |
| `knowledge` | `object` | 知识加成 `{bonus_per_10:2,bonus_cap:20}` |
| `combat_feedback` | `object` | 打击感 `{flash_ms:60,knockback_melee:18,knockback_ranged:8,screenshake_amp:2}` |
| `ui` | `object` | UI `{dialog_speed:40,text_chars_per_line:18,max_lines:3,portraits:{…}}` |
| `skills` | `object` | 技能表，本期只有 `humen_cannon`（虎门重炮，虎门炮台场景专用，见 4.1.7） |

> 掉落保底不在这里：它在 `equipment/drops.json` 的 `pity` 与 `dungeons/dungeons.json` 里。旧稿曾把这个表里的 `dodge.distance_px` 写成 200，实际值是 64（= 4 格 × 16 px）。

## 5.3 示例数据（节选）

### 5.3.1 事件卡：`ev_1839_humen`

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

### 5.3.2 敌人：`en_uk_infantry`

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

### 5.3.3 装备模板：`eq_wp_dao_white_01`

```json
{
  "id": "eq_wp_dao_white_01",
  "slot": "weapon", "quality": "white",
  "name": "腰刀",
  "stat": "atk", "base_value": 12,
  "quality_multiplier": 1.00,
  "source": "quest",
  "flavor": "虎门水勇标配，刀身短而沉。",
  "weapon_ref": "wp_dao"
}
```

### 5.3.4 知识卡：`kc_1839_humen`

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

### 5.3.5 章末测验题：`qz_ch00_q01`

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

## 5.4 数值参考表

以下为游戏运行时从 `config.json` 派生的全部数值。**本文档即验收基准**；若游戏内数值与下表不符，以游戏代码中的 `config.json` 为准。

### 5.4.1 经验曲线

| 等级 | 升到下一级需求 | 等级 | 升到下一级需求 |
| --- | --- | --- | --- |
| 1 | 300 | 6 | 600 |
| 2 | 360 | 7 | 660 |
| 3 | 420 | 8 | 720 |
| 4 | 480 | 9 | 780 |
| 5 | 540 | — | — |

`需求(L→L+1) = 300 + 60 × (L − 1)`。**本期只到 Lv8**，上表列到 Lv9 是为了让"升满"之后还能看见下一级需求（超过 Lv8 的等级本期不可达）。

### 5.4.2 玩家属性与等级

| Lv | HP | ATK | DEF |
| --- | --- | --- | --- |
| 1 | 100 | 10 | 4 |
| 5 | 172 | 19 | 9 |
| 8 | 226 | 25 | 12 |

`HP = 100 + 18(L−1)`、`ATK = round(10 + 2.2(L−1))`、`DEF = round(4 + 1.2(L−1))`。本期只用这三档；公式对任意等级成立。

### 5.4.3 关卡等级系数

| 关卡推荐等级 L | 系数 | 关卡推荐等级 L | 系数 |
| --- | --- | --- | --- |
| 1 | 1.00 | 6 | 1.43 |
| 3 | 1.17 | 8 | 1.60 |
| 5 | 1.34 | — | — |

`系数 = 1.00 + 0.085 × (L − 1)`

### 5.4.4 掉落权重表

| 来源 | 白 | 蓝 | 紫 | 掉落率 | 保底 |
| --- | --- | --- | --- | --- | --- |
| 普通敌人（mob / standard / ranged） | 72% | 23% | 5% | 8% | 无 |
| 精英敌人 | 35% | 45% | 20% | 100% | 无 |
| Boss | 15% | 50% | 35% | 100% | 无 |
| 副本 · 租界暗巷（dg01） | 45% | 40% | 15% | 通关必出 1 件 | 5 次不出紫 → 白装权重挪 25 点到紫 |
| 副本 · 匪寨 / 码头（dg02、dg03） | 40% | 42% | 18% | 通关必出 1 件 | 同上 |

> 表中副本数字直接来自 `dungeons/dungeons.json` 的 `quality_weights`；前四行来自 `equipment/drops.json` 的 `rules`。旧稿把副本首通写成 30/45/25，与数据不符，已按实测值更正。

### 5.4.5 词条池与权重

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