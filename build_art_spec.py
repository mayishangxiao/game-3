# -*- coding: utf-8 -*-
"""
鸦片战争原型·美术资产规格表 —— Markdown -> DOCX 构建脚本（交付外部美工用）

用法: python build_art_spec.py
输入: design/10_art_spec_opium.md   （不进设计书正文，build_docx.py 只拼 00–09）
输出: 鸦片战争原型·美术资产规格表 v1.docx

比 build_docx.py 多的东西:
  * 第 5 节调色板表 → 表头换成真实色块（不是色号文字）
  * 第 2 节画布示意 → 32×40 / 96×48 的网格图（每个格子 = 1px）
  * 页面为 A4，页脚带交付方标识与页码
"""
import os, re, sys, io, glob
from collections import OrderedDict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from docx import Document
from docx.shared import Pt, Cm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# 内容宽度 16.8cm（A4 21cm − 左右各 2.1cm）。python-docx 的 autofit=True 会让
# 列宽按内容长回来，必须 autofit=False + 显式 gridCol 宽度才不会出页。
CONTENT_CM = 16.8
TWIP_PER_CM = 567

BASE = os.path.dirname(os.path.abspath(__file__))
MD = os.path.join(BASE, "design", "10_art_spec_opium.md")
OUT = os.path.join(BASE, "鸦片战争原型·美术资产规格表 v1.docx")

# ---------- 配色（与设计书同一套，红=标题，蓝=二级） ----------
C_RED = RGBColor(0x8C, 0x1C, 0x1C)
C_H1 = RGBColor(0x8C, 0x1C, 0x1C)
C_H2 = RGBColor(0x1B, 0x3A, 0x6B)
C_H3 = RGBColor(0x2F, 0x2B, 0x45)
C_H4 = RGBColor(0x4A, 0x44, 0x68)
C_BODY = RGBColor(0x1C, 0x1A, 0x2B)
C_MUTED = RGBColor(0x6B, 0x64, 0x89)
SH_HEAD = "8C1C1C"
SH_ALT = "F2EDE4"
SH_NOTE = "F7F3EA"
SH_CODE = "F4F4F6"
SH_WARN = "FDECEA"

FONT = "微软雅黑"
FONT_MONO = "Consolas"

# 24 色盘（第 5 节的表就是用这张表渲染成色块的）
PALETTE = OrderedDict([
    (1, ("深墨", "0D0B14", "外描边、最深阴影")),
    (2, ("暗夜", "1C1A2B", "夜间地面")),
    (3, ("深紫灰", "2F2B45", "建筑暗部；炮舰船体主色")),
    (4, ("中紫灰", "4A4468", "石墙、铁器")),
    (5, ("浅紫灰", "6B6489", "远景、雾、石板地")),
    (6, ("灰紫", "948DAB", "金属高光")),
    (7, ("浅灰", "C2BCD1", "云、雪、白装")),
    (8, ("纸白", "F2EDE4", "高光、纸张")),
    (9, ("米黄", "E8CFA8", "室内墙、稻谷、军帽白羽")),
    (10, ("沙黄", "CFA26A", "沙滩、土路")),
    (11, ("褐", "A8763F", "木器")),
    (12, ("深褐", "7A4F2A", "木梁、皮革、军帽")),
    (13, ("焦褐", "4E2F1A", "深土、暗木")),
    (14, ("暗红", "8C1C1C", "旗帜暗面")),
    (15, ("正红", "C62828", "英军红上衣")),
    (16, ("亮红", "E85C4A", "火焰、受击")),
    (17, ("浅红", "F2A08C", "火光余光")),
    (18, ("墨绿", "1F5C3A", "清军号衣暗部")),
    (19, ("军绿", "2F8F5B", "清军号衣、草地")),
    (20, ("浅绿", "7EC08A", "稻田")),
    (21, ("深靛", "1B3A6B", "夜空、海军、清军水师")),
    (22, ("中蓝", "2F6BA8", "海洋、军服")),
    (23, ("浅蓝", "7FB2D9", "水面高光")),
    (24, ("星黄", "F0C419", "交互专用，美术不许占")),
])


