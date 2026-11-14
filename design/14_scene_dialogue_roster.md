# 场景对话人物清单 · v1.8.7

> 对应需求：每个场景都明确包含参与对话的人物及说话人归属，覆盖开场与战斗结束后的收尾阶段；
> 统一排查所有现有场景，补齐遗漏人物，保证各阶段对话连续可识别。
> 数据真值：`game/public/data/dialogues/dlg_ch00.json`、`nodes/nodes_ch00.json`、
> `dungeons/dungeons.json`、`events/events_ch00.json`。本表由 `game/tests/sceneDialogue.test.ts` 逐项校验。

## 1. 改动前查到的问题

| # | 问题 | 涉及场景 |
| --- | --- | --- |
| 1 | 只有块级 `speaker`，一段里多人说话全靠正文自己写名字，玩家看不出这句归谁 | 全部对白块 |
| 2 | 天京陷落战斗节点原本连开场对白都没有 | `nd_1864_tianjing_fall` |
| 3 | 两个抉择场景的遮罩面板直接盖住对白框，开场台词根本不播 | `nd_1842_nanjing_choice`、`nd_1864_limitation` |
| 4 | 经营面板（DOM overlay）压在对白框上，名字与「▼ 继续」只从缝里露出来 | `nd_1853_tianjing_manage` |
| 5 | **所有节点都没有收尾对白**：战斗 / 搬箱 / 经营 / 抉择一结束就 `completeNode()` 直接跳下一节点或手工结算面板 | 9 个剧情节点 |
| 6 | 3 个副本既无开场人物、也无通关后的角色对话，打完立刻弹掉落面板 | `dg01_alley` / `dg02_bandit` / `dg03_dock` |
| 7 | 事件卡 `figures` 有空人物，部分人物（杨秀清、韦昌辉、石达开、洪仁玕等）没有显示名 | 11 张事件卡 |

## 2. 剧情节点清单（ch00，共 9 场）

「说话顺序」按台词逐句去重后的首次出场排列；每行台词的说话人在 `dlg_ch00.json → lines[].speaker`，
游戏内由金色名字栏 + 立绘逐句切换呈现，对白框右上角固定显示「在场：…」。

| # | 场景 id | 名称 | 类型 | 开场对白 | 收尾对白 | 参与对话人物 | 开场说话顺序 | 收尾说话顺序 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `nd_1839_humen_dialog` | 林则徐赴粤 | dialog | `dlg_ch00_act1_intro` | `dlg_ch00_act1_intro_outro` | 旁白、林则徐、关天培、乡民、水勇 | 旁白 → 林则徐 → 关天培 → 乡民 → 林则徐 | 水勇 → 林则徐 → 关天培 → 旁白 |
| 2 | `nd_1839_humen_pool` | 虎门销烟 | dialog | `dlg_ch00_act1_pool` | `dlg_ch00_act1_pool_outro` | 旁白、林则徐、关天培、乡民 | 旁白 → 林则徐 → 乡民 → 关天培 → 旁白 | 乡民 → 林则徐 → 关天培 → 旁白 |
| 3 | `nd_1841_humen_battle` | 虎门炮台守卫战 | combat | `dlg_ch00_act1_fort_intro` | `dlg_ch00_act1_fort_outro` | 关天培、水勇、林则徐、旁白 | 关天培 → 水勇 → 关天培 → 旁白 → 林则徐 → 关天培 | 旁白 → 水勇 → 关天培 → 林则徐 → 旁白 |
| 4 | `nd_1842_nanjing_choice` | 南京条约 | choice | `dlg_ch00_act1_nanjing` | `dlg_ch00_act1_nanjing_outro` | 旁白、璞鼎查、耆英、林则徐 | 旁白 → 璞鼎查 → 耆英 → 旁白 → 林则徐 → 旁白 | 璞鼎查 → 耆英 → 林则徐 → 旁白 |
| 5 | `nd_1851_jintian_escort` | 金田村突围 | dialog | `dlg_ch00_act2_intro` | `dlg_ch00_act2_intro_outro` | 旁白、洪秀全、杨秀清、李秀成、太平军战士 | 旁白 → 洪秀全 → 杨秀清 → 李秀成 → 太平军战士 | 太平军战士 → 李秀成 → 杨秀清 → 旁白 |
| 6 | `nd_1853_tianjing_manage` | 天京经营 | management | `dlg_ch00_act2_tianjing` | `dlg_ch00_act2_tianjing_outro` | 洪秀全、杨秀清、洪仁玕、旁白 | 洪秀全 → 杨秀清 → 洪仁玕 → 旁白 → 洪秀全 | 洪仁玕 → 杨秀清 → 洪秀全 → 旁白 |
| 7 | `nd_1856_intrigue` | 天京事变 | cutscene | `dlg_ch00_act2_intrigue` | `dlg_ch00_act2_intrigue_outro` | 旁白、杨秀清、洪秀全、韦昌辉、石达开、洪仁玕、李秀成 | 旁白 → 杨秀清 → 洪秀全 → 韦昌辉 → 石达开 → 旁白 | 石达开 → 洪仁玕 → 李秀成 → 旁白 |
| 8 | `nd_1864_tianjing_fall` | 天京陷落 | combat | `dlg_ch00_act2_fall_intro` | `dlg_ch00_act2_fall_outro` | 旁白、曾国藩、李秀成、太平军战士 | 旁白 → 曾国藩 → 李秀成 → 太平军战士 → 旁白 | 太平军战士 → 曾国藩 → 李秀成 → 旁白 |
| 9 | `nd_1864_limitation` | 农民阶级的局限性 | choice | `dlg_ch00_act2_fall` | `dlg_ch00_act2_limit_outro` | 旁白、李秀成、洪仁玕 | 旁白 → 李秀成 → 洪仁玕 → 李秀成 → 旁白 | 洪仁玕 → 李秀成 → 旁白 |

