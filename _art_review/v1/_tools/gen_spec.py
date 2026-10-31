# -*- coding: utf-8 -*-
"""鸦片战争原型 · 按《美术资产规格表 v1》重做美术资产

对位文档：D:\\game_project\\game 3\\鸦片战争原型·美术资产规格表 v1.docx
执行要点（逐条对应规格表章节）：
  2.1 角色画布 32×40，锚点脚底中心 (16,40)，行 1-5 留白 / 6-15 头肩 / 16-30 躯干 / 31-39 腿摆 / 40 脚底线
  2.2 首次交付 8 帧：idle0 idle1 walk0 walk1 attack0 attack1 hurt death（只出朝下一组）
  2.4 Boss 96×48，吃水线固定 y=40，4 帧 + 2 破损帧
  3   瓦片 6 组，无碎贝壳、无孤立 1px 亮点
  4.1 鸦片箱严格 20×20，包边不用金黄
  4.3 对话立绘 96×112
  5   24 色锁定 + 单帧 ≤ 8 色 + 星黄 #F0C419 一律不许出现
  7   命名 ch00_<类别>_<名>_<序号>.png，透明底 PNG，alpha 只 0/255，附 8 倍预览
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out_spec")

PAL = {
    "ink":       0x0D0B14, "night":     0x1C1A2B, "plumDark":  0x2F2B45,
    "plumMid":   0x4A4468, "plumLight": 0x6B6489, "greyPlum":  0x948DAB,
    "greyLight": 0xC2BCD1, "paper":     0xF2EDE4, "cream":     0xE8CFA8,
    "sand":      0xCFA26A, "brown":     0xA8763F, "brownDark": 0x7A4F2A,
    "brownDeep": 0x4E2F1A, "redDark":   0x8C1C1C, "red":       0xC62828,
    "redBright": 0xE85C4A, "redSoft":   0xF2A08C, "greenDark": 0x1F5C3A,
    "green":     0x2F8F5B, "greenLight": 0x7EC08A, "indigo":    0x1B3A6B,
    "blue":      0x2F6BA8, "blueLight": 0x7FB2D9, "star":      0xF0C419,
}
PAL_SET = set(PAL.values())
INV_PAL = {v: k for k, v in PAL.items()}
BUDGET = 8          # 规格表 硬规则 1：单帧 ≤ 8 色（含描边）

# 规格表 2.1 纵向分区（0-based：行 1-5 留白 → y=0..4 空，脚底线 y=39）
CW, CH = 32, 40
FOOT = 39           # 脚底线
CX = 15             # 锚点列（1-based 第 16 列）

WARNINGS = []


class Grid:
    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.c = [[fill] * w for _ in range(h)]

    def px(self, x, y, v):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[y][x] = v
        return self

    def rect(self, x1, y1, x2, y2, v):
        for y in range(max(0, y1), min(self.h, y2 + 1)):
            for x in range(max(0, x1), min(self.w, x2 + 1)):
                self.c[y][x] = v
        return self

    def col(self, x, y1, y2, v):
        return self.rect(x, y1, x, y2, v)

    def row(self, x1, x2, y, v):
        return self.rect(x1, y, x2, y, v)

    def diag(self, x1, y1, x2, y2, v):
        n = max(abs(x2 - x1), abs(y2 - y1)) or 1
        for i in range(n + 1):
            self.px(round(x1 + (x2 - x1) * i / n), round(y1 + (y2 - y1) * i / n), v)
        return self

    def poly(self, pts, v):
        n = len(pts)
        ys = [p[1] for p in pts]
        for y in range(min(ys), max(ys) + 1):
            xs = []
            for i in range(n):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % n]
                if y1 == y2:
                    continue
                if min(y1, y2) <= y <= max(y1, y2):
                    xs.append(x1 + (x2 - x1) * (y - y1) / (y2 - y1))
            if xs:
                self.rect(round(min(xs)), y, round(max(xs)), y, v)
        return self

    def ellipse(self, cx, cy, rx, ry, v):
        for y in range(cy - ry, cy + ry + 1):
            for x in range(cx - rx, cx + rx + 1):
                dx = (x - cx) / rx
                dy = (y - cy) / ry
                if dx * dx + dy * dy <= 1.0 + 0.35:
                    self.px(x, y, v)
        return self

    def outline(self, v="ink"):
        add = [(x, y) for y in range(self.h) for x in range(self.w)
               if self.c[y][x] is None
               and any(self.get(nx, ny) is not None
                       for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))]
        for x, y in add:
            self.c[y][x] = v
        return self

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.c[y][x]
        return None

    def copy_from(self, src, ox, oy, x1, y1, x2, y2):
        for y in range(y1, y2 + 1):
            for x in range(x1, x2 + 1):
                self.px(ox + x - x1, oy + y - y1, src.get(x, y))
        return self

    def remap(self, table):
        for y in range(self.h):
            for x in range(self.w):
                k = self.c[y][x]
                if k in table:
                    self.c[y][x] = table[k]
        return self

    def colors(self):
        return {self.c[y][x] for y in range(self.h) for x in range(self.w) if self.c[y][x]}

    def bottom_row(self):
        for y in range(self.h - 1, -1, -1):
            if any(self.c[y][x] for x in range(self.w)):
                return y
        return -1

    def to_img(self, scale=1):
        img = Image.new("RGBA", (self.w * scale, self.h * scale), (0, 0, 0, 0))
        d = img.load()
        for y in range(self.h):
            for x in range(self.w):
                k = self.c[y][x]
                if k is None:
                    continue
                hv = PAL[k]
                rgb = ((hv >> 16) & 255, (hv >> 8) & 255, hv & 255)
                for sy in range(scale):
                    for sx in range(scale):
                        d[x * scale + sx, y * scale + sy] = rgb + (255,)
        return img

    def check(self, tag):
        cs = self.colors()
        bad = [c for c in cs if c not in PAL_SET and PAL.get(c) is None]
        # colors() 返回的是调色板键名
        if len(cs) > BUDGET:
            WARNINGS.append(f"[{tag}] 超色预算 {len(cs)}>{BUDGET}: {sorted(cs)}")
        if "star" in cs:
            WARNINGS.append(f"[{tag}] 违规使用星黄 #F0C419（规格表硬规则：交互专用色）")
        if bad:
            WARNINGS.append(f"[{tag}] 非 24 色: {bad}")
        return cs


def mkdir(*p):
    d = os.path.join(OUT, *p)
    os.makedirs(d, exist_ok=True)
    return d


FR = mkdir("frames")
SH = mkdir("sheets")
PV = mkdir("previews")
TL = mkdir("tiles")
PT = mkdir("portraits")
AT = mkdir("atlas")
QA = mkdir("qa")


def save_pair(g, name, preview_dir, scale=8, sub=None):
    """规格表 7.2：1:1 原图 + 8 倍最近邻预览"""
    g.to_img(1).save(os.path.join(preview_dir or FR, name + ".png"))
    return g


# ============================================================ 角色骨架
# 规格表 2.1：头宽 12 / 身宽 12 / 二头身；可绘制区列 4-27（0-based 3..26）
POSES = ["idle0", "idle1", "walk0", "walk1", "attack0", "attack1", "hurt", "death"]
LIN_POSES = ["idle0", "idle1", "gesture0", "gesture1"]


def draw_humanoid(cfg, pose):
    g = Grid(CW, CH)
    c = cfg["c"]
    flash = pose == "hurt"
    lying = pose == "death"

    DARK = {"ink", "night", "plumDark", "brownDeep", "brownDark", "greyPlum"}

    def K(role):
        """受击帧只把亮部洗白（规格表 2.3 hurt），描边与金属/皮革深色保留，
        否则整只变成白幽灵、玩家认不出倒下的是谁。"""
        v = c.get(role, "ink")
        if flash and v not in DARK:
            return "paper"
        return v

    dyU = 0
    if pose in ("idle1", "walk1"):
        dyU = -1
    leg = "stand"
    if pose == "walk0":
        leg = "a"
    elif pose == "walk1":
        leg = "b"
    armR = "down"
    wpn = "hold"
    if pose == "attack0":
        armR, wpn = "up", "up"
    elif pose == "attack1":
        armR, wpn = "out", "out"
    if pose in ("gesture0", "gesture1"):
        armR = "up" if pose == "gesture0" else "out"

    if lying:
        draw_body_down(g, cfg, K)
        g.outline("ink")
        return g

    # ---------- 腿与衣摆（行 30-39，脚必须压在第 40 行 = y39）
    draw_legs(g, cfg, K, leg)
    # ---------- 头肩 + 躯干 + 手臂（受 bob 影响）
    draw_torso(g, cfg, K, dyU, armR, wpn)
    draw_head(g, cfg, K, dyU)
    draw_weapon(g, cfg, K, wpn, dyU)
    g.outline("ink")
    return g


def draw_legs(g, cfg, K, leg):
    c = cfg["c"]
    hem_top, foot_y = 29, FOOT
    if leg == "stand":
        g.rect(11, hem_top, 13, 37, K("legs"))
        g.rect(18, hem_top, 20, 37, K("legs"))
        draw_feet(g, cfg, K, 10, 13, foot_y)
        draw_feet(g, cfg, K, 18, 21, foot_y)
    elif leg == "a":        # 左腿前迈：前脚外探 3px，后脚抬 1px（落地脚仍压 y39）
        g.rect(11, hem_top, 13, 35, K("legs"))
        g.rect(18, hem_top, 20, 37, K("legs"))
        draw_feet(g, cfg, K, 7, 11, foot_y)
        draw_feet(g, cfg, K, 19, 22, foot_y - 1)
        g.row(19, 22, foot_y, "ink")                     # 抬脚处留 1px 落地影
        g.row(10, 13, hem_top, K("shade") or K("legs"))  # 衣摆随迈步甩出
    else:                   # b：右腿前迈（镜像）
        g.rect(11, hem_top, 13, 37, K("legs"))
        g.rect(18, hem_top, 20, 35, K("legs"))
        draw_feet(g, cfg, K, 10, 13, foot_y - 1)
        draw_feet(g, cfg, K, 21, 25, foot_y)
        g.row(11, 13, foot_y, "ink")
        g.row(18, 21, hem_top, K("shade") or K("legs"))
    # 衣摆（袍类下摆压到 y30-31）
    if cfg.get("robe"):
        g.rect(10, hem_top - 2, 21, hem_top, K("robeHem") or K("body"))


def draw_feet(g, cfg, K, x1, x2, y):
    """foot_style: boot=黑靴 / bare=赤脚（绿营兵必须赤脚，规格表 6.2）"""
    if cfg.get("foot") == "bare":
        g.rect(x1, y - 1, x2, y - 1, K("skin"))
        g.rect(x1, y, x2, y, K("skin"))
        g.px(x2, y, K("ink"))
    else:
        g.rect(x1, y - 1, x2, y - 1, K("boot") or K("legs"))
        g.rect(x1, y, x2, y, "ink")


def draw_torso(g, cfg, K, dyU, armR, wpn):
    t = 16 + dyU
    b = 28 + dyU
    g.rect(10, t, 21, b, K("body"))
    # 左上光：左侧一提亮、右侧与下缘压暗
    if cfg.get("shade"):
        g.col(21, t, b, K("shade"))
        g.row(10, 21, b, K("shade"))
        g.col(10, t, b - 1, K("lit") or K("body"))
    style = cfg["trim"]
    if style == "redcoat":
        # 立领 + 前襟成排纽扣 + 团色肩章袖口（规格表 6.1）
        g.col(15, t + 1, b - 1, K("facing"))
        for yy in (t + 3, t + 6, t + 9):
            g.px(15, yy, K("bright"))
        g.row(11, 20, t, K("facing"))                 # 立领
        g.rect(10, t + 1, 11, t + 2, K("facing"))     # 左肩章
        g.rect(20, t + 1, 21, t + 2, K("facing"))     # 右肩章
        g.col(8, 25 + dyU, 26 + dyU, K("facing"))
        g.col(23, 25 + dyU, 26 + dyU, K("facing"))
        # 两条白皮带：胸前一横 + 肩上两条（背后交叉在正面表现为肩带）
        g.row(11, 20, t + 5, K("bright"))
        g.col(12, t, t + 5, K("bright"))
        g.col(19, t, t + 5, K("bright"))
        g.rect(18, t + 7, 21, t + 9, K("dark"))       # 弹药包（团色系，不用金黄）
        if cfg.get("elite"):
            # 精英识别：肩章加宽成纸白双线 + 左肩到右胯斜绶带（星黄被禁，只能用纸白）
            g.rect(9, t, 12, t + 1, K("bright"))
            g.rect(19, t, 22, t + 1, K("bright"))
            g.diag(10, t + 1, 21, t + 10, K("bright"))
            g.diag(11, t + 1, 21, t + 9, K("bright"))
            g.row(9, 12, t + 2, K("facing"))
    elif style == "hatcote":
        # 清军号衣：正红滚边 + 胸前圆补（规格表 6.2）
        g.row(11, 20, t, K("trimRed"))
        g.col(10, t, b, K("trimRed"))
        g.col(21, t, b, K("trimRed"))
        g.row(12, 19, b, K("trimRed"))
        g.rect(14, t + 4, 16, t + 6, K("trimRed"))    # 圆补
        g.rect(14, t + 5, 15, t + 5, K("patchChar"))  # 画不清的字 → 2×2 深红块
        g.col(8, t, t + 3, K("sleeve"))
        g.col(23, t, t + 3, K("sleeve"))
        if cfg.get("banner"):                         # 把总背令旗：竖杆压在左肩后（收在可画列内）
            g.col(7, t - 9, t + 1, K("bannerPole"))
            g.rect(5, t - 9, 7, t - 6, K("banner"))
            g.row(5, 7, t - 6, K("bannerShade"))
    elif style == "official":
        # 关天培武将官服：圆领 + 系腰带 + 补子
        g.row(11, 20, t, K("trimRed"))
        g.rect(12, t + 3, 17, t + 8, K("patch"))
        g.row(12, 17, t + 3, K("patchLit"))          # 补子边框
        g.row(12, 17, t + 8, K("patchLit"))
        g.px(14, t + 5, K("patchLit"))               # 武补走兽，两格点到为止
        g.px(16, t + 6, K("patchLit"))
        g.px(15, t + 7, K("patchLit"))
        g.row(10, 21, t + 11, K("belt"))
        g.px(15, t + 11, K("beltLit"))
        g.col(10, t, b, K("robeShade"))
    elif style == "civil":
        # 林则徐文官：交领右衽 + 云肩
        g.diag(11, t + 1, 16, t + 6, K("collar"))
        g.diag(12, t + 1, 17, t + 6, K("lit") or K("body"))
        g.row(10, 21, t, K("collar"))
        g.col(15, t + 7, b, K("robeShade"))
        g.rect(13, t + 9, 18, t + 10, K("belt"))
    # 手臂
    g.col(8, t, t + 11, K("sleeve") or K("body"))
    if armR == "up":
        g.col(23, t - 6, t + 5, K("sleeve") or K("body"))
        g.px(23, t - 7, K("skin"))
    elif armR == "out":
        g.col(23, t + 4, t + 12, K("sleeve") or K("body"))
        g.px(23, t + 13, K("skin"))
    else:
        g.col(23, t, t + 11, K("sleeve") or K("body"))
        g.px(23, t + 12, K("skin"))
    g.px(8, t + 12, K("skin"))


def draw_head(g, cfg, K, dyU):
    y0 = 5 + dyU
    g.rect(11, y0 + 3, 20, y0 + 10, K("skin"))
    g.px(13, y0 + 6, "ink")
    g.px(18, y0 + 6, "ink")
    g.px(15, y0 + 8, "ink")
    hat = cfg["hat"]
    if hat == "shako":
        g.rect(11, y0, 20, y0 + 3, K("hat"))
        g.row(11, 20, y0, K("hatLit") or K("hat"))
        g.rect(14, y0 + 1, 17, y0 + 2, K("plate"))          # 帽徽用团色，不许金黄
        g.row(11, 20, y0 + 3, "ink")
        if cfg.get("plume"):
            # 羽饰：帽墙左上探出，逐行 1-3-2-1 收窄；画成 3x4 白方块就会被读成白斑（踩过）
            g.px(10, y0 - 2, K("plume"))
            g.rect(9, y0 - 1, 11, y0 - 1, K("plume"))
            g.rect(9, y0, 10, y0 + 1, K("plume"))
            g.px(9, y0 + 2, K("plume"))
    elif hat == "bear":
        g.rect(11, y0 - 3, 20, y0 + 3, K("hat"))            # 掷弹兵熊皮高帽
        g.row(12, 19, y0 - 3, K("hat"))                     # 顶角收进 1px，不成方黑箱
        g.px(11, y0 - 2, None)
        g.px(20, y0 - 2, None)
        g.row(11, 20, y0 + 2, "ink")                        # 下缘鬃毛压深
        g.rect(14, y0 - 1, 17, y0 + 1, K("plate"))          # 前额帽徽
    elif hat == "conical":
        # 尖顶斗笠：恒定 45° 斜率圆锥 + 独立帽檐（上一版踩过的坑）
        for i in range(5):
            yy = y0 + i
            g.rect(15 - i, yy, 16 + i, yy, K("hat"))
        g.rect(15, y0 - 1, 16, y0 - 1, K("hat"))        # 藤钮
        g.rect(6, y0 + 5, 25, y0 + 5, K("hat"))             # 帽檐
        g.row(6, 25, y0 + 6, K("hatShade"))                 # 檐下阴影
        for i in range(1, 5):
            g.px(15 - i, y0 + i, K("hatWeave"))
            g.px(16 + i, y0 + i, K("hatWeave"))
    elif hat == "helmet":
        g.rect(11, y0, 20, y0 + 3, K("hat"))
        g.row(11, 20, y0, K("hatLit") or K("hat"))
        g.px(15, y0 - 2, K("finial"))
        g.px(16, y0 - 2, K("finial"))
        g.px(15, y0 - 1, K("finial"))
        g.row(10, 21, y0 + 4, K("hat"))
    elif hat == "rank":
        g.rect(12, y0 + 1, 19, y0 + 3, K("hat"))            # 圆帽顶戴
        g.row(12, 19, y0, K("hat"))
        g.px(15, y0 - 1, K("finial"))
        g.px(16, y0 - 1, K("finial"))
        g.rect(13, y0 + 4, 18, y0 + 4, K("hatShade"))
    elif hat == "wushamao":
        g.rect(11, y0, 20, y0 + 2, K("hat"))                # 乌纱帽
        g.rect(7, y0 + 1, 9, y0 + 1, K("hat"))
        g.rect(22, y0 + 1, 24, y0 + 1, K("hat"))
        g.row(11, 20, y0 + 3, K("hatShade"))
        g.px(15, y0 - 1, K("finial"))
    if cfg.get("queue"):
        g.col(21, y0 + 4, y0 + 9, K("hair"))                # 辫子
        g.col(22, y0 + 7, y0 + 11, K("hair"))
    if cfg.get("beard"):
        # 须髯：下颌起 4 行锥形，居中、最后画（上一版被袍盖住 / 糊成白围嘴的坑）
        for i, w in enumerate((2, 2, 1, 1)):
            g.rect(15 - w, y0 + 10 + i, 16 + w, y0 + 10 + i, K("beard"))
        g.px(13, y0 + 9, K("beard"))          # 两鬓垂下，中间留出嘴
        g.px(18, y0 + 9, K("beard"))


def draw_weapon(g, cfg, K, wpn, dyU):
    """武器中轴：一亮列 + 一暗列贯穿到底（上一版「断枪」的教训）"""
    w = cfg["weapon"]
    if w == "none":
        return
    dx, dy = 0, 0
    if wpn == "up":
        dy = -8
    elif wpn == "out":
        dy = 4                     # 只下压不右移：右移 1 列会让描边落到第 28 列（超出可画列）
    if w == "musket":
        g.col(24 + dx, 10 + dy, 30 + dy, K("metal"))
        g.col(25 + dx, 12 + dy, 28 + dy, "ink")
        g.col(24 + dx, 8 + dy, 9 + dy, K("bright"))          # 刺刀
        g.px(24 + dx, 7 + dy, K("bright"))
        if wpn == "out":
            # 击发反馈：枪口前一格纸白爆点，再前一格弹丸
            g.px(24 + dx, 6 + dy, K("bright"))
            g.px(25 + dx, 6 + dy, K("metal"))
            g.px(24 + dx, 4 + dy, K("bright"))
    elif w == "spear":
        g.col(24, 9 + dy, 33 + dy, K("shaft"))
        g.col(25, 11 + dy, 31 + dy, "ink")
        g.col(24, 5 + dy, 8 + dy, K("metal"))               # 矛头与杆同轴
        g.px(25, 6 + dy, K("metal"))
        g.px(24, 4 + dy, K("metal"))
        g.px(25, 9 + dy, K("ink"))
    elif w == "sword":
        g.col(24 + dx, 14 + dy, 22 + dy, K("metal"))
        g.px(25 + dx, 15 + dy, "ink")
        g.px(25 + dx, 19 + dy, "ink")
        g.row(23 + dx, 25 + dx, 23 + dy, K("hilt"))
        g.px(24 + dx, 13 + dy, cfg["c"].get("bright") and K("bright") or K("metal"))
    elif w == "grenade":
        g.rect(23 + dx, 8 + dy, 24 + dx, 9 + dy, K("metal"))
        g.px(23 + dx, 7 + dy, K("hilt"))


def draw_body_down(g, cfg, K):
    """阵亡帧：头在左、躯干横陈、腿在右；最低不透明像素仍压在第 40 行（脚底线纪律）
    横向内容收在 5..26 列，加 1px 外描边后正好落在规格表 2.1 的可画列 4..27 内"""
    g.ellipse(8, 35, 3, 3, K("skin"))
    g.px(7, 35, "ink")                                # 闭眼（阵亡识别）
    g.px(9, 35, "ink")
    if cfg["hat"] == "conical":
        g.poly([(5, 34), (13, 34), (9, 30)], K("hat"))        # 斗笠滚落到头侧
    else:
        g.rect(5, 31, 11, 33, K("hat"))
    g.rect(11, 33, 22, 37, K("body"))
    g.row(11, 22, 37, K("shade") or K("body"))
    g.rect(13, 34, 16, 35, K("sleeve") or K("body"))          # 搭在身上的手臂
    g.rect(22, 35, 25, 37, K("legs"))
    draw_feet(g, cfg, K, 23, 25, FOOT)
    g.row(5, 25, FOOT, "ink")                                 # 地面接触影
    if cfg["weapon"] != "none":
        g.row(13, 22, 31, K("metal"))                         # 掉落的兵器横在一旁
        g.px(23, 31, K("hilt") or K("metal"))


# ============================================================ 单位表
UK_INF = {
    "name": "ch00_char_en_uk_infantry", "cn": "英军线列步兵", "trim": "redcoat",
    "hat": "shako", "weapon": "musket", "foot": "boot", "plume": True,
    # 8 色预算：ink / red / redDark / cream / indigo / paper / plumDark / greyPlum
    "c": {
        "ink": "ink", "body": "red", "shade": "redDark", "lit": "red",
        "sleeve": "red", "facing": "indigo", "bright": "paper", "dark": "plumDark",
        "legs": "plumDark", "legsShade": "ink", "boot": "plumDark",
        "skin": "cream", "hat": "ink", "hatLit": "indigo", "plume": "paper",
        "plate": "paper", "metal": "greyPlum", "hilt": "plumDark", "hair": "ink",
    },
}
UK_GREN = dict(UK_INF)
UK_GREN.update({"name": "ch00_char_en_uk_grenadier", "cn": "英军掷弹兵",
                "hat": "bear", "weapon": "musket", "plume": False})
UK_GREN["c"] = dict(UK_INF["c"])
UK_GREN["c"]["hat"] = "plumDark"      # 熊皮用深紫灰，才不会被 1px 描边糊成方黑箱
UK_BRIG = dict(UK_INF)
UK_BRIG.update({"name": "ch00_char_en_uk_brigadier", "cn": "郭富准将（精英）",
                "weapon": "sword", "plume": False, "elite": True})
QING_GRN = {
    "name": "ch00_char_qing_greencamp", "cn": "清军绿营兵", "trim": "hatcote",
    "hat": "conical", "weapon": "spear", "foot": "bare", "queue": True,
    "c": {
        # 8 色预算：ink / green / greenDark / red / redDark / cream / brownDeep / greyPlum
        "ink": "ink", "body": "green", "shade": "greenDark", "sleeve": "greenDark",
        "lit": "green", "trimRed": "red", "patchChar": "redDark",
        "legs": "greenDark", "skin": "cream",
        "hat": "cream", "hatShade": "brownDeep", "hatWeave": "brownDeep",
        "metal": "greyPlum", "shaft": "brownDeep",
        "hilt": "brownDeep", "hair": "ink", "bright": "greyPlum",
    },
}
QING_BAZ = dict(QING_GRN)
QING_BAZ.update({"name": "ch00_char_qing_bazong", "cn": "清军把总（精英）",
                 "hat": "rank", "weapon": "sword", "banner": True,
                 "finial": "red", "queue": False})
QING_BAZ["c"] = dict(QING_GRN["c"])
QING_BAZ["c"].update({"hat": "ink", "hatShade": "brownDeep",
                      "finial": "red", "banner": "red", "bannerShade": "redDark",
                      "bannerPole": "brownDeep"})
GUAN = {
    "name": "ch00_char_qing_guantianpei", "cn": "关天培（可操作化身）", "trim": "official",
    "hat": "helmet", "weapon": "sword", "foot": "boot", "beard": True, "robe": True,
    "c": {
        # 8 色预算：ink / blue / indigo / red / cream / brownDark / greyPlum / greyLight
        "ink": "ink", "body": "blue", "shade": "indigo", "lit": "blue",
        "sleeve": "blue", "robeHem": "indigo", "trimRed": "red", "belt": "brownDark",
        "beltLit": "greyPlum", "patch": "indigo", "patchLit": "greyPlum",
        "legs": "indigo", "boot": "ink", "skin": "cream",
        "hat": "brownDark", "hatLit": "greyPlum", "finial": "greyLight",
        "metal": "greyPlum", "hilt": "brownDark", "beard": "greyLight", "bright": "greyLight",
    },
}
LIN = {
    "name": "ch00_char_qing_linxzexu", "cn": "林则徐（对话 NPC）", "trim": "civil",
    "hat": "wushamao", "weapon": "none", "foot": "boot", "beard": True, "robe": True,
    "c": {
        # 8 色预算：ink / indigo / night / blue / red / cream / paper / greyPlum
        "ink": "ink", "body": "indigo", "shade": "night", "lit": "blue",
        "sleeve": "indigo", "robeHem": "night", "collar": "paper", "belt": "red",
        "robeShade": "night", "legs": "night", "boot": "ink", "skin": "cream",
        "hat": "ink", "hatShade": "night",
        "finial": "red", "beard": "greyPlum", "metal": "greyPlum", "hilt": "ink",
        "bright": "paper", "patch": "blue", "patchLit": "paper", "trimRed": "red",
    },
}
UNITS = [UK_INF, QING_GRN, UK_BRIG, GUAN, UK_GREN, QING_BAZ, LIN]


def render_unit(cfg):
    poses = LIN_POSES if cfg is LIN else POSES
    frames = []
    for p in poses:
        g = draw_humanoid(cfg, p)
        cs = g.check(f"{cfg['name']}/{p}")
        g._pose = p          # noqa
        g._ncol = len(cs)
        frames.append(g)
    return frames


def sheet_img(frames, scale=1):
    w = CW * scale
    img = Image.new("RGBA", (w * len(frames), CH * scale), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        img.paste(f.to_img(scale), (i * w, 0))
    return img


def preview_img(cfg, frames, cols=4):
    """带帧名标注的 8 倍预览（规格表 7.2）"""
    sc = 8
    rows = (len(frames) + cols - 1) // cols
    cellw, cellh = CW * sc + 16, CH * sc + 40
    img = Image.new("RGBA", (cellw * cols, 44 + cellh * rows), (PAL["night"] >> 16 & 255,
                                                          PAL["night"] >> 8 & 255, PAL["night"] & 255, 255))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\simhei.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    d.text((12, 8, ), f"{cfg['cn']}  {cfg['name']}   32x40  锚点(16,40)", font=font,
           fill=(PAL["paper"] >> 16 & 255, PAL["paper"] >> 8 & 255, PAL["paper"] & 255))
    for i, f in enumerate(frames):
        r, cidx = divmod(i, cols)
        x = cidx * cellw + 8
        y = 44 + r * cellh
        bg = Image.new("RGBA", (CW * sc, CH * sc), (PAL["plumDark"] >> 16 & 255,
                                                    PAL["plumDark"] >> 8 & 255,
                                                    PAL["plumDark"] & 255, 255))
        bg.paste(f.to_img(sc), (0, 0), f.to_img(sc))
        img.paste(bg, (x, y))
        d.text((x, y + CH * sc + 4), f"{f._pose}  {f._ncol}色", font=font,
               fill=(PAL["greyLight"] >> 16 & 255, PAL["greyLight"] >> 8 & 255,
                     PAL["greyLight"] & 255))
    return img


def main():
    atlas_cells = []
    for cfg in UNITS:
        frames = render_unit(cfg)
        for i, f in enumerate(frames):
            f.to_img(1).save(os.path.join(FR, f"{cfg['name']}_{i:02d}.png"))
        sheet_img(frames).save(os.path.join(SH, f"{cfg['name']}_sheet.png"))
        preview_img(cfg, frames).save(os.path.join(PV, f"{cfg['name']}_preview8x.png"))
        atlas_cells.extend(frames)
        print(f"{cfg['cn']:<16} {len(frames)}帧  最大色数 {max(f._ncol for f in frames)}")
    # 图集 512×512（规格表 1.2：序章角色图集 512×512）
    cols = 512 // CW
    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    for i, f in enumerate(atlas_cells):
        r, c = divmod(i, cols)
        if (r + 1) * CH > 512:
            break
        img.paste(f.to_img(1), (c * CW, r * CH))
    img.save(os.path.join(AT, "ch00_atlas_units.png"))
    print(f"图集: {len(atlas_cells)} 帧 / 网格 {cols}×{512 // CH}")
    for w in WARNINGS:
        print("WARN", w)


if __name__ == "__main__":
    main()
