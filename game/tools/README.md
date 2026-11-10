# tools/ —— 验证脚本与生成器（含「缓存区」约定）

> 这里的东西**不参与游戏运行**，只服务于「怎么证明它真的能跑」和「怎么批量生成数据」。
> 本目录遵守一条纪律：**脚本产出的一切都是可重建的缓存**，随时可以整个删掉而不影响游戏。

## 一、三个区，别混

| 区 | 路径 | 性质 | 能否删 |
| --- | --- | --- | --- |
| 源码区 | `src/` `public/data/` `tests/` `index.html` `*.config.*` | 唯一真相，手写 ≠ 可再生成 | 不能 |
| 生成器产物 | `public/data/maps/*.json`（由 `gen_maps*.py` 生成）、`dist/`（vite 构建） | 可由脚本重建 | 能，但重跑脚本/构建 |
| **验证缓存区** | `tools/_cdp/` `tools/_cdp2/` `tools/_cdp3/` `tools/_mobile/` `tools/_smoke/` `tools/__pycache__/` `__pycache__/` | 截图、JSON 报告、Edge profile | 随时删，下次跑自动重建 |

清理缓存（随时可执行，不影响任何功能）：

```powershell
Remove-Item -Recurse -Force tools/_cdp*, tools/_smoke, tools/__pycache__, __pycache__ -ErrorAction SilentlyContinue
```

`dist/` 是构建产物，`node_modules/` 是依赖，两者都在 `.gitignore` 里；`tools/_cdp*` 同样不入库——**报告值得看，但不值得提交**。

## 二、端到端验证脚本（真实浏览器，CDP 驱动）

为什么不用 `--dump-dom`：那个模式下 `requestAnimationFrame` 被冻结，Phaser 的时钟不走，`delayedCall` 全部不触发（实测 `clockAdvancedMs: 17`），测不出任何真实行为。这里用远程调试协议驱动一个正常的 headless Edge，真实等待若干秒，让游戏循环真正跑起来。

先构建并起服务器：

```bash
pnpm build
node tools/serve.mjs dist 4173        # 极简静态服务器，无依赖；手机试玩加第 3 个参数 0.0.0.0
```

| 脚本 | 覆盖内容 | 用法 | 产物 |
| --- | --- | --- | --- |
| `cdp-e2e.mjs` | **唯一的主链路 E2E**：点击开始引导层（`#tap-gate` → `__dshGate`）→ 长廊（7 扇门 + 副本面板 + 底部四入口）→ 第一幕战斗节点（对话、近战伤害、摇杆触摸隔离、单指点击攻/技/闪必须真的驱动角色、清场、掉落入包）→ 副本连刷两次（保底计数持久化、首通独特装备、虚拟摇杆是否被面板压住）→ 含 Boss 副本结算 → 装备界面（穿上 / 强化 / 拆解，逐项与 localStorage 对账）→ 知识图谱（连错被拒 → 连满 15/15 → 重启场景读回）→ 第二幕经营节点冒烟 | `node tools/cdp-e2e.mjs <edgePath> <baseUrl> <outDir>` | `_cdp/cdp-e2e.json` + 9 张截图 |
| `public-tunnel.mjs` | 起静态服务器 + localhost.run 隧道并打印当前公网地址（免费版域名每几分钟换一次，脚本读日志取最新的那个）| `node tools/public-tunnel.mjs`；地址失效就重跑；判断活着看 `Invoke-WebRequest` 是否 200 且长度等于 `dist/index.html` |
| `smoke.mjs` | 老式冒烟（无 CDP，逐阶段开页面查 JS 错误与关键实体是否创建） | `node tools/smoke.mjs <baseUrl> <edgePath> <outDir>` | `_smoke/` |

> 2026-06 的合并：原先 `cdp-smoke.mjs` / `cdp-act2.mjs` / `cdp-dungeon.mjs` 三个脚本各自复制了一套 CDP 样板（各 400–600 行），且在一次「用 PowerShell 往返改文件」时被 GBK 解码毁掉（中文行乱码 + 收尾引号被吞，`node --check` 直接报 `Invalid or unexpected token`）。长尾修复不可控，改为一个脚本 `cdp-e2e.mjs`（约 620 行），一次跑完整条主链路；细粒度的数值断言仍然由 `tests/*.test.ts` 兜（9 个文件 / 191 条）。

专项脚本：

