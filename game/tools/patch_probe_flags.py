# -*- coding: utf-8 -*-
"""给需要打线上裸 IP(http://39.103.58.244) 的探针统一加 Chromium 关 HTTPS-First 升级的 flag。

不加的后果：Chromium 会把 http://IP 的导航先升级成 https://IP，连不上就直接停在
chrome-error://chromewebdata/，探针表现为「等待超时: __dshGame」或
「SecurityError: Failed to read the 'localStorage' property」——看着像游戏坏了，其实页面根本没加载。

注意：stdout 只打 ASCII。本机控制台是 GBK，打对勾之类的字符会 UnicodeEncodeError 把脚本打断在半路。
"""
import io

FILES = [
    r"D:\game_project\game 3\game\tools\_cdp\salvo.mjs",
    r"D:\game_project\game 3\game\tools\_cdp\touch.mjs",
    r"D:\game_project\game 3\game\tools\cdp-e2e.mjs",
    r"D:\game_project\game 3\game\tools\mobile-probe.mjs",
]
NEEDLE = "'--disable-gpu',"
FLAG = "'--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstModeV2ForDesktop',"

for p in FILES:
    s = io.open(p, encoding="utf-8").read()
    name = p.rsplit("\\", 1)[-1]
    if FLAG in s:
        print(name + ": already")
        continue
    if NEEDLE not in s:
        print(name + ": NEEDLE NOT FOUND")
        continue
    s = s.replace(NEEDLE, NEEDLE + "\n      " + FLAG, 1)
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print(name + ": patched")
