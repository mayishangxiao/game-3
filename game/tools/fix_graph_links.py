# -*- coding: utf-8 -*-
"""修 knowledge_all.json 的两处 links：去掉自指、补一座连通桥。

为什么要有这个脚本：图谱玩法不加新内容，全靠知识卡的 links 把已有事件卡连起来。
links 写错（自指、悬挂、漏写）时玩家会看到一座孤岛，而单元测试能直接抓到。
本脚本按实际缩进重排，并以无 BOM 的 UTF-8 写回（BOM 会让 JSON.parse 直接报错）。
"""
import re
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "public" / "data" / "knowledge" / "knowledge_all.json"
raw = p.read_bytes().decode("utf-8-sig")

LINKS = re.compile(r'(?P<ind>[ ]*)"links": \[(?P<body>[^\]]*)\]', re.S)

fixes = {
    # 1859 《资政新篇》原来自指，改为「与《天朝田亩制度》对比 + 天京陷落」
    ("ev_1859_zizheng", "ev_1864_limitation"): ["ev_1864_limitation", "ev_1864_tianjing_fall"],
    # 1842 《南京条约》→ 1851 金田起义：把「侵略」与「反抗」连成一条历史脉络
    ("ev_1840_war",): ["ev_1840_war", "ev_1851_jintian"],
}

done = []


def repl(m: re.Match) -> str:
    ids = tuple(re.findall(r'"([^"]+)"', m.group("body")))
    new = fixes.get(ids)
    if new is None:
        return m.group(0)
    ind = m.group("ind")
    item_ind = ind + " "
    body = "".join(f'{item_ind}"{i}",' for i in new[:-1])
    body += f'{item_ind}"{new[-1]}"'
    done.append((ids, new))
    return f'{ind}"links": [\n{body}\n{ind}]'


out = LINKS.sub(repl, raw)

missing = [k for k in fixes if k not in [d[0] for d in done]]
assert not missing, f"这些 links 没找到：{missing}"
assert out != raw, "没有任何改动"

p.write_bytes(out.encode("utf-8"))  # 无 BOM
print("rewritten:", p.stat().st_size, "bytes")
for old, new in done:
    print("  ", list(old), "->", new)