| 脚本 | 用途 |
| --- | --- |
| `check-boss.mjs` | 观察 Boss 一段时间内**实际执行了哪些招式**——只看阶段数据里有 `ram` 不算数，要看到真的产生了弹幕、真的召唤了敌人、真的进入弱点期 |
| `check-title-stop.mjs` | 走真实入口 `Title.startGame` 时 TitleScene 是否被正确停止、Enter 键是否在两个场景上重复触发 |
| `analyze_shots.py` | 截图体检：确认画面真的渲染了内容（不是纯黑/纯色），统计主色分布是否落在 24 色调色板内 |
| `_cdp/props-probe.mjs` | **场景布景专项**：`kind:'prop'` 的 Sunny Land 道具只画不登记（不进 `worldObjects`），单元测试只能证明「文件在、尺寸对」，证明不了「这一格真的摆了块路障」。这个探针逐图开真实关卡（第一幕战斗 / 第二幕两节点 / 副本 dg01），点掉开场卡片与月度分配面板，把镜头挪到布景带，断言「每件都有 `sunny_*` 贴图、`drawn:true`、坐标不越界」，并逐图截图。端口 9411。用法同 `cdp-e2e.mjs`，产物在 `<outDir>/props.json` + `p1…p6*.png` |
| `_cdp/text-probe.mjs` | **文字清晰度 + 半血剧情杀专项**：① 报渲染后端实况（`cssW/bufW/dpr`、canvas 的 `image-rendering`、纹理 `scaleMode`）；② 读开场卡里的「战力对比」四段文本是否都在（`/战力对比/`、`/^我$/`、`/^敌$/`、`/^差距/`）；③ 直接调 `lv.spawnBossEntities(en_boss_steamfrigate)` 把军舰摆出来、打掉一半血，按 `lv.finalStrikeStage` 的阶段推进（`warn`→`hit`→`defeat`）截图，而不是 sleep 墙钟——无头浏览器里 sleep 会拍空帧；④ 断言战败链真的接上了（`defeated:true`、`mode:'cutscene'`、`hp:0`）。端口 9416，产物 `t1-banner…t5-defeat.png` + `text-probe.json`。**注意 `pixelFilters=false` 是预期的**：无头 Edge 走 Canvas 渲染器，而 Phaser 的 Canvas 后端不实现纹理滤镜 |
| `_cdp/act1-shot.mjs` | **第一幕人工评审**：把 act1a（销烟池）与 act1b（威远炮台）各拍「出生点」与「平移后」两张，用来肉眼确认「除边界外无空气墙、布景不浮空、观众已去掉」。没有断言，只是截图工具。端口 9413。闸门清场逻辑抄自 `_cdp/parts.mjs` 的 `settleIntro`（DOM 遮罩 → `tapCard()` → `dialogue.advance()`，循环到连续 6 帧全静） |
| `textaudit.mjs` | **文字清晰度逐屏截图**（端口 9471）。用法 `node tools/textaudit.mjs <edgePath> <baseUrl> <outDir>`。用 `Emulation.setDeviceMetricsOverride(844×390, dpr=3)` 模拟 iPhone 横屏，先打印 `bufW/bufH/cssW/cssH/dpr`（这四个数就能算出「一个逻辑像素落几个物理像素」，见 `core/constants.ts` 的 `pickRenderScale`），再逐屏各拍**两张**：`NN-xxx.png` 含 DOM 层、`NN-xxx-canvas.png` 把 `#dom-ui` 藏掉只看 canvas。走过的屏：Title / Hub / 探索 / 战斗 / Equipment / Quiz / Codex / Graph。跑完读 `<outDir>/audit.json`。**为什么要成对拍**：DOM 层是浏览器原生排版，天然清晰，只看带 DOM 的截图会误判「字已经清楚了」——canvas 到底糊不糊必须把 DOM 藏起来单独看（这个坑真踩过） |
| `_cdp/tp-defeat.mjs` | **战败重试 / 清箱回归**（端口 9388）：进第二幕金田村 / 天京城 / 城墙夜战三图，断言 `visiblePickups=0`（第一幕鸦片箱不得串幕）；在 1864 战场用 `player.takeRaw(99999)` 制造阵亡，等 `storyFailOpen` 后读面板四个文本（战败 / 再试一次 / 返回长廊），再 `emit('pointerdown')` 点「再试一次」，断言 `alive=true` `hp=maxHp` `rigDead=false` `tintFill=false` `angle=0` 且坐标回到 `map.def.spawn`。这条挡的是「死后没重试、人物变白原地复活」——`CharacterRig.dead` 没复位时 `tick()` 早退，闪白 tint 永远清不掉。用法 `node tools/_cdp/tp-defeat.mjs <edgePath> <baseUrl> <outDir>`，产物 `defeat.json` + `defeat-panel.png` / `defeat-after.png` / `clean-*.png` |
| `_cdp/tp-maps.mjs` | **地图与远景背景实拍**（端口 9387）：逐图开第一幕虎门炮台（对照组）、第二幕金田村 / 天京城 / 天京城墙夜战，输出 `node / map / tileset / mode / horizonTex / sheetLoaded` 并各拍一张。v1.3 起 `cases` 带虎门对照，用来确认 1864 城破之战换成 `art_bg_strip_tianjing_fall` 时其它关卡没被串场（当前其它地图 `sky_rows=0`，`horizonTex` 应为空）。用法 `node tools/_cdp/tp-maps.mjs <edgePath> <baseUrl> <outDir>`，产物 `maps.json` + `bg-humen-dusk.png` / `tp-*.png` |
| `_cdp/live.mjs` | **线上最小自检**（端口 9461）：只做三件事——导航到 `baseUrl`、等 `window.__dshGame` 出现并计时（`bootMs`）、把 `localStorage` 是否可用 / `isSecureContext` / canvas 后缓冲尺寸 / `Phaser.VERSION` / `#tap-gate` 状态打出来。产物 `<outDir>/live.json`。用法同 `cdp-e2e.mjs`。用途：线上「打不开」时先跑它分清是**页面没加载**（`url` 会是 `chrome-error://chromewebdata/`）还是**游戏起不来**（`hasGame:false` 但 url 正常） |
| `patch_probe_flags.py` | 给需要打线上裸 IP 的探针（`_cdp/salvo.mjs`、`_cdp/touch.mjs`、`cdp-e2e.mjs`、`mobile-probe.mjs`）统一插入 `--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstModeV2ForDesktop`。幂等，已有就跳过。**为什么必须加**：线上是 `http://` + 裸 IP，Chromium 的 HTTPS-First 会把导航升级成 `https://IP`，连不上直接停在错误页，探针表现为 `等待超时: __dshGame` 或 `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`——看着像游戏坏了，其实什么都没加载。脚本 stdout 只打 ASCII：本机控制台是 GBK，打 `✓` 会 `UnicodeEncodeError` 把脚本打断在半路（真断过一次，只补上第一个文件） |

