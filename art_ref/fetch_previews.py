import urllib.request, re, os, json, sys

OUT = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36'}

pages = [
    ('sunny-land', 'sunny-land-2d-pixel-art-pack'),
    ('platformer-pixel', 'platformer-art-pixel-edition'),
    ('ars-notoria', 'hero-spritesheets-ars-notoria'),
    ('items-elements', 'items-and-elements'),
    ('pixel-fx', 'free-pixel-effects-pack'),
    ('castle-tileset', 'pixel-art-castle-tileset'),
    ('smoke', 'smoke-particle-assets'),
]

def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()

result = []
for name, slug in pages:
    url = 'https://opengameart.org/content/' + slug
    try:
        html = get(url).decode('utf-8', 'ignore')
    except Exception as e:
        result.append({'name': name, 'err': str(e)})
        continue
    imgs = re.findall(r'<img[^>]+src="([^"]+)"', html)
    prevs = []
    for s in imgs:
        if '/styles/' in s and 'preview' not in s.lower() and 'patreon' not in s.lower():
            # upgrade to large style
            big = re.sub(r'/styles/[^/]+/public/', '/', s)
            prevs.append(big)
    # attachments list for size info
    att = re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+\.(?:zip|png|rar|7z))"[^>]*>([^<]*)<', html, re.I)
    entry = {'name': name, 'page': url, 'previews': [], 'attachments': [{'url': a[0], 'label': a[1].strip()} for a in att][:12]}
    seen = set()
    for i, p in enumerate(prevs):
        if p in seen:
            continue
        seen.add(p)
        ext = os.path.splitext(p.split('?')[0])[1] or '.png'
        fn = f'{name}_{i}{ext}'
        try:
            data = get(p)
            with open(os.path.join(OUT, fn), 'wb') as f:
                f.write(data)
            entry['previews'].append(fn)
        except Exception as e:
            entry['previews'].append('ERR ' + str(e))
    result.append(entry)

with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=1)

for e in result:
    print(e.get('name'), '| previews:', len(e.get('previews', [])) if isinstance(e.get('previews'), list) else e, '| att:', len(e.get('attachments', [])), e.get('err', ''))