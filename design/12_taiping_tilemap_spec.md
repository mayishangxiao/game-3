# 太平天国篇章 · 瓦片地图规格说明书 v1.1

> **v1.1（2026-11-09）**：三张地图已接入第二幕三个节点，`tp_act2` 图集已在渲染器生效并随版本上线。
> 第 8 节由「接入建议」改写为「已实现」，回退方式见 8.4。

> **独立交付物**（不进《第一章设计书 v2.1》正文，`build_docx.py` 只拼 `00_`–`07_`）。
> 对应工程：`game/`（Phaser 3 + TypeScript）。本文件与 `game/public/art/tiles/tp/tileset.json`
> 共同构成「可执行规格」：改设计改生成脚本，重跑即可重建全部数据，不手写格号。
>
> 可视化预览：`design/taiping_tilemap_preview.html`（自包含，含图块集总览与四层切换）。

---

## 1. 范围与结论

本期只做序章第二幕「太平天国运动（1851—1864）」的**三张单屏瓦片地图**，覆盖设计书
`02_prologue.md` 里第二幕提到的三种场景，并与工程现有 `map_ch00_act2a / act2b` 并存（不替换、不改引用，
因此现有关卡表现零变化）。设计书预留的第三张「天京城墙夜战」在本包里落地为 `map_ch00_tp_battlefield`。

| 结论项 | 值 |
| --- | --- |
| 引擎 | Phaser 3 + TypeScript，自研 `MapDef` JSON → `MapRenderer` 烘焙单张 canvas 纹理 |
| 瓦片尺寸 | **16 × 16 px** |
| 网格 | **30 列 × 16 行 = 480 × 256 px**，单屏、不滚动、世界坐标 == 屏幕坐标 |
| 图层 | 逻辑 4 层（地形 / 建筑 / 装饰 / 碰撞）→ 引擎 2 层（`ground` + `collision`）+ `objects[]` |
| 图块集 | `tp_act2`：36 个有效瓦片（id 1–36），id 0 恒为透明；8 列拼版 128 × 80 |
| 配色 | 24 色锁定 v2（`game/src/core/constants.ts → PALETTE`），禁止新色号 / 半透明 / 渐变 |
| 交付地图 | `map_ch00_tp_village` / `map_ch00_tp_city` / `map_ch00_tp_battlefield` |

---

## 2. 场景类型与关卡用途

| 地图 ID | 场景类型 | 场景名 / 史实时点 | 关卡用途 | 建议挂载节点 | 出生点 |
| --- | --- | --- | --- | --- | --- |
| `map_ch00_tp_village` | **村落**（山地村寨） | 金田村 · 山地村道 / 1851 金田起义 | 护送 + 探索：从村口由左到右，沿主路收集军粮 / 抬枪 / 药包，NPC 对话与家眷护送；右端 x=27/28 为终点 | `nd_1851_jintian_escort`（mode `escort`） | (2, 8) |
| `map_ch00_tp_city` | **城池**（都城街市） | 天京城 · 街市与天王府 / 1853 定都天京 | 经营 + 管理 + 对话：圣库、粮秣、街市交互；经营面板弹出时角色冻结，平时可自由走街串巷 | `nd_1853_tianjing_manage`（mode `management`） | (13, 8) |
| `map_ch00_tp_battlefield` | **战场**（城墙夜战） | 天京城墙 · 城破之夜 / 1864 天京陷落 | Boss 战 + 守城：湘军统领 / 洋枪队队长从右侧开阔地出生，玩家借沙袋、拒马、炮位作掩体 | `nd_1864_tianjing_fall`（mode `combat`） | (3, 9) |

**场景差异化的三条硬规则**

1. 村落必须留一条**从左到右三格宽**的连续通路（护送终点判定在像素 `x ≥ width-48`）。
2. 城池必须留**十字主街**（横 y=7..9、纵 x=14..15）与**可进入的王府门洞**，经营节点才不会把角色卡在布景里。
3. 战场必须保留**右侧 55% 之后的双格可站立出生点**（`LevelScene.spawnPoints` 规则），且开启
   `sky_rows=4` + `battle_scars=true`；村道与城池**禁止**开这两个开关。

---

## 3. 瓦片尺寸、网格与坐标