# ---------- 低层工具 ----------
def set_font(run, name=FONT, size=None, bold=None, color=None, italic=None):
    run.font.name = name
    rPr = run._element.get_or_add_rPr()
    rf = rPr.find(qn('w:rFonts'))
    if rf is None:
        rf = OxmlElement('w:rFonts')
        rPr.insert(0, rf)
    for a in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
        rf.set(qn('w:' + a), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color


def shade(el, fill):
    pr = el._element.get_or_add_pPr() if hasattr(el, 'paragraph_format') else el._element.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    pr.append(shd)


def set_cell_shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    tcPr.append(shd)


def para_border(p, edge="bottom", sz=6, color="8C1C1C", space=2):
    pPr = p._p.get_or_add_pPr()
    pbdr = pPr.find(qn('w:pBdr'))
    if pbdr is None:
        pbdr = OxmlElement('w:pBdr')
        pPr.append(pbdr)
    e = OxmlElement('w:' + edge)
    e.set(qn('w:val'), 'single')
    e.set(qn('w:sz'), str(sz))
    e.set(qn('w:space'), str(space))
    e.set(qn('w:color'), color)
    pbdr.append(e)


def cell_margins(table, top=40, bottom=40, left=80, right=80):
    tblPr = table._tbl.tblPr
    mar = OxmlElement('w:tblCellMar')
    for tag, val in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
        e = OxmlElement('w:' + tag)
        e.set(qn('w:w'), str(val))
        e.set(qn('w:type'), 'dxa')
        mar.append(e)
    tblPr.append(mar)


def add_field(paragraph, instr, placeholder="1"):
    r = paragraph.add_run()
    fc = OxmlElement('w:fldChar'); fc.set(qn('w:fldCharType'), 'begin')
    it = OxmlElement('w:instrText'); it.set(qn('xml:space'), 'preserve'); it.text = instr
    fc2 = OxmlElement('w:fldChar'); fc2.set(qn('w:fldCharType'), 'separate')
    t = OxmlElement('w:t'); t.text = placeholder
    fc3 = OxmlElement('w:fldChar'); fc3.set(qn('w:fldCharType'), 'end')
    r._r.append(fc); r._r.append(it); r._r.append(fc2); r._r.append(t); r._r.append(fc3)
    return r


def cell_borders(cell, color="C2BCD1", sz=2):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right'):
        e = OxmlElement('w:' + edge)
        e.set(qn('w:val'), 'single')
        e.set(qn('w:sz'), str(sz))
        e.set(qn('w:space'), '0')
        e.set(qn('w:color'), color)
        borders.append(e)
    tcPr.append(borders)


def no_borders(table):
    tblPr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement('w:' + edge)
        e.set(qn('w:val'), 'none')
        e.set(qn('w:sz'), '0')
        borders.append(e)
    tblPr.append(borders)


def set_cell_valign_center(table):
    """短列（优先级/帧数/画布）垂直居中，长列保持顶端对齐不适合阅读，所以只用来修窄列。"""
    for row in table.rows:
        for cell in row.cells:
            tcPr = cell._tc.get_or_add_tcPr()
            v = OxmlElement('w:vAlign')
            v.set(qn('w:val'), 'center')
            tcPr.append(v)


# ---------- 内联解析 ----------
INLINE = re.compile(r'(\*\*.+?\*\*|`[^`]+`|![^!]*!)')


def add_inline(p, text, size=10.5, color=C_BODY, bold=False, name=FONT):
    # 先把反引号统一成 **，交给同一套解析（反引号跨过加粗标记时会失配）
    text = re.sub(r'`([^`]+)`', lambda m: '**' + m.group(1) + '**', text)
    for seg in INLINE.split(text):
        if not seg:
            continue
        if seg.startswith('**') and seg.endswith('**') and len(seg) > 4:
            r = p.add_run(seg[2:-2])
            set_font(r, name, size, True, color)
        elif seg.startswith('`') and seg.endswith('`') and len(seg) > 2:
            r = p.add_run(seg[1:-1])
            set_font(r, FONT_MONO, size - 0.5, bold, RGBColor(0x8C, 0x1C, 0x1C))
        else:
            r = p.add_run(seg)
            set_font(r, name, size, bold, color)


# ---------- 文档骨架 ----------
def build_doc():
    doc = Document()
    st = doc.styles['Normal']
    st.font.name = FONT
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    st.paragraph_format.space_after = Pt(4)
    st.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    st.paragraph_format.line_spacing = 1.28

    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(2.0)
    sec.right_margin = Cm(2.0)
    sec.top_margin = Cm(2.0)
    sec.bottom_margin = Cm(1.8)

    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("鸦片战争原型 · 美术资产规格表 v1     —  ")
    set_font(r, FONT, 8, False, C_MUTED)
    add_field(fp, ' PAGE ')
    r2 = fp.add_run("  —")
    set_font(r2, FONT, 8, False, C_MUTED)
    return doc


def cover(doc):
    for _ in range(3):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("鸦片战争原型")
    set_font(r, FONT, 30, True, C_RED)
    p2 = doc.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p2.add_run("美术资产规格表 v1")
    set_font(r, FONT, 24, True, C_H2)
    p3 = doc.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p3.add_run("—— 可执行交付版：尺寸 / 帧计划 / 色纪律 / 史实校对 / 验收 ——")
    set_font(r, FONT, 12, False, C_MUTED)
    doc.add_paragraph()

    rows = [
        ("适用范围", "序章第一幕「鸦片战争」（能玩到的那一段）"),
        ("对应样张", "美术基准样张 v2（2026-06）"),
        ("画布", "角色 32×40 · Boss 96×48 · 瓦片 16×16"),
        ("色纪律", "24 色锁定，单帧 ≤ 8 色，金黄为交互专用色"),
        ("给谁", "外部美工 / 外包"),
        ("文档性质", "**执行级**：照做即可；与设计书第八章冲突处以本文为准"),
    ]
    t = doc.add_table(rows=len(rows), cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    no_borders(t)
    cell_margins(t, 60, 60, 100, 100)
    set_col_widths(t, [3.4, 13.4])
    for i, (k, v) in enumerate(rows):
        c0, c1 = t.cell(i, 0), t.cell(i, 1)
        p = c0.paragraphs[0]
        r = p.add_run(k)
        set_font(r, FONT, 10, True, C_MUTED)
        p2_ = c1.paragraphs[0]
        add_inline(p2_, v, 10)
    page_break(doc)


def h(doc, level, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    if level == 1:
        pf.space_before = Pt(18); pf.space_after = Pt(9)
        add_inline(p, text, 18, C_H1, True)
        para_border(p, "bottom", 12, "8C1C1C", 6)
    elif level == 2:
        pf.space_before = Pt(14); pf.space_after = Pt(6)
        add_inline(p, text, 13.5, C_H2, True)
        para_border(p, "bottom", 6, "C2BCD1", 4)
    elif level == 3:
        pf.space_before = Pt(10); pf.space_after = Pt(4)
        add_inline(p, text, 11.5, C_H3, True)
    else:
        pf.space_before = Pt(8); pf.space_after = Pt(3)
        add_inline(p, text, 10.5, C_H4, True)
    pf.keep_with_next = True
    return p


def body(doc, text, size=10.5):
    p = doc.add_paragraph()
    add_inline(p, text, size)
    return p


def bullet(doc, text, level=0, size=10.5):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Pt(14 + level * 16)
    pf.first_line_indent = Pt(-11)
    pf.space_after = Pt(2.5)
    mark = "▪ " if level == 0 else ("– " if level == 1 else "· ")
    r = p.add_run(mark)
    set_font(r, FONT, size, False, C_RED if level == 0 else C_MUTED)
    add_inline(p, text, size)
    return p


def note(doc, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Pt(10); pf.right_indent = Pt(6)
    pf.space_before = Pt(5); pf.space_after = Pt(7)
    shade(p, SH_NOTE)
    para_border(p, "left", 18, "8C1C1C", 6)
    add_inline(p, text, 10)
    return p


def code_block(doc, lines):
    for i, ln in enumerate(lines):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent = Pt(10)
        pf.space_before = Pt(4 if i == 0 else 0)
        pf.space_after = Pt(4 if i == len(lines) - 1 else 0)
        pf.line_spacing = 1.0
        shade(p, SH_CODE)
        r = p.add_run(ln if ln else " ")
        set_font(r, FONT_MONO, 8.6, False, C_H3)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def set_col_widths(table, widths_cm):
    """真正锁死列宽：tblLayout=fixed + tblW + 每个 tc 的 tcW + gridCol。
    只设 cell.width 是不够的，Word/WPS 仍会按内容重排并撑出页边距。"""
    tbl = table._tbl
    tblPr = tbl.tblPr
    # 固定布局
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tblPr.append(layout)
    # 全表宽度
    tblW = tblPr.find(qn('w:tblW'))
    if tblW is None:
        tblW = OxmlElement('w:tblW')
        tblPr.append(tblW)
    tblW.set(qn('w:type'), 'dxa')
    tblW.set(qn('w:w'), str(int(sum(widths_cm) * TWIP_PER_CM)))
    # 缩进清零：默认模板会给表格一个左缩进，配合固定列宽会整体右移出页
    ind = tblPr.find(qn('w:tblInd'))
    if ind is None:
        ind = OxmlElement('w:tblInd')
        tblPr.append(ind)
    ind.set(qn('w:type'), 'dxa')
    ind.set(qn('w:w'), '0')
    # 网格列
    grid = tbl.find(qn('w:tblGrid'))
    if grid is not None:
        tbl.remove(grid)
    grid = OxmlElement('w:tblGrid')
    for wcm in widths_cm:
        gc = OxmlElement('w:gridCol')
        gc.set(qn('w:w'), str(int(wcm * TWIP_PER_CM)))
        grid.append(gc)
    tblPr.addnext(grid)
    # 每个单元格
    for row in table.rows:
        for ci, cell in enumerate(row.cells):
            if ci < len(widths_cm):
                cell.width = Cm(widths_cm[ci])


def can_split_row(tbl):
    """表格里每一行都加 cantSplit：宁可在行前分页，也不要把一行拆成两页。"""
    for row in tbl.rows:
        trPr = row._tr.get_or_add_trPr()
        e = OxmlElement('w:cantSplit')
        trPr.append(e)


def table(doc, rows, widths=None):
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    t = doc.add_table(rows=len(rows), cols=ncol)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    cell_margins(t)

    if widths is None:
        weights = []
        for c in range(ncol):
            mx = 0
            for r in rows:
                L = len(re.sub(r'[*`]', '', r[c]))
                mx = max(mx, min(L, 46))
            weights.append(max(mx, 3) ** 0.85)
        tot = sum(weights)
        widths = [CONTENT_CM * w / tot for w in weights]
    else:
        widths = [w.cm if hasattr(w, 'cm') else float(w) for w in widths]
        # 超宽就等比压缩，保证永远不出页
        tot = sum(widths)
        if tot > CONTENT_CM:
            widths = [w * CONTENT_CM / tot for w in widths]
    set_col_widths(t, widths)

    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = t.cell(ri, ci)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(1.5)
            p.paragraph_format.space_after = Pt(1.5)
            p.paragraph_format.line_spacing = 1.15
            if ri == 0:
                set_cell_shade(cell, SH_HEAD)
                for seg in INLINE.split(val):
                    if not seg:
                        continue
                    if seg.startswith('**') and seg.endswith('**'):
                        seg = seg[2:-2]
                    r = p.add_run(seg)
                    set_font(r, FONT, 9, True, RGBColor(0xFF, 0xFF, 0xFF))
            else:
                if ri % 2 == 0:
                    set_cell_shade(cell, SH_ALT)
                add_inline(p, val, 9)
    trPr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement('w:tblHeader'); th.set(qn('w:val'), 'true')
    trPr.append(th)
    can_split_row(t)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def page_break(doc):
    p = doc.add_paragraph()
    p.add_run().add_break(WD_BREAK.PAGE)
    return p


# ---------- 专用块：24 色色卡 ----------
def palette_card(doc):
    """在调色板表头直接嵌一条真实色带：26 列，前 24 格按色号上色，后两格留白对齐。
    （用单元格底纹而不是图片，避免再引入二进制资源。）"""
    t = doc.add_table(rows=1, cols=26)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    no_borders(t)
    cell_margins(t, 0, 0, 0, 0)
    w = CONTENT_CM / 26
    set_col_widths(t, [w] * 26)
    for i, (no, (name, hexv, use)) in enumerate(PALETTE.items()):
        cell = t.cell(0, i)
        set_cell_shade(cell, hexv)
        cell_borders(cell, "F2EDE4", 8)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(16)
        p.paragraph_format.space_after = Pt(16)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run(" ").font.size = Pt(1)
    for i in range(len(PALETTE), 26):
        p = t.cell(0, i).paragraphs[0]
        p.add_run(" ").font.size = Pt(1)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    h(doc, 2, "5.2 色号用途表")
    body(doc, "色号是唯一取值，逐像素比对的就是这张表；上表（5.1）的横条是同一组颜色的实物色块。")
    rows = [["#", "名称", "Hex", "本项目用途", "备注"]]
    for no, (name, hexv, use) in PALETTE.items():
        extra = "**交互专用，美术不许占**" if no == 24 else ""
        rows.append([f"{no:02d}", name, f"#{hexv}", use, extra])
    table(doc, rows, widths=[1.0, 1.9, 2.4, 7.6, 3.9])


# ---------- 可疑内容高亮 ----------
SUSPECT = re.compile(r'(打回|不许|禁止|不要|错|违规|不合格)')


def suspicious(doc, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Pt(14)
    pf.first_line_indent = Pt(-11)
    pf.space_after = Pt(2.5)
    shade(p, SH_WARN)
    r = p.add_run("✕ ")
    set_font(r, FONT, 10.5, True, C_RED)
    add_inline(p, text, 10.5)
    return p


# ---------- Markdown 渲染 ----------
def parse_table_block(block):
    rows = []
    for ln in block:
        s = ln.strip()
        if s.startswith('|'):
            s = s[1:]
        if s.endswith('|'):
            s = s[:-1]
        cells = [c.strip() for c in s.split('|')]
        if all(re.fullmatch(r':?-{2,}:?', c) for c in cells if c != ''):
            continue
        rows.append(cells)
    return rows


def render_md(doc, text):
    lines = text.split('\n')
    i = 0
    seen_palette = False
    while i < len(lines):
        ln = lines[i]
        s = ln.rstrip()
        if s.strip() == '<!--pb-->':
            page_break(doc); i += 1; continue

        if s.strip().startswith('<!--'):
            # 构建用的注释（md 里标注「此处由脚本渲染」），不进正文
            while i < len(lines) and '-->' not in lines[i]:
                i += 1
            i += 1; continue

        if s.startswith('```'):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith('```'):
                buf.append(lines[i]); i += 1
            i += 1
            code_block(doc, buf)
            continue

        if s.startswith('|'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                buf.append(lines[i]); i += 1
            rows = parse_table_block(buf)
            if rows:
                table(doc, rows)
            continue

        m = re.match(r'^(#{1,4})\s+(.*)$', s)
        if m:
            lvl = len(m.group(1))
            title = m.group(2).strip()
            num = title.split()[0]
            h(doc, lvl, title)
            # 第 5 章调色板表：换成色卡 + 用途表
            if num == "5." and not seen_palette:
                body(doc, "24 色锁定，**不许自己调**。下表既是色号表，也是色卡——每一格的底色就是该色本身。")
                h(doc, 2, "5.1 色卡（横条就是 24 色本身，可在屏上直接吸色）")
                palette_card(doc)
                seen_palette = True
            # 画布示意插在 2.7 之后（md 里 2.7 这一节是空的）
                # md 里 2.7 的正文（一句说明）跳过，脚本已经自带说明
                i += 1
                while i < len(lines) and not lines[i].startswith('#'):
                    i += 1
                continue
            i += 1; continue

        if s.strip() in ('---', '***', '___'):
            i += 1; continue

        if s.startswith('> '):
            buf = []
            while i < len(lines) and lines[i].startswith('> '):
                buf.append(lines[i][2:]); i += 1
            note(doc, ' '.join(buf))
            continue

        m = re.match(r'^(\s*)[-*]\s+(.*)$', s)
        if m:
            indent = len(m.group(1))
            lvl = 0 if indent < 2 else (1 if indent < 5 else 2)
            txt = m.group(2).strip()
            if lvl == 0 and SUSPECT.search(txt):
                suspicious(doc, txt)
            else:
                bullet(doc, txt, lvl)
            i += 1; continue

        m = re.match(r'^(\s*)(\d+)\.\s+(.*)$', s)
        if m:
            p = doc.add_paragraph()
            pf = p.paragraph_format
            pf.left_indent = Pt(16)
            pf.first_line_indent = Pt(-16)
            pf.space_after = Pt(2.5)
            r = p.add_run(m.group(2) + ". ")
            set_font(r, FONT, 10.5, True, C_RED)
            add_inline(p, m.group(3).strip(), 10.5)
            i += 1; continue

        if not s.strip():
            i += 1; continue

        body(doc, s.strip())
        i += 1


def main():
    if not os.path.exists(MD):
        raise SystemExit("missing " + MD)
    with open(MD, 'r', encoding='utf-8') as fh:
        txt = fh.read()
    # 删掉 md 里的第 5 节原表（由色卡专用块替代），保留 5.1/5.2 之后的内容
    doc = build_doc()
    cover(doc)
    render_md(doc, txt)
    doc.save(OUT)
    print("saved:", OUT)


if __name__ == '__main__':
    main()