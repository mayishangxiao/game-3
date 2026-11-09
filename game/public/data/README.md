# public/data/ —— 内容数据地图

> 整个游戏的内容都在这里，**改内容不用改代码**。但数据之间有引用关系，写错一个 id 会让某个节点不可通关——所以这份文件按「谁引用谁」写，并列出 `tests/data.test.ts` 已经替你挡住的检查项。
> 字段级 schema 见 `src/core/types.ts`（与设计书 5.2 节一一对应）；骨架清单用 `node tools/map_repo.mjs .` 生成。

## 一、文件总览

| 路径 | 内容 | 数量 | 主键 |
| --- | --- | --- | --- |
| `index.json` | 游戏索引：章列表与每章已实现的 `acts`（本期只有 ch00，两幕都已完成；旧字段 `acts_planned` 已删除） | 1 章 | `chapters[].id` |
| `config.json` | **数值唯一真相**：经验曲线、HP/攻/防公式、伤害与闪避、**`damage.player_damage_mult`（我方出手总体倍率）**、等级系数、4 把武器、敌人档位（含 Boss HP）、10 条词条、品质倍率、知识加成、战斗反馈、UI、**`ui.portraits`（说话人 → 立绘路径）** | — | `weapons[].id` `affixes[].id` |
| `chapters/ch00.json` | 章节元数据：名称、年代、主角链、长廊地图、完成度权重 | 1 | `id` |
| `acts/ch00_act1.json` `acts/ch00_act2.json` | 幕定义：`events[]` `nodes[]` `map_refs[]` 顺序、原型（主/次）、首通奖励、`exp_base` | 2 | `id` |
| `nodes/nodes_ch00.json` | 节点（关卡内的一次挑战）：`type` = explore/combat/cutscene/choice/escort/management + `params` | 9 | `id` |
| `events/events_ch00.json` | 历史事件卡（图鉴条目 + 关卡题材）：时间、地点、人物、文献、结果、五要素核对 | 11 | `id` |
| `knowledge/knowledge_all.json` | 知识卡：摘要/详解/出处/标签/**`links`（因果边，图谱玩法就靠它）** | 12 | `id` |
| `enemies/enemies_ch00.json` | 敌人：`tier` `hp_base` `atk_base` `def_base` `spd` `ai_params`（`attack_cooldown_ms` = 出手间隔）、`boss_phases`、**`final_strike`（Boss 半血剧情杀）**、`color` `size` | 19 | `id` |
| `equipment/items_base.json` | 装备模板：`slot` `quality` `stat` `base_value` `quality_multiplier` `source` | 16 | `id` |
| `equipment/drops.json` | 掉落规则：按来源类型的掉率、部位权重、品质权重；`pity` 保底参数 | 5 条规则 | `rules[].source_type` |
| `dungeons/dungeons.json` | 副本：波次（`waves[]`）、Boss、`quality_weights`、`unique_drop`、`unlock_act` | 3 | `id` |
| `maps/map_ch00_act1a.json` `maps/map_ch00_act1b.json` `maps/map_ch00_act2a.json` `maps/map_ch00_act2b.json` `maps/map_ch00_tp_village.json` `maps/map_ch00_tp_city.json` `maps/map_ch00_tp_battlefield.json` `maps/map_dg01_alley.json` `maps/map_dg02_bandit.json` `maps/map_dg03_dock.json` | 瓦片地图：`width/height` `tile_colors` `spawn` `layers[]` `objects[]` `triggers[]`（清单见第六节）。`map_ch00_act2a/b` 自 v1.1 起保留为回退素材、不再被引用 | 10 张 | `id` |
| `quiz/quiz_ch00.json` | 章末题库：题干/选项/答案/解析/`knowledge_ref` | 12 题（抽 5） | `pool[].id` |
| `dialogues/dlg_ch00.json` | 对话块 + NPC 表 | 9 块 | `dialogues[].id` |

> **美术资源不在这张表里**：图片放 `public/art/`（`ship/` 舰船帧、`props/` 地图物件、`portrait_*.png` 立绘），
> 路径登记在两处——立绘在 `config.json → ui.portraits`（说话人 id → 文件），舰船/箱子在 `src/core/constants.ts` 的 `ART`。
> `tests/art.test.ts` 会校验文件存在、尺寸正确、`ui.portraits` 的 key 符合 `portrait_${speaker}` 约定。

## 二、包装形状（**最容易踩的坑**）

有的文件是裸对象，有的把数组包了一层。测试里 `JSON.parse` 后取错层级，断言会静默跳过或直接抛错（本项目已经踩过一次）：

```js
index.json         → 裸对象            { version, chapters: [...] }
chapters/ch00.json → 裸对象
acts/*.json        → 裸对象（自带 events/nodes 数组）
config.json        → 裸对象
maps/*.json        → 裸对象
nodes/*.json       → { nodes: [...] }
events/*.json      → { events: [...] }
knowledge/*.json   → { cards: [...] }
enemies/*.json     → { enemies: [...] }
items_base.json    → { items: [...] }
dungeons.json      → { dungeons: [...] }
quiz_ch00.json     → 裸对象，题库在 pool: [...]
dlg_ch00.json      → { dialogues: [...], npcs: [...] }
```

## 三、引用关系（写数据时按这张图查）

```
index.chapters[].acts ──▶ acts[].id
index.chapters[].quiz_id ──▶ quiz 文件
acts[].nodes ──▶ nodes[].id
acts[].events ──▶ events[].id
acts[].map_refs ──▶ maps[].id

nodes[].event_id      ──▶ events[].id
nodes[].dialogue_ref  ──▶ dialogues[].id
nodes[].enemy_ref     ──▶ enemies[].id
nodes[].map_ref       ──▶ maps[].id

events[].knowledge_id ──▶ knowledge[].id
knowledge[].links     ──▶ events[].id      ← 图谱的因果边（不是知识卡 id！）
quiz.pool[].knowledge_ref ──▶ knowledge[].id

dungeons[].map_ref     ──▶ maps[].id
dungeons[].boss        ──▶ enemies[].id
dungeons[].waves[].spawns[].enemy ──▶ enemies[].id
dungeons[].unique_drop ──▶ items_base[].id
dungeons[].unlock_act  ──▶ index.chapters[0].acts 里真实存在的幕 id
```

## 四、编码与格式纪律

- **UTF-8，不能带 BOM。** 测试用 `readFileSync(p,'utf8')` + `JSON.parse`，BOM 会让它直接 `SyntaxError: Unexpected token '﻿'`。PowerShell 的 `Set-Content -Encoding UTF8` 会写 BOM——**改数据请用 Python（`encoding='utf-8'`）或写字节**。
- 文件是 CRLF、2 空格缩进、`links` 等短数组会折行。用字符串 `Replace` 批量改容易匹配不上，宁可正则捕获缩进再重建（踩过）。
- id 一律 `snake_case` 带语义前缀：`ev_`（事件）/`nd_`（节点）/`en_`（敌人）/`eq_`（装备）/`kc_`（知识卡）/`dg_`（副本）/`map_`/`dlg_`/`qz_`/`af_`（词条）。

## 五、已经替你挡住的检查（改完数据必跑 `pnpm test`）

**`tests/data.test.ts` —— 引用与可达性**

- 所有跨文件引用都存在（上表每条箭头）；索引里每一幕都有幕定义文件，幕的 `nodes` 与节点表双向一致，每个节点都属于本幕的事件卡。
- 事件卡五要素齐全；每个事件卡都有对应知识卡；知识卡正文与出处齐全；隐藏事件卡确实标了 `hidden`。
- 敌人：Boss 阶段区间**连续覆盖 100%→0%** 且招式名合法；普通敌人 `ai_params` 在合理范围；按行为分类检查射程与前摇搭配；Boss 基准 HP 与设计书一致。
- 对话：每行 ≤3 行 ×18 字（对话框容量），说话人都在 `npcs` 表里。
- 地图：所有 `tile_colors` 都有定义、出生点不在实心格；**可交互物本身或四邻可达**（BFS）；护送地图右端可达；战斗节点至少有一个可用敌人出生点；通用「右侧 55% 之后有可站立出生格」（`minCol = floor(cols*0.55)`，需 `!solid[y][col] && !solid[y+1][col]`）。
- 地图：**可交互物不能摆在虚拟按键底下**——单屏地图（`width*16 ≤ 480` 且 `height*16 ≤ 256`）不滚动，世界坐标即屏幕坐标，物件圆心离 `CONTROL_LAYOUT` 里每个按键圆心必须 ≥ `r + CONTROL_HIT_PAD`。这条来自玩家反馈「第八个鸦片找不到」：两个箱子正好压在「攻」「技」按钮下面，既看不见也点不到。
- 副本：`quality_weights` 三档键恰为 `blue/purple/white`、非负、`white > 0`（否则保底扣不动）、`purple > 0`、**和为 100**；`waves` 2—5；`unlock_act` 是本章已实现的幕；Boss/副 Boss 存在；`unique_drop` 存在且全局唯一。

**`tests/graph.test.ts` —— 图谱真实数据校对**

- 事件卡与知识卡一一对应；`links` **无自指**、**无悬空**；每条边两端真实存在、键集合无重复；边数 ≥3；**不出现孤岛**（所有连边节点同属一个脉络）。

**`tests/quiz.test.ts` —— 题库**

- 题量 ≥12（抽 5 还有余量）、题干/选项/解释/知识卡齐全、题号唯一、正确答案不集中在同一个位置。

## 六、地图清单（都由脚本生成，不要手写）

| 地图 | 用途 | 生成脚本 |
| --- | --- | --- |
| `maps/map_ch00_act1a.json` | 第一幕 · 虎门海滩（探索、搬箱、销烟池、NPC） | `tools/gen_maps.py` |
| `maps/map_ch00_act1b.json` | 第一幕 · 威远炮台（战斗、三波 + Boss） | `tools/gen_maps.py` |
| `maps/map_ch00_act2a.json` | 第二幕 · 金田村山地（护送走廊，从走到右） | `tools/gen_maps_act2.py` |
| `maps/map_ch00_act2b.json` | 第二幕 · 天京城（经营模块背景，角色冻结） | `tools/gen_maps_act2.py` |
| `maps/map_dg01_alley.json` | 副本「租界暗巷」（上下砖墙夹出的窄巷） | `tools/gen_maps_dungeon.py` |
| `maps/map_dg02_bandit.json` | 副本「广州城外匪寨」（寨门广场 + 高台） | `tools/gen_maps_dungeon.py` |
| `maps/map_dg03_dock.json` | 副本「沪上码头」（空地 + 货箱堆 + 吊机） | `tools/gen_maps_dungeon.py` |
| `maps/map_ch00_tp_village.json` | 太平天国专题 · 村落「金田村」（护送 / 探索），图块集 `tp_act2`；已接入 `nd_1851_jintian_escort` | `tools/gen_taiping_tilemap.py` |
| `maps/map_ch00_tp_city.json` | 太平天国专题 · 城池「天京城」（经营 / 管理 / 对话）；已接入 `nd_1853_tianjing_manage` | `tools/gen_taiping_tilemap.py` |
| `maps/map_ch00_tp_battlefield.json` | 太平天国专题 · 战场「天京城墙夜战」（Boss 战，`sky_rows=4` + `battle_scars`）；已接入 `nd_1864_tianjing_fall` | `tools/gen_taiping_tilemap.py` |

> 上面三张是 `tp_act2` 图块集的**可选专题地图**：文件已就位、`DataLoader.loadMap(id)` 直接可读，
> 但**没有**登记进任何 `acts[].map_refs` / `nodes[].map_ref` / `dungeons[].map_ref`，因此改动零回归。
> 规格见 `design/12_taiping_tilemap_spec.md`，四层编辑源与 36 张瓦片在 `public/art/tiles/tp/`。
> 三张图的 `tileset` 字段是 `tp_act2`（旧图仍是 `placeholder`，渲染器不读该字段）。

**静态布景（`kind:'prop'` + `payload` = `SUNNY_PROPS` 里的道具名）**：act1b / act2a / act2b / dg01 四张图上有
`rock / skulls / spikeSkull / spikes` 这几件，由 `art_ref/place_sunny_props.py` 落进 JSON（不在 `tools/`，因为它是
美术导入脚本的配套，见 `art_ref/art_credits.json`）。摆位规则写在脚本里，三条都是踩着坑改出来的：

- **只摆「墙顶」或「非海平地」，且要贴地**。地毯式扫全图会出两种怪图：① 图里有横贯全宽的边界行列，按列扫会**全落在同一行**；
  ② 碰撞层里大片的空地其实是空气，立起来的石堆会飘在空中。
- **`bush`（亮绿灌木）不进布景**：它是这批素材里饱和度最高的一件，压在紫灰砖地上是全屏最跳的色块，甲方看过直接要求全部去掉。
  贴图仍留在 `SUNNY_PROPS` 表里（删表项要连带改测试与文件），只是摆位脚本的 `order` 循环不用它；想恢复就往 `order` 里加。
- **第一幕（act1a / act1b）除了边界不留空气墙**（甲方原话：「除了边界全去掉」）。这两张图的碰撞层现在只有一圈边：
  act1a 是顶部 4 行（海 3 行 + 湿沙带）+ 底行 + 左右两列，act1b 是整圈 1 格。`tests/art.test.ts` 有一条断言锁着这件事
  （内部任何一格非 0 就红），改 `tools/gen_maps.py` 时别再把「看起来像礁石/柱子/远景」的格子写成实心——
  `MapRenderer.paintWalls()` 会给它们画上石墙色，玩家撞上去就是撞隐形墙。
- 布景**只画不登记**（不进 `worldObjects`、不进 `extraSolid`），所以 `tests/data.test.ts` 的「可交互物不能压虚拟按键」对它们不生效——
  但 `tests/art.test.ts` 会检查每个布景 `payload` 都在 `SUNNY_PROPS` 表里（写错名字运行时只会留一条 `console.warn`，截图看不出来）。
- **第一幕的围观百姓已去掉**（甲方 m01249）。`door_0..4` 那套 `kind:'prop'` + payload 判别式还在 `LevelScene.spawnCrowd` 里，
  但 `spawnWorldObject` 已经不再调用它，地图数据里也没有 `door_N` 条目了。想放回来：往 JSON 里加 `{"kind":"prop","payload":"door_2"}`
  再把 `spawnWorldObject` 里那两行分支恢复。**注意人群会挡路**（它往 `extraSolid` 登记格子），加回来要重跑可达性测试。

## 七、加内容的配方

- **加一个事件 + 节点**：`events` 加事件卡 → `knowledge` 加对应知识卡（并让它的 `links` 指向已有事件，避免孤岛）→ `nodes` 加节点（`event_id` 指过去）→ `acts[].nodes` 插入顺序 → 若涉及新地图就加 `maps/map_*.json`。
- **加一件装备**：`items_base.json` 加模板（`quality` 决定能否带词条：只有 `purple` 会 roll 词条）→ `drops.json` 加进对应 `quality_weights`/`slot_weights`，或直接挂某个副本的 `unique_drop`。
- **加一个敌人**：`enemies_ch00.json` 加条目，`ai_params` 决定行为（不为单个敌人写新 AI）；远程需要 `projectile` 且前摇 ≥550ms；Boss 用 `boss_phases`。
- **加一个副本**：`dungeons.json` 加定义 → 新地图（右侧留出生格）→ `unlock_act` 指向已实现的幕。
- **加数值平衡**：改 `config.json`（不用动代码），但设计书 4.4 / 4.3 的表格也要同步，否则 `tests/balance.test.ts` 会红。
- **加一章（本期不做）**：`index.json` 加 chapter、`chapters/` 加章定义、`acts/` 加幕、各文件按 `chXX` 命名——工程侧没有为下一章预留字段，`acts_planned` 已经删了。

### 「打不过才是史实」那套数值（甲方 m01507）

第一幕虎门之战被故意调成了**打不赢**，玩家要活的不是胜利，是亲眼看它怎么输。四处开关：

| 位置 | 作用 | 现用值 |
| --- | --- | --- |
| `config.json → damage.player_damage_mult` | 我方出手的总倍率，乘在 `LevelScene` 的三条出手路径上（远程、近战、弹道） | `0.5` |
| `enemies_ch00.json → 敌兵.atk_base` | 单次伤害基数 | 蒸汽炮舰 `56`（其余未动） |
| `enemies_ch00.json → 敌兵.ai_params.attack_cooldown_ms` | 两次出手的间隔，**越小越快** | 全体减半（floor `140`） |
| `enemies_ch00.json → Boss.final_strike` | Boss 跌破半血时的剧情杀：`{warn, hit_line, hp_mult, warn_ms}` | `hp_mult: 3`、`warn_ms: 2600` |

`final_strike` 走的是 `LevelScene.startFinalStrike` → 白光 + 伤害数字 → `playDefeatSequence()`（城破演出 → 战败卡 → 条约 → 牺牲 → 继续），
**不会卡关**（节点的 `defeat_continues` 为真）。它不是普通伤害：护盾、闪避、无敌帧一律不生效，因为这不是数值，是剧情。

> 改这几项时**不要只改一面**：光把敌人调快一点、玩家调慢一点，玩家会觉得是 bug 而不是史实——所以开场卡上要有 `banner.power` 的战力对比把话说明白。