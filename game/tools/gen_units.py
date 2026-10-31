"""生成兵种小人贴图（24×32，四个朝向），用于替换矩形占位形体。

为什么程序化画：甲方要「我方小人 / 英军小人 / 郭富准将」一眼能分辨，
而正式美术还没到。这里用 Pillow 按 24 色盘画硬边像素小人，
生成结果放 public/art/units/<unit>_<facing>.png，CharacterRig 检测到贴图就切贴图模式。

用法：python tools/gen_units.py
"""

import pathlib

from PIL import Image

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "art" / "units"

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
}


def new_canvas():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return img, img.load()


def rect(px, x, y, w, h, color):
    for iy in range(y, y + h):
        for ix in range(x, x + w):
            if 0 <= ix < W and 0 <= iy < H:
                px[ix, iy] = color + (255,)


def put(px, x, y, color):
    rect(px, x, y, 1, 1, color)


def outline_body(px, x0, y0, x1, y1, color):
    """给一块区域加 1px 深色描边（像素风硬边）"""
    for x in range(x0, x1 + 1):
        put(px, x, y0, color)
        put(px, x, y1, color)
    for y in range(y0, y1 + 1):
        put(px, x0, y, color)
        put(px, x1, y, color)


def draw_front(px, c, back=False):
    """正面/背面。back=True 时脸不画（只看到帽子后脑）。"""
    # 腿
    rect(px, 8, 24, 3, 7, c["trouser"])
    rect(px, 13, 24, 3, 7, c["trouser"])
    rect(px, 8, 30, 3, 2, INK)
    rect(px, 13, 30, 3, 2, INK)
    # 躯干（号衣/军服）
    rect(px, 7, 13, 10, 11, c["coat"])
    rect(px, 7, 13, 10, 2, c["coat_dark"])
    # 交叉背带（英军）/ 门襟（清军）
    if c["weapon"] == "musket":
        for i in range(9):
            put(px, 8 + i, 15 + i, c["trim"])
            put(px, 16 - i, 15 + i, c["trim"])
    else:
        rect(px, 11, 15, 2, 8, c["trim"])
    outline_body(px, 7, 13, 16, 23, INK)
    # 手臂
    rect(px, 5, 15, 2, 6, c["coat_dark"])
    rect(px, 17, 15, 2, 6, c["coat_dark"])
    # 头
    rect(px, 8, 6, 8, 7, CREAM if not back else PLUM_D)
    outline_body(px, 8, 6, 15, 12, INK)
    if not back:
        put(px, 10, 9, INK)
        put(px, 13, 9, INK)
        put(px, 11, 11, BROWN_D)
    draw_hat(px, c, front=True, back=back)
    draw_weapon_front(px, c)


def draw_side(px, c, flip=False):
    """侧面。flip=False 朝右，True 朝左（画完镜像，省一套坐标）。"""
    if flip:
        img2 = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw_side(tmp.load(), c, flip=False)
        px_img = img2.load()
        # 写回：调用方给的是 pixel access，这里用整体粘贴替代
        # （由 draw_all 统一处理，见下）
        raise RuntimeError("flip 由 draw_all 处理")
    # 腿（一前一后）
    rect(px, 9, 24, 3, 7, c["trouser"])
    rect(px, 12, 24, 3, 7, c["trouser"])
    rect(px, 9, 30, 4, 2, INK)
    rect(px, 12, 29, 4, 2, INK)
    # 躯干
    rect(px, 8, 13, 8, 11, c["coat"])
    rect(px, 8, 13, 8, 2, c["coat_dark"])
    if c["weapon"] == "musket":
        for i in range(8):
            put(px, 9 + i, 16 + i, c["trim"])
    else:
        rect(px, 10, 15, 2, 8, c["trim"])
    outline_body(px, 8, 13, 15, 23, INK)
    # 前臂（持枪/持刀，向前伸）
    rect(px, 15, 16, 6, 2, c["coat_dark"])
    put(px, 20, 19, CREAM)
    # 头（侧脸）
    rect(px, 9, 6, 7, 7, CREAM)
    outline_body(px, 9, 6, 15, 12, INK)
    put(px, 13, 9, INK)
    put(px, 15, 10, SAND)  # 鼻尖
    draw_hat(px, c, front=False, back=False)
    # 武器：长枪/长刀朝右
    if c["weapon"] == "musket":
        rect(px, 16, 15, 8, 2, BROWN_D)
        rect(px, 18, 14, 8, 1, GREY_P)
        put(px, 23, 13, GREY_L)
    elif c["weapon"] == "dao":
        rect(px, 17, 12, 2, 10, GREY_L)
        rect(px, 16, 20, 3, 3, BROWN_D)
    else:  # sabre
        rect(px, 18, 11, 2, 10, STAR)
        rect(px, 17, 19, 3, 3, BROWN_D)


