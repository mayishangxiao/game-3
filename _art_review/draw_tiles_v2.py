"""
按新24色盘画虎门销烟瓦片集 + 第二幕海战背景
输出到 game/public/art/tiles/ 和 _art_review/
"""
from PIL import Image, ImageDraw
import os, random, math

random.seed(42)

# 新24色盘
C = {
    'ink': (13,11,20),
    'night': (28,26,43),
    'plumDark': (47,43,69),
    'brownDeep': (78,47,26),
    'brownDark': (122,79,42),
    'brown': (168,118,63),
    'sand': (207,162,106),
    'cream': (232,207,168),
    'grassDark': (74,122,46),
    'grass': (123,168,74),
    'grassLight': (168,208,112),
    'leafDark': (58,107,36),
    'leaf': (90,148,56),
    'waterDark': (42,90,138),
    'water': (74,144,200),
    'waterLight': (123,192,232),
    'stoneDark': (107,100,120),
    'stone': (148,141,171),
    'stoneLight': (194,188,209),
    'redDark': (140,28,28),
    'red': (192,57,43),
    'gold': (212,168,64),
    'skin': (224,184,136),
    'paper': (242,237,228),
}

OUT_TILES = r"D:\game_project\game 3\game\public\art\tiles"
OUT_PREVIEW = r"D:\game_project\game 3\_art_review"
os.makedirs(OUT_TILES, exist_ok=True)
os.makedirs(OUT_PREVIEW, exist_ok=True)

def new(w=16, h=16):
    return Image.new('RGBA', (w,h), (0,0,0,0))

def px(img, x, y, c):
    if 0<=x<img.width and 0<=y<img.height:
        img.putpixel((x,y), (*C[c],255))

# ========== 1. 草地瓦片（3种变体）==========
def grass_tile(v=0):
    img = new()
    for y in range(16):
        for x in range(16):
            c = 'grass'
            n = (x*7 + y*11 + v*13) % 9
            if n == 0: c = 'grassDark'
            elif n == 1: c = 'grassLight'
            px(img,x,y,c)
    return img

# ========== 2. 沙瓦片 ==========
def sand_tile(v=0):
    img = new()
    for y in range(16):
        for x in range(16):
            c = 'sand'
            n = (x*3 + y*5 + v*7) % 11
            if n == 0: c = 'cream'
            elif n == 1: c = 'brownDark'
            px(img,x,y,c)
    return img

# ========== 3. 水面瓦片 ==========
def water_tile(v=0):
    img = new()
    for y in range(16):
        for x in range(16):
            c = 'water'
            if (x+y+v) % 4 == 0: c = 'waterLight'
            if (x*2+y+v) % 7 == 0: c = 'waterDark'
            px(img,x,y,c)
    return img

# ========== 4. 石板路 ==========
def stone_tile(v=0):
    img = new()
    for y in range(16):
        for x in range(16):
            c = 'stone'
            if y % 5 == 0 or x % 6 == 0: c = 'stoneDark'
            if (x+y+v)%9==0: c = 'stoneLight'
            px(img,x,y,c)
    return img

# ========== 5. 木板 ==========
def wood_tile(v=0):
    img = new()
    for y in range(16):
        for x in range(16):
            c = 'brown'
            if y % 4 == 0: c = 'brownDeep'
            if (x+y+v)%8==0: c = 'brownDark'
            px(img,x,y,c)
    return img

# ========== 6. 灌木装饰 ==========
def bush_tile():
    img = new()
    for y in range(16):
        for x in range(16):
            px(img,x,y,'grass')
    # 深绿灌木团
    for dx in range(3,13):
        for dy in range(4,12):
            if (dx-8)**2 + (dy-8)**2 < 18:
                px(img,dx,dy,'leafDark')
                if (dx+dy)%3==0: px(img,dx,dy,'leaf')
    return img

# ========== 7. 花地 ==========
def flower_tile():
    img = new()
    for y in range(16):
        for x in range(16):
            px(img,x,y,'grass')
    # 小花
    for fx,fy,fc in [(3,4,'paper'),(8,7,'cream'),(5,11,'waterLight'),(11,5,'paper'),(10,12,'cream')]:
        px(img,fx,fy,fc)
    return img

# ========== 8. 水边过渡（沙→水）==========
def shore_tile():
    img = new()
    for y in range(16):
        for x in range(16):
            if y < 10:
                c = 'sand' if (x+y)%4 else 'cream'
            elif y < 13:
                c = 'sand' if y==10 else 'water'
            else:
                c = 'water'
                if (x+y)%3==0: c = 'waterLight'
            px(img,x,y,c)
    return img

# ========== 9. 草→石过渡 ==========
def grass_stone_edge():
    img = new()
    for y in range(16):
        for x in range(16):
            if y < 8:
                c = 'grass' if (x+y)%3 else 'grassDark'
            else:
                c = 'stone' if (x+y)%4 else 'stoneDark'
            px(img,x,y,c)
    return img

# ========== 10. 鸦片箱道具 16x16 ==========
def crate_sprite():
    img = new()
    for y in range(3,13):
        for x in range(3,13):
            c = 'brown'
            if y==3 or y==12 or x==3 or x==12: c = 'brownDeep'
            if y==8: c = 'brownDark'
            px(img,x,y,c)
    # 红十字
    for i in range(3):
        px(img,6+i,7,'redDark')
        px(img,7,6+i,'redDark')
    return img