**E2E 脚本写作要点**（都是踩过坑才写下来的）：

- 端口固定 `9341`；`cdp-e2e.mjs` 只用一个端口，因此不存在并行抢端口的问题——但也不要在它跑到一半时手动起第二个 Edge 调试实例。
- 换场景必须用脚本里的 `gotoScene(key, data)`：先停掉其它场景再 start。`game.scene.start()` 是全局场景管理器，**不会停掉调用者**，直接用会出现两个场景叠着渲染（曾导致两张截图字节完全相同）。
- **`gotoScene` 的已知伪影**：它绕过场景自己的收尾逻辑，而 DOM 层（`#dom-title` / `#dom-dialogue` / `#dom-float`）不归 Phaser 场景生命周期管，于是截图里会残留上一屏的标题大字「党史像素 RPG / 序章·觉醒年代」压在战场上。看到这种叠字**先别当 bug 报**——`TitleScene.startGame()` 里是有 `hideTitle()` 的，真人走正常流程不会看到。要干净的图就在拍之前手动隐藏这些 div（`_cdp/textprobe.mjs` 就是这么做的）。
- 场景重启后必须读**新实例**的字段。曾因此漏掉一个真 bug：`LevelScene.create()` 复用同一实例，`this.dungeon` 残留会让下一次进入正片时重开副本——现在 `create()` 里显式 `this.dungeon = null`。
- 找 UI 文本要走**递归遍历**（`hub.list` 套 `Container.list`），只看 `scene.children.list` 会漏掉容器里的标签。
- TS 的 `private` 只是编译期约定，运行时能直接调用 `lvl.startDungeon()`、`sc.equipSelected()`，E2E 大量依赖这一点。
- 强杀敌人必须 `if (e.takeDamage(1e6,false,lvl.cfg)) lvl.onEnemyDeath(e)` —— `Enemy.takeDamage()` 不会触发死亡回调。
- **按钮坐标不要硬编码**：脚本从 `window.__dshLayout`（`src/boot.ts` 挂出的 `CONTROL_LAYOUT`）读「攻 / 技 / 闪」的中心再点。加「炮」键那次重排了按钮，旧坐标 `(336,232)` 正好落进「炮」的命中区，断言就报成「技失灵」——是测试坐标问题，不是游戏 bug。
- 存档没有挂在 `window` 上，用 `game.scene.getScene('Level').save` 拿到同一个对象再改，后续内部 `persist()` 会把同一个对象写盘。
- 节点索引要对准数据：`nodes_ch00.json` 里 0/1 是对话、2 是战斗（`nd_1841_humen_battle`）、5 是经营（`nd_1853_tianjing_manage`）、7 是战斗（`nd_1864_tianjing_fall`）。
- **headless 截图必须等两帧再截**：`Page.captureScreenshot` 直接调用会拿到上一次合成的帧——连续 5 张截图的 md5 完全一样，全是引导层。正确写法是先 `await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))')`，再 `captureScreenshot { fromSurface: true }`。
- **引导层要点两次**：引擎还没加载完时点第一次只是记下 tap（监听器都还没挂），引擎就绪后按钮变成「再点一下进入」，第二次点才真正隐藏。脚本里补一句 `g.click(); g.style.display='none'`。
- **站桩清怪的探针要先保命**：玩家一死 `updateWorld()` 就提前 return，波次永远不推进，表现为「清完第一波就等不到 Boss」。每轮 `lvl.player.alive = true; lvl.player.hp = 9999;`，并顺手点掉对白与全屏卡片。
- **全屏卡片只有一条官方出口：`lvl.tapCard()`**（`LevelScene.ts:1012`，只认 `pendingCardTap`）。卡片按钮是 Phaser 里的 Text，DOM 里没有、点 `document.querySelector` 永远点不掉——第一次写布景探针时就卡在这，截图永远是那张「1841 年 2 月 虎门·威远炮台」。判定式：`if (lvl.introOpen || lvl.pendingCardTap) lvl.tapCard()`。
- **有些节点开场还有别种闸门**：第二幕战斗节点会先弹「粮草/兵员/民心」月度分配面板，里面的「确认本月分配」「记下这段历史」同样是容器里的 Text，要递归遍历 `scene.children.list → Container.list` 找文字再 `emit('pointerdown')`。
- **相机跟随的是 `lvl.player.rig`，不是 `lvl.player`**：想把镜头挪到某个坐标就反复 `rig.setPosition()` 并轮询 `cameras.main.scrollX`，一次性设置会被跟随插值拉回去。
- **地图 id 不要凭命名猜**：没有 `acts/ch00_act1b.json` 这个文件，第二幕地图靠节点 `nd_1841_humen_battle` 的 `map_ref` 决定；要进哪张图就打对应节点（`startNode: 2`）或打副本（`dungeonId`），再从 `lvl.map.def.id` 读回真实地图 id 做断言。