## 3. 副本清单（可重复刷，共 3 场）

开场对白读完才放第一波；通关结算面板之前必播收尾对白。重复刷同样播（每段 2~3 句）。

| # | 副本 id | 名称 | 开场对白 | 收尾对白 | 参与对话人物 | 开场说话顺序 | 收尾说话顺序 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `dg01_alley` | 租界暗巷 | `dlg_dg01_intro` | `dlg_dg01_outro` | 旁白、乡民、林则徐 | 旁白 → 乡民 → 林则徐 | 乡民 → 旁白 |
| 2 | `dg02_bandit` | 广州城外匪寨 | `dlg_dg02_intro` | `dlg_dg02_outro` | 旁白、太平军战士 | 旁白 → 太平军战士 | 太平军战士 → 旁白 |
| 3 | `dg03_dock` | 沪上码头 | `dlg_dg03_intro` | `dlg_dg03_outro` | 旁白、水勇 | 旁白 → 水勇 | 水勇 → 旁白 |

## 4. 事件卡人物（11 张，`figures` 不再是空数组）

| 事件 id | 标题 | 人物 |
| --- | --- | --- |
| `ev_1839_humen` | 虎门销烟 | 林则徐、关天培、乡民 |
| `ev_1840_war` | 鸦片战争爆发 | 林则徐、义律、关天培 |
| `ev_1841_humen_fort` | 虎门炮台之战 | 关天培、水勇 |
| `ev_1841_sanyuanli` | 三元里抗英 | 韦绍光、乡民 |
| `ev_1842_nanjing` | 《南京条约》签订 | 耆英、璞鼎查、林则徐 |
| `ev_1851_jintian` | 金田起义 | 洪秀全、杨秀清、李秀成 |
| `ev_1853_tianjing` | 定都天京 | 洪秀全、杨秀清、洪仁玕 |
| `ev_1856_intrigue` | 天京事变 | 洪秀全、杨秀清、韦昌辉、石达开 |
| `ev_1859_zizheng` | 《资政新篇》 | 洪仁玕、洪秀全 |
| `ev_1864_tianjing_fall` | 天京陷落 | 李秀成、曾国藩、太平军战士 |
| `ev_1864_limitation` | 农民阶级的局限性 | 李秀成、洪仁玕、旁白 |

人物显示名表（`dlg_ch00.json → npcs`，17 人）：旁白（`narrator`）、林则徐、关天培、水勇、乡民、耆英、
璞鼎查、义律、韦绍光、李秀成、洪秀全、洪仁玕、杨秀清、韦昌辉、石达开、太平军战士、曾国藩。

