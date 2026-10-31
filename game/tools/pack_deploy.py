"""把 dist 打成 Linux 友好的 zip（正斜杠路径，根目录平铺）。

PowerShell 的 Compress-Archive 会写反斜杠，Linux 解压后文件名会变成 `dist\\index.html`，
nginx 找不到文件。这里用 Python zipfile 逐条写入，arcname 用 '/'。
"""
from __future__ import annotations

import os
import sys
import zipfile

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_stage")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_deploy_game.zip")

SKIP_DIRS = {"_deploy", "_stage"}


def main() -> int:
    if not os.path.isdir(SRC):
        print(f"staging dir missing: {SRC}", file=sys.stderr)
        return 2

    if os.path.exists(OUT):
        os.remove(OUT)

    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk(SRC):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, SRC).replace(os.sep, "/")
                z.write(full, rel)
                count += 1

    size = os.path.getsize(OUT)
    print(f"packed {count} files -> {OUT} ({size/1024/1024:.2f} MB)")
    with zipfile.ZipFile(OUT) as z:
        bad = [n for n in z.namelist() if "\\" in n]
        print(f"entries={len(z.namelist())} backslash_names={len(bad)} has_index={'index.html' in z.namelist()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())