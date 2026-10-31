"""生成远景条 + 让 sky_rows 那几行真的走不进去。"""
from PIL import Image
import json
import os

SRC = 'tools/_art_in'
BG_OUT = 'public/art/bg'
os.makedirs(BG_OUT, exist_ok=True)

# ---------- 远景条：全景 960x540 的 y=120..260（天空下沿 + 全部舰影 + 水线）压到 480x64 ----------
for name in ('night', 'red'):
    src = Image.open(os.path.join(SRC, 'bg_%s.png' % name)).convert('RGB')
    strip = src.crop((0, 120, 960, 260)).resize((480, 64), Image.NEAREST)
    dst = os.path.join(BG_OUT, 'bg_strip_%s.png' % name)
    strip.save(dst)
    print('strip ->', dst, strip.size)

# ---------- 地图：sky_rows 那几行必须是墙 ----------
SKY_ROWS = 4
for name in sorted(os.listdir('public/data/maps')):
    if not name.endswith('.json'):
        continue
    path = os.path.join('public/data/maps', name)
    with open(path, encoding='utf-8') as f:
        m = json.load(f)
    sky = m.get('sky_rows', 0)
    before = sky
    if sky:
        m['sky_rows'] = SKY_ROWS
        # 碰撞层顶上前 SKY_ROWS 行改成实心，避免玩家走进远景带（看着像站在天上/水面上）
        for layer in m['layers']:
            if layer.get('name') != 'collision':
                continue
            rows = layer['data']
            for y in range(SKY_ROWS):
                if y < len(rows):
                    rows[y] = [max(1, v) if v == 0 else v for v in rows[y]]
    with open(path, 'w', encoding='utf-8', newline='') as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('%-26s sky_rows %s -> %s  scars=%s' % (name, before, m.get('sky_rows', 0), m.get('battle_scars', False)))