| 项 | 值 | 依据 |
| --- | --- | --- |
| 瓦片 | 16 × 16 px，1:1 原始像素，透明底禁用渐变 | `constants.ts: TILE = 16`；设计书 10 号第 5 节 |
| 战场区 | 480 × 270 内部分辨率，其中战场 480 × 256，底部 14 px 归 HUD | `VIEW_W/H`、`FIELD_H = 256` |
| 网格 | `FIELD_COLS = 30`、`FIELD_ROWS = 16` | 同上 |
| 格坐标 | `x = 0..29`，`y = 0..15`；`spawn` 用**格坐标**，世界坐标 = `(x+0.5)*16` | `LevelScene.buildWorld()` |
| 世界坐标 | `x = 0..479`，`y = 0..255`；越界一律视为实心 | `MapRenderer.isSolidAtWorld()` |
| 相机 | 不滚动；`setScroll(0,0)` + 手动 `cameraScrollTarget()`，故意不调 `setBounds/startFollow` | `LevelScene.buildWorld()` |
| 角色 | 24 × 32 px，脚底矩形四角采样碰撞 | `Player.footBlocked()` |
| 通道净宽 | **≥ 2 格（32 px）**，推荐 3 格；1 格宽会把 24 px 角色卡死 | 同上 |
| 渲染层级 | 地面 `DEPTH.ground=0`，装饰 `10`，实体 `20+`，前景 `98`，HUD `100` | `constants.ts: DEPTH` |

> 所有新地图都是**单屏**：`width*16 ≤ 480 && height*16 ≤ 256`。这条一旦破坏，
> `data.test.ts` 的「物件不能压虚拟按键」断言会失效，同时虚拟摇杆坐标体系（`CONTROL_LAYOUT`）
> 不再与世界坐标等价，需要重新设计相机。

---

## 4. 图层结构

### 4.1 逻辑四层（美术编辑态）

| 层 | 名称 | 内容 | 碰撞 |
| --- | --- | --- | --- |
| L0 | `terrain` 地形 | 草地 / 土路 / 稻田 / 石板 / 城墙砖 / 水 / 岸线 / 焦土 | 否（水体例外） |
| L1 | `building` 建筑 | 村舍 / 篱笆 / 粮仓 / 城墙 / 城门 / 箭楼 / 王府 / 铺面 / 木桥 | 逐瓦片，多数阻挡 |
| L2 | `decoration` 装饰 | 松 / 竹 / 旗 / 灯笼 / 箱桶 / 井 / 沙袋 / 拒马 / 炮位 / 营帐 / 缺口 | 逐瓦片，掩体阻挡 |
| L3 | `collision` 碰撞 | 边界 + 建筑 + 阻挡装饰的并集，值只有 `0 / 1` | 是 |

四层原始数组保存在 `game/public/art/tiles/tp/layers/<map_id>.layers.json`，供 Tiled / Aseprite
编辑与 diff；它是**编辑源**，引擎不读。

### 4.2 引擎两层（运行态）

`MapDef.layers` 只认识这些层名，落地规则写在 `tileset.json → layer_fold_rule`：

```
ground.data   = terrain 底图
              → 被 building 非零格覆盖
              → 再被 decoration 非零格覆盖
collision.data = 各层 collidable 瓦片的并集（0/1），外加显式边界
objects[]     = 可交互物（pickup / prop / npc / exit），与装饰层分开
triggers[]    = 走到即触发节点的矩形，本包三张图都为空
```

`MapRenderer` 的构造逻辑决定了这个折叠方式是**必须的**：

- `name === 'collision'` 的层不绘制，只调 `markCollision()` 写 `grid.solid`；
- 其余每个 `name !== 'foreground'` 的层都会**各自重新烘焙整张地面纹理并覆盖前一张**，
  所以当前渲染器下叠多个不透明层会互相盖掉，不能照搬 Tiled 的多层结构；
- `foreground` 层**禁用**（设计书 10 号：会遮挡角色）；
- `sky_rows` 让顶部若干行不画地砖，改由 `LevelScene` 叠 480 × 64 远景条。

> 因此：**编辑态四层，发布态两层**。要恢复多层叠加渲染，需先改造 `MapRenderer.drawGround()`
> 让它按层合成到同一张 canvas，而不是每层各建一张 Image —— 见第 8 节的可选升级。

### 4.3 三张图的层参数

