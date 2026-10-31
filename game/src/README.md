# src/ —— 代码地图

> 这份文件写给「接手改这个工程的人或 AI」：**先看这里，再决定打开哪个文件**。
> 每个条目包含：职责 / 主要导出 / 改它会波及谁。改完代码请同步这里，`tests/docs.test.ts` 会检查文件与本表是否一一对应。
>
> 重新生成骨架骨架用：`node tools/map_repo.mjs .`（打印每个文件的头部注释 + 导出符号）。

## 分层与依赖方向

```
main.ts
  └─ scenes/            ← 全部玩法都在场景里，场景之间靠 EventBus 通信
       ├─ systems/      ← 输入、对话框（被 UIScene / LevelScene 调用）
       ├─ entities/     ← 玩家、敌人（被 LevelScene 创建与驱动）
       ├─ gfx/          ← 占位矢量美术、瓦片渲染
       └─ core/         ← 数据、数值、存档、纯玩法逻辑
```

**硬性约束：`core/` 里的 `balance / constants / DataLoader / dungeon / graph / management / quiz / SaveManager / types` 不 import Phaser。**
这条线是单元测试能跑在 node 环境的前提（`vitest.config.ts` 里 `environment: 'node'`）。往这些文件里加 `import Phaser` 会让 7 个测试文件全部炸掉。
需要渲染的东西一律往 `scenes/` 或 `gfx/` 放。

## core/ —— 纯逻辑层（可单元测试）

