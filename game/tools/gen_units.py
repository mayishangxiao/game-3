#!/usr/bin/env python3
"""生成兵种小人贴图（24×32，四个朝向）。

为什么程序化画：甲方要「我方小人 / 英军小人 / 郭富准将」一眼能分辨，而正式美术还没到。
这里按 24 色盘画硬边像素小人，生成结果放 `public/art/units/<unit>_<facing>.png`，
`CharacterRig` 检测到四朝向贴图齐全就切贴图模式。

**v1.9.1 起改为纯标准库**：早先这一版 `import PIL`，本机没装 Pillow，脚本事实上跑不起来
（图是从别处带进来的）。现在自写 PNG chunk，跟 `gen_portraits.py` 一个路子——任何人
`python tools/gen_units.py` 都能重出全套图。绘制坐标一行没改，所以原有 8 个兵种重跑后
与库里那批图逐像素一致（`tests/unitArt.test.ts` 只保证尺寸/朝向齐全，这里靠 `--diff`
自证：`python tools/gen_units.py --diff` 会把新生成的图和库里的图比一遍）。

第二幕与三个副本里的角色（湘军、匪兵、巡捕、流氓、把头……）以前没图，战斗中退回纯色
方块；v1.9.1 补上 11 个兵种，`UNIT_ART` 与 `unitArtOf()` 负责把敌人 id 指过来。

用法：
    python tools/gen_units.py              # 生成新增兵种（不碰甲方出图的 8 个老兵种）
    python tools/gen_units.py patrol       # 只生成某一个
    python tools/gen_units.py --list       # 列出全部兵种
    python tools/gen_units.py --diff       # 只比对：库里的图与本脚本重画的是否一致
    python tools/gen_units.py --all        # 连 8 个老兵种一起重出（会覆盖人工微调，慎用）
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "art" / "units"

W, H = 24, 32

# 24 色盘（constants.ts PALETTE 的子集）
INK = (0x0D, 0x0B, 0x14)
NIGHT = (0x1C, 0x1A, 0x2B)
PLUM_D = (0x2F, 0x2B, 0x45)
PLUM_M = (0x4A, 0x44, 0x68)
GREY_P = (0x94, 0x8D, 0xAB)
GREY_L = (0xC2, 0xBC, 0xD1)
PAPER = (0xF2, 0xED, 0xE4)
CREAM = (0xE8, 0xCF, 0xA8)
SAND = (0xCF, 0xA2, 0x6A)
BROWN = (0xA8, 0x76, 0x3F)
BROWN_D = (0x7A, 0x4F, 0x2A)
RED_D = (0x8C, 0x1C, 0x1C)
RED = (0xC6, 0x28, 0x28)
RED_S = (0xF2, 0xA0, 0x8C)
GREEN_D = (0x1F, 0x5C, 0x3A)
GREEN = (0x2F, 0x8F, 0x5B)
INDIGO = (0x1B, 0x3A, 0x6B)
BLUE = (0x2F, 0x6B, 0xA8)
BLUE_L = (0x7F, 0xB2, 0xD9)
STAR = (0xF0, 0xC4, 0x19)

UNITS = {
    # 清军绿营兵：绿号衣 + 红边 + 红缨帽，手持长刀
    # （用户给的样图里清军就是绿衣，这里跟着改成绿色系；
    #  绿营的「绿」本来也是史实里的号衣色，蓝衣更适合军官）
    "qing_green": dict(
        coat=GREEN,
        coat_dark=GREEN_D,
        trim=RED_D,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=RED,
        weapon="dao",
    ),
    # 玩家（关天培麾下亲兵）：蓝号衣 + 金边，和绿营兵在屏幕上分得开
    "qing_officer": dict(
        coat=BLUE,
        coat_dark=INDIGO,
        trim=STAR,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=STAR,
        weapon="dao",
    ),
    # 清军把总：绿营的官，绿袍 + 金边
    "qing_batou": dict(
        coat=GREEN_D,
        coat_dark=GREEN,
        trim=STAR,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=STAR,
        weapon="dao",
    ),
    # 英军步兵：红上衣 + 白交叉背带 + 高筒黑帽
    "uk_infantry": dict(
        coat=RED_D,
        coat_dark=RED,
        trim=PAPER,
        trouser=GREY_P,
        hat="shako",
        hat_color=INK,
        tassel=PAPER,
        weapon="musket",
    ),
    # 英军掷弹兵：同红衣，熊皮高帽（更高更黑）+ 金帽带
    "uk_grenadier": dict(
        coat=RED_D,
        coat_dark=RED,
        trim=PAPER,
        trouser=GREY_P,
        hat="bearskin",
        hat_color=INK,
        tassel=STAR,
        weapon="musket",
    ),
    # 郭富准将：深蓝将官服 + 金肩章 + 金腰带 + 双角帽
    "gough": dict(
        coat=INDIGO,
        coat_dark=BLUE,
        trim=STAR,
        trouser=PLUM_M,
        hat="bicorne",
        hat_color=INK,
        tassel=PAPER,
        weapon="sabre",
    ),
    # 林则徐：石青紫官袍 + 金边 + 红缨帽，手里不拿兵器。
    # （原来是绯色：和英军的红上衣撞色，玩家会把他当敌人，改成紫调）
    "lin_zexu": dict(
        coat=PLUM_D,
        coat_dark=PLUM_M,
        trim=STAR,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=STAR,
        weapon="none",
    ),
    # 关天培：石青官袍 + 金边，同样不拿兵器（他是水师提督，局内站着说话）
    "guan_tianpei": dict(
        coat=INDIGO,
        coat_dark=PLUM_D,
        trim=STAR,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=RED,
        weapon="none",
    ),
    # ------------------------------------------------------------------
    # v1.9.1 补的第二幕兵种（以前没图，战斗里退回纯色方块）
    # ------------------------------------------------------------------
    # 湘军统领：灰蓝号衣 + 金扣 + 红缨帽 + 马刀（清军绿营的绿留给第一幕）
    "xiang_army": dict(
        coat=PLUM_M,
        coat_dark=PLUM_D,
        trim=STAR,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=RED,
        weapon="dao",
    ),
    # 洋枪队队长：深蓝制服 + 金边 + 洋枪（火器部队，跟绿营/湘军分得开）
    "xiang_rifle": dict(
        coat=INDIGO,
        coat_dark=PLUM_D,
        trim=STAR,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=STAR,
        weapon="musket",
    ),
    # 匪兵：土黄短打 + 褐头巾 + 大刀
    "bandit": dict(
        coat=SAND,
        coat_dark=BROWN,
        trim=BROWN_D,
        trouser=BROWN_D,
        hat="bandit",
        hat_color=BROWN_D,
        tassel=BROWN,
        weapon="dao",
    ),
    # 匪寨头目：深棕短打 + 红头巾 + 金柄大刀
    "bandit_chief": dict(
        coat=BROWN_D,
        coat_dark=INK,
        trim=RED,
        trouser=INK,
        hat="bandit",
        hat_color=RED_D,
        tassel=RED,
        weapon="sabre",
    ),
    # 匪弩手：同一身土黄，但手里是横着的弩——远看就能和近战匪兵分辨
    "bandit_crossbow": dict(
        coat=SAND,
        coat_dark=BROWN,
        trim=BROWN,
        trouser=BROWN_D,
        hat="bandit",
        hat_color=BROWN_D,
        tassel=BROWN,
        weapon="crossbow",
    ),
    # 租界巡捕：深蓝制服 + 金箍圆盔 + 短棍（肤色取深色，跟英军区分）
    "patrol": dict(
        coat=INDIGO,
        coat_dark=PLUM_D,
        trim=GREY_L,
        trouser=NIGHT,
        hat="helmet",
        hat_color=INK,
        tassel=STAR,
        weapon="stick",
    ),
    # 码头把头：褐色短打 + 米色宽腰带 + 木棒
    "dock_boss": dict(
        coat=BROWN,
        coat_dark=BROWN_D,
        trim=CREAM,
        trouser=BROWN_D,
        hat="bandit",
        hat_color=INK,
        tassel=RED,
        weapon="stick",
    ),
    # 包打听：灰长衫 + 瓜皮帽，不拿兵器（他不动手，跟上来递消息的）
    "informant": dict(
        coat=GREY_P,
        coat_dark=PLUM_M,
        trim=PLUM_D,
        trouser=PLUM_D,
        hat="cap",
        hat_color=INK,
        tassel=PLUM_D,
        weapon="none",
    ),
    # 烟厂监工：白褂 + 深背心 + 藤条
    "overseer": dict(
        coat=CREAM,
        coat_dark=PLUM_D,
        trim=PLUM_D,
        trouser=PLUM_D,
        hat="cap",
        hat_color=PLUM_D,
        tassel=NIGHT,
        weapon="cane",
    ),
    # 流氓 / 帮会打手：深紫短打 + 红腰带 + 木棒
    "thug": dict(
        coat=PLUM_D,
        coat_dark=INK,
        trim=RED,
        trouser=NIGHT,
        hat="bandit",
        hat_color=NIGHT,
        tassel=PLUM_M,
        weapon="stick",
    ),
    # 清军马队：红号衣（跟绿营的绿分开）+ 缨帽 + 马刀
    "qing_cavalry": dict(
        coat=RED_D,
        coat_dark=RED,
        trim=STAR,
        trouser=PLUM_D,
        hat="qing",
        hat_color=INK,
        tassel=RED_S,
        weapon="dao",
    ),
    # 英军军官：红制服 + 金肩章 + 佩剑（跟郭富准将那身深蓝将官服区分）
    "uk_officer": dict(
        coat=RED_D,
        coat_dark=RED,
        trim=STAR,
        trouser=GREY_L,
        hat="shako",
        hat_color=INK,
        tassel=STAR,
        weapon="sabre",
    ),
    # 日军步兵（甲午）：深蓝制服 + 军帽 + 步枪，和清军绿号衣、英军红衣都分得开
    "jp_infantry": dict(
        coat=INDIGO,
        coat_dark=NIGHT,
        trim=RED_D,
        trouser=PLUM_D,
        hat="cap",
        hat_color=INK,
        tassel=RED_D,
        weapon="musket",
    ),
    # 日军大尉 / 联队长：同色系加深，金边 + 指挥刀，作为 Boss 也认得出来
    "jp_officer": dict(
        coat=NIGHT,
        coat_dark=INK,
        trim=STAR,
        trouser=PLUM_D,
        hat="cap",
        hat_color=INK,
        tassel=STAR,
        weapon="sabre",
    ),
}


class Canvas:
    """24×32 RGBA 画布。`None` = 透明。"""

    def __init__(self) -> None:
        self.px: list[list[tuple[int, int, int] | None]] = [[None] * W for _ in range(H)]


def rect(cv: Canvas, x: int, y: int, w: int, h: int, color) -> None:
    for iy in range(y, y + h):
        for ix in range(x, x + w):
            if 0 <= ix < W and 0 <= iy < H:
                cv.px[iy][ix] = color


def put(cv: Canvas, x: int, y: int, color) -> None:
    rect(cv, x, y, 1, 1, color)


def outline_body(cv: Canvas, x0: int, y0: int, x1: int, y1: int, color) -> None:
    """给一块区域加 1px 深色描边（像素风硬边）"""
    for x in range(x0, x1 + 1):
        put(cv, x, y0, color)
        put(cv, x, y1, color)
    for y in range(y0, y1 + 1):
        put(cv, x0, y, color)
        put(cv, x1, y, color)


def draw_front(cv: Canvas, c, back=False) -> None:
    """正面/背面。back=True 时脸不画（只看到帽子后脑）。"""
    # 腿
    rect(cv, 8, 24, 3, 7, c["trouser"])
    rect(cv, 13, 24, 3, 7, c["trouser"])
    rect(cv, 8, 30, 3, 2, INK)
    rect(cv, 13, 30, 3, 2, INK)
    # 躯干（号衣/军服）
    rect(cv, 7, 13, 10, 11, c["coat"])
    rect(cv, 7, 13, 10, 2, c["coat_dark"])
    # 交叉背带（英军）/ 门襟（清军）
    if c["weapon"] == "musket":
        for i in range(9):
            put(cv, 8 + i, 15 + i, c["trim"])
            put(cv, 16 - i, 15 + i, c["trim"])
    else:
        rect(cv, 11, 15, 2, 8, c["trim"])
    outline_body(cv, 7, 13, 16, 23, INK)
    # 手臂
    rect(cv, 5, 15, 2, 6, c["coat_dark"])
    rect(cv, 17, 15, 2, 6, c["coat_dark"])
    # 头
    rect(cv, 8, 6, 8, 7, CREAM if not back else PLUM_D)
    outline_body(cv, 8, 6, 15, 12, INK)
    if not back:
        put(cv, 10, 9, INK)
        put(cv, 13, 9, INK)
        put(cv, 11, 11, BROWN_D)
    draw_hat(cv, c, front=True, back=back)
    draw_weapon_front(cv, c)


def draw_side(cv: Canvas, c) -> None:
    """侧面（朝右）。朝左由 draw_unit 整体镜像，省一套坐标。"""
    # 腿（一前一后）
    rect(cv, 9, 24, 3, 7, c["trouser"])
    rect(cv, 12, 24, 3, 7, c["trouser"])
    rect(cv, 9, 30, 4, 2, INK)
    rect(cv, 12, 29, 4, 2, INK)
    # 躯干
    rect(cv, 8, 13, 8, 11, c["coat"])
    rect(cv, 8, 13, 8, 2, c["coat_dark"])
    if c["weapon"] == "musket":
        for i in range(8):
            put(cv, 9 + i, 16 + i, c["trim"])
    else:
        rect(cv, 10, 15, 2, 8, c["trim"])
    outline_body(cv, 8, 13, 15, 23, INK)
    # 前臂（持枪/持刀，向前伸）
    rect(cv, 15, 16, 6, 2, c["coat_dark"])
    put(cv, 20, 19, CREAM)
    # 头（侧脸）
    rect(cv, 9, 6, 7, 7, CREAM)
    outline_body(cv, 9, 6, 15, 12, INK)
    put(cv, 13, 9, INK)
    put(cv, 15, 10, SAND)  # 鼻尖
    draw_hat(cv, c, front=False, back=False)
    # 武器：长枪/长刀朝右
    if c["weapon"] == "musket":
        rect(cv, 16, 15, 8, 2, BROWN_D)
        rect(cv, 18, 14, 8, 1, GREY_P)
        put(cv, 23, 13, GREY_L)
    elif c["weapon"] == "dao":
        rect(cv, 17, 12, 2, 10, GREY_L)
        rect(cv, 16, 20, 3, 3, BROWN_D)
    elif c["weapon"] == "sabre":
        rect(cv, 18, 11, 2, 10, STAR)
        rect(cv, 17, 19, 3, 3, BROWN_D)
    elif c["weapon"] == "crossbow":
        # 横着的弩：弩臂 + 弓弦，比刀短一截
        rect(cv, 16, 16, 7, 1, BROWN_D)
        rect(cv, 18, 13, 1, 7, CREAM)
        rect(cv, 17, 15, 4, 1, GREY_L)
    elif c["weapon"] in ("stick", "cane"):
        rect(cv, 17, 13, 1, 10, BROWN_D)
        rect(cv, 17, 12, 3, 1, BROWN)
    # 文官（weapon == none）不画兵器


# 头巾 / 圆盔 / 瓜皮帽：v1.9.1 新增的帽型，正背侧三个视角共用一套坐标
def draw_hat(cv: Canvas, c, front=True, back=False) -> None:
    kind = c["hat"]
    if kind == "qing":
        # 清军红缨帽：锥形斗笠 + 顶珠 + 红缨
        rect(cv, 7, 4, 10, 2, c["hat_color"])
        rect(cv, 8, 2, 8, 2, c["hat_color"])
        rect(cv, 10, 1, 4, 1, c["hat_color"])
        put(cv, 11, 0, c["tassel"])
        put(cv, 12, 0, c["tassel"])
        put(cv, 11, 5, STAR)
        if front and not back:
            rect(cv, 7, 6, 10, 1, c["tassel"])
    elif kind == "shako":
        # 高筒军帽 + 白帽带 + 铜牌
        rect(cv, 8, 1, 8, 6, c["hat_color"])
        rect(cv, 7, 6, 10, 1, INK)
        rect(cv, 8, 5, 8, 1, c["trim"])
        put(cv, 11, 3, STAR)
        put(cv, 12, 3, STAR)
        put(cv, 12, 0, c["tassel"])
    elif kind == "bearskin":
        # 熊皮帽：更高更粗，顶上一撮黄
        rect(cv, 7, 0, 10, 7, c["hat_color"])
        rect(cv, 8, 0, 8, 2, PLUM_M)
        rect(cv, 7, 5, 10, 1, c["tassel"])
        put(cv, 12, 0, STAR)
    elif kind == "bicorne":  # 双角帽（郭富）
        rect(cv, 5, 3, 14, 3, c["hat_color"])
        rect(cv, 4, 4, 16, 1, c["hat_color"])
        rect(cv, 5, 3, 14, 1, c["trim"])
        put(cv, 11, 5, STAR)
        put(cv, 12, 5, STAR)
        put(cv, 3, 4, c["tassel"])
        put(cv, 20, 4, c["tassel"])
    elif kind == "bandit":
        # 头巾：箍一圈 + 侧面打结（背面能看到结和垂下来的两绺）
        rect(cv, 7, 2, 10, 3, c["hat_color"])
        rect(cv, 7, 5, 10, 1, c["tassel"])
        if back:
            rect(cv, 15, 5, 2, 3, c["hat_color"])
            put(cv, 16, 8, c["tassel"])
        else:
            put(cv, 17, 4, c["hat_color"])
            put(cv, 17, 5, c["tassel"])
    elif kind == "helmet":
        # 巡捕圆顶盔：半球 + 金箍 + 前檐
        rect(cv, 9, 1, 6, 1, c["hat_color"])
        rect(cv, 8, 2, 8, 3, c["hat_color"])
        rect(cv, 7, 5, 10, 1, c["tassel"])
        if front:
            put(cv, 11, 3, c["tassel"])
            put(cv, 12, 3, c["tassel"])
            rect(cv, 6, 6, 12, 1, c["hat_color"])
    elif kind == "cap":
        # 瓜皮帽 / 军便帽：小圆帽 + 帽檐
        rect(cv, 8, 2, 8, 3, c["hat_color"])
        rect(cv, 10, 1, 4, 1, c["hat_color"])
        rect(cv, 7, 5, 10, 1, c["tassel"])
    else:
        raise ValueError(kind)


def draw_weapon_front(cv: Canvas, c) -> None:
    """正面：武器竖在右手边"""
    if c["weapon"] == "none":
        # 文官不拿兵器：只画一只握着的拳，避免身体一侧空着像缺了胳膊
        rect(cv, 17, 17, 3, 3, c["coat_dark"])
        put(cv, 18, 16, c["trim"])
        return
    if c["weapon"] == "musket":
        rect(cv, 18, 12, 2, 14, BROWN_D)
        rect(cv, 19, 6, 1, 7, GREY_P)
        put(cv, 19, 5, GREY_L)
    elif c["weapon"] == "dao":
        rect(cv, 18, 10, 2, 11, GREY_L)
        rect(cv, 17, 20, 4, 2, BROWN_D)
    elif c["weapon"] == "sabre":
        rect(cv, 18, 9, 2, 12, STAR)
        rect(cv, 17, 20, 4, 2, BROWN_D)
    elif c["weapon"] == "crossbow":
        # 弩：竖直挎着，弓臂横过来——正面上比刀短、比棍粗
        rect(cv, 18, 13, 1, 9, BROWN_D)
        rect(cv, 16, 15, 6, 1, CREAM)
        rect(cv, 17, 14, 3, 1, GREY_L)
        put(cv, 18, 22, BROWN)
    elif c["weapon"] in ("stick", "cane"):
        rect(cv, 18, 12, 1, 11, BROWN_D)
        rect(cv, 18, 11, 2, 2, BROWN)
    else:
        raise ValueError(c["weapon"])


def png_bytes(cv: Canvas) -> bytes:
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        for x in range(W):
            c = cv.px[y][x]
            raw += bytes((c[0], c[1], c[2], 255)) if c is not None else b"\x00\x00\x00\x00"

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def mirrored(cv: Canvas) -> Canvas:
    out = Canvas()
    for y in range(H):
        for x in range(W):
            out.px[y][x] = cv.px[y][W - 1 - x]
    return out


def render(name: str, c) -> dict[str, bytes]:
    """返回 {朝向: PNG 字节}。四个朝向一次画完，避免各视图之间尺寸漂移。"""
    files: dict[str, bytes] = {}
    cv = Canvas()
    draw_front(cv, c, back=False)
    files["down"] = png_bytes(cv)
    cv = Canvas()
    draw_front(cv, c, back=True)
    files["up"] = png_bytes(cv)
    cv = Canvas()
    draw_side(cv, c)
    files["right"] = png_bytes(cv)
    files["left"] = png_bytes(mirrored(cv))
    return files


def read_png_rgba(path: Path) -> list[list[tuple[int, int, int, int]]]:
    """只解得动本脚本自己写的那种 PNG（8bit RGBA、非隔行），够用来做 --diff。"""
    data = path.read_bytes()
    pos, idat = 8, b""
    while pos < len(data):
        ln = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + ln]
        pos += 12 + ln
        if tag == b"IHDR":
            w, h, _bd, ct, _c, _f, _i = struct.unpack(">IIBBBBB", body)
            if ct != 6:
                raise ValueError(f"{path.name}: 不是 RGBA")
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = w * 4
    prev = bytearray(stride)
    rows = []
    p = 0
    for _y in range(h):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if ft == 1:
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                cc = prev[i - 4] if i >= 4 else 0
                pa, pb, pc = abs(b - cc), abs(a - cc), abs(a + b - 2 * cc)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else cc)
                line[i] = (line[i] + pr) & 0xFF
        rows.append([tuple(line[x * 4 : x * 4 + 4]) for x in range(w)])
        prev = bytearray(line)
    return rows


# 第一幕那 8 个兵种是甲方出图 + 人工微调过的（`qing_officer` 的帽子顶珠、`lin_zexu` /
# `guan_tianpei` 左侧面的刀柄痕迹都和脚本输出不一致）。默认**不重写**它们，
# 免得一次误跑把人工调整洗掉；确实要从脚本重新出图时加 `--all`。
LEGACY = {
    "qing_green",
    "qing_officer",
    "qing_batou",
    "uk_infantry",
    "uk_grenadier",
    "gough",
    "lin_zexu",
    "guan_tianpei",
}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--list" in sys.argv:
        print(" ".join(sorted(UNITS)))
        return
    if "--diff" in sys.argv:
        bad = 0
        for name, spec in UNITS.items():
            for facing, data in render(name, spec).items():
                path = OUT / f"{name}_{facing}.png"
                if not path.exists():
                    print(f"MISSING {path.name}")
                    bad += 1
                    continue
                if read_png_rgba(path) != read_png_rgba_bytes(data):
                    print(f"DIFF {path.name}")
                    bad += 1
        print("diff ok" if bad == 0 else f"{bad} 张不一致")
        return
    force = "--all" in sys.argv
    if args:
        targets = args
    else:
        targets = sorted(UNITS if force else (set(UNITS) - LEGACY))
    OUT.mkdir(parents=True, exist_ok=True)
    for name in targets:
        if name not in UNITS:
            raise SystemExit(f"没这个兵种：{name}（--list 看全部）")
        for facing, data in render(name, UNITS[name]).items():
            (OUT / f"{name}_{facing}.png").write_bytes(data)
        print("wrote", name, "4 facings")
    if not args and not force:
        print(f"跳过 {len(LEGACY)} 个甲方出图的老兵种（要重出加 --all）")


def read_png_rgba_bytes(data: bytes):
    """`--diff` 用：把内存里的 PNG 字节按同一套解码读成像素。"""
    tmp = Path(OUT / "_diff_tmp.png")
    tmp.write_bytes(data)
    try:
        return read_png_rgba(tmp)
    finally:
        tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