| 地图 | `layers` | `sky_rows` | `battle_scars` | `objects` | 阻挡格数 |
| --- | --- | --- | --- | --- | --- |
| 村落 | `ground` + `collision` | 无 | 无 | 3 pickup + 2 prop | 178 |
| 城池 | `ground` + `collision` | 无 | 无 | 2 pickup + 2 prop | 171 |
| 战场 | `ground` + `collision` | **4** | **true** | 2 pickup + 2 prop | 211 |

战场 `sky_rows=4` 时，`y=0..3` 必须**整行实心**（`art.test.ts` 有断言锁着），
否则玩家会走进远景带、看起来像站在空中。

---

## 5. 地图尺寸与边界范围

三张图统一 **30 × 16 格 / 480 × 256 px**，外圈 1 格整圈实心（顶、底、左、右都不漏）。

| 地图 | 可玩区（格） | 边界构成 | 特殊边界 |
| --- | --- | --- | --- |
| 村落 | `x=1..28, y=2..13` | 上下各 2 行山林（松树 / 竹丛，实心）+ 左右各 1 列 | 主路 `y=7..9` 贯通 `x=1..28`；右端 x=27/28 可达 |
| 城池 | `x=1..28, y=1..12` | 四边城墙段（实心），顶边中央 x=14/15 为城门洞 | `y=14` 护城河（实心），`y=13` 岸线；x=14/15 有可通行木桥 |
| 战场 | `x=1..28, y=5..14` | 左右各 1 列 + 底边城墙；`y=4` 城墙残段 | `y=0..3` 远景带（透明 + 实心）；`y=4` 中央 x=14..17 为城破缺口，可通行 |

**可达性自检结果**（生成器每次运行都会断言，算法与 `tests/data.test.ts` 一致）：

| 地图 | 从出生点可达格 | 右侧 55% 后可用敌人出生点 | 护送右端 |
| --- | --- | --- | --- |
| 村落 | 302 | 110 | 可达 x=27/28 |
| 城池 | 309 | 118 | — |
| 战场 | 269 | 92 | — |

其它边界纪律：

- 出生点必须落在非实心格；所有可交互物本身或四邻可达（BFS）。
- 物件中心离 `CONTROL_LAYOUT` 每个虚拟按键圆心 > `r + CONTROL_HIT_PAD(8)`，
  `pickup` 再加 10 px 视觉余量（甲方反馈过「第八个鸦片找不到」）。
- `kind:'prop'` 的 `payload` 只能取 `SUNNY_PROPS` 表内名字（`rock / sign / skulls / spikes` 等），
  写错运行时只留一条 `console.warn`，截图评审看不出来。
- 地图 JSON 一律 **UTF-8 无 BOM**，2 空格缩进；用 Python 写，别用 PowerShell `Set-Content`。

---

## 6. 瓦片类型清单与图块集配置

### 6.1 图块集 `tp_act2`

| 项 | 值 |
| --- | --- |
| 名称 / 版本 | `tp_act2` / v1.0 |
| 单瓦片 | 16 × 16 px，一瓦片一张 PNG（`tp_*.png`） |
| 拼版 | `tp_act2_sheet.png`，8 列 × 5 行 = 128 × 80 px，`margin=0 / spacing=0` |
| 有效瓦片 | 36 个，id **1–36**；**id 0 恒为透明空瓦片**，`tilecount = 37` |
| 分片坐标 | `sheet_cell = { col: id % 8, row: floor(id / 8) }` |
| 配置文件 | `game/public/art/tiles/tp/tileset.json`（Tiled 标准字段 + `engine_binding` 段） |
| 配色 | 24 色锁定 v2，色值随文件内 `palette` 段一起交付 |

`tileset.json` 同时提供两套字段：

- **Tiled 侧**：`tilewidth / tileheight / tilecount / columns / image / imagewidth / imageheight /
  margin / spacing / tiles[].id / type / properties`；
- **引擎侧**：`grid`、`layers`、`layer_fold_rule`、`engine_binding.map_field="tileset"`、
  `engine_binding.value="tp_act2"`、`engine_binding.tile_colors`（id → hex，直接写进地图 JSON）、
  每个瓦片的 `engine_hex` / `render_style_hint` / `collidable` / `scenes` / `sheet_cell`。

`render_style_hint` 是 `MapRenderer.tileStyleOf(hex)` 的推断结果。当前渲染器**按颜色猜材质**
（sea / sand / stone / wood / plain），不看 PNG；所以在接入真图集之前，
绿色草地 `#7BA84A` 会被判成 `wood`、红色旗帜会被判成 `wood` —— 这是已知的占位行为，
不是 bug，PNG 接入后即由像素图本身决定外观。

