/**
 * 战斗「情境背景图」——程序化画一张 480×270 的海战全景，用作开场卡底图。
 *
 * 为什么程序化而不是等美术图：甲方要求「背景是海面斗争、还原鸦片战争的情景」，
 * 但美术还要几天。先用调色板内的硬边图形拼出「天 — 海 — 敌舰 — 岸防炮台」四层，
 * 有情境、能交付评审；美术图到位后只要把 `Backdrop.image()` 换成 `load.image` 读图即可，
 * 调用点不用改。
 *
 * 全部使用 24 色盘（constants.PALETTE），不引入新颜色——设计书 8.1.2 的硬约束。
 */

import Phaser from 'phaser';
import { BG_TEX, PALETTE, VIEW_H, VIEW_W } from '../core/constants';

/** 敌舰剪影：只在背景层出现，不参与战斗 */
interface Silhouette {
  x: number;
  y: number;
  scale: number;
  /** 距离越远越淡（空气透视） */
  alpha: number;
}

const SHIPS: Silhouette[] = [
  { x: 96, y: 150, scale: 0.55, alpha: 0.5 },
  { x: 214, y: 144, scale: 0.8, alpha: 0.72 },
  { x: 352, y: 152, scale: 0.45, alpha: 0.42 },
];

function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** 画一艘蒸汽炮舰的剪影（船体 + 烟囱 + 桅杆 + 帆） */
function drawShip(ctx: CanvasRenderingContext2D, s: Silhouette): void {
  const ink = hex(PALETTE.ink);
  const grey = hex(PALETTE.greyPlum);
  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.translate(s.x, s.y);
  ctx.scale(s.scale, s.scale);

  // 船体（梯形）
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-38, 0);
  ctx.lineTo(38, 0);
  ctx.lineTo(28, 11);
  ctx.lineTo(-28, 11);
  ctx.closePath();
  ctx.fill();
  // 甲板亮线
  ctx.fillStyle = grey;
  ctx.fillRect(-34, 0, 68, 2);
  // 桅杆与帆
  ctx.fillStyle = ink;
  ctx.fillRect(-14, -42, 2, 42);
  ctx.fillRect(14, -36, 2, 36);
  ctx.beginPath();
  ctx.moveTo(-12, -38);
  ctx.lineTo(-12, -12);
  ctx.lineTo(6, -20);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, -32);
  ctx.lineTo(16, -10);
  ctx.lineTo(30, -18);
  ctx.closePath();
  ctx.fill();
  // 烟囱与烟
  ctx.fillStyle = ink;
  ctx.fillRect(-2, -16, 7, 16);
  ctx.fillStyle = grey;
  ctx.globalAlpha = s.alpha * 0.5;
  ctx.fillRect(0, -22, 5, 6);
  ctx.fillRect(2, -30, 7, 8);
  ctx.restore();
}

/** 画岸上的炮台剪影（左侧），点出「我方守岸」 */
function drawFort(ctx: CanvasRenderingContext2D, y: number): void {
  const ink = hex(PALETTE.ink);
  const stone = hex(PALETTE.greyPlum);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = ink;
  // 山体
  ctx.beginPath();
  ctx.moveTo(0, y + 18);
  ctx.lineTo(52, y - 24);
  ctx.lineTo(96, y + 2);
  ctx.lineTo(120, y + 18);
  ctx.closePath();
  ctx.fill();
  // 炮台垛口
  ctx.fillStyle = stone;
  for (let i = 0; i < 5; i++) ctx.fillRect(46 + i * 9, y - 10, 6, 10);
  // 一门口岸炮
  ctx.fillStyle = ink;
  ctx.fillRect(56, y - 16, 18, 4);
  ctx.restore();
}

