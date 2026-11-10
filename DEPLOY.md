# 部署说明（给后续接手的 AI）

## 一键发布流程

在 `D:\game_project\game 3\game` 目录下依次执行：

```powershell
# 1. 环境变量（每次新开 shell 都要设）
$env:DSP_PW="Yf17853221623"
$node="$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm="$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

# 2. 类型检查
& $node $pnpm exec tsc --noEmit

# 3. 跑测试（288 个，全绿才继续）
& $node $pnpm test

# 4. 构建
& $node $pnpm build

# 5. 打包到 staging
$stage="tools\_stage"
Remove-Item -Recurse -Force $stage
New-Item -ItemType Directory -Path "$stage\game" | Out-Null
Copy-Item -Recurse "dist\*" "$stage\game\"
Copy-Item "tools\_landing_index.html" "$stage\index.html"
python tools/pack_deploy.py

# 6. 部署到阿里云
python tools/deploy_ecs.py 39.103.58.244
```

**捷径**：改完代码后，上面 2-6 步可以合成一条命令（tsc 过了才 build/deploy）：

```powershell
& $node $pnpm exec tsc --noEmit 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { & $node $pnpm build 2>&1 | Select-Object -Last 1; $stage="tools\_stage"; Remove-Item -Recurse -Force $stage; New-Item -ItemType Directory -Path "$stage\game" | Out-Null; Copy-Item -Recurse "dist\*" "$stage\game\"; Copy-Item "tools\_landing_index.html" "$stage\index.html"; python tools/pack_deploy.py 2>&1 | Select-Object -Last 1; python tools/deploy_ecs.py 39.103.58.244 2>&1 | Select-Object -Last 1 } else { Write-Output "TSC FAIL" }
```

## 线上地址

- 首页：http://39.103.58.244/
- 游戏：http://39.103.58.244/game/
- 服务器：阿里云 ECS，`root@39.103.58.244`，密码在环境变量 `DSP_PW` 里

## GitHub

- 仓库：https://github.com/mayishangxiao/game-3 （master 分支）
- 推送：`git add -A; git commit -m "说明"; git push origin master`
- 注意：不要提交 `tools/_stage/`、`dist/`、`tsc_out.txt`、`_fix_json.py`、`_t.json`

## 关键架构（改文字时必看）

- **canvas 文字全糊**：后缓冲固定 480×270，手机高 dpr 屏被拉伸。所有中文已搬到 DOM 层（`src/systems/DomUi.ts`）。新增界面文字一律走 `showOverlay(html)` 或直接挂 DOM，**不要再用 `this.add.text()` 写中文**。
- `#dom-overlay` 内部用 480×270 逻辑坐标，CSS transform 自动缩放。
- 直接挂 `#dom-ui` 的元素（如 NPC 浮动标签、暂停按钮）用 CSS 像素 = 逻辑坐标 × (canvas.clientWidth / 480)。
- 所有 DOM 覆盖层必须 `pointer-events:none`，否则吃掉 canvas 点击。
- 切场景时每个新场景 `create()` 开头要调 `hideOverlay()`，否则上一页 DOM 文字残留。
- Phaser 引擎优先从本地 `/game/phaser.min.js` 加载（北京机房快），CDN 兜底。

## 发布前检查清单（每次发版照着走）

- [ ] `pnpm exec tsc --noEmit` 0 错
- [ ] `pnpm test` 全绿（当前 14 文件 / 288 条）
- [ ] 改动涉及装备时，确认 `items_base.json` 里每个 `weapon_ref` 都在 `config.json.weapons` 里（`tests/data.test.ts` 会挡拼错），且未标字段的模板与老存档仍走原武器逻辑；跑 `node tools/_cdp/equip-presence.mjs <edgePath> <baseUrl> tools/_cdp/equip`，确认 `equip-presence.json` 的 `ok=true` / `errors=[]`，并逐张看 `equipment-initial.png` / `equipment.png` / `level-equipped-bow.png` 无文字重叠
- [ ] `pnpm build` 通过，确认 `dist/` 里带了本次新增的静态资源
- [ ] 改动涉及渲染 / UI 时，用 CDP 探针实拍并逐张看截图（断言全绿不等于画面没问题）
- [ ] 改动涉及死亡 / 复活 / 关卡物件时，跑 `node tools/_cdp/tp-defeat.mjs <edgePath> http://127.0.0.1:4173 tools/_cdp/tp`，确认 `defeat.json` 里 `after.alive / rigDead / tintFill / visiblePickups` 全部达标
- [ ] 改动涉及远景背景时，跑 `node tools/_cdp/tp-maps.mjs ...`，确认只有城破之战 `horizonTex=['art_bg_strip_tianjing_fall']`、虎门对照组为空，并逐张看 HUD 白字清晰度
- [ ] 改动涉及远景背景**像素**时，重跑 `python tools/gen_tianjing_fall_bg.py`，自检的「HUD 区亮度 / 可见区平均亮度 / 结构边缘 / 上半部冷色占比 / 墙顶轮廓成形率」必须全过；可见区亮度不得比上一版明显升高（会抢前景），并做一次引擎可见区（源图 x=90..390 / y=0..40，1.6 倍）前后放大对照
- [ ] `_stage` 打包成功（`has_index=True`、`backslash_names=0`）
- [ ] 部署后打开首页与游戏页，抽查一个新增资源 URL 返回 200
- [ ] Git 提交不含 `tools/_stage/`、`dist/`、`tsc_out.txt`、`_fix_json.py`、`_t.json` 与临时探针截图