## 三、数据生成器（Python，一次性的，但保留可复现）

| 脚本 | 作用 | 备注 |
| --- | --- | --- |
| `gen_maps.py` | 生成第一幕两张地图（30×16 瓦片） | 手写 480 个格号必错，布局改动改脚本再跑 |
| `gen_maps_act2.py` | 生成第二幕两张地图（金田村山地 / 天京城） | 同上 |
| `gen_maps_dungeon.py` | 生成三个副本地图（租界暗巷 / 城外匪寨 / 沪上码头） | 靠墙体做出「窄」的手感 |
| `gen_taiping_tilemap.py` | 太平天国篇章瓦片地图包：36 张 16×16 PNG + 8 列拼版 + `tileset.json` + 三张 `map_ch00_tp_*.json` + 四层编辑源 + 12 张预览 + `design/taiping_tilemap_preview.html` | **纯标准库**（自写 PNG 编码，无需 Pillow）；与 `gen_maps*.py` 互不覆盖，只写 `map_ch00_tp_*`；每次运行自检边界 / 可达性 / 按键避让 / 布景 payload / **禁止 `pickup` 与木箱瓦片（防第一幕鸦片箱串幕）** / 四层折叠一致性。规格见 `design/12_taiping_tilemap_spec.md` |
| `gen_tianjing_fall_bg.py` | 把 `tools/_art_in/tianjing_fall_src.png`（AI 生成的 1864 城破之夜全景）压成 `public/art/bg/bg_strip_tianjing_fall.png`（480×64，24 色盘）：分段纵向映射把城楼 / 火光 / 城墙放进可视区、4×4 保边采样、边缘保持平滑 + 5×3 unsharp、分档量化、自适应 Bayer 抖动、1px 硬边结构层（墙顶线 / 垛口 / 飞檐 / 门洞）、顶部 HUD 区压暗。**v1.4 全部重写为清晰度优先**，见文件头注释 | **纯标准库**（自写 PNG 解码 / 编码，无需 Pillow）；输出尺寸必须与旧条带完全一致，否则 `horizonImage` 的 1.6 倍裁切与 `HORIZON_H * 1.6` 淡出带会错位；自检 24 色合规 / 顶部 9 行与 HUD 区亮度 / 火光占比 / 可见区亮度与结构边缘 / 上半部冷色占比 / 墙顶轮廓成形率，重复运行字节一致。源图右下有生成水印，裁切窗口最远到 y=830 已避开 |
| `fix_map_extras.py` | 地图手工增项**复位器**：给两张战场图补回 `battle_scars: true`；并按甲方两条删除令守住第一幕——不许有 `sky_rows`（远景实心带＝空气墙）、不许有围观百姓 `door_N`（m01249「把第一幕的观众也全去掉」），谁加回来就清掉 | **重跑任何 `gen_maps*.py` 之后跑一次**（2026-11-05 重新生成把 `battle_scars` 抹掉过）。可重复执行；末尾用与 `tests/art.test.ts` 相同的算法复核「首个整行可走以下不得有内部实心格」 |
| `add_act2_data.py` | 向已有 JSON 追加第二幕的节点/事件/知识卡/对话/敌人/装备，并新建幕定义、更新章索引 | **读-改-写**，避免手写大段 JSON 出错 |
| `add_dungeon_data.py` | 追加副本所需的敌人、装备、副本定义 | 同上 |
| `add_demo_data.py` | 演示版数据：`config.json` 减小闪避距离（200→64）+ 写入 `skills.humen_cannon`；新增精英「郭富准将」；改写虎门战斗节点的三波敌军（第三波含郭富）+ 战败继续/国运扣减/战败与条约文案 | **读-改-写**；可重复执行（郭富会先被剔除再插回） |
| `fix_graph_links.py` | 修 `knowledge_all.json` 的自指链接 + 补一座连通桥 | 按实际缩进正则重建，**以无 BOM 的 UTF-8 写回**（BOM 会让 `JSON.parse` 直接报错） |
| `add_node_titles.py` | 给节点补 `title` / `year`（左上角战役条要显示「幕名 · 这一场　年份」） | 读-改-写、可重复执行；`tests/data.test.ts` 会检查每个节点都有这两项 |
| `mk_portrait.py` | 把 AI 出的立绘（JPEG，棋盘格底是像素不是透明）转成游戏用的 96×112 透明 PNG：从四边框泛洪抠底 → 只留最大连通域（顺带丢掉「AI生成/千问」水印）→ 开运算吃掉轮廓边的 JPEG 彩噪 → 透明区填黑再缩放（边缘自然收成深色描边）→ alpha 二值化 | 用法 `python tools/mk_portrait.py <src> <dst>`；加 `--bust` 在抠底后先裁成头肩像（用户要求「立绘只要头」）。**同尺寸才能直接替换**：`tests/art.test.ts` 锁死立绘必须是 96×112，且文件名要与 `config.json → ui.portraits` 一致 |
| `import_parts.py` | 把甲方出的「积木小人分件图」切成游戏用的分件贴图：品红底泛洪抠底 → 按列切出 头/身/臂/腿/兵器 五件 → 等比预乘缩放 → 对齐到 24 色盘 | 原图丢 `tools/_art_in/parts/`（`<兵种>_<front\|side>.jpg`）再跑。输出 `public/art/parts/<兵种>_<朝向>_<件>.png`。**缺件就整只退回旧版整张贴图**（`CharacterRig.buildParts` 的 `has()` 全查一遍才拼），所以切图后先看 `tools/check_parts.py` 的对照表 |
| `check_parts.py` | 用离线 PIL 把分件按 `CharacterRig.PIVOT` 的锚点拼成 8 倍大对照表（左：按游戏锚点拼装，右：原稿那张），不开浏览器就能看出刀是不是离手、帽子会不会压到肩上 | 锚点与 `src/gfx/CharacterRig.ts` 的 `PIVOT` 必须**成对手改**（脚本里有两处同样数值的字典）；它只做拼装、不写游戏资源 |
| `gen_units.py` | 生成兵种小人贴图：6 个兵种（`qing_officer` 玩家亲兵 / `qing_green` 绿营兵 / `qing_batou` 刀牌手 / `uk_infantry` 英军步兵 / `uk_grenadier` 掷弹兵 / `gough` 郭富）× 四朝向 `_down/_up/_left/_right`，24×32，颜色全部取自 24 色盘 | 输出到 `public/art/units/`。兵种→贴图的映射在 `src/core/constants.ts` 的 `UNIT_ART` / `unitArtOf()`，**新增兵种要同时改这三处**（脚本、常量、`tests/art.test.ts`） |
| `prep_art_assets.py` | 把甲方给的美术原图整理成游戏资源：`tools/_art_in/bg_*.png`（960×540）减半成 `public/art/bg/bg_sea_*.png`（480×270）；`tools/_art_in/scars.png`（512×512 贴图集）按 alpha 投影切成 12 张 `public/art/scars/scar_NN.png` | 原图放 `tools/_art_in/` 再跑。切贴花靠「行/列投影 + 连通带」，**换贴图集后要数一下切出来的张数是不是 12**（`SCAR_TEX` 与 `MapRenderer.paintScarStickers` 的分组按 0-2 弹坑 / 3-5 血泊 / 6-8 尸骸 / 9-11 碎砖来排） |
| `gen_strips.py` | 从全景里裁出战场远景条 `public/art/bg/bg_strip_{night,red}.png`（480×64），并把所有 `sky_rows` 地图的**顶上前 4 行碰撞改成实心** | 远景条窗口是全景的 y=120..260；改窗口就要同步改 `Backdrop.HORIZON_H=64` 与地图 `sky_rows`（=4）。那几行必须不可走，否则玩家会走进远景带、看着像站在海面上 |
| `import_fx.py` | 把甲方给的 GIF 特效拆成游戏用的逐帧 PNG：保留每帧完整画面 → **所有帧按同一系数缩放** → 逐帧把自己不透明包围盒的中心搬到画布正中 → 写到 `public/art/fx/<名字>/fx_NN.png`。`python tools/import_fx.py "<源 gif>" public/art/fx/cannon_blast --size 96` | 输出是 `art/fx/cannon_blast/fx_00…fx_47.png`（96×96，48 帧），常量在 `src/core/constants.ts` 的 `FX_TEX` / `FX_CANNON_FRAMES` / `FX_FRAME_MS`。**两个坑**：① 不能按一个固定爆心开窗裁切——源 GIF 的爆心在画布上从 x=70 漂到 x=132，前段刚喷出的火舌会被裁掉，必须先缩放再逐帧居中；② 帧数变了要同步 `FX_CANNON_FRAMES`，`tests/art.test.ts` 会核对「48 个文件都在且都是 96×96」 |
| `map_repo.mjs` | 打印全仓骨架：每个文件的头部说明注释 + 导出符号 / JSON 顶层键 | 用来核对 `src/README.md` 等目录文档是否漏了文件 |
| `import_crowd.py` | 把甲方给的围观百姓条带（`tools/_ref_crowd.png`，480×96，5 个放大 6 倍的像素小人）还原成 6×12 的 PNG | 不重画、只按 6 像素一格取色并丢背景色；输出给 `CROWD_SCALE=3` 的最近邻放大用（18×36，和玩家小人 24×32 同量级）。直接在游戏里缩放原图会糊边且挡路 |
| `serve.mjs` | 极简静态服务器（`node tools/serve.mjs <dir> <port> [host]`） | 自带 MIME 表与 `Cache-Control: no-store`；文本资源自动 gzip（1.4 MB → 0.35 MB）；`host` 传 `0.0.0.0` 时监听全部网卡并打印局域网地址，供手机同网试玩 |
| `pack_deploy.py` | 把 `tools/_stage/`（= `dist` 去掉 `_deploy`）打成 `tools/_deploy_game.zip`，**arcname 用正斜杠** | ⚠️ 不要用 PowerShell 的 `Compress-Archive` 打这个包：它写反斜杠，Linux 解压后文件名变成 `assets\index.js`，nginx 直接 404（踩过一次，日志里 `warning: /tmp/game.zip appears to use backslashes as path separators`）。脚本结束时自检 `backslash_names=0` |
| `deploy_ecs.py` | 阿里云 ECS 一键部署：SSH 登录 → 装 nginx/unzip → SFTP 传包 → 解包 `/var/www/dsp` → 写站点配置（gzip + 静态长缓存）→ 重启并自检。`$env:DSP_PW="密码"; python tools/deploy_ecs.py 39.103.58.244` | 密码只走环境变量，不落盘。线上地址 `http://39.103.58.244/`；**首屏 gzip 后约 55 KB**（boot 块 163 KB → 50 KB），整站 1.56 MB / 151 个文件 |
| `deploy_ecs.sh` | 同上，纯 shell 版（给「网页终端粘贴」用）：`curl -fsSL <url>/_deploy/deploy.sh \| bash -s -- <url>` | 文件必须 LF 换行（CRLF 会让 `bash` 报 `$'\r': command not found`）；只在不想交出 SSH 密码时用 |