### 6.2 地形瓦片（id 1–12）

| id | 文件名 | 中文 | 适用地图 | hex | 推断材质 | 阻挡 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `tp_terrain_grass_00.png` | 草地·基 | 村落 / 城池 | `#7BA84A` | wood | — |
| 2 | `tp_terrain_grass_01.png` | 草地·变体 | 村落 | `#7BA84A` | wood | — |
| 3 | `tp_terrain_grass_edge.png` | 草地·田埂边 | 村落 | `#A8D070` | sand | — |
| 4 | `tp_terrain_dirt_path.png` | 土路 | 村落 / 战场 | `#CFA26A` | sand | — |
| 5 | `tp_terrain_dirt_path_01.png` | 土路·变体 | 村落 | `#CFA26A` | sand | — |
| 6 | `tp_terrain_paddy.png` | 水田 / 稻田 | 村落 | `#A8763F` | sand | — |
| 7 | `tp_terrain_stone_road.png` | 青石板街（深，主街） | 城池 | `#6B6489` | stone | — |
| 8 | `tp_terrain_stone_road_01.png` | 青石板·变体（浅，街区） | 城池 / 战场 | `#948DAB` | stone | — |
| 9 | `tp_terrain_rampart.png` | 城墙砖面 | 城池 / 战场 | `#4A4468` | stone | — |
| 10 | `tp_terrain_water.png` | 护城河 | 城池 / 战场 | `#2A5A8A` | sea | **是** |
| 11 | `tp_terrain_shore.png` | 岸线 | 城池 / 村落 | `#E8CFA8` | sand | — |
| 12 | `tp_terrain_scorched.png` | 焦土瓦砾 | 战场 | `#4E2F1A` | plain | — |

### 6.3 建筑瓦片（id 13–24）

| id | 文件名 | 中文 | 适用地图 | hex | 阻挡 |
| --- | --- | --- | --- | --- | --- |
| 13 | `tp_building_village_roof.png` | 村舍瓦顶 | 村落 | `#7A4F2A` | 是 |
| 14 | `tp_building_village_wall.png` | 村舍土墙 | 村落 | `#E8CFA8` | 是 |
| 15 | `tp_building_village_door.png` | 村舍门洞 | 村落 | `#4E2F1A` | 是 |
| 16 | `tp_building_fence.png` | 竹篱笆 | 村落 | `#7BA84A` | 是 |
| 17 | `tp_building_granary.png` | 粮仓 / 圣库 | 村落 / 城池 | `#A8763F` | 是 |
| 18 | `tp_building_city_wall.png` | 城墙段（垛口） | 城池 / 战场 | `#6B6489` | 是 |
| 19 | `tp_building_city_gate.png` | 城门洞 | 城池 | `#2F2B45` | 是 |
| 20 | `tp_building_watchtower.png` | 箭楼 | 城池 / 战场 | `#948DAB` | 是 |
| 21 | `tp_building_palace_roof.png` | 王府琉璃顶 | 城池 | `#D4A840` | 是 |
| 22 | `tp_building_palace_wall.png` | 王府红墙 | 城池 | `#8C1C1C` | 是 |
| 23 | `tp_building_shop_front.png` | 街市铺面 | 城池 | `#7A4F2A` | 是 |
| 24 | `tp_building_bridge.png` | 护城河木桥 | 城池 | `#7A4F2A` | **否（唯一可通行跨水瓦片）** |

### 6.4 装饰瓦片（id 25–36）

装饰瓦片自带**不透明地表底色**（`base`），因此单层 `ground` 也能直接显示；
底色与主要使用场景一致，见 `tileset.json → tiles[].note`。

