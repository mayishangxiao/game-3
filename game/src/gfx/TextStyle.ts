/**
 * 游戏内文字的统一字体设置 —— 全工程只在这一处决定「字长什么样」。
 *
 * 为什么要有这个文件（甲方 m01507）：「游戏内所有文字像素感太强了，用清晰的标准字体」。
 * 以前 140 处 `fontFamily: 'sans-serif'` 是各场景自己写的，等于没有统一口径：
 * 有的机器 `sans-serif` 落到宋体、有的落到黑体，中英文基线还会错位。
 * 现在所有 Text 的 `fontFamily` 一律用 `FONT_UI`，字号/颜色仍然由调用点决定。
 *
 * 两件事必须一起做才「清晰」，缺一不可：
 *  1. `boot.ts` 关掉了画布的 pixelArt 锁定（否则整屏只有 480×270 个像素，字必然糊）；
 *  2. 文字画布按 `TEXT_RESOLUTION` 倍栅格生成（否则字仍是按逻辑像素画的小图再放大）。
 *
 * 字体栈的排序是「本机最标准的黑体优先」，不下载任何字体文件：
 *  - 游戏跑在手机上（微信内置浏览器 / Safari / Chrome），中文黑体几乎必装，
 *    外链字体会让首屏多几十 KB 到几 MB，弱网下比「有点糊」难受得多；
 *  - `system-ui` 放在最后一位兜底，避免某些安卓 ROM 把 sans-serif 解析成衬线体。
 */

/** 正文/标题共用的字体栈。想换字体验只改这一行。 */
export const FONT_UI =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif';

/** 数字/伤害数字等纯西文场景，用系统 UI 字体的数字（等宽感更好，不会跳）。 */
export const FONT_NUM = '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * 文字画布的栅格倍数。
 *
 * Phaser 的 Text 是「先画到一张 canvas，再当纹理贴出来」，这张 canvas 的像素数 =
 * 字号 × style.resolution。resolution 为 1 时，10px 的字真的只有 10 个像素高，
 * 屏幕上再放大 3 倍就是马赛克——这就是「像素感」的来源之一。
 * 4 倍：微信竖屏 CSS 旋转兜底时，画布实际显示尺寸 = FIT 缩放 × dpr（实测手机上 ~4.3 倍逻辑像素），
 * 3 倍栅格会被再放大 1.4 倍发糊；4 倍对齐后缓冲（见 OrientationGate 里的 fitBackingResolution）。
 * 再高会让每次改文案都重新生成更大的 canvas，HUD 每帧刷新数字时会掉帧。
 */
export const TEXT_RESOLUTION = 4;

/** 常用字号的语义名，避免同一个「小字」在不同场景写成 8px / 9px / 10px 三种。 */
export const FS = {
  /** 角标、坐标、提示小字 */
  tiny: '9px',
  /** 正文里的辅助说明 */
  small: '10px',
  /** 正文 */
  body: '11px',
  /** 小标题 */
  sub: '13px',
  /** 标题 */
  title: '18px',
  /** 全屏大标题（城破、章节名） */
  huge: '32px',
} as const;