| 文件 | 行数 | 职责 | 主要导出 | 改动波及 |
| --- | --- | --- | --- | --- |
| `core/constants.ts` | 282 | 全局常量：内部分辨率 480×270、瓦片 16、角色 24×32、24 色锁定调色板、`darkerOf/lighterOf`、`DEPTH`、`SAVE_KEY`、`DATA_ROOT`、`CONTROL_LAYOUT`/`CONTROL_HIT_PAD`（虚拟按键圆心与半径）、`ART`/`SHIP_TEX`/`TEX_CRATE`/`SHIP_FRAME`/`BG_TEX`/`SCAR_TEX`/`UNIT_ART`/`unitArtOf`/`HORIZON_ROWS`（正式美术路径、纹理 key、兵种→贴图映射） | 常量 + 两个配色函数 | 全部文件。改 `VIEW_W/H` 要同步 `FIELD_COLS/ROWS` 与 UIScene 布局；改 `SAVE_KEY` 等于清档；改 `CONTROL_LAYOUT` 要跑 `tests/data.test.ts` + `tests/art.test.ts`（后者断言 8 个鸦片箱不在按钮命中圈内，曾被玩家反馈「第八个鸦片找不到」）；改 `ART` 里的路径要跑 `tests/art.test.ts`（会真的读 PNG 头校验尺寸） |
| `core/types.ts` | 466 | 与设计书 7.2 节 JSON Schema 一一对应的接口定义 | 全部接口 | 编译器会把影响面直接指出来，改字段名很安全。`NodeDef.title` / `NodeDef.year` 只服务左上角战役条（数据里有则不写代码也能改显示名） |
| `core/balance.ts` | 335 | 数值公式：等级属性、经验曲线、伤害（减法防御 + 暴击 + 弱点 ×2.5 + 等级压制）、掉落品质、词条、强化/拆解价值、`effectiveStats` | `levelStats` `expToNext` `applyExp` `computeDamage` `rollQuality` `makeItemInstance` `enhanceCost` `salvageValue` `knowledgeBonus` `aggregateEquipment` `effectiveStats` | `tests/balance.test.ts` 用设计书表格断言。改数值必须同步设计书 6.4 / 6.6 表格，否则测试红 |
| `core/SaveManager.ts` | 230 | localStorage 存档 + 版本迁移（缺字段用默认值补齐，绝不清档）、背包/装备/知识/成就写入、章节完成度 | `createDefaultSave` `migrate` `SaveManager` `equipItem` `addToBag` `markNodeDone` `addKnowledge` `unlockWeapon` `chapterCompletion` | 改 `SaveData` 结构必须同时改 `migrate()` 和 `tests/save.test.ts`，否则老玩家存档会缺字段 |
| `core/DataLoader.ts` | 164 | 从 `public/data/` 读 JSON（带缓存）：index / config / 装备 / 掉落 / 知识 / 章节包 / 地图 / 幕 / 副本 | `dataLoader` `DataLoader` `ChapterBundle` `clearDataCache` | 改了 JSON 目录结构或文件名要同步这里 |
| `core/EventBus.ts` | 127 | 跨场景事件总线（HUD、toast、目标、输入开关、操控显隐、HUD 整块显隐、左上角战役条） | `bus` `EV` `emitHud` `emitToast` `emitObjective` `emitSceneLabel` `getSceneLabel` `setInputEnabled` `setControlsVisible` `getControlsVisible` `setHudVisible` `getHudVisible` | 加事件先在这里加常量；订阅方要处理场景重启（旧 scene 的回调会打到已销毁对象）。**`CONTROLS_VISIBLE` / `HUD_VISIBLE` / `SCENE_LABEL` 都存了模块级状态**：LevelScene 比 UIScene 先发，事件会丢，UIScene 建好时必须用 `get*()` 补读一次 |
| `core/dungeon.ts` | 82 | 副本纯逻辑：紫色保底计数、掉落权重改写、解锁判定、首通独特装备 | `PITY_THRESHOLD` `PITY_BOOST` `getDungeonState` `pityWeights` `updateAfterClear` `recordDungeonClear` `dungeonUnlocked` `shouldGrantUnique` `pityHint` | `tests/dungeon.test.ts` 锁死；`LevelScene.rollDrop` / `finishDungeon` 依赖它 |
| `core/graph.ts` | 146 | 知识图谱纯逻辑：由知识卡 `links` 推导必需边、连线校验、进度、连通分量 | `edgeKey` `buildRequiredEdges` `attemptEdge` `graphProgress` `neighbours` `connectedComponents` `linkable` | `tests/graph.test.ts` + 真实数据校验（无自指、无孤岛）；`GraphScene` 依赖它 |
| `core/management.ts` | 175 | 天京经营：6 点/月 × 8 个月，逐月上涨的消耗 → **任何策略都会崩**（设计意图，不是平衡 bug） | `settleMonth` `validateAlloc` `simulate` `finalVerdict` | `tests/management.test.ts` 断言「19 种合法分配全部崩盘」 |
| `core/quiz.ts` | 74 | 章末测验：抽 5 题、判分、四档完成度 | `QUIZ_PASS_THRESHOLD` `QUIZ_DRAW_COUNT` `sampleQuestions` `scoreQuiz` `completionTier` | `QuizScene` + `tests/quiz.test.ts` |
| `core/orientation.ts` | 62 | 屏幕方向判定与旋转兜底的坐标反算（纯函数）：竖屏判定、`planOrientation` 决策（要不要 CSS 兜底；开关本身在 OrientationGate）、`unrotateToLocal` 屏幕→画布、`toGameSpace` 画布→480×270 | `isPortrait` `planOrientation` `unrotateToLocal` `toGameSpace` | `systems/OrientationGate.ts` 调它；`tests/orientation.test.ts` 锁四个角的映射，别改公式 |
| `core/cannon.ts` | 96 | 「虎门重炮」纯逻辑：伤害分档（小兵秒杀 / 精英 45% 且不致死 / BOSS 3%）、炸膛自伤、冷却、溅射、清王朝血条 | `DYNASTY_MAX` `planCannonShot` `cannonReady` `cooldownSeconds` `within` `applyDynastyDelta` | `LevelScene.fireCannon` 调用；`tests/cannon.test.ts` 锁死「不秒杀精英/BOSS」「炮弹不抵消敌弹」；参数在 `config.json → skills.humen_cannon` |
| `core/space.ts` | 69 | 纯几何：从任意一点按圈向外找最近的可站点（`nearestOpenPoint`），用来把卡进海面/墙里的角色挪出来 | `nearestOpenPoint` `tileCenter` | `LevelScene.ejectPlayerFromSea` 用它。**判断「不可站」要同时查 `isSeaAt` 和 `isSolidAtWorld`**：海面是运行时禁区、不在碰撞格数据里，只查地图碰撞会让脱困永远不触发（玩家实测卡死在军舰压出的水坑里就是这个原因） |

## scenes/ —— 玩法层

