/**
 * 占位美术：矢量拼装角色（24×32 二头身，1px 黑描边）。
 *
 * 依据设计书 9.1 的策略——「先跑通，后贴图」。这里不加载任何图片资源，
 * 用完形矩形拼出一个会走路、会挥武器、会闪白的小人。
 * 接入正式像素图集时，只需把本类替换为 Phaser.GameObjects.Sprite，
 * 对外接口（setFacing / playWalk / playAttack / hitFlash / playDeath）保持不变。
 */

import Phaser from 'phaser';
import { CHAR_H, CHAR_W, DEPTH, PALETTE, PART_ART, PartFacing, PartName, partKey, SHIP_FRAME, WEAPON_KIND } from '../core/constants';

/** 舰船一次开炮动作的时长（毫秒）：比人形长一倍，舷炮齐射才看得清 */
const SHIP_ATTACK_MS = 340;

export type Facing = 'down' | 'up' | 'left' | 'right';

export interface RigOptions {
  /** 主体色（军装/长衫/制服） */
  bodyColor: number;
  /** 头部/肤色 */
  skinColor?: number;
  /** 腿部色 */
  legColor?: number;
  /** 武器色（null 表示无武器） */
  weaponColor?: number | null;
  /** 体型缩放：Boss 用 1.6—3.0 */
  scale?: number;
  /**
   * 占位形体。默认人形；'ship' 画成铁壳蒸汽炮舰（Boss 英舰）。
   * 人形的头/躯干/腿仍会创建但隐藏，这样 tick / 受击闪白等逻辑不必分叉太多。
   */
  body?: 'human' | 'ship';
  /**
   * 正式美术帧的纹理 key（按舰队帧序：0 待机 / 1 后坐 / 2 冒烟 / 3 舷炮齐射 / 4·5 破损）。
   * 传了且纹理已加载就用贴图，否则退回矩形拼装的占位形体——
   * 这样「美术还没到位」和「图挂了」都不会让军舰消失，只是退回旧观感。
   */
  art?: readonly string[];
  /**
   * 兵种小人贴图的「前缀」。传了且 `<prefix>_down|up|left|right` 四张纹理都在，
   * 人形就切成贴图模式（`public/art/units/*.png`，24×32，四朝向）。
   *
   * 为什么不写进 JSON：这是**表现层**的东西——同一个 `en_uk_infantry` 换个皮不该动数据，
   * 数据里只留身价/血量/攻击这些数值。缺图时自动退回矩形占位形体，不会白屏。
   */
  unit?: string;
}

export class CharacterRig extends Phaser.GameObjects.Container {
  private head: Phaser.GameObjects.Rectangle;
  private torso: Phaser.GameObjects.Rectangle;
  private legL: Phaser.GameObjects.Rectangle;
  private legR: Phaser.GameObjects.Rectangle;
  private weapon: Phaser.GameObjects.Rectangle | null = null;

  private facing: Facing = 'down';
  private walkPhase = 0;
  /** 贴图小人的「呼吸」相位：站着的时候只有这一条在动 */
  private idlePhase = 0;
  private attackTimer = 0;
  private flashTimer = 0;
  private dead = false;

  private readonly baseBody: number;
  private readonly baseSkin: number;
  /** 舰船形体（body: 'ship'）时的各部件与底色，受击闪白要整船一起闪 */
  private readonly isShip: boolean;
  private shipParts: Phaser.GameObjects.Rectangle[] = [];
  private shipColors: number[] = [];
  /** 有正式美术帧时，舰船是一张 Image（后续可换帧），矩形部件不再创建 */
  private shipImage: Phaser.GameObjects.Image | null = null;
  private shipKeys: readonly string[] = [];
  private frameTimer = 0;
  /** 血量低于阈值时换破损帧（由 Enemy 每帧同步） */
  private damaged = false;
  /** 兵种贴图（24×32 四朝向）。有它时矩形部件全部隐藏，走路改成整体上下浮动 */
  private unitImage: Phaser.GameObjects.Image | null = null;
  private unitKey = '';