Python 用打包好的解释器：

```powershell
& "C:\Users\Lecoo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" tools/gen_maps_dungeon.py
```

## 四、验证顺序（每次改完代码照这个顺序走）

```bash
pnpm exec tsc --noEmit     # 类型
pnpm test                  # 单元测试（纯逻辑 + 数据完整性 + 文档对齐）
pnpm build                 # 构建，顺便看首屏体积有没有爆
node tools/serve.mjs dist 4173
node tools/cdp-e2e.mjs "<edgePath>" http://127.0.0.1:4173 tools/_cdp   # 主链路 + 副本 + 装备 + 图谱 + 经营冒烟
```

三层各管一段，缺一层就会漏一类问题：`tsc` 管不着逻辑，单元测试管不着面板，E2E 管不着数值细节。**改动涉及 UI 时，还必须用 `read_image` 逐张看截图**——断言全绿但按钮被虚拟摇杆压住这种事真的发生过。

手机端（点击开始 + 自动横屏）的验证不在上面这条链路里，它要模拟竖屏视口：

```bash
node tools/mobile-probe.mjs "<edgePath>" http://127.0.0.1:4173        # 默认 outDir tools/_mobile
```

判据（`tools/_mobile/tap-probe.json`）：`bootMs` 在秒级（本机约 1.3 s，经公网隧道约 7 s；若到 60 s 量级说明引擎又被打包进 bundle 了）；`net.count` 应为 8 个资源左右、`net.totalKb` 在 420 KB 上下（引擎走 CDN 后剩下的都在 boot 包里），突增说明有人把 `import Phaser` 写回了静态依赖；默认（auto）竖屏下锁不上屏就会 CSS 旋转，此时 `__dshGate.map(195,422)` 必须等于 `{x:240,y:135}`（屏幕中心映射到画面中心）；真实触摸后 `Input.activePointer` 也必须落在 (240,135)；`afterButtonTap.scenes` 必须是 `["Hub"]`（这条才是「点得动」）。截图 `p1-gate.png` / `p2-after-gate.png` / `p3-after-button-tap.png` 要逐张看。三种模式的整流程断言用 `node tools/_cdp/gate-portrait.mjs "<edgePath>" "<baseUrl>[?norot=1|?rot=1]" <outDir>`：auto = 点开始前不转、点后自动横（rotClass=true 或 locked=true）、真横过来后 rot 撤销，且标题页操作提示不再写「手机请横屏」（`titleNoRotateNag`，读的是 Title 场景里活的 Text）；hint(`?norot=1`) = 全程不转、只弹提示；force(`?rot=1`) = 加载即转。探针必须先等 `window.__dshGate` 再点——主模块接管前那一下只会置 `__tapGatePending`（引导层自己的「先手」逻辑），点了也不进游戏；点开始后还要等 `scene.isActive('Title')` 再判定，早于 create() 抓到的画面是 BootScene 的进度条，会误判。

