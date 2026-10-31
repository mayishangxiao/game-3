# -*- coding: utf-8 -*-
"""生成《鸦片战争原型 · 美术生成提示词》DOCX。

只做一件事：把游戏里现有的占位矢量图形，翻译成可以直接贴进
Midjourney / 即梦 / 文心一格 的提示词，让用户能自己出美术图。
运行：python build_art_prompts.py
"""
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

OUT = '鸦片战争原型·美术生成提示词.docx'

STYLE_PREFIX = (
    'pixel art, 16-bit Chinese historical RPG, limited 24-color palette, '
    '1px black outline, hard shadow, no anti-aliasing, transparent background, '
    'front-facing three-quarter-free flat view'
)

NEGATIVE = (
    'no photorealistic, no 3D render, no blur, no gradient shading, no watermark, '
    'no text, no signature, no extra limbs, no modern clothing, no guns of modern type, '
    'no color banding, no perspective distortion'
)

# 立绘（对话框里的人像）两条风格前缀，二选一整套统一
PORTRAIT_PREFIX_PIXEL = (
    'pixel art bust portrait, chest-up composition, 1px black outline, limited 24-color palette, '
    'left-top key light, hard shadow, no anti-aliasing, transparent background, '
    'centered head in upper third, plain dark background'
)

PORTRAIT_PREFIX_PAINT = (
    'Chinese ink-and-color illustration, half-body bust portrait, restrained palette of indigo/ochre/'
    'rust-red, soft aged-paper texture, subtle rim light on the left, painterly brush strokes, '
    'transparent background, no text, chest-up composition'
)


def set_east_asian_lang(rpr):
    """把 rPr 里的语言标成中文（eastAsia=zh-CN）。

    必须做：python-docx 默认模板写的是 eastAsia="en-US"，LibreOffice 读到
    会把一整段中文当成一个不可断词的英文单词，于是整行溢出纸张右边（Word 宽容
    会自己断词，所以只在 LibreOffice/手机 WPS 上看得到）。踩过一次。
    """
    lang = rpr.find(qn('w:lang'))
    if lang is None:
        lang = OxmlElement('w:lang')
        rpr.append(lang)
    lang.set(qn('w:val'), 'en-US')
    lang.set(qn('w:eastAsia'), 'zh-CN')


def set_font(run, name='宋体', size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn('w:eastAsia'), name)
    set_east_asian_lang(run._element.get_or_add_rPr())
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)


def para(doc, text, size=10.5, bold=False, color=(0x22, 0x22, 0x22), space_after=4):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    r = p.add_run(text)
    set_font(r, size=size, bold=bold, color=color)
    return p


def code_block(doc, text):
    """提示词用等宽+浅底，方便手机上长按复制。"""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.left_indent = Pt(8)
    r = p.add_run(text)
    set_font(r, name='Consolas', size=9)
    r.font.color.rgb = RGBColor(0x0A, 0x2A, 0x4A)
    return p


def bullet(doc, text, size=10.5):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(text)
    set_font(r, size=size)
    return p


def heading(doc, text, level=1):
    h = doc.add_heading(level=level)
    r = h.add_run(text)
    set_font(r, name='黑体', size=16 if level == 1 else 13, bold=True,
             color=(0x1B, 0x2A, 0x44))
    return h


