# -*- coding: utf-8 -*-
"""
把 Sunny Land（CC0 / Pixel Frog）的场景道具落到工程里。

做三件事：
  1. 从 art_ref/sunny-land-files.zip 里取出 PNG/environment/props/*.png，
     按原像素尺寸（最近邻，不重采样）复制进 game/public/art/props/
  2. 覆盖亮品红/亮绿的「色键底」——少数道具（crate/block 等）是 RGB 不透明图，
     原包里矿箱的底是纯品红，直接搬进去会在游戏里露出一块粉红色
  3. 生成 art_ref/art_credits.json：来源 + 许可 + 原始尺寸，供 tests/docs 与致谢用

不重采样是刻意的：这些道具本来就是 16/22/32 px 的像素图，任何缩放都会糊。
"""
import io
import json
import os
import zipfile

from PIL import Image

ROOT = r'D:\game_project\game 3'
ZIP = os.path.join(ROOT, 'art_ref', 'sunny-land-files.zip')
DST = os.path.join(ROOT, 'game', 'public', 'art', 'props')
PREFIX = 'Sunny-land-assets-files/PNG/environment/props/'

# 需要搬的道具（其余留给以后：tree/house 太大、face-block 是关卡装饰）
WANT = [
    'crate', 'big-crate', 'block', 'block-big', 'door', 'door-opened',
    'rock', 'bush', 'skulls', 'spike-skull', 'sign', 'shrooms', 'spikes',
]


def key_out(im: Image.Image) -> Image.Image:
    """把「品红底」抠成透明。只动明显是色键的像素（高饱和品红/亮绿），不碰画面本体。"""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            magenta = r > 200 and b > 200 and g < 90
            lgreen = g > 200 and r < 120 and b < 120
            if magenta or lgreen:
                px[x, y] = (0, 0, 0, 0)
    return im


def main() -> None:
    os.makedirs(DST, exist_ok=True)
    z = zipfile.ZipFile(ZIP)
    names = {os.path.splitext(n[len(PREFIX):])[0]: n for n in z.namelist() if n.startswith(PREFIX)}
    credits = []
    for want in WANT:
        if want not in names:
            print('MISS', want)
            continue
        raw = z.read(names[want])
        try:
            im = Image.open(io.BytesIO(raw))
        except Exception as e:
            print('SKIP(non-image)', want, e)
            continue
        im = key_out(im)
        out = os.path.join(DST, f'sunny_{want.replace("-", "_")}.png')
        im.save(out)
        credits.append({
            'file': f"art/props/sunny_{want.replace('-', '_')}.png",
            'source': want + '.png',
            'w': im.size[0],
            'h': im.size[1],
        })
        print('ok', out, im.size)

    meta = {
        'pack': 'Sunny Land 2D Pixel Art Pack',
        'author': 'Pixel Frog (Ansimuz)',
        'license': 'CC0 1.0',
        'page': 'https://opengameart.org/content/sunny-land-2d-pixel-art-pack',
        'note': '仅取 PNG/environment/props/ 下的场景道具，原像素尺寸复制（最近邻/零缩放）。',
        'files': credits,
    }
    with open(os.path.join(ROOT, 'art_ref', 'art_credits.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print('credits written', len(credits))


if __name__ == '__main__':
    main()