引导层「两个按钮」专项用 `node tools/_cdp/gate-buttons.mjs "<edgePath>" "<baseUrl>" <outDir>`（端口 9397，输出 `gate-buttons.json` + `p1`–`p4` 截图）11 条判据：`twoButtonsVisible` / `sideBySide`（两个按钮都在屏幕内、且**横向**在屏幕内不重叠）/ `rotButtonHitTest`（`elementFromPoint` 命中的确实是「横屏」按钮）/ `notRotatedBeforeTap` / `rotatedByButton`（点「横屏」后 `html.rot` 到位）/ `gameNotStartedByRotButton`（`__dshGate.tapped` 仍为 false —— 这条是「横屏按钮不等于开始」的唯一证据，别用 `__dshGame` 或 `scene.isActive` 代替，它们加载阶段就是 true）/ `startEntersGame` / `gateHiddenAfterStart` / `stillRotatedAfterStart` / `landscapeDropsRotation` / `landscapeCanvasWide`。截图 `p1-portrait-two-buttons.png`（竖屏两个按钮）、`p2-after-landscape-button.png`（点横屏后引导层仍是正的文字、按钮并排）、`p3-after-start-button.png`（进游戏的横向画面）、`p4-landscape.png`（真横过来之后）要逐张看。

游戏内「⟳ 横屏」按钮（`#rotate-btn`）的专项检查：竖屏点开始后按钮应 `show` 且带 `on`；手动把 `documentElement` 的 `rot` 类摘掉（模拟旋转被撤）后按钮应回到 `on` 以外的状态；再 `click()` 它，`__dshGate.rotated` 必须变回 true 且 `map(195,422)` 仍是 `{x:240,y:135}`。**位置不能只看 `getBoundingClientRect`**：`html.rot` 下 CSS 变换只在绘制阶段生效，那个矩形返回的是未变换的布局盒子——要判「用户眼里的右上角」就在合成后的屏幕上 `elementFromPoint(innerWidth-24, innerHeight-24)`，命中应是 `rb-txt`/`rb-inner` 而不是 `game-root`。