## 发布记录

| 日期 | 发版内容 | 验证 | 线上 |
| --- | --- | --- | --- |
| 2026-11-09 | 太平天国篇章瓦片地图接入：三张 30×16 地图（金田村 / 天京城 / 天京城墙夜战）替换第二幕三个节点；`tp_act2` 图集的 36 张 16×16 PNG 在 `MapRenderer` 生效，旧图程序化材质原样保留；修正 1864 战场串用第一幕「守住威远炮台」的目标文案；规格书升 v1.1 | `tsc` 0 错；`vitest` 14 文件 / 263 条全绿；`vite build` 通过；CDP 实拍三张地图，`tileset=tp_act2`、图集已加载、控制台零异常 | http://39.103.58.244/game/ |
| 2026-11-09 | **v1.2 热修**（真机截图反馈）：剧情关战败改为「战败 / 再试一次 / 返回长廊」面板，不再 900ms 后自动原地复活；`CharacterRig.revive()` + `Player.resetForNode()` 完整复位死亡状态（清 `dead` / 闪白 tint / 倒地 tween）并回到地图出生点，副本重来走同一路径；清除三张太平天国地图误放的第一幕 `pickup/crate` 鸦片箱共 7 个（改静态布景）、木箱装饰瓦片不再摆放、沙袋工事改横向矮墙；新增 `tests/data.test.ts` 防串幕断言与 `_cdp/tp-defeat.mjs` 回归探针；规格书升 v1.2 | `tsc` 0 错；`vitest` 14 文件 / **264 条**全绿；`vite build` 通过；CDP 实拍：面板四文本齐全，点重试后 `alive=true / hp=100 / rigDead=false / tintFill=false / angle=0`、坐标回到出生点，三图 `visiblePickups=0`，控制台零异常 | http://39.103.58.244/game/ |
| 2026-11-09 | **v1.3 背景替换**：1864 天京城破之战的远景条换成「火光四起 / 战火映照 / 浓烟弥漫」的战争夜景 `bg_strip_tianjing_fall.png`（480×64、24 色盘、顶部 HUD 区压暗）；新增 `gen_tianjing_fall_bg.py` 可复现生成，`horizonImage` 加 `'cityfall'` 分支、只在 `tp_act2 + sky_rows>0` 启用；原 `bg_strip_dusk.png`、虎门开场卡片底图、页面布局 / 文案 / 前景元素 / 其它素材全部未动；规格书升 v1.3 | `tsc` 0 错；`vitest` 14 文件 / **265 条**全绿（新增背景回归断言）；`vite build` 通过；CDP 实拍：城破之战 `horizonTex=['art_bg_strip_tianjing_fall']`、HUD 白字清晰、角色与地面无遮挡，虎门等关卡 `horizonTex=[]` 未受影响，控制台零异常 | http://39.103.58.244/game/ |
| 2026-11-10 | **v1.4 背景清晰度修正**：针对「城破之战背景过于模糊」，重写 `gen_tianjing_fall_bg.py` 的像素处理（纵向映射把城墙/城楼移进可视区、保边采样、边缘保持平滑 + unsharp、24 色盘分档量化、自适应抖动、1px 硬边结构层描回墙顶/垛口/飞檐/门洞、火光映照与高亮档收敛），重新生成 `bg_strip_tianjing_fall.png`。**仅**改这 2 个文件；布局、配色、文案、前景、其它背景图、渲染代码一行未动；规格书升 v1.4（8.7 节） | `tsc` 0 错；`vitest` 14 文件 / **265 条**全绿；`vite build` 通过且 `dist` 资源与源字节一致；生成器自检：顶部 9 行亮度 12.6（旧 20.7）、HUD 区 17 行 20.1、可见区亮度 55.1（旧 54.6，不抢前景）、结构边缘 8.93（旧 8.47）、上半部冷色 90.7%、墙顶轮廓成形率 83.1%，重复生成字节一致；引擎可见区（x=90..390 / y=0..40，1.6 倍）前后放大对照确认轮廓更清楚；线上 PNG 返回 200 且与本地字节一致，默认 `bg_strip_dusk.png` 未变。**CDP 实拍未执行**：无头浏览器访问外网被 `net::ERR_BLOCKED_BY_CLIENT` 拦截（本地预览服务按用户取消未重启），非页面故障；本次渲染链路未改，v1.3 的实拍结论继续有效 | http://39.103.58.244/game/ |