| 文件 | 行数 | 职责 | 关键入口 | 改动波及 |
| --- | --- | --- | --- | --- |
| `scenes/BootScene.ts` | 67 | 加载全局数据 → 建/迁移存档 → 进标题。**存档单例也在这里**：模块级导出 `SAVE` `saveManager` `getSave()` `persist()` | `getSave` `persist` | 所有场景都靠这条链路拿存档。改存档时机要小心：`persist()` 是全量覆盖写 |
| `scenes/TitleScene.ts` | 175 | 标题 + 「开始」按钮（兼 iOS 音频解锁手势）；底部操作提示行按 `__dshGate.rotated` 每帧对表，画面已横过来就不再写「手机请横屏」 | — | 改标题要保留音频解锁调用点；提示行的 POST_UPDATE 同步别删——自检撤销旋转时要靠它把提示放回来 |
| `scenes/HubScene.ts` | 367 | 时间轴长廊：幕门选择、节点门、副本面板、底部四入口（图鉴/装备/图谱/测验） | `setCursor` `enterQuiz` `buildDungeonPanel` | 场景会被反复进入 → `create()` 里所有数组/光标/相机位置必须重置（踩过：二次进入崩溃） |
| `scenes/LevelScene.ts` | 3184 | **一个场景承载全部关卡玩法**，由 nodes JSON 驱动。模式：`explore` `combat` `cutscene` `choice` `escort` `management`，外加副本模式（`this.dungeon` 非空）。`preload()` 加载正式美术：全景图与远景条（`BG_TEX`）、12 张残破贴花（`SCAR_TEX`）、Boss 舰 6 帧、鸦片箱、两位说话人立绘、6 个兵种 × 四朝向（`UNIT_ART`） | `startNodeInner` `buildWorld` `showBattleIntro` `spawnWave` `spawnBoss` `onBossPhaseCleared` `startDungeon` `finishDungeon` `spawnWorldObject` `refreshObjectLabels` `nearestEnemy` `aimAtNearest` `playerAttack` `ejectPlayerFromSea` `update` | **改动风险最高的文件**。加功能先读 `startNodeInner`（进节点）/ `buildWorld`（换地图）/ `update`（每帧推进）三处。可交互物必须走 `spawnWorldObject`（它负责金色描边/呼吸光晕与 `extra` 的显隐销毁），别在别处直接 `add.rectangle`；`worldObjects[].rect` 既可能是 `Rectangle` 也可能是 `Image`（贴图到位后），只能用 `visible/x/y` 这类共有成员。**`create()` 必须把三个闸门 `transitioning` / `pendingCardTap` / `introOpen` 复位**——实例被复用，若上一轮停在卡片或切节点的 `await` 里，`updateWorld()` 开头就 `return`，波次不推进、玩家也动不了。节点带 `banner` 时**先放情境卡、再放对白、对白读完才上第一波**（三步顺序写在 `showBattleIntro` 的注释里） |
| `scenes/UIScene.ts` | 512 | 常驻 HUD（HP/经验/武器/目标/toast）+ 左上角战役条（「幕名 · 这一场　年份」+「时间 · 地点 · 敌军」）+ 目标文字（贴在战役条下方，甲方要求不占屏幕正中）+ 右上角「暂停」与暂停面板（继续 / 返回主菜单）+ 清王朝血条 + 创建 `InputSystem` | `controlsShown` `hudShownNow` `pauseShownNow` `openPause` `closePause` `backToTitle` `onSceneLabel` `setHudShown` | **跨场景层级：UIScene 永远盖在 LevelScene 之上，`setDepth` 跨场景无效**。要盖住操控只能发 `setControlsVisible(false)`，要临时收起整块 HUD（开场情境卡）发 `setHudVisible(false)`——**只有底板没有内容引用的部件（HUD 底条 / 经验槽 / 清王朝底槽）也必须在 `setHudShown` 的清单里**，否则卡片上会留下两条孤零零的空槽（截图里出现过）。`onSceneLabel` 会无条件 `setVisible(true)`，所以它末尾要按 `hudShown` 再收一次 |
| `scenes/CodexScene.ts` | 127 | 知识图鉴，展示收集加成（每 10 张 +2%，上限 +20%） | — | 只读存档 |
| `scenes/QuizScene.ts` | 403 | 章末测验：抽 5 题 → 逐题解释 → 判分 → 四档评价 → 写 `progress.completion` | — | 选项高亮用 `optionRects` 数组定位（踩过：索引错位） |
| `scenes/EquipmentScene.ts` | 457 | 五槽位装备 + 12 件一页背包 + 装备/卸下、拆解、强化、选中详情 | `items` `equipSelected` `salvageSelected` `enhanceSelected` `back` | 所有行都要能点（触屏）；强化上限 +5 写在 `balance.enhanceCost` 侧 |
| `scenes/GraphScene.ts` | 324 | 知识图谱：事件按年份蛇形排开，点两个节点连线，连满解锁成就 | `pickNode` `redraw` `saveGraph` `dottedLine` | 节点命中区 32×32（触摸）；**不要给字段起名 `events`**（与 `Phaser.Scene.events` 冲突，TS2416） |