「小兵会不会被打出地图」专项用 `node tools/_cdp/enemy-bounds.mjs "<edgePath>" "<baseUrl>" <outDir>`（端口 9399，输出 `enemy-bounds.json` + `b1`/`b2` 截图）。它进第一幕战斗节点（`startNode: 2`）后**主动制造越界**：把每个活着的敌人依次挪到地图右边界外、下方边界外、负坐标、原始海面格，再调 `__dshLevel.rescue()`，断言 `__dshLevel.unsafe()` 全部为 false 且落在图内。判据 `pushedOff_<case>`（确认真的推到了不可站的地方，否则测试是空转）/ `rescuedOnMap_<case>` / `allEnemiesOnLandAfterFrames`（再跑若干真实帧后仍无人下水）。`__dshLevel` 是 `LevelScene.create()` 末尾挂的调试钩子：`enemies()` / `allEnemies()` / `map()` / `unsafe(x,y)` / `grid()`（碰撞格 ASCII 图，`#` = 墙或海）/ `traceLanding(x,y)`（环形搜索每圈找到的空地）/ `teleport(i,x,y)` / `rescue()`。踩过的坑：`startNode: 2` 会先弹开场情境卡与对白，**必须点掉卡片并循环 `dialogue.advance()`**，否则世界冻结、一个怪都不刷（`enemies()` 恒为 0，测试会假绿）；`actId`/`chapterId` 是两个字段（`{actId:'ch00_act1', chapterId:'ch00'}`），只写 `chapterId:'ch00_act1'` 会报「未知章节」。

