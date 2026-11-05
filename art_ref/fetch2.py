# -*- coding: utf-8 -*-
"""Fetch real OpenGameArt asset previews (the files in the page body, not the Drupal style thumbnails)."""
import urllib.request, os, zipfile, io

OUT = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36'}

S = 'https://opengameart.org/sites/default/files/'
files = {
    'spritesheet_2.png': 'platformer-pixel',
    'player-spritemap-v9.png': 'ars-notoria',
    'db32-Char.png': 'ars-notoria',
    'sword-slash-06-60x30.png': 'ars-notoria',
    'Items_1.png': 'items-elements',
    'castle_tileset_part1.png': 'castle',
    'castle_tileset_part2.png': 'castle',
    'castle_tileset_part3.png': 'castle',
    '11_fire_spritesheet.png': 'pixel-fx',
    'sample_27.png': 'smoke',
    'sample_4.png': 'platformer-pixel',
}
for fn, _ in files.items():
    try:
        d = urllib.request.urlopen(urllib.request.Request(S + fn, headers=UA), timeout=60).read()
        open(os.path.join(OUT, 'real_' + fn), 'wb').write(d)
        print('ok', fn, len(d))
    except Exception as e:
        print('ERR', fn, e)

# sunny land zip -> extract a couple of tilesets/spritesheets
try:
    d = urllib.request.urlopen(urllib.request.Request(S + 'sunny-land-files.zip', headers=UA), timeout=120).read()
    open(os.path.join(OUT, 'sunny-land-files.zip'), 'wb').write(d)
    z = zipfile.ZipFile(io.BytesIO(d))
    n = 0
    for info in z.infolist():
        low = info.filename.lower()
        if low.endswith(('.png', '.jpg')) and n < 12 and not info.is_dir():
            data = z.read(info)
            if len(data) < 20000:
                continue
            safe = info.filename.replace('/', '_')
            open(os.path.join(OUT, 'sun_' + safe), 'wb').write(data)
            print('extract', info.filename, len(data))
            n += 1
except Exception as e:
    print('ERR zip', e)