  /**
   * 分件小人（「积木小人」）：五张图按锚点拼起来，关节可以真的转。
   * 比整张贴图多的就是「能动」——腿绕胯摆、手臂连带兵器绕肩抡。
   */
  private partsRoot: Phaser.GameObjects.Container | null = null;
  private partImgs: Phaser.GameObjects.Image[] = [];
  private legBack: Phaser.GameObjects.Image | null = null;
  private legFront: Phaser.GameObjects.Image | null = null;
  private torsoImg: Phaser.GameObjects.Image | null = null;
  private headImg: Phaser.GameObjects.Image | null = null;
  private weaponPartImg: Phaser.GameObjects.Image | null = null;
  private armPivot: Phaser.GameObjects.Container | null = null;
  private partsUnit = '';
  private partsFacing: PartFacing = 'front';

  /** 分件拼装锚点（容器原点 = 脚底中心，向上为负）。改这里会同时改走路手感，先量再动 */
  private static readonly PIVOT = {
    legTop: -12,
    legSpread: 4,
    torsoBottom: -9,
    headBottom: -20,
    shoulder: -19,
    shoulderX: 4,
    /** 兵器的握把在手臂支点里的位置（+9 = 胯部高度，刀尖到耳朵） */
    weaponInHand: 9,
    /** 贴着身子往外错一点，不然刀刃横在肚子前面 */
    weaponOutX: 4,
    /** 原稿里刀/枪是竖着挎的，不斜 */
    weaponAngle: 0,
    /** 兵器最高 16px（原稿件是 18px，比 32px 的人还高，会顶到头发） */
    weaponMaxH: 16,
  };

  constructor(scene: Phaser.Scene, x: number, y: number, opts: RigOptions) {
    super(scene, x, y);
    this.baseBody = opts.bodyColor;
    this.baseSkin = opts.skinColor ?? PALETTE.cream;

    const legColor = opts.legColor ?? PALETTE.plumDark;

    // 头部 12×12（二头身，占上半身）
    this.head = scene.add
      .rectangle(0, -10, 12, 12, this.baseSkin)
      .setStrokeStyle(1, PALETTE.ink)
      .setOrigin(0.5);
    // 躯干 12×12
    this.torso = scene.add
      .rectangle(0, 2, 12, 12, this.baseBody)
      .setStrokeStyle(1, PALETTE.ink)
      .setOrigin(0.5);
    // 双腿 4×8
    this.legL = scene.add.rectangle(-4, 12, 4, 8, legColor).setOrigin(0.5);
    this.legR = scene.add.rectangle(4, 12, 4, 8, legColor).setOrigin(0.5);

    this.add([this.legL, this.legR, this.head, this.torso]);

    if (opts.weaponColor !== null && opts.weaponColor !== undefined) {
      this.weapon = scene.add
        .rectangle(9, 2, 3, 14, opts.weaponColor)
        .setStrokeStyle(1, PALETTE.ink)
        .setOrigin(0.5);
      this.add(this.weapon);
    }

    this.isShip = opts.body === 'ship';
    if (this.isShip) {
      // 人形部件留着（隐藏），只是不参与显示，省得每处逻辑都判断形体
      this.head.setVisible(false);
      this.torso.setVisible(false);
      this.legL.setVisible(false);
      this.legR.setVisible(false);
      this.weapon?.setVisible(false);
      const art = opts.art ?? [];
      if (art.length > 0 && scene.textures.exists(art[0])) {
        this.shipKeys = art;
        // 96×48 的贴图：底边压在水下 8px 处，吃水线（第 40 行）正好落在容器原点，
        // 这样海面是按玩家脚下的 y 画的，船不会浮在半空。
        this.shipImage = scene.add.image(0, 8, art[0]).setOrigin(0.5, 1);
        this.add(this.shipImage);
      } else {
        this.buildShip(scene, this.baseBody);
      }
    }

    if (opts.scale && opts.scale !== 1 && !this.isShip) this.setScale(opts.scale);

    // 兵种贴图：先试分件（能摆动手脚），再退整张贴图，最后退矩形小人。
    // 顺序不能反：分件和整张都会命中，分件更「活」，所以先给它机会。
    const unit = opts.unit ?? '';
    const useParts = !this.isShip && unit !== '' && this.buildParts(scene, unit);
    if (useParts) {
      this.hideRectParts();
    } else if (!this.isShip && unit && this.unitFrames(scene, unit)) {
      this.unitKey = unit;
      this.hideRectParts();
      // 24×32 的贴图脚底对齐容器原点：环境里角色坐标就是「站着的那一点」
      this.unitImage = scene.add.image(0, 0, `${unit}_down`).setOrigin(0.5, 1);
      this.add(this.unitImage);
    }

    this.setDepth(DEPTH.entityBase + y * 0.01);
    scene.add.existing(this);
  }