/** 一团上升的浓烟：叠圆 + 越往上越淡，给「船在烧」用 */
function drawSmoke(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  hgt: number,
  alpha = 0.55,
): void {
  const dark = hex(PALETTE.ink);
  const grey = hex(PALETTE.plumDark);
  const light = hex(PALETTE.greyPlum);
  // 像素风的烟要「小团叠大团」，画成大圆饼会像气球（第一版就是这个毛病）
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const r = w * 0.26 * (0.7 + t * 1.5);
    ctx.globalAlpha = alpha * (1 - t * 0.78);
    ctx.fillStyle = t < 0.22 ? dark : i % 3 === 0 ? light : grey;
    ctx.beginPath();
    ctx.ellipse(
      x + t * w * 1.15 + (i % 2 ? 1.5 : -1.5),
      baseY - hgt * t,
      r,
      r * 0.82,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 甲板上的火苗：红橙三角 + 一点亮黄核心 */
function drawFire(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number): void {
  ctx.fillStyle = hex(PALETTE.red);
  for (let i = 0; i < 4; i++) {
    const bx = x - w / 2 + (w / 4) * i + 1;
    const hh = 4 + ((i * 7) % 5);
    ctx.beginPath();
    ctx.moveTo(bx, baseY);
    ctx.lineTo(bx + w / 8 + 1, baseY - hh);
    ctx.lineTo(bx + w / 4, baseY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = hex(PALETTE.star);
  ctx.fillRect(x - 1, baseY - 4, 3, 3);
  ctx.fillStyle = hex(PALETTE.redSoft);
  ctx.fillRect(x - 3, baseY - 2, 2, 2);
  ctx.fillRect(x + 2, baseY - 3, 2, 2);
}

/** 侧翻的残骸船体：斜着半沉，断桅，读作「打烂了」 */
function drawWreck(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const ink = hex(PALETTE.ink);
  const grey = hex(PALETTE.greyPlum);
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.translate(x, y);
  ctx.rotate(-0.26);
  ctx.scale(scale, scale);
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(30, 0);
  ctx.lineTo(22, 9);
  ctx.lineTo(-24, 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = grey;
  ctx.fillRect(-26, 0, 50, 2);
  // 断桅：只留半截，倒在一边
  ctx.fillStyle = ink;
  ctx.fillRect(-8, -16, 2, 16);
  ctx.save();
  ctx.translate(-8, -16);
  ctx.rotate(0.9);
  ctx.fillRect(0, 0, 16, 2);
  ctx.restore();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** 海面反光里透出的火光（船烧红了水面） */
function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = hex(PALETTE.red);
  for (let i = 0; i < 5; i++) ctx.fillRect(x - w / 2 + (i * w) / 5, y + i * 2, w / 6, 1);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = hex(PALETTE.star);
  for (let i = 0; i < 4; i++) ctx.fillRect(x - w / 3 + (i * w) / 4, y + 1 + i * 3, w / 8, 1);
  ctx.globalAlpha = 1;
}

/** 生成（或复用）背景纹理，返回纹理 key */
export function backdropTexture(scene: Phaser.Scene, key = 'bg_sea_battle'): string {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, VIEW_W, VIEW_H);
  if (!tex) return key;
  const ctx = tex.getContext();
  const horizon = 150;

  // 天空：从深蓝压到破晓的暖色，分 5 条硬边色带（像素风不用渐变）
  const sky = [PALETTE.indigo, PALETTE.plumDark, PALETTE.plumMid, PALETTE.redDark, PALETTE.red];
  for (let i = 0; i < sky.length; i++) {
    const y0 = Math.round((horizon / sky.length) * i);
    const y1 = Math.round((horizon / sky.length) * (i + 1));
    ctx.fillStyle = hex(sky[i]);
    ctx.fillRect(0, y0, VIEW_W, y1 - y0);
  }
  // 一轮低日
  ctx.fillStyle = hex(PALETTE.star);
  ctx.beginPath();
  ctx.arc(372, horizon - 18, 11, 0, Math.PI * 2);
  ctx.fill();
  // 海：越近越深
  ctx.fillStyle = hex(PALETTE.blue);
  ctx.fillRect(0, horizon, VIEW_W, VIEW_H - horizon);
  ctx.fillStyle = hex(PALETTE.blueLight);
  ctx.fillRect(0, horizon, VIEW_W, 2);
  for (let i = 1; i <= 9; i++) {
    const y = horizon + i * i * 1.6;
    ctx.globalAlpha = 0.5 - i * 0.04;
    ctx.fillStyle = hex(i % 2 ? PALETTE.blueLight : PALETTE.paper);
    for (let x = (i % 3) * 9; x < VIEW_W; x += 34) ctx.fillRect(x, y, 12 + (i % 4) * 4, 1);
  }
  ctx.globalAlpha = 1;

  drawFort(ctx, horizon);
  for (const s of SHIPS) drawShip(ctx, s);

  // —— 惨烈感：烧着的船、侧翻的残骸、三道冲天浓烟、水面火光与硝烟
  // 用户要求「背景要惨烈，体现鸦片战争残酷」。这里不画尸体（远景看不清），
  // 用「火 + 烟 + 残骸 + 被烟压住的太阳」说同一件事。
  const burning = SHIPS[1];
  drawFire(ctx, burning.x, burning.y + 2, 22 * burning.scale * 2.4);
  drawSmoke(ctx, burning.x + 6, burning.y - 6, 16, 92, 0.62);
  drawSmoke(ctx, burning.x - 30, burning.y - 2, 11, 64, 0.42);
  drawWreck(ctx, 404, horizon + 6, 0.5);
  drawSmoke(ctx, 348, horizon - 4, 12, 74, 0.5);
  drawGlow(ctx, burning.x, horizon + 8, 48);

  // 贴海平线的一条硝烟带：把远处压灰，视野里像刚打完一轮齐射
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = hex(PALETTE.plumDark);
  ctx.fillRect(0, horizon - 16, VIEW_W, 18);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = hex(PALETTE.greyPlum);
  ctx.fillRect(0, horizon - 20, VIEW_W, 6);
  ctx.globalAlpha = 1;

  // 前景压暗，让上面的白字读得清
  ctx.fillStyle = hex(PALETTE.ink);
  ctx.globalAlpha = 0.32;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;

  tex.refresh();
  return key;
}

/**
 * 把背景铺满屏幕（容器友好：返回 Image，调用方自己 add 到 container）。
 *
 * 优先用甲方给的正式美术图（`art_bg_sea_red`，480×270）；没加载到就退回程序化绘制，
 * 所以「美术还没到位」和「美术已替换」走的是同一行调用。
 */
export function backdropImage(scene: Phaser.Scene, depth: number): Phaser.GameObjects.Image {
  if (scene.textures.exists(BG_TEX.intro)) {
    return scene.add.image(0, 0, BG_TEX.intro).setOrigin(0, 0).setDepth(depth);
  }
  return scene.add.image(0, 0, backdropTexture(scene)).setOrigin(0, 0).setDepth(depth);
}

/** 战场上方的「远景条」高度（瓦片地图里 `sky_rows` 行 × 16px = 4 行） */
export const HORIZON_H = 64;

/**
 * 战斗场景自带的远景条：天空 + 低日 + 一排敌舰 + 海面。
 *
 * 用户原话是「我想要战斗的时候也有背景」——只做开场卡不够，打起来还是俯视格子地。
 * 做法不是把整张背景铺在战场上（会盖住瓦片），而是**地图顶上留出 `sky_rows` 行不画地砖**，
 * 在那条透明带上叠一条远景：上方是天、下方是海，敌舰停在海平线上，读作「炮台外海面」。
 * 全部色号来自 24 色盘。
 */
export function horizonTexture(scene: Phaser.Scene, key = 'bg_horizon'): string {
  if (scene.textures.exists(key)) return key;
  const h = HORIZON_H;
  const seaY = h - 22;
  const tex = scene.textures.createCanvas(key, VIEW_W, h);
  if (!tex) return key;
  const ctx = tex.getContext();

  const sky = [PALETTE.night, PALETTE.indigo, PALETTE.plumDark, PALETTE.brownDeep];
  for (let i = 0; i < sky.length; i++) {
    const y0 = Math.round((seaY / sky.length) * i);
    const y1 = Math.round((seaY / sky.length) * (i + 1));
    ctx.fillStyle = hex(sky[i]);
    ctx.fillRect(0, y0, VIEW_W, y1 - y0);
  }
  // 火光把海平线压成暗红（烧着的船在左中，光晕就压在它上方）
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = hex(PALETTE.redDark);
  ctx.fillRect(0, seaY - 10, VIEW_W, 10);
  ctx.globalAlpha = 1;
  // 低日，压在右侧海平线附近（左上角被战役条盖住，太阳与舰影都排在右边）
  ctx.fillStyle = hex(PALETTE.star);
  ctx.beginPath();
  ctx.arc(430, seaY - 8, 7, 0, Math.PI * 2);
  ctx.fill();

  // 海：一条亮水线 + 几道波
  ctx.fillStyle = hex(PALETTE.blue);
  ctx.fillRect(0, seaY, VIEW_W, h - seaY);
  ctx.fillStyle = hex(PALETTE.blueLight);
  ctx.fillRect(0, seaY, VIEW_W, 2);
  for (let i = 1; i <= 3; i++) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = hex(PALETTE.paper);
    for (let x = (i % 2) * 11; x < VIEW_W; x += 40) ctx.fillRect(x, seaY + i * 4, 14, 1);
  }
  ctx.globalAlpha = 1;

  // 敌舰剪影停在海平线上（越远越淡）。
  // y 取 seaY：船体上半露出水面，视觉上才像「停在海上」而不是沉下去。
  drawShip(ctx, { x: 172, y: seaY, scale: 0.34, alpha: 0.55 });
  drawShip(ctx, { x: 268, y: seaY + 1, scale: 0.46, alpha: 0.72 });
  drawShip(ctx, { x: 366, y: seaY, scale: 0.3, alpha: 0.45 });

  // 惨烈化：中间那艘在烧、右边那艘翻倒半沉、海面泛火光（用户要求「背景要惨烈」）
  // 远景条只有 56px 高，烟柱最高只能到 30px，再高就被裁掉（第一版 40px，一条烟都看不见）
  drawFire(ctx, 268, seaY + 1, 14);
  drawSmoke(ctx, 272, seaY - 3, 8, 28, 0.72);
  drawSmoke(ctx, 296, seaY - 2, 6, 20, 0.5);
  drawSmoke(ctx, 186, seaY - 2, 7, 22, 0.42);
  drawWreck(ctx, 412, seaY + 3, 0.34);
  drawGlow(ctx, 268, seaY + 4, 30);
  // 远处舰炮的火光：两点亮斑 + 一道斜的白烟，交代「正在对射」
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = hex(PALETTE.star);
  ctx.fillRect(214, seaY - 5, 3, 2);
  ctx.fillRect(340, seaY - 3, 2, 2);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = hex(PALETTE.paper);
  ctx.fillRect(206, seaY - 8, 10, 1);
  ctx.fillRect(336, seaY - 6, 8, 1);
  ctx.globalAlpha = 1;

  // 硝烟带：整条海平线压灰，远景不再像晴天的旅游照
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = hex(PALETTE.plumDark);
  ctx.fillRect(0, seaY - 9, VIEW_W, 11);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = hex(PALETTE.greyPlum);
  ctx.fillRect(0, seaY - 12, VIEW_W, 4);
  ctx.globalAlpha = 1;

  // 底部一条暗色胸墙，把远景和脚下的石台隔开
  ctx.fillStyle = hex(PALETTE.ink);
  ctx.globalAlpha = 0.85;
  ctx.fillRect(0, h - 3, VIEW_W, 3);
  ctx.globalAlpha = 1;

  tex.refresh();
  return key;
}

/**
 * 远景条 Image（调用方自己塞进场景/容器）。
 *
 * `prefer` 决定用甲方哪一张实拍/手绘全景裁出来的条带：
 *  - `'dusk'`（默认，m12276 那张黄昏双舰全景）：舰影更密、海平线更低，战斗关卡都用它；
 *  - `'night'`：早期那张夜色条，留给还在用旧素材的关卡。
 * 两张都没有时才退回 `horizonTexture()` 的程序化绘制——所以美术没接也不会黑屏。
 *
 * `zoom` 是「把条带放大多少倍」：甲方全景里那几艘巨舰占 288×80，塞进 64px 的带子里
 * 会变成指甲盖大的小船，而放大到脸上又跟场上 24×32 的小人抢视觉。这里只放大 1.6 倍
 * 并**水平居中裁切**（只留中段海面），让小舰队读作「远处的敌船」而不是场上道具。
 * 放大后条带比视口宽，调用方要用 `setScrollFactor(0)` 钉住，否则左右会露边。
 */
export function horizonImage(
  scene: Phaser.Scene,
  depth: number,
  prefer: 'dusk' | 'night' = 'dusk',
  zoom = 1,
): Phaser.GameObjects.Image {
  // 甲方给的远景条是 480×64（从全景 y=72..136 裁出来），
  // 画到 `sky_rows`（4 行 = 64px）那条带上刚好对齐。
  const order =
    prefer === 'dusk' ? [BG_TEX.horizonDusk, BG_TEX.horizon] : [BG_TEX.horizon, BG_TEX.horizonDusk];
  for (const key of order) {
    if (scene.textures.exists(key)) {
      const img = scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(depth);
      if (zoom !== 1) {
        img.setScale(zoom);
        // 水平居中：放大后左右各多出一截海面，让中间的舰队落在画面正中
        img.setPosition(-(img.displayWidth - VIEW_W) / 2, -(img.displayHeight - HORIZON_H));
      }
      return img;
    }
  }
  const proc = scene.add.image(0, 0, horizonTexture(scene)).setOrigin(0, 0).setDepth(depth);
  if (zoom !== 1) {
    proc.setScale(zoom);
    proc.setPosition(-(proc.displayWidth - VIEW_W) / 2, -(proc.displayHeight - HORIZON_H));
  }
  return proc;
}