def draw_hat(px, c, front=True, back=False):
    kind = c["hat"]
    if kind == "qing":
        # 清军红缨帽：锥形斗笠 + 顶珠 + 红缨
        rect(px, 7, 4, 10, 2, c["hat_color"])
        rect(px, 8, 2, 8, 2, c["hat_color"])
        rect(px, 10, 1, 4, 1, c["hat_color"])
        put(px, 11, 0, c["tassel"])
        put(px, 12, 0, c["tassel"])
        put(px, 11, 5, STAR)
        if front and not back:
            rect(px, 7, 6, 10, 1, c["tassel"])
    elif kind == "shako":
        # 高筒军帽 + 白帽带 + 铜牌
        rect(px, 8, 1, 8, 6, c["hat_color"])
        rect(px, 7, 6, 10, 1, INK)
        rect(px, 8, 5, 8, 1, c["trim"])
        put(px, 11, 3, STAR)
        put(px, 12, 3, STAR)
        put(px, 12, 0, c["tassel"])
    elif kind == "bearskin":
        # 熊皮帽：更高更粗，顶上一撮黄
        rect(px, 7, 0, 10, 7, c["hat_color"])
        rect(px, 8, 0, 8, 2, PLUM_M)
        rect(px, 7, 5, 10, 1, c["tassel"])
        put(px, 12, 0, STAR)
    else:  # bicorne 双角帽（郭富）
        rect(px, 5, 3, 14, 3, c["hat_color"])
        rect(px, 4, 4, 16, 1, c["hat_color"])
        rect(px, 5, 3, 14, 1, c["trim"])
        put(px, 11, 5, STAR)
        put(px, 12, 5, STAR)
        put(px, 3, 4, c["tassel"])
        put(px, 20, 4, c["tassel"])


def draw_weapon_front(px, c):
    """正面：武器竖在右手边"""
    if c["weapon"] == "none":
        # 文官不拿兵器：只画一只握着的拳，避免身体一侧空着像缺了胳膊
        rect(px, 17, 17, 3, 3, c["coat_dark"])
        put(px, 18, 16, c["trim"])
        return
    if c["weapon"] == "musket":
        rect(px, 18, 12, 2, 14, BROWN_D)
        rect(px, 19, 6, 1, 7, GREY_P)
        put(px, 19, 5, GREY_L)
    elif c["weapon"] == "dao":
        rect(px, 18, 10, 2, 11, GREY_L)
        rect(px, 17, 20, 4, 2, BROWN_D)
    else:
        rect(px, 18, 9, 2, 12, STAR)
        rect(px, 17, 20, 4, 2, BROWN_D)


def draw_unit(name, c):
    OUT.mkdir(parents=True, exist_ok=True)
    # 正面
    img, px = new_canvas()
    draw_front(px, c, back=False)
    img.save(OUT / f"{name}_down.png")
    # 背面
    img, px = new_canvas()
    draw_front(px, c, back=True)
    img.save(OUT / f"{name}_up.png")
    # 侧面朝右
    img, px = new_canvas()
    draw_side(px, c, flip=False)
    img.save(OUT / f"{name}_right.png")
    # 朝左 = 镜像
    img.rotate(0)
    img.transpose(Image.FLIP_LEFT_RIGHT).save(OUT / f"{name}_left.png")
    print("wrote", name, "4 facings")


def main():
    for name, cfg in UNITS.items():
        draw_unit(name, cfg)


if __name__ == "__main__":
    main()