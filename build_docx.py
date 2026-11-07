# -*- coding: utf-8 -*-
"""
党史像素RPG游戏·第一章设计书 —— Markdown -> DOCX 构建脚本
用法: python build_docx.py
"""
import os, re, sys, io, glob

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from docx import Document
from docx.shared import Pt, Cm, RGBColor, Emu, Twips
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn, nsmap
from docx.oxml import OxmlElement

BASE = os.path.dirname(os.path.abspath(__file__))
MD_DIR = os.path.join(BASE, "design")
OUT = os.path.join(BASE, "党史像素RPG游戏·第一章设计书 v2.1.docx")

# ---------- 配色 ----------
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

FONT = "微软雅黑"
FONT_MONO = "Consolas"


def set_font(run, name=FONT, size=None, bold=None, color=None, italic=None):
    run.font.name = name
    rPr = run._element.get_or_add_rPr()
    rf = rPr.find(qn('w:rFonts'))
    if rf is None:
        rf = OxmlElement('w:rFonts')
        rPr.insert(0, rf)
    rf.set(qn('w:ascii'), name)
    rf.set(qn('w:hAnsi'), name)
    rf.set(qn('w:eastAsia'), name)
    rf.set(qn('w:cs'), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color


def shade(el, fill):
    """给段落或单元格加底纹"""
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


# ---------- 内联解析 ----------
INLINE = re.compile(r'(\*\*.+?\*\*|`[^`]+`)')


def add_inline(p, text, size=10.5, color=C_BODY, bold=False, name=FONT):
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
    sec.left_margin = Cm(2.2)
    sec.right_margin = Cm(2.0)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.0)

    # 页脚页码
    footer = sec.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("党史像素 RPG 游戏 · 第一章设计书 v2.1     —  ")
    set_font(r, FONT, 8, False, C_MUTED)
    add_field(fp, ' PAGE ')
    r2 = fp.add_run("  —")
    set_font(r2, FONT, 8, False, C_MUTED)
    return doc


def h(doc, level, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    if level == 1:
        pf.space_before = Pt(20); pf.space_after = Pt(10)
        add_inline(p, text, 19, C_H1, True)
        para_border(p, "bottom", 12, "8C1C1C", 6)
    elif level == 2:
        pf.space_before = Pt(15); pf.space_after = Pt(7)
        add_inline(p, text, 14.5, C_H2, True)
        para_border(p, "bottom", 6, "C2BCD1", 4)
    elif level == 3:
        pf.space_before = Pt(11); pf.space_after = Pt(5)
        add_inline(p, text, 12, C_H3, True)
    else:
        pf.space_before = Pt(8); pf.space_after = Pt(4)
        add_inline(p, text, 10.8, C_H4, True)
    pf.keep_with_next = True
    return p


def body(doc, text, indent=0, size=10.5):
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Pt(0)
    if indent:
        p.paragraph_format.left_indent = Pt(indent)
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
        set_font(r, FONT_MONO, 8.6, False, RGBColor(0x2F, 0x2B, 0x45))
    return


def table(doc, rows, widths=None):
    """rows[0] 为表头"""
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    t = doc.add_table(rows=len(rows), cols=ncol)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    cell_margins(t)
    # 固定布局：否则 Word/LO 会按内容重算列宽，多列表格会顶出版心
    tblPr = t._tbl.tblPr
    layout = OxmlElement('w:tblLayout'); layout.set(qn('w:type'), 'fixed'); tblPr.append(layout)

    # 列宽：按内容长度加权。可用宽度必须扣掉每格左右内边距（80+80 dxa = 160 twips），
    # 否则 6 列表格光内边距就要吃掉 1.7 cm，右侧一列会被切在版心外。
    avail = Cm(16.8).twips - ncol * 160
    if widths is None:
        weights = []
        for c in range(ncol):
            mx = 0
            for r in rows:
                L = len(re.sub(r'[*`]', '', r[c]))
                mx = max(mx, min(L, 46))
            weights.append(max(mx, 3) ** 0.85)
    else:
        weights = list(widths)
    tot = sum(weights)
    widths = [max(560, int(avail * w / tot)) for w in weights]
    # 取整可能留下几 twips 余量，全部补给最宽的一列
    widths[widths.index(max(widths))] += avail - sum(widths)
    grid = t._tbl.find(qn('w:tblGrid'))
    if grid is not None:
        for gc, w in zip(grid.findall(qn('w:gridCol')), widths):
            gc.set(qn('w:w'), str(w))

    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = t.cell(ri, ci)
            cell.width = Twips(widths[ci])
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
    # 表头重复
    trPr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement('w:tblHeader'); th.set(qn('w:val'), 'true')
    trPr.append(th)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def page_break(doc):
    p = doc.add_paragraph()
    p.add_run().add_break(WD_BREAK.PAGE)
    return p


# ---------- Markdown 解析 ----------
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


def render_md(doc, text, first_h1_break=True):
    lines = text.split('\n')
    i = 0
    first_h1 = True
    while i < len(lines):
        ln = lines[i]
        s = ln.rstrip()

        if s.strip() == '<!--pb-->':
            page_break(doc); i += 1; continue

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
            if lvl == 1:
                if not (first_h1 and not first_h1_break):
                    page_break(doc)
                first_h1 = False
            h(doc, lvl, m.group(2).strip())
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
            bullet(doc, m.group(2).strip(), lvl)
            i += 1; continue

        m = re.match(r'^(\s*)(\d+)\.\s+(.*)$', s)
        if m:
            indent = len(m.group(1))
            p = doc.add_paragraph()
            pf = p.paragraph_format
            pf.left_indent = Pt(16 + (0 if indent < 2 else 16))
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
    doc = build_doc()
    # 只取 00_*.md … 09_*.md；README.md 是给人看的工作区导航，10_ 之后是独立交付物（美术规格表），
    # 都不进设计书 —— 前缀只认「两位数字且 < 10」
    files = [f for f in sorted(glob.glob(os.path.join(MD_DIR, "*.md")))
             if os.path.basename(f)[:2].isdigit() and int(os.path.basename(f)[:2]) < 10]
    if not files:
        raise SystemExit("no markdown found in " + MD_DIR)
    for idx, f in enumerate(files):
        with open(f, 'r', encoding='utf-8') as fh:
            txt = fh.read()
        if idx > 0:
            pass
        render_md(doc, txt, first_h1_break=(idx > 0))
    doc.save(OUT)
    print("saved:", OUT)
    print("files:", [os.path.basename(x) for x in files])


if __name__ == '__main__':
    main()