  /** 四朝向贴图是否齐全 */
  private unitFrames(scene: Phaser.Scene, unit: string): boolean {
    return (['down', 'up', 'left', 'right'] as const).every((f) => scene.textures.exists(`${unit}_${f}`));
  }

  /** 矩形占位形体整体隐藏（切贴图/分件时用） */
  private hideRectParts(): void {
    this.head.setVisible(false);
    this.torso.setVisible(false);
    this.legL.setVisible(false);
    this.legR.setVisible(false);
    this.weapon?.setVisible(false);
  }

  /**
   * 拼一个「积木小人」：两条腿、上身、一条臂（臂与兵器挂在同一个可转支点上）、头。
   *
   * 图层顺序 = 后腿 → 前腿 → 上身 → 手臂 → 头 → 兵器（兵器在臂支点里）。
   * 锚点见 PIVOT：胯在 −12、腰 −9、脖子 −20、肩 (−19, ±4)，脚底就是容器原点。
   * 缺任意一件就返回 false，让构造函数退回整张贴图——不做半成品拼装。
   */
  private buildParts(scene: Phaser.Scene, unit: string): boolean {
    const parts = PART_ART[unit];
    if (!parts) return false;
    const has = (f: PartFacing, p: PartName) => scene.textures.exists(partKey(unit, f, p));
    const facings: PartFacing[] = ['front', 'side'];
    for (const f of facings) {
      for (const p of parts) {
        if (!has(f, p)) return false;
      }
    }

    this.partsUnit = unit;
    this.partsFacing = 'front';
    const P = CharacterRig.PIVOT;
    const root = scene.add.container(0, 0);

    // 后腿压暗一档：两腿同色时看不出前后，走起来会像一条腿在抖
    this.legBack = scene.add
      .image(-P.legSpread, P.legTop, partKey(unit, 'front', 'leg'))
      .setOrigin(0.5, 0)
      .setTint(0xB9B2C9);
    this.legFront = scene.add
      .image(P.legSpread, P.legTop, partKey(unit, 'front', 'leg'))
      .setOrigin(0.5, 0);
    this.torsoImg = scene.add
      .image(0, P.torsoBottom, partKey(unit, 'front', 'torso'))
      .setOrigin(0.5, 1);
    this.headImg = scene.add
      .image(0, P.headBottom, partKey(unit, 'front', 'head'))
      .setOrigin(0.5, 1);

    // 手臂支点：绕肩转，兵器和手一起走（不分开算，省得抡刀时刀飞出去）
    this.armPivot = scene.add.container(P.shoulderX, P.shoulder);
    const arm = scene.add.image(0, 0, partKey(unit, 'front', 'arm')).setOrigin(0.5, 0);
    this.armPivot.add(arm);
    const weapon = this.buildWeapon(scene, unit);
    if (weapon) this.armPivot.add(weapon);

    root.add([this.legBack, this.legFront, this.torsoImg, this.armPivot, this.headImg]);
    this.partsRoot = root;
    this.add(root);
    this.partImgs = [this.legBack, this.legFront, this.torsoImg, this.headImg, arm];
    return true;
  }

