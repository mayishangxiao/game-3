/**
 * 护送完成的门禁 —— 设计书 3.3.2 场景 A（金田突围）。
 *
 * 为什么要单独一个纯函数：`updateWorld` 每帧都会问「玩家到终点了吗」，
 * 而节点切换是 async（换图要 await loadMap）。在让出的那一帧里，
 * `mode` 还是 escort、玩家还在终点、战士已被 clearAllies() 收走，
 * 旧判定会二次命中 completeNode()，把下一幕（天京经营）直接跳过去 ——
 * 表现就是经营面板闪一下就没了，还附带一条「护送出 0/0 名战士」。
 *
 * 判据集中在这里，单测才能锁住「切换中 / 节点已结算 / 战士已清空 /
 * 模式串了 / 目标未初始化」这几条边界，而不是靠肉眼截图碰运气。
 */

export interface EscortGate {
  /** 当前场景模式，必须是 escort */
  mode: string;
  /** 当前节点数据里声明的模式：切换中 this.node 已经换了，用它能挡住串幕 */
  nodeMode: string | undefined;
  /** 节点切换中（startNode 的 async 窗口） */
  transitioning: boolean;
  /** 本节点已结算 / 尚未就绪 */
  nodeBusy: boolean;
  /** 终点世界坐标；0 表示还没 setupEscort */
  goalX: number;
  playerX: number;
  /** 仍在册的护送对象数量；切节点时被清空 → 0 */
  allyCount: number;
}

export function canCompleteEscort(g: EscortGate): boolean {
  return (
    g.mode === 'escort' &&
    g.nodeMode === 'escort' &&
    !g.transitioning &&
    !g.nodeBusy &&
    g.goalX > 0 &&
    g.allyCount > 0 &&
    g.playerX >= g.goalX
  );
}