| id | 文件名 | 中文 | 适用地图 | hex | 阻挡 |
| --- | --- | --- | --- | --- | --- |
| 25 | `tp_deco_pine.png` | 松树 / 山林 | 村落 | `#4A7A2E` | 是 |
| 26 | `tp_deco_bamboo.png` | 竹丛 | 村落 | `#A8D070` | 否 |
| 27 | `tp_deco_banner.png` | 太平军黄旗 | 全部 | `#C0392B` | 否 |
| 28 | `tp_deco_lantern.png` | 街市灯笼 | 城池 | `#E85C4A` | 否 |
| 29 | `tp_deco_crate.png` | 木箱 | 村落 / 城池 | `#A8763F` | 否 |
| 30 | `tp_deco_barrel.png` | 粮桶 | 全部 | `#A8763F` | 否 |
| 31 | `tp_deco_well.png` | 水井 | 村落 | `#948DAB` | 是 |
| 32 | `tp_deco_sandbag.png` | 沙袋工事 | 战场 | `#CFA26A` | 是 |
| 33 | `tp_deco_barricade.png` | 鹿角拒马 | 战场 | `#7A4F2A` | 是 |
| 34 | `tp_deco_cannon.png` | 炮位 | 战场 | `#0D0B14` | 是 |
| 35 | `tp_deco_tent.png` | 营帐 | 战场 | `#E8CFA8` | 是 |
| 36 | `tp_deco_breach.png` | 城墙缺口 | 战场 | `#6B6489` | 否（可通行，视觉焦点） |

**史实约束**：旗帜用太平军黄旗红边（`star` + `red`），不画清军龙旗、不画黄龙旗；
不出现真实历史照片与人物肖像（全部像素插画）；村落不出现洋枪队，城池不出现炮台。

### 6.5 配色纪律

24 色锁定 v2 取自 `game/src/core/constants.ts → PALETTE`（`design/05_assets.md` 的旧表已过时，
以运行时常量为准）。硬规则：单帧 ≤ 8 色（角色可放宽到 12）、阴影用同色相下一档而非半透明、
瓦片层禁用渐变、所有像素不透明、`#F2EDE4` 最亮 / `#0D0B14` 最暗。

---

## 7. 命名与文件组织

### 7.1 命名规则

| 对象 | 规则 | 例 |
| --- | --- | --- |
| 瓦片 PNG | `tp_<类别>_<语义>[_两位变体].png`，全小写 snake_case | `tp_terrain_grass_01.png`、`tp_building_palace_roof.png` |
| 类别段 | 固定三值 `terrain` / `building` / `deco` | 与 id 段 1–12 / 13–24 / 25–36 一一对应 |
| 图块集 | `tp_<幕标识>` | `tp_act2`、sheet `tp_act2_sheet.png`、配置 `tileset.json` |
| 地图 ID | `map_ch00_tp_<场景>` | `map_ch00_tp_village` |
| 地图 JSON | `<地图 ID>.json`，放 `public/data/maps/` | `map_ch00_tp_village.json` |
| 编辑源 | `<地图 ID>.layers.json` | `layers/map_ch00_tp_city.layers.json` |
| 物件 ID | `obj_tp_<场景>_<两位序号>` | `obj_tp_village_01` |
| 预览图 | `preview_<场景>_<图层>.png` | `preview_battlefield_collision.png` |

**编号纪律**：id 0 恒为透明空瓦片；1–36 连续、不跳号、不复用；地图 `tile_colors` 的键是
**字符串形式的 id**（`"1"`…`"36"`），与 `ground.data` 里的整数一一对应；新增瓦片只能往末尾追加，
不许插队，否则所有旧地图的格号含义会整体漂移。

### 7.2 目录树

```
game/
├─ public/
│  ├─ data/maps/
│  │   ├─ map_ch00_tp_village.json         村落 · 金田村
│  │   ├─ map_ch00_tp_city.json            城池 · 天京城
│  │   └─ map_ch00_tp_battlefield.json     战场 · 天京城墙夜战
│  └─ art/tiles/tp/
│      ├─ tp_terrain_*.png     (12)        16×16 地形
│      ├─ tp_building_*.png    (12)        16×16 建筑
│      ├─ tp_deco_*.png        (12)        16×16 装饰
│      ├─ tp_act2_sheet.png                8×5 拼版 128×80
│      ├─ tileset.json                     Tiled / 引擎双兼容配置
│      ├─ layers/*.layers.json (3)         四层编辑源
│      └─ preview_*.png        (12)        三层 + 碰撞视图 × 3 张图
├─ tools/gen_taiping_tilemap.py            唯一生成源（纯标准库，无第三方依赖）
└─ src/gfx/MapRenderer.ts                  渲染器（本包不改它，见第 8 节）
design/
├─ 12_taiping_tilemap_spec.md              本说明书
└─ taiping_tilemap_preview.html            自包含预览页
```