  /**
   * 分件小人的兵器：优先用甲方出的分件贴图（竖着挎，跟原稿一致）；
   * 那张图缺失时才用矩形现画一把，保证不会出现「空着手」的人。
   */
  private buildWeapon(scene: Phaser.Scene, unit: string): Phaser.GameObjects.Container | null {
    const P = CharacterRig.PIVOT;
    // 文官（林则徐）空手：分件图里他有一件兵器，但按设定他不带刀
    const kind = WEAPON_KIND[unit] ?? 'none';
    if (kind === 'none') return null;
    const c = scene.add.container(P.weaponOutX, P.weaponInHand);

    const key = partKey(unit, 'front', 'weapon');
    if (scene.textures.exists(key)) {
      const img = scene.add.image(0, 0, key).setOrigin(0.5, 1);
      img.setScale(Math.min(1, P.weaponMaxH / img.height));
      c.add(img);
      this.weaponPartImg = img;
      c.setAngle(P.weaponAngle);
      return c;
    }

    if (kind === 'saber') {
      // 刀身 2×11、护手 5×2、握把 2×3：跟原稿里那把细刀一个比例
      c.add(scene.add.rectangle(0, -6.5, 2, 11, PALETTE.paper).setOrigin(0.5, 0.5));
      c.add(scene.add.rectangle(0, 0, 5, 2, PALETTE.brown).setOrigin(0.5, 0.5));
      c.add(scene.add.rectangle(0, 2, 2, 3, PALETTE.brownDeep).setOrigin(0.5, 0.5));
      c.setAngle(P.weaponAngle);
      return c;
    }

    // 洋枪：枪管 2×13，枪托 3×5，扳机护圈一格
    c.add(scene.add.rectangle(0, -7, 2, 13, PALETTE.greyLight).setOrigin(0.5, 0.5));
    c.add(scene.add.rectangle(0, -0.5, 3, 5, PALETTE.brown).setOrigin(0.5, 0.5));
    c.add(scene.add.rectangle(0, 2.5, 3, 1, PALETTE.brownDeep).setOrigin(0.5, 0.5));
    c.setAngle(P.weaponAngle);
    return c;
  }

  /** 分件换朝向：正/侧两套纹理 + 侧面左右靠镜像 */
  private applyPartsFacing(): void {
    if (!this.partsRoot) return;
    const facing: PartFacing = this.facing === 'left' || this.facing === 'right' ? 'side' : 'front';
    if (facing !== this.partsFacing) {
      this.partsFacing = facing;
      const put = (img: Phaser.GameObjects.Image | null, part: PartName) => {
        if (!img) return;
        const key = partKey(this.partsUnit, facing, part);
        if (img.texture.key !== key) img.setTexture(key);
      };
      put(this.legBack, 'leg');
      put(this.legFront, 'leg');
      put(this.torsoImg, 'torso');
      put(this.headImg, 'head');
      const arm = this.armPivot?.list[0] as Phaser.GameObjects.Image | undefined;
      if (arm) put(arm, 'arm');
      if (this.weaponPartImg) put(this.weaponPartImg, 'weapon');
    }
    // 侧面出一张（朝右），朝左就镜像；不用负 scale 会连血条一起翻，所以只翻 partsRoot
    this.partsRoot.setScale(this.facing === 'left' ? -1 : 1, 1);
  }

  /** 切朝向贴图（贴图模式下用，替代水平翻转 + 头部换色那套） */
  private applyUnitFacing(): void {
    if (!this.unitImage || !this.unitKey) return;
    const key = `${this.unitKey}_${this.facing}`;
    if (this.unitImage.texture.key !== key) this.unitImage.setTexture(key);
  }

