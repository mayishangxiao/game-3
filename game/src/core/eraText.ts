/**
 * 按幕派发的 UI 文案（v2.2）。
 *
 * 修的是两张实拍截图里露出来的串幕问题：第三幕江南制造总局的经营面板
 * 顶着「天京经营 / 粮草·兵员·民心」，第四、五幕战斗左上角写着「守住威远炮台」。
 * 根因是 `LevelScene.setupCombat()` 里一句三元表达式只分了第一、二幕，
 * 其余三幕 + 副本全部落到第一幕的默认值；经营面板的标题和三条分配线也是写死的。
 *
 * 这里只管**展示层**：`core/management.ts` 的结算数值逻辑与 `ManageTrack`
 * 的 food/troops/morale 三个键一个都不动（19 种分配穷举测试照旧），
 * 第三幕靠 `words` 把月度事件里的「粮草 / 兵员 / 民心 / 城墙」换成
 * 「银子 / 工匠 / 洋员 / 厂房」，读起来才像机器局而不是天京围城。
 *
 * 加一幕只改这里的登记表，不要回 LevelScene 里再写 `act?.id === ...` 分支。
 */

export interface EraSkin {
  /** 经营面板标题（只有第二、三幕有经营关） */
  manageTitle: string;
  /** 三条分配线的显示名，顺序固定对应 food / troops / morale */
  tracks: readonly [string, string, string];
  /** 面板第二行的小字说明 */
  manageHint: string;
  /** 经营结束的判词；第二幕仍走 `finalVerdict()`，这里留空 */
  verdictTitle: string;
  verdictBody: string;
  /** 战斗关左上角的目标条 */
  objective: string;
  /** 月度事件文案的换词表（空表 = 原文） */
  words: Readonly<Record<string, string>>;
}

const BASE: EraSkin = {
  manageTitle: '天京经营',
  tracks: ['粮草', '兵员', '民心'],
  manageHint: '粮草、兵员、民心三事，怎么分都不够——这就是要你亲手体会的事。',
  verdictTitle: '',
  verdictBody: '',
  objective: '守住威远炮台',
  words: {},
};

const HUMEN: EraSkin = { ...BASE, objective: '守住威远炮台' };
const TIANJING: EraSkin = { ...BASE, objective: '守住天京城墙' };

const JIANGNAN: EraSkin = {
  manageTitle: '江南制造总局',
  tracks: ['银子', '工匠', '洋员'],
  manageHint: '银子、工匠、洋员三事，怎么分都不够——这就是要你亲手体会的事。',
  verdictTitle: '机器局撑不起一个王朝',
  verdictBody: '买得来机器，买不来制度；船炮再新，也挡不住一纸条约。',
  objective: '守住定远舰甲板',
  words: {
    粮草: '银子', 兵员: '工匠', 民心: '洋员',
    城墙: '厂房', 逃亡: '停工', 仓里: '账上', 守军: '工匠',
    // settleMonth() 的「三事俱备，天京暂安」在机器局里也要换掉
    天京: '机器局',
  },
};

const WUXU: EraSkin = { ...BASE, objective: '护住变法的人' };
const XINHAI: EraSkin = { ...BASE, objective: '拿下总督衙门' };
/** 副本没有幕（this.act 未赋值），不能写任何具体战役地名 */
const NEUTRAL: EraSkin = { ...BASE, objective: '击退来敌' };

/** actId 来自 `LevelScene.act?.id`；undefined 表示副本。 */
export function eraSkinOf(actId?: string | null): EraSkin {
  switch (actId) {
    case 'ch00_act1': return HUMEN;
    case 'ch00_act2': return TIANJING;
    case 'ch00_act3': return JIANGNAN;
    case 'ch00_act4': return WUXU;
    case 'ch00_act5': return XINHAI;
    default: return NEUTRAL;
  }
}

/** 把 `settleMonth()` 生成的事件文案换成本幕口径（纯字符串替换，不改数值）。 */
export function localizeEraText(text: string, skin: EraSkin): string {
  let out = text;
  for (const [from, to] of Object.entries(skin.words)) out = out.split(from).join(to);
  return out;
}