def build():
    doc = Document()

    # 默认模板的 docDefaults 把 eastAsia 标成 en-US，中文本在 LibreOffice 里不会换行
    styles_el = doc.styles.element
    rpr_default = styles_el.find(qn('w:docDefaults')).find(qn('w:rPrDefault')).find(qn('w:rPr'))
    set_east_asian_lang(rpr_default)

    style = doc.styles['Normal']
    style.font.name = '宋体'
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    style.font.size = Pt(10.5)
    set_east_asian_lang(style.element.rPr)

    t = doc.add_heading(level=0)
    r = t.add_run('鸦片战争原型 · 美术生成提示词')
    set_font(r, name='黑体', size=24, bold=True, color=(0x1B, 0x2A, 0x44))
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = sub.add_run('配套《虎门炮台守卫战》可演示原型　v1.0')
    set_font(r, size=11, color=(0x55, 0x55, 0x55))

    # ---------------- 一、怎么用 ----------------
    heading(doc, '一、怎么用这份提示词', 1)
    para(doc, '游戏现在跑的是占位矢量图形（矩形拼的小人、方块箱子、黑块军舰），不是最终美术。'
              '下面每一条提示词都可以直接贴进任意出图工具，出完图按尺寸切好替换即可，代码不用改。')
    bullet(doc, '出图工具：Midjourney、即梦、文心一格、通义万相都行；像素风建议用「像素」或「pixel art」模式。')
    bullet(doc, '统一风格前缀：每条提示词前面都先贴上这个前缀，出来的四张图才是一套。')
    code_block(doc, STYLE_PREFIX)
    bullet(doc, '统一负面提示词：贴在 negative prompt 里，避免出来写实风或带文字的图。')
    code_block(doc, NEGATIVE)
    bullet(doc, '尺寸：角色 24×32 像素（等比放大 8 倍出图再缩回）；地砖 16×16；大物件按表里写的尺寸。')
    bullet(doc, '背景必须透明：出图时选「透明背景 / transparent」，否则缩图后会有白边。')

    # ---------------- 二、美术规范 ----------------
    heading(doc, '二、美术规范（照这个做，缩到手机上才不会糊）', 1)
    para(doc, '游戏内部只有 480×270 像素，放大到手机屏幕约 2—3 倍。这意味着：细节会消失，轮廓和色块才是信息。', bold=True)
    bullet(doc, '轮廓优先：每个物件至少 1 像素纯黑描边，否则在土黄/灰紫的地面上会糊成一片（这是现有版本踩过的坑——箱子看不见）。')
    bullet(doc, '只用 24 色：主色是土黄（沙地）、灰紫（战场）、墨蓝（海/夜）、砖红（敌方）、米白（纸张/文字）。出图后统一压到这个色数，画面才不脏。')
    bullet(doc, '光源固定左上：左上受光、右下压暗，全游戏统一，玩家不会觉得乱。')
    bullet(doc, '不要写实阴影和渐变：像素风一加渐变就会在缩小后变成脏点。')
    bullet(doc, '人形一律二头身：头 12×12、身 12×12、腿 4×8，站在 16×16 的地砖上。')

    # ---------------- 三、角色 ----------------
    heading(doc, '三、角色（8 个，含 Boss）', 1)
    para(doc, '每个角色都要四向：正面、背面、左侧、右侧（右侧可用左侧镜像）。'
              '下面提示词默认出「正面」，其余三向把 "front view" 换成 "back view / side view" 重出一遍。')

    chars = [
        ('1. 关天培（清军水师提督，60 岁，剧情核心）',
         '64×64',
         'Chinese Qing dynasty naval admiral, 60 years old, dark blue dragon-pattern official robe, '
         'black official hat with red tassel, long grey beard, holding a sword, dignified and tired expression',
         '穿深蓝蟒袍的清朝水师提督，六十岁，黑官帽红顶穗，花白长须，执刀，神情威严而疲惫。'
         '关键点：他不是「威武将军」，是一个知道打不赢仍然去死的人——脸上要有一点悲色。'),
        ('2. 清军绿营兵（普通杂兵）',
         '24×32',
         'Qing green standard army soldier, green cotton uniform with red trim, conical straw hat, '
         'long spear, bare feet, thin and poorly equipped',
         '清朝绿营兵，绿布号衣红边，尖顶斗笠，长矛，赤脚，瘦弱、装备简陋。'
         '关键点：要看得出来「穷」——衣服有补丁、武器不整齐，和英军的整齐形成对比。'),
        ('3. 清军刀牌手（近战，扛炮灰）',
         '24×32',
         'Qing soldier with rattan shield and broadsword, dark red vest, head wrapped in cloth, '
         'crouching defensive stance',
         '清军刀牌手，藤牌加单刀，深红坎肩，头缠布巾，半蹲防御姿态。'),
        ('4. 英军步兵（线列步兵，红虾兵）',
         '24×32',
         'British line infantry 1840, red coat with white cross belts, black shako with white plume, '
         'musket with bayonet, standing in disciplined posture',
         '1840 年英国线列步兵，红色军服白色交叉皮带，黑色高筒军帽白羽饰，滑膛枪上刺刀，站姿严整。'
         '关键点：和清兵并排时要一眼看出「装备代差」——衣服平整、皮具齐全、枪是制式的。'),
        ('5. 英军掷弹兵（精锐）',
         '24×32',
         'British grenadier 1840, taller bearskin cap, red coat with blue facings, '
         'grenade pouch, musket, aggressive stance',
         '英军掷弹兵，更高的熊皮帽，红上衣蓝翻领，手雷袋，滑膛枪，气势逼人。'),
        ('6. 郭富准将（精英，带指挥光环）',
         '32×40',
         'British brigadier general 1840, dark blue coat with gold epaulettes, '
         'cocked hat, sabre raised, standing on a small rise, commanding posture',
         '英军准将（郭富），深蓝将官服配金色肩章，三角帽，举着指挥刀，站在略高处。'
         '关键点：他是「外援」的具象化——周围那一圈指挥光环在游戏里加 20% 攻击。'),
        ('7. 英军蒸汽炮舰（Boss，整场压轴）',
         '96×48（可出 192×96 再缩）',
         'British 1840 steam frigate, iron hull, three masts with furled sails, '
         'single black funnel with smoke, gun ports along the hull, bowsprit, side view, '
         'dark blue-grey iron with rust streaks',
         '1840 年英国蒸汽炮舰，铁壳船体，三桅收帆，单根黑烟囱冒黑烟，船侧一排炮门，船首斜桁，'
         '侧面视角，深蓝灰铁色带锈迹。'
         '关键点：它是「打不穿」的那面墙——铁壳要显得厚重、冷硬，和木质清军炮台形成材质对比。'),
    ]
    for title, size, en, cn in chars:
        heading(doc, title, 2)
        bullet(doc, f'尺寸：{size}')
        bullet(doc, '中文提示词：')
        code_block(doc, cn)
        bullet(doc, '英文提示词（有些工具英文更稳）：')
        code_block(doc, en + ', ' + STYLE_PREFIX)

    # ---------------- 四、地块 ----------------
    heading(doc, '四、地图地块（16×16 tileset）', 1)
    para(doc, '一块地砖 16×16。出图时按 8×8 的大图出，再切成单块，接缝才齐。')
    tiles = [
        ('虎门海滩（沙地）', 'pale sand beach tile, fine grain dots, a few shell fragments, top-left lit',
         '虎门海滩沙地，细颗粒点状纹理，几片碎贝壳，左上受光。关键点：要和鸦片箱的深棕形成对比，箱子上要有亮边。'),
        ('炮台石墙（威远炮台）', 'grey granite fortress wall tile, weathered blocks, dark mortar lines',
         '威远炮台花岗岩石墙，风化的条石，深色灰缝。'),
        ('海面（近岸）', 'shallow coastal sea tile, blue-grey water, small wave crests',
         '近岸海面，蓝灰水色，小浪尖。'),
        ('木栈道 / 码头', 'wooden pier planks tile, dark brown, nail heads, worn edges',
         '码头木栈道，深棕木板，钉头，磨损边缘。'),
        ('城内街道（广州）', 'Canton street cobblestone tile, grey-purple stone, dirt between stones',
         '广州城内石板路，灰紫石面，石缝有土。'),
        ('战场地面（灰紫台地）', 'battlefield ground tile, muted grey-purple earth, sparse grass tufts',
         '战场地面，灰紫土色，稀疏草簇。'),
    ]
    for name, en, cn in tiles:
        heading(doc, name, 2)
        code_block(doc, cn + '\n' + en + ', seamless tileable, ' + STYLE_PREFIX)

    # ---------------- 五、场景物件 ----------------
    heading(doc, '五、场景物件与可交互物', 1)
    props = [
        ('鸦片箱（关键道具，务必醒目）', '20×20',
         'wooden opium chest, dark brown wood, gold-yellow metal corner brackets, '
         'small red seal label, glowing rim highlight',
         '鸦片木箱，深棕木料，金黄连角包边，小红印标签，边缘带高亮。'
         '关键点：之前玩家在手机上找不到箱子——箱子必须比地面亮一档，并且有金色描边。'),
        ('销烟池（目标点）', '40×26',
         'lime pit for destroying opium, rectangular stone basin, white lime slurry, steam rising',
         '销烟池，石砌方池，白色石灰浆，升起水汽。'),
        ('清军岸炮（虎门炮台）', '32×24',
         'Qing coastal cannon on wooden carriage, rusted iron barrel, sandbags around',
         '清军岸炮，木质炮架，锈蚀铁炮管，周围堆沙袋。'
         '关键点：炮管要细、要旧——和英舰的粗壮形成「射程与穿甲都不够」的视觉暗示。'),
        ('英舰炮弹（投射物）', '8×8',
         'black iron cannonball with motion trail, small white highlight',
         '黑色铁弹丸，带运动拖尾，小白高光。'),
        ('我方炮弹（投射物）', '8×8',
         'stone cannonball with smoke puff, warm grey',
         '石弹丸，带硝烟，暖灰色。'),
        ('旗帜：清（黄龙旗）', '24×16',
         'Qing yellow dragon banner on bamboo pole, triangular pennant',
         '清朝黄龙旗，竹竿，三角旗。'),
        ('旗帜：英（米字旗）', '24×16',
         'British union jack on wooden pole, weathered',
         '英国米字旗，木杆，做旧。'),
    ]
    for name, size, en, cn in props:
        heading(doc, name, 2)
        bullet(doc, f'尺寸：{size}')
        code_block(doc, cn + '\n' + en + ', ' + STYLE_PREFIX)

    # ---------------- 六、UI ----------------
    heading(doc, '六、界面元素（手机上要「拇指大小」）', 1)
    para(doc, '界面按 480×270 设计，按钮直径 40—52 像素；直径小于 36 的按钮在手机上就点不准了。')
    ui = [
        ('摇杆底座与摇杆头', '底座 68×68，杆头 28×28',
         'round joystick base, dark translucent, thin white ring; joystick knob, light grey, soft highlight',
         '圆形摇杆底座，半透明深色，细白圆环；摇杆头浅灰，柔和高光。'),
        ('四键：攻 / 技 / 炮 / 闪', '直径 40—52',
         'circular stone-grey action button with engraved Chinese character, red-brown inner disc, '
         'thick dark ring; a special variant with gold ring for the cannon skill',
         '圆形石灰色动作按钮，中间刻汉字，内部暗红圆盘，外圈深色厚环；「炮」键用金色外环区分成大招。'),
        ('「查」交互键', '直径 36',
         'small golden circular button with a magnifier glyph',
         '小的金色圆形按钮，放大镜图形。'),
        ('清王朝血条', '宽 120，高 8',
         'ornate horizontal health bar frame, aged brass, dragon motif ends, deep red fill',
         '横向血条外框，做旧黄铜，两端龙纹，内部深红填充。'
         '关键点：这条是「清王朝的国运」，不是角色血量，外框要更庄重。'),
        ('敌人血条', '宽 20—72，高 3',
         'thin health bar, black backing, red fill, elite version in gold',
         '细血条，黑底，红色填充，精英用金色。'),
    ]
    for name, size, en, cn in ui:
        heading(doc, name, 2)
        bullet(doc, f'尺寸：{size}')
        code_block(doc, cn + '\n' + en + ', ' + STYLE_PREFIX)

    # ---------------- 七、对话立绘 ----------------
    heading(doc, '七、对话立绘（画框 72×84，图缩到 68×80）', 1)
    para(doc, '对话框左侧那一格画框就是立绘位。它在游戏里只有 68×80 像素，所以出图必须「胸像」——'
              '头肩胸三样占满画面，画全身缩下来就是一团糊。', bold=True)
    bullet(doc, '出图尺寸：576×672（8 倍），透明底 PNG，竖构图；进游戏会缩到 68×80。')
    bullet(doc, '构图：头部在画面上 1/3，肩与胸占下 2/3，人物略偏向画面右侧（左边留给画框边），四周留 8 像素以上空白。')
    bullet(doc, '只画到胸口：不要腿、不要手部特写、不要背景道具堆满——画框只有拇指大，多一笔就糊。')
    bullet(doc, '风格必须同一个人出全套：同一批人只用一套提示词前缀，色温、打光、笔触都别换。')
    bullet(doc, '接进游戏：图放 public/art/，在 config.json → ui.portraits 里加一行 '
              '"lin_zexu": "art/portrait_lin_zexu.png"，代码不用改；说话人 id 见 data/dialogues/dlg_ch00.json。')
    bullet(doc, '旁白（narrator）不要立绘——对话框空着就好，别给他配一张脸。')
    bullet(doc, '关天培已经有立绘（原稿沿用 public/art/portrait_guan_tianpei.png），不用重画；'
                '要重画就按上面的胸像规格出一张，放到同名文件覆盖即可。')
    bullet(doc, '所有立绘统一是「只要头」的胸像：96×112 的话，头与帽子占上 2/3，肩占下 1/3。')

    para(doc, '立绘风格前缀（二选一，整套统一用同一个）：', bold=True)
    code_block(doc, PORTRAIT_PREFIX_PIXEL)
    code_block(doc, PORTRAIT_PREFIX_PAINT)

    portraits = [
        ('林则徐（钦差大臣，销烟主角）', 'lin_zexu',
         'bust portrait of Lin Zexu, 55-year-old Qing official, dark blue mandarin robe with '
         'first-rank badge, black official hat with red button, short grey beard, calm resolute eyes, '
         'holding a folded memorial in one hand',
         '林则徐胸像：五十五岁，深蓝补服配一品补子，黑官帽红顶珠，灰白短须，眼神沉着坚定，一手按着一封奏折。'
         '关键点：他是「明知会得罪人也要做」的那种沉静，不是愤怒。'),
        ('郭富准将（英军指挥，外援的具象）', 'charles_gough',
         'bust portrait of a British brigadier general 1840, dark blue coat with gold epaulettes and '
         'gold braid, cocked hat, sideburns, cold confident expression',
         '英军准将郭富胸像：深蓝呢军装、金色肩章与金线滚边，三角帽，络腮胡，冷硬自信的表情。'
         '关键点：和清廷官员并排时要一眼看出「装备与后勤的代差」。'),
        ('义律（英国驻华商务监督）', 'charles_elliot',
         'bust portrait of Charles Elliot 1840, dark green frock coat, high collar, curly brown hair, '
         'arrogant thin lips',
         '义律胸像：深绿呢外套、高领、褐色卷发，薄唇、倨傲神情。'
         '关键点：他是「谈判桌上不讲理」的那种礼貌，不要画成反派脸谱。'),
        ('琦善（主和派，签条约的人）', 'qishan',
         'bust portrait of Qishan, Qing official in slate-blue robe, official hat, thin moustache, '
         'evasive lowered gaze',
         '琦善胸像：石青补服、官帽、八字细须，目光下视、神情回避。'
         '关键点：他要显得「在算账」，不是「在卖国」——这样玩家才理解妥协是怎么发生的。'),
    ]
    for title, sid, en, cn in portraits:
        heading(doc, title, 2)
        bullet(doc, f'说话人 id（写进 config.json 用）：{sid}')
        bullet(doc, '提示词（前面接上你选的那条「立绘风格前缀」）：')
        code_block(doc, cn + '\n' + en)

    para(doc, '第二幕（太平天国）要用的两个说话人先留模板，等做到那一幕再出图：'
              'li_xiucheng（李秀成，青年将领，布衣铁甲）、hong_xiuquan（洪秀全，天王冠服，'
              '眼神狂热）。规则一样：胸像、透明底、576×672。', size=10)

    # ---------------- 八、惨烈战场 ----------------
    heading(doc, '八、惨烈战场：背景全景与地面残破（本轮新增）', 1)
    para(doc, '需求原话：「背景要惨烈，体现鸦片战争残酷，还有地板增加血迹尸骸、炮坑等，让地图很残破」。')
    para(doc, '这一节只要两样东西：① 一张 480×270 的战斗背景全景；② 一张地面残破贴图（贴图里带血迹、'
              '尸骸、弹坑、碎木）。我已经先用程序画了占位版（只用 24 色盘），你出的图会直接替换掉它。')

    heading(doc, '8.1 战斗背景全景（开场卡 + 战场远景共用）', 2)
    bullet(doc, '尺寸：480×270（等比放大到 960×540 也可以，我按 480 宽缩回去）。', 10)
    bullet(doc, '用途：战斗开始的情境卡整屏底图；同一张图顶部 48px 还会被裁成「战场远景条」，'
                '所以**最重要的一排东西（敌舰、炮台、火光、烟柱）请放在画面上下 1/3 之间**，'
                '最顶部 48px 别放主体。', 10)
    bullet(doc, '构图要交代三件事：我方在岸（炮台/垛口/清军旗）、敌方在海上（多艘蒸汽炮舰、'
                '桅杆密集）、战场已被打烂（浓烟、火光、漂木、翻倒的船）。', 10)
    code_block(
        doc,
        '1841 年鸦片战争虎门海战全景，横向构图，黄昏血红色天空压着黑烟，'
        '远景海平线上十余艘英国蒸汽炮舰列阵，其中两艘中弹起火、黑烟冲天，一艘侧翻半沉；'
        '近景左侧是虎门威远炮台的石砌垛口与几门岸防炮，清军旗残破；'
        '海面漂浮碎木与帆布，水上有火光倒影；画面惨烈、压抑、有硝烟层次，'
        '复古像素画，16-bit，深蓝紫与暗红主调，硬边块面，无渐变，1px 深色描边，'
        '限制在 24 色以内 --ar 16:9 '
        '--no photorealistic, 3D render, blur, soft gradient, text, watermark, modern objects'
    )
    para(doc, '如果一次出不满意，把「黄昏血红色天空」改成「铅灰色阴天」再出一版——两种都能用，'
              '阴天版更压抑，红天版更像火场。')

    heading(doc, '8.2 地面残破贴图（血迹 / 尸骸 / 弹坑 / 碎木）', 2)
    bullet(doc, '尺寸：256×256 一张「贴图集」，里面画 8～12 个独立小块（弹坑 3 种、血泊 3 种、'
                '尸骸 2 种、碎木碎石 4 种），块与块之间留 4px 透明间隔。', 10)
    bullet(doc, '要**俯视角**（从上往下看），因为这些痕迹是平铺在地砖上的；不要画成立面侧视。', 10)
    bullet(doc, '背景必须是**纯透明**（不要棋盘格、不要白底），边缘要硬（像素风不能有半透明羽化）。', 10)
    bullet(doc, '尸骸要收敛：躺倒的人形剪影即可，深色军服，不要血浆喷溅、不要特写伤口'
                '（这是给学生看的思政课素材）。', 10)
    code_block(
        doc,
        '俯视角战场地面痕迹贴图集，透明背景，包含：三处炮弹坑（焦黑坑心、'
        '外圈翻起的褐色泥土、零星飞溅土粒）、三处暗红血泊（不规则边缘，颜色偏暗不发亮）、'
        '两具躺倒的清军士兵遗骸（深靛蓝军服、俯视剪影、身形简单）、'
        '若干碎木板与碎石块；复古像素画，16-bit，1px 深色描边，'
        '颜色限制在深棕、焦黑、暗红、灰蓝四系，无渐变 --ar 1:1 '
        '--no photorealistic, 3D render, blur, soft gradient, blood splatter close-up, gore, text, watermark'
    )

    heading(doc, '8.3 交接方式', 2)
    bullet(doc, '背景图：命名随意，发我即可，我会缩到 480×270 铺进 `Backdrop.backdropTexture()`。', 10)
    bullet(doc, '地面贴图集：请**不要压缩成 jpg**（会把透明底变成白底），png 直传。', 10)
    bullet(doc, '这两张到位后，程序占位版（现在这版烟、火光、弹坑都是代码画的）会被整块换掉，'
                '关卡数据不用动。', 10)

    # ---------------- 九、组合示例 ----------------
    heading(doc, '九、一条完整的示例（直接复制去出图）', 1)
    para(doc, '示例：出「英军蒸汽炮舰」的侧面图。')
    code_block(
        doc,
        '1840 年英国蒸汽炮舰，铁壳船体，三桅收帆，单根黑烟囱冒黑烟，船侧一排炮门，'
        '船首斜桁，侧面视角，深蓝灰铁色带锈迹，'
        + STYLE_PREFIX +
        ' --ar 2:1 --no photorealistic, 3D render, blur, gradient shading, text, watermark'
    )
    para(doc, '出完图之后给我（或在工程里替换），我会按 96×48 切好并接进游戏——'
              '炮舰的受击闪白、开炮后坐、血条位置都已经按这个尺寸预留好了。')

    doc.save(OUT)
    print('saved', OUT)


if __name__ == '__main__':
    build()