> 长廊（`HubScene`）、标题页、知识图谱、测验场景没有剧情对白，属于功能性界面，不在本清单的「场景」范围；
> 地图上的可交互物（NPC / 布景）复用 `dlg_ch00_act1_intro`、`dlg_ch00_act1_cannon`、
> `dlg_ch00_act1_pool_lin` 等对白块，同样遵守逐句说话人规则。

## 5. 流程：每场固定四拍

```
进场 startNode / startDungeon
  → ① 开场对白（逐句说话人 + 立绘 + 「在场」名单；战斗情境卡先关再读）
  → ② 玩法面板 / 波次（抉择、经营面板等对白读完才出现，不遮挡）
  → ③ 完成判定（护送抵达 / 搬箱投池 / 经营 8 月 / 抉择 / Boss 清空 / 过场结束 / 战败链）
  → ④ 收尾对白（本场人物交代结果） → 记完成、发奖励、切下一节点 / 弹副本结算面板
```

- 收尾闸门放在统一结算入口 `LevelScene.completeNode()`（剧情）与 `finishDungeon()`（副本），
  所有完成路径自动覆盖，不需要逐条补台词调用。
- `shouldPlayOutro()` + `outroPlayedFor` / `dungeonOutroPlayed` 保证同一场只念一次，
  重试会清空标记，重新走完整套「开场 + 收尾」。
- 对白期间冻结世界逻辑并隐藏虚拟按键（`updateWorld` 里 `dialogue.isActive` 既有门禁），
  玩家点 / E / Enter 推进，任何时候都能看清是谁在说。

## 6. 改动摘要

| 层 | 文件 | 改了什么 |
| --- | --- | --- |
| 数据 | `game/public/data/dialogues/dlg_ch00.json` | 补 `npcs` 显示名、每段 `participants`、逐句 `speaker`；新增 9 段节点收尾 + 6 段副本开场/收尾对白 |
| 数据 | `game/public/data/nodes/nodes_ch00.json` | 9 个节点补 `outro_dialogue_ref` / `participants`；天京陷落补开场对白 |
| 数据 | `game/public/data/dungeons/dungeons.json` | 3 个副本补 `participants` / `intro_dialogue_ref` / `outro_dialogue_ref` |
| 数据 | `game/public/data/events/events_ch00.json` | 11 张事件卡补 `figures`，人物 id 与 `npcs` 对齐 |
| 类型 | `game/src/core/types.ts` | `DialogueLine.speaker`、`DialogueBlock.participants`、`NodeDef` / `DungeonDef` 的开场/收尾/人物字段 |
| 纯逻辑 | `game/src/core/sceneDialogue.ts`（新） | `resolveDialogueCast` / `sceneCast` / `lineSpeaker` / `castLabel` / `shouldPlayOutro`，渲染、流程、测试共用判据 |
| 渲染 | `game/src/systems/DialogueBox.ts` | 逐句切名字与立绘；异步立绘回调校验当前说话人，防止把上一个人的头像贴到下一句 |
| 渲染 | `game/src/systems/DomUi.ts` + `game/index.html` | 对白框右上角新增 `#dom-dlg-cast`「在场：A · B」，整段对白固定显示 |
| 流程 | `game/src/scenes/LevelScene.ts` | 开场对白覆盖抉择 / 经营 / 过场并延后面板；副本开场读完才刷第一波；`completeNode()` / `finishDungeon()` 拆出 `settleNode()` / `settleDungeon()`，结算前统一播收尾对白 |
| 测试 | `game/tests/sceneDialogue.test.ts`（新） | 10 条：纯函数 5 条 + 对白数据 2 条 + 9 节点 / 3 副本 / 11 事件卡完整性 3 条 |

## 7. 验收

```bash
cd "game 3/game"
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run            # 含 sceneDialogue.test.ts 的数据一致性断言
./node_modules/.bin/vite build
```

改动只碰对白数据、对白渲染与结算闸门；武器选择、强化三选一、暴击震屏、开炮命名、部署缓存等既有不变量不受影响。
