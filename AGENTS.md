# AGENTS.md —— 给 AI agent 的入场须知

这个仓库分两个区：**文档区** `design/`（设计书源文件）与**工程区** `game/`（可运行游戏）。
工程区里已有一套「目录级 README」，目的就是**让你不用遍历文件就能定位**。请遵守下面的读取顺序。

## 一、动手之前：按顺序读这四份（合计 46 KB；源码 + 数据约 355 KB，翻一遍是它的 7 倍多）

| 顺序 | 文件 | 读完你会知道 |
| --- | --- | --- |
| 1 | `README.md`（本目录） | 两个区、缓存区、设计书怎么重建 |
| 2 | `game/README.md` | 已实现范围、验证方式（tsc / vitest / 三层 E2E）、与设计书的偏差 D-1…D-8 |
| 3 | `game/src/README.md` | 代码地图：分层依赖、每个文件职责与**改动影响面**、常见改动配方、6 条踩过的陷阱 |
| 4 | `game/public/data/README.md` | 数据 schema、**引用关系图**、编码纪律、测试已挡住的检查 |

改哪一类东西，再补读对应的一份：改测试看 `game/tests/README.md`；跑验证/生成数据看 `game/tools/README.md`。

## 二、硬性约束（违反会导致测试或流程直接坏掉）

1. **不要在 `game/` 全盘 grep 找位置**。先查目录 README 的表格定位文件；需要骨架清单时跑
   `node game/tools/map_repo.mjs game`（打印每个文件的头部注释 + 导出符号）。
2. **`game/src/core/` 里那 9 个模块（balance / constants / DataLoader / dungeon / graph / management / quiz / SaveManager / types）不许 import Phaser**。它们是纯逻辑层，7 个测试文件跑在 node 环境，加了 Phaser 会全炸。
3. **改内容不动代码**：数值、事件、节点、敌人、装备、副本、地图都在 `game/public/data/`。改完必须跑 `pnpm test`——数据引用错会让关卡直接不可通关。
4. **数据文件必须 UTF-8 无 BOM**（PowerShell 的 `Set-Content -Encoding UTF8` 会写 BOM，`JSON.parse` 会报 `Unexpected token '﻿'`）。改 JSON 用 Python（`encoding='utf-8'`）。
5. **文档即契约**：新增文件必须同步写进所在目录的 `README.md`——`game/tests/docs.test.ts` 会检查「每个文件都被文档提到、每条相对链接都存在」，漏了直接红。
6. **验证顺序**：`pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build` → CDP 端到端（`game/tools/README.md` 有命令）。改动涉及 UI 时**必须用截图逐张看**，断言全绿但按钮被虚拟摇杆压住这种事发生过。

## 三、不要做

- 不要 `git` 提交或推送（用户没要求时）。
- 不要删除 `design/*.md`（设计书源文件；`build_docx.py` 只认 `00_`–`09_` 前缀，README 不会进正文）。
- 不要把 `dist/`、`node_modules/`、`game/tools/_cdp*/` 当源码读——它们是产物与验证缓存，随时可删可重建。
- 不要在同一个端口并行跑两个 `cdp-*.mjs`（`cdp-act2` 与 `cdp-dungeon` 都用 9335）。