标题页按钮专项用 `node tools/_cdp/title-menu.mjs "<edgePath>" "<baseUrl>" <outDir>`（端口 9398，输出 `title-menu.json` + `t1`–`t4` 截图）7 条判据：`continueKeepsProgress`（点「继 续」后存档的 chapter/act/level 原样保留）/ `continueEntersHub` / `restartWipesSave`（点「重 新 开 始」后 act 回到 `ch00_act1`、level 回到 1、achievements 清空）/ `restartStaysOnTitle`（人还站在标题页，不是死按钮）/ `restartShowsStartButton`（按钮表**就地重画**成 `开 始`、`重 新 开 始` 消失）/ `startBeginsFreshGame` / `errors`。截图 `t1-title-with-save.png`、`t2-after-continue.png`、`t3-after-restart.png`（应只剩「开 始」）、`t4-after-start.png`。注意 `press()` 的返回值 `ok:false` 是**正常**的：`emit('pointerdown')` 会走完回调并销毁旧按钮，之后 `n.active` 自然变成 false；要看效果请读 `list()`。

炮火特效专项用 `node tools/_cdp/cannon-fx.mjs "<edgePath>" "<baseUrl>" <outDir>`（端口 9401，输出 `cannon-fx.json` + `f1`–`f5` 截图）7 条判据：`allFramesLoaded`（48 个 `fx_cannon_blast_N` 纹理都在）/ `frameSize96` / `cannonFired` / `cannonEnteredCooldown` / `fxAppeared` / `fxAdvanced`（截图拍到的不止一个帧号，证明在换纹理而不是卡在第 0 帧）/ `fxDestroyedAfterEnd`（3 秒后场上不留残影）。截图按开炮后 200 / 500 / 900 / 1500 / 3000 ms 拍，依次应是闪光 → 金色放射 → 橙红火球 → 灰烟 → 干净战场。**两个坑**：① 移玩家要同时改 `player.x/y`（射程判定读它）与 `player.rig`（画面读它）；② 地图尺寸用 `__dshLevel.map()` 返回的 `{w,h}`——`LevelScene.map` 是 `MapRenderer` 实例，只有 `pixelWidth/pixelHeight`，写成 `L.map.w` 会得到 undefined → NaN → 开炮因「敌人在射程外」直接返回、特效一个都不出现（会白白误判成特效没接上）。

波次强化（每清一波三选一，只强化弓）用 `node tools/_cdp/wave-upgrade.mjs "<edgePath>" "<baseUrl>" <outDir>`（端口 9402，输出 `wave-upgrade.json` + `u1`–`u5` 截图）16 条判据：`startsWithSingleRow` / `startsWithNoSummary`（开局是单发、无强化）/ `cardAppearsAfterWaveCleared`（清完一波真的弹卡）/ `cardShowsTitle` / `cardShowsThreeChoices`（数卡片上的三项名字）/ `cardWorldFrozen`（卡片期间 `introOpen`）/ `controlsHiddenDuringCard` / `cardClosesAfterPick` / `upgradeApplied` / `summaryNonEmpty` / `worldResumed`（选完摇杆回来——这条挡的是「选完动不了」）/ `bowIsSingleShotBase` / `threeRowsFireThreeArrows`（齐射满级一次 `playerAttack` 真的生成 3 个投射物）/ `hasteSpeedsUpBow`（实际间隔 = 基础 ÷ 1.24）/ `zeroLevelFiresOneArrow`（清零后回到 1 支） / `upgradesResetOnRestart`（重进关卡强化清零）。**三个坑**：① 必须先等 `wavePending === false` 再清场——`spawnWave` 是每 260ms 放一个敌人的定时器，清早了下一批立刻补上，`alive` 永远不为 0，波次分支不进、卡片永远不弹；② 开局玩家拿的是刀，弓要捡第 2 波前掉的 `eq_wp_bow_white_01`，测强化要先把 `player.weapon` 换成 `cfg.weapons.wp_bow`；③ 清场只翻 `alive`，别自己 `rig.destroy()`——`clearDeadEnemies()` 会调 `e.destroy()` 一并销毁 rig，重复销毁抛错。