  /**
   * 铁壳蒸汽炮舰的占位形体：船体 + 炮门 + 甲板 + 烟囱冒烟 + 桅杆旗。
   * 全部用矩形拼，配色取自 24 色盘——目的只是让老师一眼看出「这是条军舰」。
   */
  private buildShip(scene: Phaser.Scene, hull: number): void {
    const part = (x: number, y: number, w: number, h: number, color: number, stroke = true) => {
      const r = scene.add.rectangle(x, y, w, h, color).setOrigin(0.5);
      if (stroke) r.setStrokeStyle(1, PALETTE.ink);
      this.shipParts.push(r);
      this.shipColors.push(color);
      return r;
    };

    // 船体（铁壳）+ 吃水线（蓝）
    part(0, 8, 92, 26, hull);
    part(0, 19, 92, 5, PALETTE.blue);
    // 船首斜桁
    part(46, 2, 18, 4, PALETTE.brown, false);
    // 甲板与舷墙
    part(0, -8, 66, 7, PALETTE.cream);
    part(0, -14, 70, 5, PALETTE.brown);
    // 舷炮：一排黑方口
    for (let i = -2; i <= 2; i++) part(i * 14, 6, 7, 6, PALETTE.ink, false);
    // 烟囱与烟
    part(-6, -30, 12, 24, PALETTE.plumDark);
    part(-6, -42, 17, 4, PALETTE.ink, false);
    part(-6, -52, 14, 12, PALETTE.paper, false).setAlpha(0.5);
    part(7, -60, 10, 9, PALETTE.paper, false).setAlpha(0.3);
    // 桅杆与旗
    part(-32, -34, 3, 34, PALETTE.ink, false);
    part(-22, -46, 19, 11, PALETTE.red);

    for (const p of this.shipParts) this.add(p);
  }

  get isDead(): boolean {
    return this.dead;
  }

  get currentFacing(): Facing {
    return this.facing;
  }

  setFacing(dir: Facing): void {
    if (this.facing === dir) return;
    this.facing = dir;
    if (this.partsRoot) {
      // 分件：正/侧两套图 + 镜像，不翻容器（血条、特效都在容器外）
      this.applyPartsFacing();
      return;
    }
    if (this.unitImage) {
      // 贴图模式自带四张朝向图，不需要翻转，也不会因为翻转变负而影响血条/特效
      this.applyUnitFacing();
      return;
    }
    // 侧向用水平翻转表达；上/下用头部明暗区分
    switch (dir) {
      case 'left':
        this.setScale(-Math.abs(this.scaleX), this.scaleY);
        break;
      case 'right':
        this.setScale(Math.abs(this.scaleX), this.scaleY);
        break;
      case 'up':
        this.head.setFillStyle(PALETTE.brownDark);
        break;
      default:
        this.head.setFillStyle(this.baseSkin);
        break;
    }
  }