`public/` 下的路径**不带 `public` 前缀**（`constants.ts` 里已有注释）；美术路径按幕懒加载，
第一幕不需要第二幕的贴图。

---

## 8. 直接接入游戏引擎

### 8.1 数据契约（已对齐，零改动）

三张地图 JSON 严格符合 `src/core/types.ts → MapDef`：

```jsonc
{
  "id": "map_ch00_tp_village",
  "width": 30, "height": 16,
  "tileset": "tp_act2",                 // 旧图是 "placeholder"；渲染器不读该字段，填新值无回归
  "tile_colors": { "1": "#7BA84A", ... }, // 程序化渲染的唯一输入
  "spawn": { "x": 2, "y": 8 },
  "layers": [
    { "name": "ground",    "data": [[...]], "collidable": false },
    { "name": "collision", "data": [[...]], "collidable": true  }
  ],
  "triggers": [],
  "objects": [ { "id": "obj_tp_village_01", "kind": "pickup", "x": 4, "y": 6,
                 "label": "军粮", "payload": "crate" } ],
  "meta": { ... }                       // 引擎忽略的编辑元数据（场景/用途/层映射/边界）
}
```

加载链路：`LevelScene.buildWorld(mapRef)` → `DataLoader.loadMap(id)`（fetch `data/maps/<id>.json`）
→ `new MapRenderer(this, def)` → `drawGround()` 逐格取帧（`tp_act2` 走图集 PNG，其余走
`paintTile()` 程序化材质）→ 烘成一张 canvas 纹理 → `DEPTH.ground`。
换节点时只有当 `map_ref` 变化才重建世界（`LevelScene:1427`）。

### 8.2 已接入：第二幕三个节点换图（v1.1）

| 节点 | 原地图 | 现地图 | 模式 |
| --- | --- | --- | --- |
| `nd_1851_jintian_escort` | `map_ch00_act2a` | `map_ch00_tp_village` | escort |
| `nd_1853_tianjing_manage` | `map_ch00_act2b` | `map_ch00_tp_city` | management |
| `nd_1864_tianjing_fall` | `map_ch00_act2b` | `map_ch00_tp_battlefield` | combat |

`game/public/data/acts/ch00_act2.json` 的 `map_refs` 同步换成这三张（顺序即剧情顺序）。
旧的 `map_ch00_act2a/b.json` 保留在仓库里作为回退素材，**不再被任何节点引用**。
回退只需把上面三处 `map_ref` 与 `map_refs` 改回旧 id，代码不用动。

> 换图后 `data.test.ts` 的 `maps` 集合变为新三张（它由 `acts.map_refs + nodes.map_ref +
> dungeons.map_ref` 汇总而成），出生点、可达性、护送右端、敌人出生点、物件避让按键
> 等断言全部适用，已全绿。

### 8.3 已实现：36 张 PNG 真瓦片生效（v1.1）

渲染器改动做成一个**显式开关**，第一幕与副本（`tileset: "placeholder"`）原逻辑一行未改：

**① `src/core/constants.ts`**：新增 `ART.tpSheet` 与
`TP_TILESET_ID / TP_SHEET_TEX / TP_SHEET_COLS`（纯常量，core 层不依赖 Phaser）。

**② `src/scenes/LevelScene.ts → preload()`**：预载拼版。

```ts
if (!this.textures.exists(TP_SHEET_TEX)) this.load.image(TP_SHEET_TEX, ART.tpSheet);
```

必须放 `preload`：`buildWorld()` 里 `new MapRenderer()` 是同步烘纹理的，
等构造时再异步加载图集就已经画完了。

**③ `src/gfx/MapRenderer.ts → drawGround()`**：逐格循环里图集优先。

```ts
const sheet = this.def.tileset === TP_TILESET_ID && this.scene.textures.exists(TP_SHEET_TEX)
  ? (this.scene.textures.get(TP_SHEET_TEX).getSourceImage() as CanvasImageSource) : null;
...
if (sheet && this.blitSheetTile(ctx, sheet, Number(tile), x, y)) continue;
const hex = this.def.tile_colors[String(tile)];
if (!hex) continue;
this.paintTile(ctx, x * TILE, y * TILE, hex);   // 旧图 placeholder 原样不动
```

