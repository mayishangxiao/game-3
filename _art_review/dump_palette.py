import re
src = open(r"src/core/constants.ts", encoding="utf-8").read()
m = re.search(r"export const PALETTE\s*=\s*\{(.*?)\}\s*as const", src, re.S)
body = m.group(1)
cols = re.findall(r"0x([0-9a-fA-F]{6})", body)
with open(r"tools/_art_review/palette.txt", "w", encoding="utf-8") as f:
    for c in cols:
        f.write("#" + c.upper() + "\n")
print("PALETTE 色数:", len(cols))
print("前 6:", cols[:6])