  /** 每帧驱动：walkPhase 用于腿部摆动 */
  tick(dtMs: number, moving: boolean): void {
    if (this.dead) return;

    if (this.isShip) {
      // 舰船不走路：开炮时整体后退一点，算作后坐
      if (this.attackTimer > 0) {
        this.attackTimer -= dtMs;
        const t = Math.max(0, this.attackTimer) / SHIP_ATTACK_MS;
        const push = Math.sin((1 - t) * Math.PI) * 6;
        if (this.shipImage) {
          this.shipImage.setX((this.facing === 'left' ? 0.4 : -0.4) * push);
          this.applyShipAttackFrame();
        } else {
          for (const p of this.shipParts) p.setX(p.x - (this.facing === 'left' ? -0.4 : 0.4) * push);
        }
      } else if (this.shipImage) {
        this.shipImage.setX(0);
        this.tickShipFrames(dtMs);
      }
      if (this.flashTimer > 0) {
        this.flashTimer -= dtMs;
        if (this.flashTimer <= 0) this.clearFlash();
      }
      return;
    }

    if (this.partsRoot && this.legFront && this.legBack && this.torsoImg && this.headImg && this.armPivot) {
      // 分件小人：腿绕胯摆、上身随步起伏、手臂连带兵器绕肩抡
      const P = CharacterRig.PIVOT;
      this.idlePhase += dtMs;

      if (moving) {
        this.walkPhase += dtMs * 0.013; // 约 2.9 步/秒，腿长了步子要沉
        const swing = Math.sin(this.walkPhase) * 20;
        this.legFront.setAngle(swing);
        this.legBack.setAngle(-swing * 0.9);
        // 每迈一步身体抬起 1px（一条腿过顶时最高）
        const bob = Math.abs(Math.sin(this.walkPhase)) * 1;
        this.torsoImg.setY(P.torsoBottom - bob);
        this.headImg.setY(P.headBottom - bob);
        this.armPivot.setY(P.shoulder - bob);
        this.torsoImg.setAngle(swing * 0.06);
        this.headImg.setAngle(swing * 0.06);
      } else {
        this.walkPhase = 0;
        this.legFront.setAngle(0);
        this.legBack.setAngle(0);
        const breathe = Math.sin(this.idlePhase * 0.0042) > 0.6 ? 1 : 0;
        this.torsoImg.setY(P.torsoBottom - breathe);
        this.headImg.setY(P.headBottom - breathe);
        this.armPivot.setY(P.shoulder - breathe);
        this.torsoImg.setAngle(0);
        this.headImg.setAngle(0);
      }

      // 出手：抬臂 → 前抡 → 收回。兵器挂在臂支点里，自己不用再算一遍轨迹
      const ARM_REST = -12;
      if (this.attackTimer > 0) {
        this.attackTimer -= dtMs;
        const prog = 1 - Math.max(0, this.attackTimer) / 160;
        if (prog < 0.4) {
          const k = prog / 0.4;
          this.armPivot.setAngle(ARM_REST - k * 55);
        } else {
          const k = (prog - 0.4) / 0.6;
          this.armPivot.setAngle(ARM_REST - 55 + Math.sin(k * Math.PI * 0.8) * 105);
        }
        this.torsoImg.setAngle((this.facing === 'left' ? -1 : 1) * (prog < 0.4 ? -3 : 4));
        if (this.attackTimer <= 0) {
          this.armPivot.setAngle(ARM_REST);
          this.torsoImg.setAngle(0);
        }
      }

      if (this.flashTimer > 0) {
        this.flashTimer -= dtMs;
        if (this.flashTimer <= 0) this.clearFlash();
      }
      return;
    }

    if (this.unitImage) {
      // 贴图小人是一张单帧图，没有骨骼可以掰：甲方问的「怎么一贴图就不流畅了」，
      // 根因就在这儿——矩形小人会摆腿、甩兵器，贴图小人只剩整体平移。
      // 这里用三件事把动作补回来（都只动 unitImage，不动容器：容器管碰撞、影子、血条）：
      //   1. 两拍踏步：走起来左右各歪 2°、抬脚 2px，像素画里这就是「迈步子」；
      //   2. 站立呼吸：1.5 秒一轮，最高抬 1px；
      //   3. 攻击三段：先后仰蓄力，再前冲出手——有预备动作，才不像瞬移。
      const img = this.unitImage;
      this.idlePhase += dtMs;

      if (moving) {
        this.walkPhase += dtMs * 0.020; // 约 4.5 步/秒
        const step = Math.floor(this.walkPhase / Math.PI) % 2 === 1;
        img.setY(step ? -2 : 0);
        img.setAngle(step ? 2.2 : -2.2);
        img.setX(step ? (this.facing === 'left' ? 1 : -1) : 0);
      } else {
        this.walkPhase = 0;
        const breathe = Math.sin(this.idlePhase * 0.0042) > 0.6;
        img.setY(breathe ? -1 : 0);
        img.setAngle(0);
        img.setX(0);
      }

      if (this.attackTimer > 0) {
        this.attackTimer -= dtMs;
        const prog = 1 - Math.max(0, this.attackTimer) / 160; // 0 → 1
        const dirX = this.facing === 'left' ? -1 : 1;
        if (prog < 0.45) {
          // 蓄力：往后拉 2.5px、身体后仰
          const k = Math.sin((prog / 0.45) * (Math.PI / 2)) * 2.5;
          img.setX(-dirX * k);
          img.setAngle(dirX * k * 1.4);
        } else {
          // 出手：前冲 6.5px、身体前压
          const k = (prog - 0.45) / 0.55;
          const fwd = Math.sin(k * Math.PI) * 6.5;
          img.setX(dirX * fwd);
          img.setAngle(-dirX * fwd * 0.9);
        }
        if (this.attackTimer <= 0) {
          img.setX(0);
          img.setAngle(0);
        }
      }

      if (this.flashTimer > 0) {
        this.flashTimer -= dtMs;
        if (this.flashTimer <= 0) this.clearFlash();
      }
      return;
    }

    if (moving) {
      this.walkPhase += dtMs * 0.012;
      const swing = Math.sin(this.walkPhase) * 3;
      this.legL.setY(12 + swing);
      this.legR.setY(12 - swing);
      this.torso.setY(2 + Math.sin(this.walkPhase * 2) * 0.5);
    } else {
      this.legL.setY(12);
      this.legR.setY(12);
      this.torso.setY(2);
      this.walkPhase = 0;
    }

    if (this.attackTimer > 0) {
      this.attackTimer -= dtMs;
      const t = Math.max(0, this.attackTimer) / 160;
      const reach = Math.sin((1 - t) * Math.PI) * 8;
      this.torso.setX(this.facing === 'left' ? -reach : reach);
      this.head.setX(this.torso.x);
      if (this.weapon) {
        this.weapon.setX((this.facing === 'left' ? -1 : 1) * (9 + reach));
        this.weapon.setAngle(this.facing === 'left' ? -110 + t * 40 : 110 - t * 40);
      }
      if (this.attackTimer <= 0) {
        this.torso.setX(0);
        this.head.setX(0);
        if (this.weapon) {
          this.weapon.setX((this.facing === 'left' ? -1 : 1) * 9);
          this.weapon.setAngle(0);
        }
      }
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dtMs;
      if (this.flashTimer <= 0) this.clearFlash();
    }
  }

