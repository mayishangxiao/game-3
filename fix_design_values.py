# -*- coding: utf-8 -*-
"""
把设计书中与公式不符的两处数值改正（ATK(L)=round(10+2.2(L-1))）。
Lv37: round(10+2.2*36)=round(89.2)=89（原表误作 90）
Lv54: round(10+2.2*53)=round(126.6)=127（原表误作 126）
改完重新构建 DOCX，保证「设计书 = 代码」。
"""
import io, os, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

DESIGN = r"D:\game_project\game 3\design"

edits = {
    "05_systems.md": [
        ("| 37 | 748 | 90 | 47 | 第六章结束 |", "| 37 | 748 | 89 | 47 | 第六章结束 |"),
        ("| 54 | 1054 | 126 | 68 | 第十章结束（通关） |", "| 54 | 1054 | 127 | 68 | 第十章结束（通关） |"),
    ],
    "06_data.md": [
        ("| 8 | 226 | 25 | 12 | 37 | 748 | 90 | 47 |", "| 8 | 226 | 25 | 12 | 37 | 748 | 89 | 47 |"),
        ("| 27 | 568 | 67 | 35 | 54 | 1054 | 126 | 68 |", "| 27 | 568 | 67 | 35 | 54 | 1054 | 127 | 68 |"),
    ],
}

for fname, pairs in edits.items():
    p = os.path.join(DESIGN, fname)
    t = open(p, encoding="utf-8").read()
    for old, new in pairs:
        if old not in t:
            print(f"!! 未找到（{fname}）: {old}")
            continue
        t = t.replace(old, new)
        print(f"OK {fname}: {old.strip()}  ->  {new.strip()}")
    open(p, "w", encoding="utf-8", newline="").write(t)

# 在 6.4.1 表后补一句公式说明，避免以后再有人照着表反推错值
p = os.path.join(DESIGN, "05_systems.md")
t = open(p, encoding="utf-8").read()
anchor = "| 54 | 1054 | 127 | 68 | 第十章结束（通关） |"
addition = (
    anchor
    + "\n\n> **表值以公式为准**：`HP(L)=100+18(L−1)`、`ATK(L)=round(10+2.2(L−1))`、"
    "`DEF(L)=round(4+1.2(L−1))`。上表由公式直接算出；早期草稿在 Lv37（89）与 Lv54（127）"
    "两格存在四舍五入笔误，已更正，并已由单元测试锁定（`tests/balance.test.ts`）。"
)
if anchor in t and "表值以公式为准" not in t:
    t = t.replace(anchor, addition)
    open(p, "w", encoding="utf-8", newline="").write(t)
    print("OK 05_systems.md: 补充「表值以公式为准」说明")

# 重新构建文档
sys.path.insert(0, r"D:\game_project\game 3")
os.chdir(r"D:\game_project\game 3")
import build_docx  # noqa: E402
build_docx.main()