| 2026-11-10 | **v1.5 装备存在感改造**：按诊断结论「机制是通的，但玩家感知不到」落地 5 条，且**不改任何既有数值/公式**。① `compareWithEquipped()` 纯函数把「比身上的好多少」接上拾取 toast、副本结算每行（绿▲/红▼）、换装消息；② `items_base.json` 加可选 `weapon_ref` → `config.json.weapons`，`makeItemInstance()` 透传，进关卡 `resetForNode()` 后真的 `setWeapon()`（新增近战重钝器 `wp_crowbar`，未标字段与老存档零影响）；③ `enhanceGain()`/`firstGainfulEnhance()` 让强化按钮显示 `→ DEF 5→5`，收益为 0 禁用并提示 `+3 才有提升`，键盘 R 同步拦截；④ 掉落物改容器：形状=槽位（竖条/三角/空心方块/短横/菱形）、颜色=品质、紫装呼吸光，统一销毁先停 tween；⑤ `slotProgress()` 在左列每行显示 `最高：白 目标：紫`（目标取模板表实际最高品质，不写死紫）。文档同步 `03_systems.md` 4.3.7、`04_data.md` 5.2.9、三处 README | `tsc` 0 错；`vitest` 14 文件 / **288 条**全绿（原 265 → +23）；`vite build` 通过；`weapon_ref` 引用完整性、五槽位掉落权重、对比差值八种情形、16 件装备首次有收益等级均有机器断言。新增 `tools/_cdp/equip-presence.mjs` 端到端探针，在本地静态服务 + 无头 Edge 下实拍装备界面与虎门关卡：**15 项断言全过、控制台零异常**（五槽位进度行 / 未达成目标文案 / 强化按钮含 `→` 且收益 0 时禁用 / 键盘 R 也拦截且零件不扣 / 换装消息含 ▲ / 已装备武器真的切到 `wp_bow` 且 `range=200` / 紫装掉落含 `drop-glow` 与 `drop-shape-accessory` / 白装无光 / data 标签正确）；两张装备界面截图 + 一张关卡截图人工复核，顺手修掉原消息栏压在左列详情框上的文字重叠（消息移到右列空白、页码挪到背包标题行）。未改画布缩放 / 背景 / 其它 HUD 层 | http://39.103.58.244/game/ |

**回退**：v1.5 想整体退回，把 `items_base.json` 里 5 个 `weapon_ref` 字段删掉即可让武器手感回到原状（config 里新增的 `wp_crowbar` 无人引用、无害可留）；展示层只需移除 `LevelScene` / `EquipmentScene` 里对 `compareWithEquipped` / `slotProgress` / `enhanceGain` 的调用。所有新函数都是纯函数，不改 `SAVE_VERSION`、不改存档结构。

**回退（地图）**：把 `game/public/data/nodes/nodes_ch00.json` 里 `nd_1851_jintian_escort` /
`nd_1853_tianjing_manage` / `nd_1864_tianjing_fall` 三处 `map_ref`，以及
`game/public/data/acts/ch00_act2.json` 的 `map_refs`，改回 `map_ch00_act2a` / `map_ch00_act2b`，
重新 build + 部署即可；渲染器的 `tp_act2` 开关自然不触发，不用改代码。
细节见 `design/12_taiping_tilemap_spec.md` 第 8.4 节。
