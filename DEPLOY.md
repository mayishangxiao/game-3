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
