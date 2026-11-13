/**
 * 暴击命中的屏幕震动参数（纯逻辑，不 import Phaser）。
 *
 * 为什么要单独抽一个模块：暴击反馈是「每次打中都可能触发」的高频效果。太平天国
 * 战场（ch00_act2）敌群密集，而 v1.8 的近战攻击向强化又有横扫 / 回旋斩 / 剑气纵横
 * 这类多段命中，一次挥砍能在几十毫秒里连出好几个暴击。若每个暴击各调一次
 * `camera.shake()`，镜头就会被一遍遍续着抖，从「打击反馈」变成「晕屏」。
 *
 * 所以这里把三件事定死并可单测：
 *   1. 强度换算：`config.json → combat_feedback.screenshake_amp / 1000` = Phaser intensity；
 *   2. 强度上下限：下限 > 0 保证**不完全去除震动**（甲方明确要求保留轻微打击反馈），
 *      上限挡住配置误填又把画面晃飞；
 *   3. 冷却窗口：窗口内的一串暴击合并成一次轻震，避免连续 shake 叠成持续晃动。
 *
 * 只是「打中那一下手上有回弹」，Boss 出场 / 舰炮 / 半血必杀等演出级大震屏不归这里管，
 * 也不要拿这组常量去改它们——那些是有意的强冲击。
 */

/** 配置值的换算分母：screenshake_amp / 1000 = Phaser 的 camera.shake intensity（视口比例） */
export const CRIT_SHAKE_AMP_DIVISOR = 1000;

/** 单次暴击震屏时长（ms）。短促一点，别拖成持续晃动；旧值 60ms。 */
export const CRIT_SHAKE_DURATION_MS = 45;

/** 合并窗口（ms）：窗口内的后续暴击不再重复触发镜头震动。 */
export const CRIT_SHAKE_COOLDOWN_MS = 140;

/**
 * 强度下限。Phaser intensity 是视口尺寸的比例，0.0002 在 480×270 逻辑画面上约 0.1px，
 * 再叠上暴击红闪（110ms）与 14px 加粗飘字，主观上就是「轻轻一顿」而非「没反应」。
 * 必须是正数：配置填 0 / 负数 / NaN 时也要留一点点反馈，不能悄悄把效果关掉。
 */
export const CRIT_SHAKE_MIN_INTENSITY = 0.0002;

/**
 * 强度上限。0.0012 约合逻辑画面 0.6px（CSS 放大后约 1px 出头），
 * 比修复前的 0.002 明显收敛，又留得住手感；也防止以后有人把配置值改大把画面晃飞。
 */
export const CRIT_SHAKE_MAX_INTENSITY = 0.0012;

/**
 * 由配置值算出实际强度，并夹在「轻微但不为零」的区间里。
 * 非有限数（NaN / Infinity / 字符串误填）按下限处理，宁可轻一点也不要抛错或晃飞。
 */
export function critShakeIntensity(amp: number): number {
  const raw = Number.isFinite(amp) ? amp / CRIT_SHAKE_AMP_DIVISOR : 0;
  return Math.min(CRIT_SHAKE_MAX_INTENSITY, Math.max(CRIT_SHAKE_MIN_INTENSITY, raw));
}

/** 冷却判定：now 到达（含）下一次可触发时刻才允许震。 */
export function shouldCritShake(now: number, readyAt: number): boolean {
  return now >= readyAt;
}

/** 触发一次之后的下一次可触发时刻。 */
export function nextCritShakeReadyAt(now: number): number {
  return now + CRIT_SHAKE_COOLDOWN_MS;
}
