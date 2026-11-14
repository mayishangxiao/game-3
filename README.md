# 党史像素 RPG · 第一章 —— 工作区导航

> **本期范围：只做第一章（序章·觉醒年代，1840—1864，两幕）。**
> 鸦片战争（1840—1842）与太平天国运动（1851—1864）两幕都已经做完、可以玩通；
> 1861 年之后的章节、序章第 3—7 幕、以及未开工的系统模块，都**已经从文档与代码里删干净**了。
> 这不是"还没做"，是"不在本期范围"：设计和数据里不存在"未开放"的占位。

这个文件夹里有**两个区、一个缓存区**。先看这张表决定该进哪个目录，不要在全盘里翻文件。

| 区 | 路径 | 里面是什么 | 起点文档 |
| --- | --- | --- | --- |
| 📄 **文档区** | `design/`（8 个 Markdown 源文件 + 3 份美术交付物）→ 构建出 `党史像素RPG游戏·第一章设计书 v2.1.docx` | 设计书正文：概念、两幕关卡、数值、系统、数据 schema、美术、验收、附录 | [design/README.md](design/README.md) |
| 🎮 **工程区** | `game/` | 可运行的 Phaser 3 + TypeScript 工程（源码 / 数据 / 测试 / 验证脚本） | [game/README.md](game/README.md) |
| 🗑 **缓存区** | `__pycache__/`、`game/tools/_cdp*/`、`game/dist/`、`game/node_modules/`、`_art_review/` | 全部可重建，随时可删 | — |

## 三份输入

| 文件 | 作用 | 状态 |
| --- | --- | --- |
| `党史游戏大世界·时期框架表(2).docx` | 甲方给的时期框架（原始需求） | 只读，保留 |
| `党史像素RPG游戏设计方案_整理_20261026175343.pdf`（v1.2） | 甲方给的设计方案初稿（原始需求） | 只读，保留 |
| `党史像素RPG游戏·第一章设计书 v2.1.docx` | **本期的产出契约**：v1.2 + 框架表 → 只覆盖第一章的设计书；代码与它对齐，偏差记在 `game/README.md` 的 D-1…D-10 | 由 `design/*.md` 构建 |

## 当前状态（接手先看这一段）

| 项 | 状态 |
| --- | --- |
| 可玩内容 | 两幕 11 张事件卡 9 个节点、3 个可重复副本、章末测验、装备/图谱/图鉴/完成度结算 |
| 验证 | `tsc --noEmit` 0 错；`pnpm test` **21 个文件 / 421 条全部通过**；`pnpm build` 通过 |
| 完成度 | 见 `design/06_plan.md` 7.1 的"交付范围与完成状态"表：✅ 是已实现，⬜ 是缺口（贴图、立绘、BGM/SFX、像素中文字体） |
| 未做 | 第二幕人物贴图与立绘、音频素材、单位动作帧、像素中文字体、长廊可走动版本（`game/README.md` 末尾有优先级） |

## 文档区的重建流程

设计书是**从 Markdown 生成的**，不要直接改 docx（改了下次重建就丢）：

```powershell
# 1) 改 design/*.md（文件名前缀 00–07 决定章节顺序，构建时按字母序拼接）
# 2) 重建 DOCX
& "C:\Users\Lecoo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" build_docx.py
# 独立交付物：鸦片战争原型的美术资产规格表 / 提示词（不参与设计书拼接）
& "C:\Users\Lecoo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" build_art_spec.py
& "C:\Users\Lecoo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" build_art_prompts.py
```

- `build_docx.py` —— Markdown → DOCX（标题层级、表格、页眉页脚、配色）。**只拼前缀 `00_`–`07_`**；`10_` / `11_` / `art_prompts_spritelab` 是独立交付物，不进正文。
- `build_art_spec.py` —— `design/10_art_spec_opium.md` → 《鸦片战争原型·美术资产规格表 v1.docx》：表格 + 24 色色卡 + 32×40 网格示意图。
- `build_art_prompts.py` —— 生成《鸦片战争原型·美术生成提示词.docx》：8 个角色、6 种地块、7 个物件、5 组界面元素的中英双版提示词。
- `fix_design_values.py` —— 一次性修正脚本，已经跑过；保留只为留下"为什么改"的凭据。

## 章节编号（改文档前必看）

`00_front` 是封面与目录，`01`–`07` 依次是第 1–8 章（`01_overview` 里装了第 1、2 两章）。**`design/README.md` 有完整对照表。**
章节号是全文唯一的交叉引用体系（`4.4.1`、`5.2.13` 这种），改编号时**不要用小数字正则批量替换**——`精英 × 6.7`、攻速 `8.33` 这类数值会被一起改掉（踩过，已回滚）。

## 临时/擦除型文件

| 文件 | 说明 |
| --- | --- |
| `_art_review/` | 甲方美术包解包后的原样（previews/qa/sheets），游戏不读它，可删。 |
| `__pycache__/` | Python 字节码缓存，可删。 |
| `~$战争原型·美术生成提示词.docx` | Word 打开文件时的锁文件，可删。 |

## 推荐阅读顺序（新人 / 新 agent）

1. 本文件 → 2. `design/00_front.md`（本期覆盖/不覆盖什么、怎么读这份文档）→ 3. `design/01_overview.md`（1.1 一句话、1.5 内容红线）→ 4. `game/README.md`（已实现范围、怎么跑、D-1…D-10 偏差）→ 5. `game/src/README.md`（代码地图，改代码前必读）→ 6. `game/public/data/README.md`（改内容前必读）。