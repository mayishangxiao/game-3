/**
 * 瓦片地图渲染与碰撞 —— 对应设计书 7.2.6 maps 数据结构。
 *
 * 两个阶段：
 *   1. **图集阶段（以前）**：每个格子画一块纯色像素砖。
 *   2. **程序化瓦片（现在）**：地面层整张画进一张 canvas 纹理，按瓦片色推「材质」
 *      （海面 / 沙地 / 石墙 / 木栈道），各自加浪脊、砂点、砖缝、木纹。
 *      为什么用 canvas 而不是几百个 Image：一张 480×256 的纹理只有 1 个游戏对象，
 *      手机上 30×16=480 个精灵的绘制开销反而更贵。
 *
 * 瓦片「材质」不写进数据：地图 JSON 只给 `tile_colors`（色号 → 颜色），
 * 这里按颜色推断材质。原因是有 8 张地图在用同一套色号，加字段要改 8 处、
 * 而且一旦推断错（蓝=海、棕=木/沙）也只是细节不好看，不影响可玩性。
 * 真要精细控制时：加 `tile_styles: {"9": "sea"}` 覆盖推断结果即可。
 */

import Phaser from 'phaser';
import { DEPTH, PALETTE, SCAR_TEX, TILE, darkerOf, lighterOf } from '../core/constants';
import type { MapDef, MapLayer, MapTrigger } from '../core/types';

export interface SolidGrid {
  cols: number;
  rows: number;
  solid: boolean[][];
}

type TileStyle = 'sea' | 'sand' | 'stone' | 'wood' | 'plain';

/**
 * 按颜色推材质：蓝→海、浅黄→沙、灰→石、棕→木。
 *
 * 阈值取的是「偏蓝多少」而不是「蓝分量大」：第一版写成 `b > r + 20`，
 * 结果 `#6B6489`（紫灰的炮台地面）也被判成海，整片场地被画上浪花，
 * 截图里看着像站在水上。改成必须蓝得明显（b-r ≥ 60 且 b ≥ g+20）才认海。
 * 需要精细控制时：地图里加 `tile_styles: {"9": "sea"}` 覆盖推断。
 */
export function tileStyleOf(hex: string): TileStyle {
  const c = Phaser.Display.Color.HexStringToColor(hex);
  const r = c.red;
  const g = c.green;
  const b = c.blue;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (b - r >= 60 && b - g >= 20) return 'sea';
  // 灰紫色（低饱和、偏冷）是炮台地面与石墙的色板，按「石」处理画砖缝
  if (mx - mn <= 46 && mx >= 60 && b >= g) return 'stone';
  if (r > 130 && g > 100 && b < g + 10) return 'sand';
  if (r > 90 && r > b + 30) return 'wood';
  return 'plain';
}