`main.ts` 只做一件事：**先把 Phaser 取来，再动态 `import('./boot')`**（引擎没到位时，场景类的 `extends Phaser.Scene` 会直接抛错 → 黑屏）。`boot.ts` 才是原来的入口：`Phaser.Game` 配置 + 场景注册顺序 `[Boot, Title, Hub, Level, UI, Codex, Quiz, Equipment, Graph]` + 挂 `window.__dshGame` 调试钩子（E2E 脚本靠它）。新场景必须注册到这里，否则 `scene.start` 静默失败。

## entities/ + gfx/ + systems/

| 文件 | 行数 | 职责 | 改动波及 |
| --- | --- | --- | --- |
| `entities/Player.ts` | 310 | 移动（按轴分离碰撞）、闪避、武器冷却、重击（`trySkill`，独立冷却）、受击（防御 ×0.5 减免） | `takeDamage` 的减伤在 Player 内做，`computeDamage` 只算攻方。`faceTowards` 只改四方向朝向（画面），命中方向由 `LevelScene.playerAttack` 的精确角度决定（自动瞄准最近的敌人）。`setBlocker(v)` 是为剧情杀准备的硬锁：锁住后移动输入全部失效，只能由外层解锁 |
| `entities/Enemy.ts` | 547 | 三态 AI（idle/chase/attack）+ Boss 分阶段循环（弹幕/召唤/冲锋→弱点窗口） | 交战半径 `ENEMY_ENGAGE_RADIUS=560` 会盖过数据里的 `detect_radius`（数据只决定追击耐心 leash）——玩家反馈「不靠近敌人敌人就不动」。**`takeDamage()` 返回是否死亡但不会回调 `onDeath`**；真正击杀流程是 `LevelScene.damageEnemy()` → `onEnemyDeath()`。E2E 强杀必须手动补这一步。舰船类敌人（`body:'ship'`）走 `haltActions()` 后不再出招但仍每帧 `syncBar()`，所以血条与箭形永远贴着 `rig`；`syncBar()` 里还把 `hpRatio ≤ 0.35` 同步给 `rig.setDamaged()` 换破损帧 |
| `gfx/CharacterRig.ts` | 399 | 角色/舰船绘制：默认是矩形拼装小人（走/挥击/闪白/死亡）；**兵种贴图模式**在 `RigOptions.unit` 传了 `UNIT_ART` 的键、且四朝向纹理齐全时启用（`add.image` + 只换纹理不翻转，`tick()` 用 1px 上下浮动代替腿摆）；`body:'ship'` 时若 `opts.art` 的纹理已加载，改用 96×48 贴图（6 帧：待机/后坐/冒烟/舷炮齐射/破损 A/B），否则退回矩形拼装的蒸汽炮舰 | 对外方法名不要改，`Player/Enemy` 依赖。贴图锚点是 `origin(0.5,1)` + `y=8`，让吃水线（第 40 行）落在容器原点——改这个偏移船会浮空或陷进海面。**帧索引越界会退回第 0 帧**（`frameTexture`），不会出现空贴图。兵种贴图缺失会自动退回矩形小人（不报错），所以「贴图没生效」先查 `UNIT_ART` 的 key 与 `preload()` 是否加载 |
| `gfx/MapRenderer.ts` | 608 | 瓦片绘制：地面层整层烘成一张 canvas 纹理，按瓦片色推断材质（海/沙/石/木）并画浪脊、砂点、砖缝、木纹；`battle_scars` 打开时再叠**战场残破化**（弹坑/血泊/尸骸/碎木）与**破烂炮台**（塌口胸墙 + 两门炸坏的岸炮）；前景层仍用 Graphics 画 + `isSolidAtWorld/Tile` 碰撞查询 `battle_scars` 的贴花走 `paintScarStickers()`：优先用甲方 12 张贴图（`SCAR_TEX`，0-2 弹坑 / 3-5 血泊 / 6-8 尸骸 / 9-11 碎砖，按 6×3 抖动网格铺），贴图缺失时退回 `paintScars()` 的矢量画法。**砖面高光只给约 45% 的格子**：每格都点一条 1px 亮边会连成一张亮网格，整块地像贴了瓷砖（截图评审发现过）。| 材质推断在 `tileStyleOf()`：**蓝得明显**（b−r ≥ 60 且 b−g ≥ 20）才算海、低饱和偏冷算石、暖亮算沙、暖暗算木。第一版写成 `b > r + 20`，把紫灰的炮台地面 `#6B6489` 也判成海，整片场地画上浪花，截图里像站在水上——改阈值时务必连 `#6B6489`/`#4A4468` 一起验。地图设了 `sky_rows` 时前几行**不画地砖**（留透明给远景条），但碰撞照旧。**海面不是碰撞格**，玩家能不能下海由 `LevelScene.isSeaAt`（`Player.setBlocker`）决定——两者别混。残破化痕迹用 `dry(x,y)`（= `!isSeaPixel`）跳过水面，96 个随机点里约 1/3 会落在海上，不跳过就出现「浮在海上的弹坑」。纹理 key **每实例唯一**（`map_ground_<mapId>_<seq>`）：复用固定 key 再 `textures.remove` 会让上一帧还在渲染的 Image 拿到空纹理，Phaser 在 `batchSprite` 里抛 `Cannot read properties of null (reading 'glTexture')` |
| `gfx/Backdrop.ts` | 382 | 背景与远景条：优先用甲方给的全景图（`BG_TEX.intro` = `art/bg/bg_sea_red.png` 480×270、`BG_TEX.horizon` = `art/bg/bg_strip_night.png` 480×64），**缺图时自动退回程序化绘制**（`backdropTexture()` 起火舰 + 烟柱 + 半沉残骸；`horizonTexture()` 天空 + 海平线 + 舰影 + 硝烟，只用 24 色盘） | `backdropImage` `horizonImage` `HORIZON_H` | 美术图到位后把两个 `*Texture()` 换成 `load.image` 即可，调用点（`LevelScene.showBattleIntro` / `buildWorld`）不用改。远景条按**底边对齐**留白带下沿（`setOrigin(0,1)`），否则最下面几像素的海会被第一行地砖盖住、船像沉进地里。烟要用一叠小团叠出来（`drawSmoke`），画成一个大圆饼会像气球 |
| `systems/InputSystem.ts` | 417 | 虚拟摇杆 + 攻/闪/查 三键 + 只在战斗幕出现的炮键 + 键盘等价键；写共享单例 `controls`；`setShown()` 整体显隐、`setCannonShown()` 只显隐炮键 | 所有输入回调都要同时检查 enabled 和 hidden 两个开关；新增按键要登记进 `parts` 才能被 `setShown` 隐藏；**摇杆只认「按在摇杆圈里」的那根手指**（`stickPointerId` 只能由 `stickHit.pointerdown` 领取），否则按「查」时手指一抖角色就跟着走；**「本帧按下」标志只能由 `LevelScene.update` 末尾的 `controls.endFrame()` 清**，挪进 `UIScene.update` 会让触屏单点在被读到之前就消失——E2E 的 `stages.act1.touch` 与 `stages.act1.buttons` 分别守这两条 |
| `systems/OrientationGate.ts` | 354 | 「点击开始」入口 + 横屏：**点一下屏幕就横**——`onTap` 里同步置 `state.wantLandscape=true` 并立刻 `reflow()`（不等异步全屏/锁屏），锁得上交给系统转、锁不上给容器加 `.rot` 用 CSS 转 90° 并改写 Phaser 的坐标反算。点之前（gate 还盖着）不转，引导层保持正立；视口真的横过来后自动撤掉 CSS 旋转回到原生横屏。**游戏内「横屏」按钮 `#rotate-btn`**：竖屏时浮在右上角，`onRotateButton()` 重新置 `wantLandscape` 并再申请一次全屏/锁屏（这是新手势才有的能力）。`?norot=1` 只弹「请横屏」提示、`?rot=1` 强制 CSS 旋转（此模式不显示按钮）。**唯一让步是自检不过（`rotationBlocked`）——那时撤销旋转退回提示，宁可提示也不能留一个「转了但点不动」的画面** | 改旋转公式只改 `core/orientation.ts`；`index.html` 里的 `#tap-gate`、`#rotate-btn` 与 `html.rot` 样式必须同步；桌面横屏不会触发全屏；E2E 按 `__dshGate.url.{rot,hint}` 分支断言。**`html.rot` 下按钮的定位不能靠 `getBoundingClientRect` 推像素**：CSS 变换只在绘制阶段生效，那个矩形返回的仍是未变换的布局盒子（踩过一次，按钮飞到屏幕外）；正确做法是套一个与 `#game-root` 同尺寸同变换的盒子，按钮用 `right/top` 贴角 |
| `core/defeat.ts` | 90 | 战败演出时间轴：`DEFEAT_BEATS`（freeze/pullback/fleet/boom/text/hold/reveal 各自毫秒数）、`defeatTimeline()`、`beatAt(ms)`、`beatStart(name)`、`DEFEAT_TEXT`（大字文案与副标题）| 纯逻辑，可单测；改节奏只改这张表，演出实现（`DefeatCinematic`）按它排程 |
| `systems/AudioKit.ts` | 130 | 无素材音效：WebAudio 现场合成炮响 / 爆炸 / 闷响 / 心跳；`AudioKit.play(name)` 惰性创建 AudioContext，`mute()` / `resume()` | 手机浏览器要求先有用户手势（点引导层即可）；没有 mp3 也出声是刻意的，换真素材改 `SYNTH` 表 |
| `systems/DefeatCinematic.ts` | 260 | 「城破」演出：冻结世界 → 镜头拉远 → 舰队剪影推进 → 炮火余响 → 大字放大 + 画面抖动 → 停留 → 移交；`play(opts)`，结束时自己还原镜头与 HUD | 演出期间必须 `setHudVisible(false)` + `setControlsVisible(false)`；重进关卡要 `destroyAll()`，否则镜头停在拉远状态；E2E 用 `lvl.breachCinema` 判断是否在演 |
| systems/DialogueBox.ts | 231 | 底部对话框 + 打字机（≤3 行 ×18 字），E/点击推进；说话人立绘（config.json → ui.portraits，首次出现时按需 load.image） | 打字机计时用 performance.now()，**不能用 scene.time.now**（会被暂停/缩放影响）；立绘必须 container.addAt(img, 2)——插在 1 会被占位框盖住；**对话期间摇杆与按键要隐藏**（LevelScene.updateWorld 每帧 setControlsVisible(!dialogue.isActive && …)），否则摇杆正压在立绘上 |

