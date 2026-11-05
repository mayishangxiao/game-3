import urllib.request, re, os, json

OUT = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36'}

urls = {
    'sunny-land': 'https://opengameart.org/content/sunny-land-2d-pixel-art-pack',
    'platformer-pixel': 'https://opengameart.org/content/platformer-art-pixel-edition',
    'ars-notoria': 'https://opengameart.org/content/hero-spritesheets-ars-notoria',
    'items-elements': 'https://opengameart.org/content/items-and-elements',
    'pixel-fx': 'https://opengameart.org/content/free-pixel-effects-pack',
    'castle-tileset': 'https://opengameart.org/content/pixel-art-castle-tileset',
    'smoke': 'https://opengameart.org/content/smoke-particle-assets',
}

def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()

out = {}
for name, url in urls.items():
    html = get(url).decode('utf-8', 'ignore')
    # the main preview image sits inside the node header / field-name-field-art-image
    blocks = re.findall(r'(?:field-name-field-art-image|content=\"[^\"]*\"[^>]*).{0,1500}?', html, re.S)
    cands = []
    for m in re.finditer(r'<img[^>]+src=\"(https?://opengameart\.org/sites/default/files/[^\"]+)\"', html):
        s = m.group(1)
        if '/styles/' in s and not re.search(r'patreon|cover', s, re.I):
            cands.append(s)
    got = []
    for i, s in enumerate(dict.fromkeys(cands)):
        big = re.sub(r'/styles/[^/]+/public/', '/', s)
        fn = f'_real_{name}_{i}' + (os.path.splitext(big.split('?')[0])[1] or '.png')
        try:
            data = get(big)
            if len(data) < 4000:
                continue
            with open(os.path.join(OUT, fn), 'wb') as f:
                f.write(data)
            got.append(fn)
        except Exception as e:
            pass
    out[name] = got
    print(name, got)

json.dump(out, open(os.path.join(OUT, 'real_previews.json'), 'w', encoding='utf-8'), indent=1)