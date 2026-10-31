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

**E2E 脚本写作要点**（都是踩过坑才写下来的）：

- 端口固定 `9341`；`cdp-e2e.mjs` 只用一个端口，因此不存在并行抢端口的问题——但也不要在它跑到一半时手动起第二个 Edge 调试实例。
- 换场景必须用脚本里的 `gotoScene(key, data)`：先停掉其它场景再 start。`game.scene.start()` 是全局场景管理器，**不会停掉调用者**，直接用会出现两个场景叠着渲染（曾导致两张截图字节完全相同）。
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

## 三、数据生成器（Python，一次性的，但保留可复现）

| 脚本 | 作用 | 备注 |
| --- | --- | --- |
| `gen_maps.py` | 生成第一幕两张地图（30×16 瓦片） | 手写 480 个格号必错，布局改动改脚本再跑 |
| `gen_maps_act2.py` | 生成第二幕两张地图（金田村山地 / 天京城） | 同上 |
| `gen_maps_dungeon.py` | 生成三个副本地图（租界暗巷 / 城外匪寨 / 沪上码头） | 靠墙体做出「窄」的手感 |
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
| `map_repo.mjs` | 打印全仓骨架：每个文件的头部说明注释 + 导出符号 / JSON 顶层键 | 用来核对 `src/README.md` 等目录文档是否漏了文件 |
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