## vendor/ —— 运行时适配层

| 文件 | 行数 | 职责 | 改动波及 |
| --- | --- | --- | --- |
| `boot.ts` | 96 | 真正的启动入口（由 `main.ts` 动态载入）：Phaser.Game 配置、场景注册、`window.__dshGame`、`installStartGate`、resize/可见性处理 | 场景数组在这里；新增/删除场景必须同步 `tests/data.test.ts` 之外的注册表 |
| `vendor/phaser-global.ts` | 21 | 把 `index.html`/加载器取来的全局 `Phaser` 重新导出成模块默认导出。`vite.config.ts` 把 `phaser` 别名到这里，所以 18 处 `import Phaser from 'phaser'` 一行不用改，而 bundle 从 1.2 MB 缩到 100 KB | 换 Phaser 版本要同时改 `vendor/loadPhaser.ts` 的 CDN 地址和 `public/phaser.min.js` 这份兜底副本 |
| `vendor/loadPhaser.ts` | 84 | 引擎加载器：CDN（bootcdn，12 s 超时）→ 本地 `./phaser.min.js` 兜底；成功即挂到 `globalThis.Phaser` | 加载失败会停在引导层并改 `#boot-hint` 文案；超时值别调太小，弱网首次冷启动要几秒 |

## 改东西的配方