# ========== 画所有瓦片并保存 ==========
tiles = {
    'grass_0.png': grass_tile(0),
    'grass_1.png': grass_tile(1),
    'grass_2.png': grass_tile(2),
    'sand_0.png': sand_tile(0),
    'sand_1.png': sand_tile(1),
    'water_0.png': water_tile(0),
    'water_1.png': water_tile(1),
    'stone_0.png': stone_tile(0),
    'stone_1.png': stone_tile(1),
    'wood_0.png': wood_tile(0),
    'bush.png': bush_tile(),
    'flower.png': flower_tile(),
    'shore.png': shore_tile(),
    'grass_stone_edge.png': grass_stone_edge(),
    'prop_crate.png': crate_sprite(),
}

for name, img in tiles.items():
    img.save(os.path.join(OUT_TILES, name))
    img.resize((128,128), Image.NEAREST).save(os.path.join(OUT_PREVIEW, name.replace('.png','_8x.png')))

# 拼瓦片总览
ov = Image.new('RGBA', (16*5, 16*3), (40,40,50,255))
for i,(name,img) in enumerate(tiles.items()):
    ox = (i%5)*16
    oy = (i//5)*16
    ov.paste(img,(ox,oy),img)
ov.resize((16*5*6, 16*3*6), Image.NEAREST).save(os.path.join(OUT_PREVIEW,'_tileset_overview.png'))

print(f"画了 {len(tiles)} 个瓦片")

# ========== 第二幕：海战背景 480x270 ==========
def draw_battle_bg():
    W,H = 480,270
    bg = Image.new('RGBA',(W,H),(0,0,0,0))
    d = ImageDraw.Draw(bg)

    # 天空渐变（用色盘硬切）
    sky_colors = ['night','plumDark','waterDark','water']
    for y in range(120):
        ci = min(int(y/30), 3)
        c = C[sky_colors[ci]]
        d.line([(0,y),(W,y)], fill=(*c,255))

    # 远处火光（地平线）
    for i in range(8):
        x = 40 + i*55 + random.randint(-10,10)
        h = random.randint(15,35)
        d.ellipse([x-15, 115-h, x+15, 115], fill=(*C['redDark'],180))
        d.ellipse([x-8, 115-h+5, x+8, 115], fill=(*C['red'],200))
        d.ellipse([x-3, 115-h+10, x+3, 115], fill=(*C['gold'],220))

    # 海面
    for y in range(120, H):
        c = C['waterDark'] if y < 150 else C['water']
        d.line([(0,y),(W,y)], fill=(*c,255))

    # 海面波纹
    for i in range(30):
        y = random.randint(125, H-5)
        x = random.randint(0, W-20)
        l = random.randint(10,30)
        d.line([(x,y),(x+l,y)], fill=(*C['waterLight'],180), width=1)

    # 远处战船剪影（3艘）
    ships = [(80,130,60),(240,125,80),(400,132,50)]
    for sx, sy, sw in ships:
        # 船体
        d.polygon([(sx-sw//2,sy),(sx+sw//2,sy),(sx+sw//3,sy+12),(sx-sw//3,sy+12)],
                  fill=(*C['brownDeep'],255))
        # 桅杆
        d.line([(sx,sy),(sx,sy-35)], fill=(*C['ink'],255), width=1)
        # 烟囱
        d.rectangle([sx+5,sy-25,sx+9,sy], fill=(*C['night'],255))

    # 烟雾/蒸汽（从烟囱升起）
    for sx, sy, sw in ships:
        for i in range(5):
            cx = sx + 7 + random.randint(-3,3)
            cy = sy - 28 - i*8
            r = 6 - i
            d.ellipse([cx-r,cy-r,cx+r,cy+r], fill=(*C['stoneLight'],80+i*20))

    # 近景蒸汽（从底部升起）
    for i in range(6):
        cx = random.randint(0,W)
        cy = H - random.randint(10,50)
        r = random.randint(15,30)
        d.ellipse([cx-r,cy-r,cx+r,cy+r], fill=(*C['paper'],40))

    return bg

bg = draw_battle_bg()
bg.save(os.path.join(OUT_TILES, 'bg_battle.png'))
bg.resize((960,540), Image.NEAREST).save(os.path.join(OUT_PREVIEW,'_bg_battle_2x.png'))
print("海战背景画完: bg_battle.png")

# ========== 拼一张虎门销烟完整场景预览 ==========
def draw_humen_full():
    W,H = 480,270
    m = Image.new('RGBA',(W,H),(*C['grass'],255))

    # 草地纹理
    for y in range(0,H,16):
        for x in range(0,W,16):
            v = (x//16 + y//16) % 3
            tile_img = grass_tile(v)
            m.paste(tile_img,(x,y),tile_img)

    # 底部沙滩+海
    for y in range(H-40,H-15):
        for x in range(0,W,16):
            m.paste(sand_tile(0),(x,y),sand_tile(0))
    for y in range(H-15,H):
        for x in range(0,W,16):
            m.paste(water_tile(0),(x,y),water_tile(0))

    # 两个销烟池
    for px,py in [(60,40),(300,40)]:
        d = ImageDraw.Draw(m)
        d.ellipse([px,py,px+50,py+45], fill=(*C['brownDark'],255))
        d.ellipse([px+5,py+5,px+45,py+40], fill=(*C['paper'],255))

    # 箱子散落
    for cx,cy in [(150,100),(250,120),(100,160),(350,150),(200,200)]:
        m.paste(crate_sprite(),(cx,cy),crate_sprite())

    # 灌木
    for bx,by in [(20,20),(440,30),(30,200),(430,180)]:
        m.paste(bush_tile(),(bx,by),bush_tile())

    return m

scene = draw_humen_full()
scene.save(os.path.join(OUT_PREVIEW,'_humen_full.png'))
print("虎门销烟场景预览画完")
