# AGENTS.md —— 给 AI agent 的入场须知

这个仓库分两个区：**文档区** `design/`（设计书源文件）与**工程区** `game/`（可运行游戏）。
工程区里已有一套「目录级 README」，目的就是**让你不用遍历文件就能定位**。请遵守下面的读取顺序。

## 〇、先知道本期范围（最重要的一条）

**这个项目只做第一章：序章·觉醒年代，1840—1864，两幕**——鸦片战争（1840—1842）与太平天国运动（1851—1864）。
两幕都已实现、可玩通；1861 年之后的章节、序章第 3—7 幕、未开工的系统模块**已经从文档、数据与代码里删干净**：

- `game/public/data/index.json` 里没有 `acts_planned`，`src/core/types.ts` 的 `ChapterMeta` 也没有这个字段；
- `game/src/scenes/HubScene.ts` 的长廊只有 ch00_act1 / ch00_act2 两道幕门；
- `game/tests/data.test.ts` 断言章节里声明的幕数就是 2（不是"7 幕中开放 2 幕"）。

所以：**不要"补回"未开放幕、不要给后续章节预埋字段**。要续做，先按 `design/00_front.md` 的"不覆盖"清单重新立项。

## 一、动手之前：按顺序读这五份（合计约 60 KB；源码 + 数据约 380 KB，翻一遍是它的 6 倍多）

| 顺序 | 文件 | 读完你会知道 |
| --- | --- | --- |
| 1 | `README.md`（本目录） | 两个区、缓存区、设计书怎么重建、当前状态 |
| 2 | `design/00_front.md` | 这份设计书覆盖什么、不覆盖什么、章节编号怎么排 |
| 3 | `game/README.md` | 已实现范围、验证方式（tsc / vitest / 三层 E2E）、与设计书的偏差 D-1…D-10、已知待办 |
| 4 | `game/src/README.md` | 代码地图：分层依赖、每个文件职责与**改动影响面**、常见改动配方、踩过的陷阱 |
| 5 | `game/public/data/README.md` | 数据 schema、**引用关系图**、编码纪律、测试已挡住的检查 |

改哪一类东西，再补读对应的一份：改测试看 `game/tests/README.md`；跑验证/生成数据看 `game/tools/README.md`；改文档看 `design/README.md`。

## 二、硬性约束（违反会导致测试或流程直接坏掉）

1. **不要在 `game/` 全盘 grep 找位置**。先查目录 README 的表格定位文件；需要骨架清单时跑
   `node game/tools/map_repo.mjs game`（打印每个文件的头部注释 + 导出符号）。
2. **`game/src/core/` 里那 15 个模块一律不许 import Phaser**（balance / cannon / constants / DataLoader / defeat / dungeon / EventBus / graph / management / orientation / quiz / SaveManager / space / types / waveUpgrade）。它们是纯逻辑层，14 个测试文件跑在 node 环境，加了 Phaser 会全炸。
3. **改内容不动代码**：数值、事件、节点、敌人、装备、副本、地图都在 `game/public/data/`。改完必须跑 `pnpm test`——数据引用错会让关卡直接不可通关。
4. **数据文件必须 UTF-8 无 BOM**（PowerShell 的 `Set-Content -Encoding UTF8` 会写 BOM，`JSON.parse` 会报 `Unexpected token '﻿'`）。改 JSON 用 Python（`encoding='utf-8'`）。
5. **文档即契约**：新增文件必须同步写进所在目录的 `README.md`——`game/tests/docs.test.ts` 会检查「每个文件都被文档提到、每条相对链接都存在」，漏了直接红。设计书里的 `# 第X章` 与章节号也要和 `design/README.md` 的对照表一致。
6. **验证顺序**：`pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build` → CDP 端到端（`game/tools/README.md` 有命令）。改动涉及 UI 时**必须用截图逐张看**，断言全绿但按钮被虚拟摇杆压住这种事发生过。
7. **改设计书数值要两头一起改**：`game/tests/balance.test.ts` 的断言直接对应设计书 4.2 / 4.3 / 4.4 / 4.7 的表格，只改一边必红。

## 三、不要做

- 不要 `git` 提交或推送（用户没要求时）。
- 不要把已删除的章节"恢复"回来：`design/` 现在只有 `00`–`07` 八个源文件（`03_ch01.md`、`04_ch02_10.md` 与旧 `05`–`09` 已随范围收缩删除，git 历史里还能找到）。`build_docx.py` 只认 `00_`–`07_` 前缀。
- 不要把 `dist/`、`node_modules/`、`game/tools/_cdp*/`、`_art_review/` 当源码读——它们是产物与验证缓存，随时可删可重建。
- 不要在同一个端口并行跑两个 `cdp-*.mjs`（`cdp-act2` 与 `cdp-dungeon` 都用 9335）。
- 不要直接编辑 `党史像素RPG游戏·第一章设计书 v2.1.docx`：它是 `design/*.md` 的构建产物，下次 `build_docx.py` 会覆盖。