`blitSheetTile()` 按 `col = id % 8`、`row = ⌊id / 8⌋` 取 16×16 帧，帧号越界返回 `false`
自动回退程序化材质；`ctx.imageSmoothingEnabled = false` 保证 1:1 像素不被插值糊掉。
`8` 来自 `tileset.json → columns`，由 `TP_SHEET_COLS` 常量固定，改拼版时两边一起改。

**④ `MapRenderer` 构造函数**对 `tp_act2` 跳过 `paintWalls()`：新图的实心格本身就是
画好的建筑 / 山林 / 掩体 PNG，再刷一层紫灰石墙会把美术整个盖掉；旧图仍靠
`paintWalls()` 补「撞得住但看不见」的空气墙。

`sky_rows`、`battle_scars`、`paintScars()`、`markPixel()` 全部沿用原流程。
`tests/art.test.ts` 新增两条断言锁住「图集尺寸 / `sheet_cell` 与 `columns` 对齐 /
三张地图的 `tileset` 声明、帧号范围与场景开关」。

### 8.4 兼容与回退

- 图集缺失、加载失败或帧号越界 → 自动回退 `tile_colors` 程序化材质，不黑屏。
- 彻底回到旧表现 → 只改 `nodes / acts` 的引用（8.2 表格），渲染器开关自然不触发。
- 其余地图（第一幕两张 + 三个副本）`tileset` 仍是 `placeholder`，E2E 与既有验收不受影响。
- 战斗目标文案按幕区分：第二幕「守住天京城墙」，第一幕 / 副本仍是「守住威远炮台」
  （修的是 `LevelScene.setupCombat()` 里的硬编码，实拍 1864 战场时发现的串幕文案）。

---

## 9. 生成、复现与验收

```bash
cd "game 3/game"
python tools/gen_taiping_tilemap.py        # 纯标准库，无需 pip install
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

生成器每次运行都会自检并打印结果，断言项与工程测试同源：

- 30 × 16 尺寸、`ground` 中每个瓦片号都在 `tile_colors` 里、无 0 号空格；
- 边界整圈实心；`sky_rows` 行全实心；出生点非实心；
- BFS：所有物件本身或四邻可达、护送地图右端可达、右侧 55% 后有双格敌人出生点；
- 物件离虚拟按键圆心 > `r + 8`（pickup 再 +10）；`prop.payload` 在 `SUNNY_PROPS` 内；
- 四层编辑源折叠结果与引擎 JSON 逐格一致。

工程侧会自动扫到新文件的测试：

| 测试 | 会检查什么 |
| --- | --- |
| `tests/docs.test.ts` | `public/data/README.md` 必须提到每张新地图 JSON；`tools/README.md` 必须提到新脚本 |
| `tests/art.test.ts` | 遍历 `public/data/maps/*.json`：`sky_rows` 行实心、`prop.payload` 已登记 |
| `tests/data.test.ts` | 地图一旦被 `map_ref / map_refs` 引用，追加检查可达性、敌人出生点、按键避让 |

**新增文件登记清单**（已同步，改文件名要一起改）：

- `game/public/data/README.md` 第六节地图清单 +3 行；
- `game/tools/README.md` 第三节生成器表 +1 行；
- `design/README.md` 独立交付物表 +1 行。

---

## 10. 已知限制与后续

| 项 | 现状 | 触发条件 |
| --- | --- | --- |
| 拼版列数两处手工同步 | `constants.ts → TP_SHEET_COLS = 8` 与 `tileset.json → columns` 必须一致；`tests/art.test.ts` 已在不一致时变红 | 改拼版列数时两边一起改 |
| 战场远景沿用黄昏海战条 | `sky_rows=4` 由 `LevelScene` 固定叠 `bg_strip_dusk.png`（海面 + 舰影）；天京不靠海，语义偏弱，夜色下观感尚可，实拍已确认 | 有「城墙夜景」远景条美术时按幕替换 |
| `foreground` 层不可用 | 会遮挡角色，且当前渲染器逐层覆盖 | 先改造 `drawGround` 为同 canvas 多遍合成 |
| 无 autotile / 过渡角 | 变体瓦片手工摆位，岸线只有一种 | 场景扩到多屏或需要自动拼接时再补 47 格 blob 集 |
| 单屏 30 × 16 | 与 `VIEW_W / FIELD_H` 绑定；多屏要重做相机与 HUD 避让 | 关卡需要滚动时立项 |
| 第三幕以上 | 不在本期范围，不预埋字段 | 按 `design/00_front.md` 重新立项 |
