# 党史像素 RPG —— 工作区导航

这个文件夹里有**两个区、一个缓存区**。先看这张表决定该进哪个目录，不要在全盘里翻文件。

| 区 | 路径 | 里面是什么 | 起点文档 |
| --- | --- | --- | --- |
| 📄 **文档区** | `design/`（10 个 Markdown 源文件 + 1 份独立交付物）→ 构建出 `党史像素RPG游戏·完整设计书 v2.0.docx` | 设计书正文：概念、七幕关卡、数值、系统、数据 schema、美术、WBS、附录 | [design/README.md](design/README.md) |
| 🎮 **工程区** | `game/` | 可运行的 Phaser 3 + TypeScript 工程（源码 / 数据 / 测试 / 验证脚本） | [game/README.md](game/README.md) |
| 🗑 **缓存区** | `__pycache__/`、`game/tools/_cdp*/`、`game/dist/`、`game/node_modules/` | 全部可重建，随时可删 | — |

## 三份输入

| 文件 | 作用 |
| --- | --- |
| `党史游戏大世界·时期框架表(2).docx` | 甲方给的时期框架（只读，原始需求） |
| `党史像素RPG游戏设计方案_整理_20261026175343.pdf`（v1.2） | 甲方给的设计方案初稿（只读，原始需求） |
| `党史像素RPG游戏·完整设计书 v2.0.docx` | **本项目的产出契约**：v1.2 + 框架表 → 148 页完整设计书；代码与它对齐，偏差记在 `game/README.md` |

## 文档区的重建流程

设计书是**从 Markdown 生成的**，不要直接改 docx（改了下次重建就丢）：

```powershell
# 1) 改 design/*.md（文件名前缀 00–09 决定章节顺序，构建时按字母序拼接）
# 2) 重建 DOCX
& "C:\Users\Lecoo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" build_docx.py
# 独立交付物：美术资产规格表（不参与设计书拼接）
& "C:\Users\Lecoo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" build_art_spec.py
```

- `build_docx.py` —— Markdown → DOCX（标题层级、表格、目录、页眉页脚、配色）。只拼 `00`–`09`。
- `build_art_spec.py` —— `design/10_art_spec_opium.md` → 《鸦片战争原型·美术资产规格表 v1.docx》：表格 + **24 色色卡（真实色块）+ 32×40 网格示意图**，给外部美工执行。
- `build_art_prompts.py` —— 生成《鸦片战争原型·美术生成提示词.docx》：8 个角色、6 种地块、7 个物件、5 组界面元素的中英双版提示词，附尺寸与 24 色盘规范。
- `fix_design_values.py` —— 一次性修正设计书里两处与公式不符的数值（Lv37 ATK 90→89、Lv54 ATK 126→127）。已经跑过，保留是为了留下「为什么改」的凭据。

## 临时/擦除型文件

| 文件 | 说明 |
| --- | --- |
| `_dsh_sess_probe.js` | 与游戏无关的一次性探针（解析 DSH 会话日志），可删。 |
| `__pycache__/` | Python 字节码缓存，可删。 |

## 推荐阅读顺序（新人 / 新 agent）

1. 本文件 → 2. `design/01_overview.md`（1.1 一句话概念、1.5 内容红线）→ 3. `game/README.md`（已实现范围与验证方式）→ 4. `game/src/README.md`（代码地图，改代码前必读）→ 5. `game/public/data/README.md`（改内容前必读）。