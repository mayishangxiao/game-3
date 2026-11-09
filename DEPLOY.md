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

# 3. 跑测试（261 个，全绿才继续）
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
- [ ] `pnpm test` 全绿（当前 14 文件 / 264 条）
- [ ] `pnpm build` 通过，确认 `dist/` 里带了本次新增的静态资源
- [ ] 改动涉及渲染 / UI 时，用 CDP 探针实拍并逐张看截图（断言全绿不等于画面没问题）
- [ ] 改动涉及死亡 / 复活 / 关卡物件时，跑 `node tools/_cdp/tp-defeat.mjs <edgePath> http://127.0.0.1:4173 tools/_cdp/tp`，确认 `defeat.json` 里 `after.alive / rigDead / tintFill / visiblePickups` 全部达标
- [ ] `_stage` 打包成功（`has_index=True`、`backslash_names=0`）
- [ ] 部署后打开首页与游戏页，抽查一个新增资源 URL 返回 200
- [ ] Git 提交不含 `tools/_stage/`、`dist/`、`tsc_out.txt`、`_fix_json.py`、`_t.json` 与临时探针截图

## 发布记录

| 日期 | 发版内容 | 验证 | 线上 |
| --- | --- | --- | --- |
| 2026-11-09 | 太平天国篇章瓦片地图接入：三张 30×16 地图（金田村 / 天京城 / 天京城墙夜战）替换第二幕三个节点；`tp_act2` 图集的 36 张 16×16 PNG 在 `MapRenderer` 生效，旧图程序化材质原样保留；修正 1864 战场串用第一幕「守住威远炮台」的目标文案；规格书升 v1.1 | `tsc` 0 错；`vitest` 14 文件 / 263 条全绿；`vite build` 通过；CDP 实拍三张地图，`tileset=tp_act2`、图集已加载、控制台零异常 | http://39.103.58.244/game/ |
| 2026-11-09 | **v1.2 热修**（真机截图反馈）：剧情关战败改为「战败 / 再试一次 / 返回长廊」面板，不再 900ms 后自动原地复活；`CharacterRig.revive()` + `Player.resetForNode()` 完整复位死亡状态（清 `dead` / 闪白 tint / 倒地 tween）并回到地图出生点，副本重来走同一路径；清除三张太平天国地图误放的第一幕 `pickup/crate` 鸦片箱共 7 个（改静态布景）、木箱装饰瓦片不再摆放、沙袋工事改横向矮墙；新增 `tests/data.test.ts` 防串幕断言与 `_cdp/tp-defeat.mjs` 回归探针；规格书升 v1.2 | `tsc` 0 错；`vitest` 14 文件 / **264 条**全绿；`vite build` 通过；CDP 实拍：面板四文本齐全，点重试后 `alive=true / hp=100 / rigDead=false / tintFill=false / angle=0`、坐标回到出生点，三图 `visiblePickups=0`，控制台零异常 | http://39.103.58.244/game/ |

**回退**：把 `game/public/data/nodes/nodes_ch00.json` 里 `nd_1851_jintian_escort` /
`nd_1853_tianjing_manage` / `nd_1864_tianjing_fall` 三处 `map_ref`，以及
`game/public/data/acts/ch00_act2.json` 的 `map_refs`，改回 `map_ch00_act2a` / `map_ch00_act2b`，
重新 build + 部署即可；渲染器的 `tp_act2` 开关自然不触发，不用改代码。
细节见 `design/12_taiping_tilemap_spec.md` 第 8.4 节。
