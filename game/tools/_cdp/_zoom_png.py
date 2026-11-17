"""临时工具：裁剪 + 最近邻放大一张 PNG（纯标准库，不依赖 PIL）。

用途：探针截图是 480×270 的原始 canvas，血条护甲层只有 1px，
直接看图判断不了「有没有画上去」。这里按像素放大 4 倍再人眼确认。

用法：python _zoom_png.py <src.png> <out.png> x y w h [scale]
"""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos = 8
    idat = bytearray()
    w = h = bd = ct = 0
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + ln
    assert bd == 8, f'unsupported bit depth {bd}'
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(bytes(idat))
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, out


def write_png(path, w, h, rgb):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * w * 3:(y + 1) * w * 3]
    comp = zlib.compress(bytes(raw), 6)

    def chunk(tag, body):
        return (struct.pack('>I', len(body)) + tag + body
                + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                           + chunk(b'IDAT', comp) + chunk(b'IEND', b''))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    x, y, cw, ch = (int(v) for v in sys.argv[3:7])
    scale = int(sys.argv[7]) if len(sys.argv) > 7 else 4
    w, h, bpp, px = read_png(src)
    cw = min(cw, w - x)
    ch = min(ch, h - y)
    out = bytearray(cw * scale * ch * scale * 3)
    ow = cw * scale
    for oy in range(ch * scale):
        sy = y + oy // scale
        for ox in range(ow):
            sx = x + ox // scale
            i = (sy * w + sx) * bpp
            r, g, b = px[i], px[i + 1], px[i + 2]
            a = px[i + 3] if bpp == 4 else 255
            # 透明区域铺深色底，避免放大后看不出边界
            if a < 255:
                r, g, b = (r * a + 13 * (255 - a)) // 255, (g * a + 11 * (255 - a)) // 255, (b * a + 20 * (255 - a)) // 255
            o = (oy * ow + ox) * 3
            out[o:o + 3] = bytes((r, g, b))
    write_png(dst, ow, ch * scale, out)
    print(f'{src} -> {dst}  crop=({x},{y},{cw},{ch}) scale={scale} out={ow}x{ch * scale}')


if __name__ == '__main__':
    main()