  playAttack(): void {
    if (this.dead) return;
    this.attackTimer = this.isShip ? SHIP_ATTACK_MS : 160;
  }

  /** 舰船换帧：帧号越界时退回第一帧，保证贴图永远有效 */
  private frameTexture(index: number): string {
    return this.shipKeys[index] ?? this.shipKeys[0] ?? '';
  }

  /** 开炮期间：前 55% 放舷炮齐射帧，后半段放后坐帧 */
  private applyShipAttackFrame(): void {
    if (!this.shipImage || this.shipKeys.length === 0) return;
    const firing = this.attackTimer > SHIP_ATTACK_MS * 0.45;
    this.shipImage.setTexture(this.frameTexture(firing ? SHIP_FRAME.broadside : SHIP_FRAME.recoil));
  }

  /** 待机循环：平时原地，每隔一阵冒一次烟；残血时改成两帧破损抖动 */
  private tickShipFrames(dtMs: number): void {
    if (!this.shipImage || this.shipKeys.length === 0) return;
    this.frameTimer = (this.frameTimer + dtMs) % 3600;
    if (this.damaged) {
      const broken = Math.floor(this.frameTimer / 420) % 2 === 0 ? SHIP_FRAME.brokenA : SHIP_FRAME.brokenB;
      this.shipImage.setTexture(this.frameTexture(broken));
      return;
    }
    const smoking = this.frameTimer > 1400;
    this.shipImage.setTexture(this.frameTexture(smoking ? SHIP_FRAME.smoke : SHIP_FRAME.idle));
  }