- **加一件装备**：`public/data/equipment/items_base.json` 加条目 → `drops.json` 里让它能掉（或挂到副本 `unique_drop`）→ `tests/data.test.ts` 会校验引用存在。
- **加一个敌人**：`public/data/enemies/enemies_ch00.json` 加 `EnemyDef`（`ai_params` 差异化，不写新 AI）→ 在 `nodes`/`dungeons` 里引用。远程敌人需要 `projectile` + 施法前摇 ≥550ms。
- **加一个副本**：`public/data/dungeons/dungeons.json` 加定义（`quality_weights` 三档和为 100，白色 >0 才能被保底扣）→ 加一张 `public/data/maps/map_*.json`（右侧 55% 之后要有可站立的出生格）→ 解锁靠 `act_cleared_<actId>` 成就。
- **加一个节点类型**：`core/types.ts` 的 `NodeType` → `LevelScene.startNodeInner` 加分支 → 记得处理 `nodeBusy` / `transitioning` 两个闸门。
- **加一个场景**：`src/scenes/XxxScene.ts` → `main.ts` 场景数组注册 → 需要从长廊进就在 `HubScene` 加入口 → **`create()` 里重置所有可变状态**（场景会被反复进入）。

## 已知陷阱（都是真踩过的）

1. **别用 Phaser.Scene 的内置成员名做字段**：`events` / `scene` / `input` / `time` / `cameras` / `add` / `children`。`GraphScene` 曾用 `private events` 直接 `TS2416`。
2. **`this.scene.start()` 会停掉自己，`game.scene.start()` 不会。** E2E 脚本里用后者曾导致两个场景叠在一起渲染（截图字节完全相同）。
3. **`transitioning` + `nodeBusy` 双闸门**：节点切换中会 `await buildWorld()`，若提前放开 `nodeBusy`，异步回来的 `startNodeInner` 会把整个节点跳过（曾导致经营节点被整段忽略）。
4. **掉落先进地面**：`rollDrop` 把装备丢到 `floorItems`，玩家走过去（`collectNearbyItems`）才进 `runDrops`。所以「这趟没掉东西」不能只看 `runDrops`——`finishDungeon` 会把剩余地面物品一起收走。
5. **硬阴影只能从调色板取色**：用 `darkerOf` / `lighterOf`，不要写数字 tint 运算，否则破坏 24 色纪律。
6. **`Enemy.takeDamage` 不触发死亡回调**（见上表）。