/** 稳定的伪随机（同一格永远同一组点，避免滚动时砂点「跳」） */
function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function cssOf(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export class MapRenderer {
  readonly def: MapDef;
  readonly grid: SolidGrid;
  private groundImg: Phaser.GameObjects.Image | null = null;
  private groundKey: string | null = null;
  private decoGfx: Phaser.GameObjects.Graphics;
  /** 地面层数据（残破化时用来跳过水面，见 isSeaPixel） */
  private groundData: number[][] | null = null;
  /** 每个实例一张纹理：见 drawGround 的注释（共用 key 会在场景切换那一帧炸渲染） */
  private static seq = 0;

  constructor(private scene: Phaser.Scene, def: MapDef) {
    this.def = def;
    this.grid = {
      cols: def.width,
      rows: def.height,
      solid: Array.from({ length: def.height }, () => Array<boolean>(def.width).fill(false)),
    };

    this.decoGfx = scene.add.graphics().setDepth(DEPTH.deco);

    for (const layer of def.layers) {
      if (layer.name === 'foreground') this.drawForeground(layer);
      else this.drawGround(layer);
      if (layer.collidable) this.markCollision(layer);
    }
    this.paintWalls();
  }

  /**
   * 把「撞不进去但看不见」的格子画成石墙。
   *
   * 甲方原话：「战斗地图的中间空气墙不规范，只是地面也加了空气墙」——
   * 碰撞层里在场地中间那几格（柱子、炮台基座、右半边的船坞区）以前只有碰撞、
   * 没有任何视觉提示，玩家一头撞上去只会以为游戏卡了。
   * 这里在烘好的地面纹理上补画石墙：亮顶面 + 深墙面 + 1px 墨线，
   * 让「看得见的墙」和「撞得住的墙」一一对应。外圈边界不画（那是屏幕边，不是墙）。
   */
  private paintWalls(): void {
    if (!this.groundKey) return;
    const tex = this.scene.textures.get(this.groundKey) as Phaser.Textures.CanvasTexture;
    if (!tex || typeof tex.getContext !== 'function') return;
    const ctx = tex.getContext();
    const { cols, rows } = this.grid;
    const skyRows = this.def.sky_rows ?? 0;
    const face = cssOf(PALETTE.plumDark);
    const topFace = cssOf(PALETTE.greyPlum);
    const ink = cssOf(PALETTE.ink);
    let painted = 0;
    for (let y = Math.max(1, skyRows); y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (!this.grid.solid[y][x]) continue;
        // 只有「下面还有可走地面」的格子才需要提示玩家：贴边的实心块本来就是画面边界
        const openBelow = y + 1 < rows - 1 && !this.grid.solid[y + 1][x];
        const openAbove = y - 1 >= 0 && !this.grid.solid[y - 1][x];
        if (!openBelow && !openAbove) continue;
        const px = x * TILE;
        const py = y * TILE;
        ctx.fillStyle = face;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = topFace;
        ctx.fillRect(px, py, TILE, 4);
        ctx.fillStyle = ink;
        ctx.fillRect(px, py, TILE, 1);
        ctx.fillRect(px, py + TILE - 1, TILE, 1);
        ctx.fillRect(px, py, 1, TILE);
        ctx.fillRect(px + TILE - 1, py, 1, TILE);
        painted += 1;
      }
    }
    if (painted > 0) tex.refresh();
  }

  /**
   * 地面层：整层烘成一张 canvas 纹理。
   *
   * key 必须**每个实例不同**：纹理是全局的（TextureManager），同一张地图被重建时
   * 如果复用 key 并先 remove 再 create，上一帧还在显示旧 Image 的场景会拿一个
   * 已经被删掉的纹理去画，Phaser 在 batchSprite 里读 `glTexture` 直接抛
   * `Cannot read properties of null`（探针里抓到的就是这个）。
   */
  private drawGround(layer: MapLayer): void {
    const { cols, rows } = this.grid;
    const w = cols * TILE;
    const h = rows * TILE;
    const key = `map_ground_${this.def.id}_${MapRenderer.seq++}`;
    this.groundKey = key;
    const tex = this.scene.textures.createCanvas(key, w, h);
    if (!tex) return;
    const ctx = tex.getContext();

    // 顶上 `sky_rows` 行留空（透明），由 LevelScene 在那条带上叠远景条，
    // 战斗地图因此有「炮台外的海面」而不是光秃秃的格子地。
    const skyRows = this.def.sky_rows ?? 0;
    this.groundData = layer.data;
    for (let y = Math.min(skyRows, rows); y < Math.min(rows, layer.data.length); y++) {
      for (let x = 0; x < Math.min(cols, layer.data[y].length); x++) {
        const tile = layer.data[y][x];
        if (!tile) continue;
        const hex = this.def.tile_colors[String(tile)];
        if (!hex) continue;
        this.paintTile(ctx, x * TILE, y * TILE, hex);
      }
    }
    // 残破化痕迹画在地砖之上、远景之下（远景条所在的那几行不沾血，免得船身上糊一片）
    if (this.def.battle_scars) this.paintScars(ctx, w, h, skyRows * TILE);
    tex.refresh();
    this.groundImg = this.scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(DEPTH.ground);
  }

  /**
   * 战场残破化：在烘好的地面纹理上再叠一层「打烂了」的痕迹。
   *
   * 用户原话是「地板增加血迹尸骸，炮坑等，让地图很残破」——不开这个开关的地图
   * （村里、长廊、副本暗巷）一格都不加，所以它是按地图数据开关的，不是全局。
   * 全部用 24 色盘；用 `hash2` 造稳定伪随机，滚动时痕迹不会跳。
   */
  private paintScars(ctx: CanvasRenderingContext2D, w: number, h: number, topY: number): void {
    const rnd = (i: number): number => hash2(i * 131 + 7, i * 977 + 13);
    const spanY = Math.max(1, h - topY);
    const ink = cssOf(PALETTE.ink);
    const soil = cssOf(PALETTE.brownDeep);
    const soilLight = cssOf(PALETTE.brown);
    const blood = cssOf(PALETTE.redDark);
    /** 水面上不沾血、不摆尸——海是后压上来的，痕迹只应该出现在陆地上 */
    const dry = (x: number, y: number): boolean => !this.isSeaPixel(x, y);

    // ① 有正式贴花就用贴花（甲方给的 12 张：弹坑 / 血泊 / 尸骸 / 碎砖），否则退回程序化痕迹
    if (this.paintScarStickers(ctx, w, topY, spanY, ink, dry)) {
      this.paintRuin(ctx, w, topY);
      ctx.globalAlpha = 1;
      return;
    }

    // ① 弹坑：黑心 + 焦土圈 + 几粒飞溅
    for (let i = 0; i < 9; i++) {
      const x = 16 + rnd(i) * (w - 32);
      const y = topY + 28 + rnd(i + 40) * (spanY - 44);
      if (!dry(x, y)) continue;
      const r = 4 + rnd(i + 80) * 4;
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = soil;
      ctx.beginPath();
      ctx.ellipse(x, y, r + 1.5, r * 0.75 + 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = soilLight;
      for (let k = 0; k < 4; k++) {
        const a = rnd(i + k * 7) * Math.PI * 2;
        const d = r + 2 + rnd(i + k * 11) * 5;
        ctx.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d * 0.7), 2, 1);
      }
    }

    // ② 血迹：不规则的暗红块 + 两点溅射（只用暗红，鲜红会像糖果）
    for (let i = 0; i < 10; i++) {
      const x = 16 + rnd(i + 300) * (w - 32);
      const y = topY + 24 + rnd(i + 340) * (spanY - 36);
      if (!dry(x, y)) continue;
      const r = 2 + rnd(i + 380) * 3;
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = blood;
      ctx.beginPath();
      ctx.ellipse(x, y, r + 1, r * 0.55, rnd(i + 400) * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 1.5, y + 1, r * 0.7, r * 0.4, rnd(i + 420) * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.round(x + r + 2), Math.round(y - 1), 2, 1);
      ctx.fillRect(Math.round(x - r - 3), Math.round(y + 2), 1, 1);
    }

    // ③ 尸骸：躺倒的人形（血泊 + 躯干 + 头 + 一条伸出的腿），深色军服
    const body = cssOf(PALETTE.blue);
    const face = cssOf(PALETTE.cream);
    for (let i = 0; i < 3; i++) {
      const x = 34 + rnd(i + 500) * (w - 68);
      const y = topY + 44 + rnd(i + 540) * (spanY - 66);
      if (!dry(x, y)) continue;
      const flip = rnd(i + 580) > 0.5 ? 1 : -1;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = blood;
      ctx.beginPath();
      ctx.ellipse(x + flip * 2, y + 3, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 先铺一圈深描边，躺着的号衣才读得出轮廓（深色躯干会和石台糊成一片）
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = ink;
      ctx.fillRect(Math.round(x - 8), Math.round(y - 4), 16, 7);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = body;
      ctx.fillRect(Math.round(x - 7), Math.round(y - 3), 14, 5);
      ctx.fillRect(Math.round(x + flip * 7), Math.round(y - 1), flip > 0 ? 6 : -6, 2);
      ctx.fillStyle = face;
      ctx.fillRect(Math.round(x - flip * 10) - 1, Math.round(y - 3), 4, 3);
      // 压在身上的一点暗影，读作「躺在地上」而不是浮着
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ink;
      ctx.fillRect(Math.round(x - 7), Math.round(y + 2), 14, 1);
    }

    // ④ 碎木与碎石：短横条，压在痕迹上打散
    for (let i = 0; i < 24; i++) {
      const x = 10 + rnd(i + 700) * (w - 20);
      const y = topY + 20 + rnd(i + 740) * (spanY - 28);
      if (!dry(x, y)) continue;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = i % 2 ? soilLight : cssOf(PALETTE.greyPlum);
      ctx.fillRect(Math.round(x), Math.round(y), 2 + Math.round(rnd(i + 780) * 3), 1);
    }
    ctx.globalAlpha = 1;

    this.paintRuin(ctx, w, topY);
  }

  /**
   * 用甲方给的 12 张贴花铺地面痕迹：0-2 弹坑、3-5 血泊、6-8 尸骸/残片、9-11 碎砖炮弹。
   *
   * 贴花是 2 倍像素（960×540 的画布规格），所以按 0.5 缩放进 480×256 的地面纹理。
   * 位置用 `hash2` 定死，滚动/重进关卡都在同一处，不会「血迹到处跑」。
   * 返回 false 表示贴图没加载（美术未到位），调用方退回程序化痕迹。
   */
  private paintScarStickers(
    ctx: CanvasRenderingContext2D,
    w: number,
    topY: number,
    spanY: number,
    ink: string,
    dry: (x: number, y: number) => boolean,
  ): boolean {
    const first = SCAR_TEX[0] as string;
    if (!this.scene.textures.exists(first)) return false;
    const rnd = (i: number): number => hash2(i * 197 + 23, i * 613 + 41);
    // 铺痕用**抖动网格**而不是纯随机：纯随机会在左半边堆成一坨，
    // 看着像「有人把贴纸撒在墙角」。6×3 个格子，每格最多放一件。
    const cellsX = 6;
    const cellsY = 3;
    const cellW = w / cellsX;
    const cellH = Math.max(1, spanY) / cellsY;
    const cells: Array<{ cx: number; cy: number }> = [];
    for (let gy = 0; gy < cellsY; gy++) {
      for (let gx = 0; gx < cellsX; gx++) {
        cells.push({ cx: gx, cy: gy });
      }
    }
    // 稳定洗牌（同一个 hash 决定顺序），保证每次进关卡痕迹位置一致
    cells.sort((a, b) => rnd(a.cx * 31 + a.cy * 7) - rnd(b.cx * 31 + b.cy * 7));
    // 每张的数量与尺寸：弹坑多但画小（原尺寸铺到 57px 宽，在 16px 地砖上像一口井），血泊中、尸骸少
    const plan: Array<{ range: [number, number]; count: number; scale: number }> = [
      { range: [0, 3], count: 5, scale: 0.44 },
      { range: [3, 6], count: 4, scale: 0.52 },
      { range: [6, 9], count: 3, scale: 0.6 },
      { range: [9, 12], count: 4, scale: 0.52 },
    ];
    let seed = 0;
    let cellAt = 0;
    for (const p of plan) {
      for (let k = 0; k < p.count; k++) {
        const key = SCAR_TEX[p.range[0] + (k % (p.range[1] - p.range[0]))] as string;
        if (!this.scene.textures.exists(key)) continue;
        const src = this.scene.textures.get(key).getSourceImage() as HTMLImageElement;
        const dw = Math.max(2, Math.round(src.width * p.scale));
        const dh = Math.max(2, Math.round(src.height * p.scale));
        const cell = cells[cellAt % cells.length];
        cellAt += 1;
        if (!cell) continue;
        // 在格子内抖一点，别排成整齐的方阵
        const x = cell.cx * cellW + 4 + rnd(seed) * Math.max(1, cellW - dw - 8);
        const y = topY + cell.cy * cellH + 6 + rnd(seed + 900) * Math.max(1, cellH - dh - 12);
        seed += 1;
        if (!dry(x + dw / 2, y + dh / 2)) continue;
        // 先在地上压一圈焦黑：贴花是贴在砖面上的，没有这层底会读成「摆在地上的物件」
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.ellipse(
          Math.round(x + dw / 2),
          Math.round(y + dh / 2 + 1),
          Math.max(3, Math.round(dw * 0.62)),
          Math.max(2, Math.round(dh * 0.5)),
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 0.92;
        ctx.drawImage(src, Math.round(x), Math.round(y), dw, dh);
        // 贴花下沿压一道极淡的影，避免像贴纸浮在地砖上
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = ink;
        ctx.fillRect(Math.round(x + 2), Math.round(y + dh - 1), Math.max(2, dw - 4), 1);
      }
    }
    ctx.globalAlpha = 1;
    return true;
  }

  /** 这个像素点在地砖数据里是不是海（残破化痕迹只在陆地上画） */
  private isSeaPixel(x: number, y: number): boolean {
    const data = this.groundData;
    if (!data) return false;
    const gx = Math.floor(x / TILE);
    const gy = Math.floor(y / TILE);
    const row = data[gy];
    if (!row) return false;
    const hex = this.def.tile_colors[String(row[gx])];
    return !!hex && tileStyleOf(hex) === 'sea';
  }

  /**
   * 世界坐标是否落在**地图数据里那片原始海面**上。
   *
   * 和 `extraSolid` 的区别：原始海面只影响绘制，没进碰撞格，`isSolidAtWorld` 对它
   * 返回 false。所以敌人被击退到海里/地图外时得单独查这一条，否则没人发现他掉下去了
   * （甲方截图报的「小兵又被打出地图」）。
   */
  isSeaAtWorld(wx: number, wy: number): boolean {
    return this.isSeaPixel(wx, wy);
  }

  /**
   * 破烂的炮台：贴着地面第一行画一道塌了的胸墙，再摆两门炸坏的岸炮。
   *
   * 用户原话「也没有破烂的炮台」——之前战场只是一片石台，没有「这里是炮台」的证据。
   * 胸墙画在**碰撞墙所在的第一行**（那行玩家本来就上不去），所以不会挡住走位。
   */
  private paintRuin(ctx: CanvasRenderingContext2D, w: number, topY: number): void {
    const ink = cssOf(PALETTE.ink);
    const stone = cssOf(PALETTE.plumLight);
    const stoneD = cssOf(PALETTE.plumMid);
    const soil = cssOf(PALETTE.brownDeep);
    const rnd = (i: number): number => hash2(i * 37 + 11, i * 173 + 5);

    // 胸墙：8px 一块，随机塌口与高低差
    for (let x = 0; x < w; x += 8) {
      const i = x / 8;
      const fallen = rnd(i) < 0.34;
      const h = fallen ? 2 : 7 + Math.round(rnd(i + 90) * 5);
      // 墙顶压在 topY 上沿，塌口只留一小截残基
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = fallen ? stoneD : stone;
      ctx.fillRect(x, topY, 7, h);
      ctx.fillStyle = ink;
      ctx.fillRect(x, topY, 7, 1);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x + 1, topY + h - 1, 5, 1);
      // 砖缝
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = ink;
      ctx.fillRect(x + 3, topY + 1, 1, Math.max(1, h - 3));
      ctx.globalAlpha = 1;
      // 塌口下面堆碎砖
      if (fallen) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = soil;
        ctx.fillRect(x, topY + 2, 8, 2);
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = stoneD;
        ctx.fillRect(x + 1, topY + 2, 3, 1);
        ctx.fillRect(x + 5, topY + 3, 2, 1);
        ctx.globalAlpha = 1;
      }
    }

    // 两门炸坏的岸炮：歪倒的炮管 + 缺了半边的炮架
    for (const [cx, tilt] of [
      [112, 1],
      [312, -1],
    ] as const) {
      ctx.save();
      ctx.translate(cx, topY + 22);
      ctx.rotate(tilt * 0.22);
      // 炮管（深灰，前端开口）
      ctx.fillStyle = cssOf(PALETTE.plumDark);
      ctx.fillRect(-13, -3, 26, 5);
      ctx.fillStyle = ink;
      ctx.fillRect(-14, -4, 28, 1);
      ctx.fillRect(-14, 2, 28, 1);
      ctx.fillStyle = cssOf(PALETTE.ink);
      ctx.fillRect(11, -2, 3, 3);
      // 炮架残骸 + 一只轮子
      ctx.fillStyle = cssOf(PALETTE.brownDeep);
      ctx.fillRect(-6, 2, 10, 4);
      ctx.fillStyle = cssOf(PALETTE.brown);
      ctx.beginPath();
      ctx.arc(-9, 5, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(-9, 5, 4, 0, Math.PI * 2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      // 炮位周围一圈焦黑
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(cx, topY + 16, 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** 一格的材质绘制（16×16，全部 1~2px 硬边细节，不用渐变） */
  private paintTile(ctx: CanvasRenderingContext2D, px: number, py: number, hex: string): void {
    const color = Phaser.Display.Color.HexStringToColor(hex).color;
    const style = tileStyleOf(hex);
    const base = cssOf(color);
    const dark = cssOf(darkerOf(color));
    const light = cssOf(lighterOf(color));

    ctx.fillStyle = base;
    ctx.fillRect(px, py, TILE, TILE);

    if (style === 'sea') {
      // 浪脊：两条错开的短线 + 顶上一点浪花
      ctx.fillStyle = light;
      ctx.fillRect(px + 2, py + 4, 6, 1);
      ctx.fillRect(px + 9, py + 9, 5, 1);
      ctx.fillStyle = cssOf(lighterOf(lighterOf(color)));
      ctx.fillRect(px + 1, py + 2, 2, 1);
      ctx.fillRect(px + 12, py + 6, 2, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(px, py + TILE - 3, TILE, 1);
      return;
    }

    if (style === 'sand') {
      // 砂点：3 个小点，位置由格坐标决定
      ctx.fillStyle = dark;
      for (let i = 0; i < 3; i++) {
        const rx = Math.floor(hash2(px + i, py) * (TILE - 3)) + 1;
        const ry = Math.floor(hash2(px, py + i * 7) * (TILE - 3)) + 1;
        ctx.fillRect(px + rx, py + ry, 1, 1);
      }
      // 顶部高光只给一部分格子：每格都加会连成一张亮网格，像铺了瓷砖
      if (hash2(px, py) > 0.62) {
        ctx.fillStyle = light;
        ctx.fillRect(px, py, TILE, 1);
      }
      return;
    }

    if (style === 'stone') {
      // 砖缝：横缝 + 每层错开的竖缝
      ctx.fillStyle = dark;
      ctx.fillRect(px, py + 7, TILE, 1);
      ctx.fillRect(px, py + TILE - 1, TILE, 1);
      const off = (Math.floor(py / TILE) % 2) * 8;
      ctx.fillRect(px + ((4 + off) % TILE), py, 1, 7);
      ctx.fillRect(px + ((12 + off) % TILE), py + 8, 1, 7);
      // 顶部高光只给一部分砖面：每格都加会连成一张亮网格，整块地像贴了瓷砖
      if (hash2(px + 3, py + 1) > 0.55) {
        ctx.fillStyle = light;
        ctx.fillRect(px + 1, py + 1, TILE - 2, 1);
      }
      // 风化麻点：两三处暗斑，把大面积的砖面打散
      ctx.fillStyle = dark;
      for (let i = 0; i < 2; i++) {
        const rx = Math.floor(hash2(px + i * 5, py + 9) * (TILE - 4)) + 2;
        const ry = Math.floor(hash2(px + 9, py + i * 5) * 6) + 1;
        ctx.fillRect(px + rx, py + ry, 2, 1);
      }
      return;
    }

    if (style === 'wood') {
      // 木纹：三条板缝 + 一点节疤
      ctx.fillStyle = dark;
      ctx.fillRect(px, py + 4, TILE, 1);
      ctx.fillRect(px, py + 11, TILE, 1);
      ctx.fillStyle = light;
      ctx.fillRect(px + 3, py + 2, 5, 1);
      ctx.fillRect(px + 8, py + 7, 4, 1);
      return;
    }

    // 兜底：硬阴影（底/右压暗、左上提亮），与以前一致
    ctx.fillStyle = dark;
    ctx.fillRect(px, py + TILE - 2, TILE, 2);
    ctx.fillRect(px + TILE - 2, py, 2, TILE);
    ctx.fillStyle = light;
    ctx.fillRect(px, py, TILE, 1);
    ctx.fillRect(px, py, 1, TILE);
  }

  /** 前景层：数量少（墙头、屋檐），照旧用 Graphics 画 */
  private drawForeground(layer: MapLayer): void {
    for (let y = 0; y < layer.data.length; y++) {
      const row = layer.data[y];
      for (let x = 0; x < row.length; x++) {
        const tile = row[x];
        if (!tile) continue;
        const hex = this.def.tile_colors[String(tile)];
        if (!hex) continue;
        const color = Phaser.Display.Color.HexStringToColor(hex).color;
        const px = x * TILE;
        const py = y * TILE;
        this.decoGfx.fillStyle(color, 1);
        this.decoGfx.fillRect(px, py, TILE, TILE);
        this.decoGfx.fillStyle(darkerOf(color), 1);
        this.decoGfx.fillRect(px, py + TILE - 2, TILE, 2);
        this.decoGfx.fillRect(px + TILE - 2, py, 2, TILE);
        this.decoGfx.fillStyle(lighterOf(color), 1);
        this.decoGfx.fillRect(px, py, TILE, 1);
      }
    }
  }

  private markCollision(layer: MapLayer): void {
    for (let y = 0; y < layer.data.length && y < this.grid.rows; y++) {
      for (let x = 0; x < layer.data[y].length && x < this.grid.cols; x++) {
        if (layer.data[y][x]) this.grid.solid[y][x] = true;
      }
    }
  }

  /**
   * 额外禁区：海水这类「地形上可画、但不该站人」的格子。
   *
   * 之前海面只影响绘制与美术，碰撞只看 `grid.solid`，于是敌人被打退、
   * 玩家闪现都会进水，而且水里没有落脚点（甲方报的「敌人被打到海里就攻击不到」）。
   * 由 LevelScene 指向自己的 `isSeaAt`，这样船推进到哪、哪片就不通了。
   */
  extraSolid: ((wx: number, wy: number) => boolean) | null = null;

  /** 世界坐标是否撞墙 */
  isSolidAtWorld(wx: number, wy: number): boolean {
    if (this.extraSolid && this.extraSolid(wx, wy)) return true;
    const gx = Math.floor(wx / TILE);
    const gy = Math.floor(wy / TILE);
    return this.isSolidAtTile(gx, gy);
  }

  isSolidAtTile(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.grid.cols || gy >= this.grid.rows) return true;
    return this.grid.solid[gy][gx];
  }

  get pixelWidth(): number {
    return this.def.width * TILE;
  }

  get pixelHeight(): number {
    return this.def.height * TILE;
  }

  triggersInWorld(): { trigger: MapTrigger; rect: Phaser.Geom.Rectangle }[] {
    return this.def.triggers.map((t) => ({
      trigger: t,
      rect: new Phaser.Geom.Rectangle(t.x * TILE, t.y * TILE, t.w * TILE, t.h * TILE),
    }));
  }

  destroy(): void {
    this.groundImg?.destroy();
    this.groundImg = null;
    if (this.groundKey) {
      this.scene.textures.remove(this.groundKey);
      this.groundKey = null;
    }
    this.decoGfx.destroy();
  }
}