  /** 血量低于阈值时换破损帧（Enemy 每帧同步一次，内部会去重） */
  setDamaged(value: boolean): void {
    if (this.damaged === value) return;
    this.damaged = value;
    this.frameTimer = 0;
  }

  /** 命中闪白（设计书 6.1.4：0.06 秒纯白叠加） */
  hitFlash(durationMs = 60): void {
    if (this.dead) return;
    this.flashTimer = durationMs;
    if (this.partImgs.length > 0) {
      for (const img of this.partImgs) img.setTintFill(PALETTE.paper);
      return;
    }
    if (this.unitImage) {
      this.unitImage.setTintFill(PALETTE.paper);
      return;
    }
    if (this.isShip) {
      if (this.shipImage) {
        // 贴图用「纯色填充」闪白，比改配色更接近设计书里 60ms 的整帧白
        this.shipImage.setTintFill(PALETTE.paper);
        return;
      }
      for (const p of this.shipParts) p.setFillStyle(PALETTE.paper);
      return;
    }
    this.head.setFillStyle(PALETTE.paper);
    this.torso.setFillStyle(PALETTE.paper);
  }

  private clearFlash(): void {
    if (this.partImgs.length > 0) {
      for (const img of this.partImgs) img.clearTint();
      // 后腿比前腿暗一档，是拼装时定下的；clearTint 会把它一起抹掉，这里补回来
      this.legBack?.setTint(0xB9B2C9);
      return;
    }
    if (this.unitImage) {
      this.unitImage.clearTint();
      return;
    }
    if (this.isShip) {
      if (this.shipImage) {
        this.shipImage.clearTint();
        return;
      }
      this.shipParts.forEach((p, i) => p.setFillStyle(this.shipColors[i]));
      return;
    }
    this.head.setFillStyle(this.facing === 'up' ? PALETTE.brownDark : this.baseSkin);
    this.torso.setFillStyle(this.baseBody);
  }

  /**
   * 击退位移（设计书 6.1.4：近战 18px / 远程 8px）。
   *
   * `unsafe` 是落点校验：调进来一个坐标，返回 true 表示那里不能站（地图外 / 墙里 / 海面）。
   * 有它的原因：这里是 tween 直接平移，**完全不查地形**，敌方小兵在岸边被打时会被
   * 一帧推出地图（甲方三次截图报「小兵被打出地图」）。传了校验就把落点夹在边界内。
   */
  knockback(dx: number, dy: number, unsafe?: (x: number, y: number) => boolean): void {
    if (this.dead) return;
    let tx = this.x + dx;
    let ty = this.y + dy;
    if (unsafe && unsafe(tx, ty)) {
      // 二分收缩：退到「还能站」的最远位置，而不是干脆不击退——手感要保住。
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (unsafe(this.x + dx * mid, this.y + dy * mid)) hi = mid;
        else lo = mid;
      }
      tx = this.x + dx * lo;
      ty = this.y + dy * lo;
    }
    this.scene.tweens.add({
      targets: this,
      x: tx,
      y: ty,
      duration: 120,
      ease: 'Quad.easeOut',
    });
  }

  /** 死亡：倒地淡出。就义等庄重段落由场景另行处理，不走此动画 */
  playDeath(onDone?: () => void): void {
    if (this.dead) return;
    this.dead = true;
    this.scene.tweens.add({
      targets: this,
      angle: this.facing === 'left' ? -90 : 90,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeIn',
      onComplete: () => {
        onDone?.();
      },
    });
  }

  /** 简单的受击音效钩子（无音频资源时静默） */
  static readonly SIZE = { w: CHAR_W, h: CHAR_H };
}