## 本轮新增的不变式（甲方七条反馈带出来的）
- **暂停必须真冻结**：`UIScene.openPause()` 走 `this.scene.pause("Level")`（排队的场景操作，`isPaused()` 要等一帧才变），同时 `setControlsVisible(false)` 与 `setHudShown(false)`；`closePause()` 只恢复暂停前露着的那些。别用「update 里加个 if」代替场景暂停——补间、计时器、敌人计时都会继续跑。
- **目标文字跟着战役条**：`objectiveText.y` 在 `onSceneLabel()` 里按 `scenePlate.y + scenePlate.height + 3` 重算，没有战役条时回到 38。改战役条高度或行数要连带看这一行。


- **可交互物不能落在虚拟按键的命中区下面**。`CONTROL_LAYOUT` 是权威来源，`LevelScene.spawnWorldObject()`
  会把物体往安全位置推（见 `constants.CONTROL_LAYOUT` + `tests/data.test.ts` 的「箱子不在按键区」断言）。
- **海水是碰撞格**：`MapRenderer.extraSolid` 回调在 `isSolidAtWorld()` 里最先问，敌人与掉落都要用
  `LevelScene.landingNear()` 落回岸上，否则玩家打不到也捡不到。
- **剧情闸门写在数据里**：`node.params.npc_talk = { npc, dialogue }` 决定「先说谁的台词、什么时候放开箱子」，
  代码里不留 if-else 拼章节。
- **本帧按下标志只能由 `LevelScene.update()` 末尾的 `controls.endFrame()` 清**（UIScene 里清会吞掉单点）。
5. **剧情闸门写在数据里**：`params.npc_talk = {npc, dialogue}` 会在 NPC 头顶挂感叹号并挡住 `pickup`，`npcTalked` 由 `finishNpcTalk()` 置真；`params.crate_target = 0` 表示这一幕不搬箱（箱子全部收起、出口一开始就开、目标改读 `params.objective`）。两者都只读 node 的 params，不认地图。
