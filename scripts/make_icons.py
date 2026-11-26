"""앱 아이콘(북마크·홈 화면)을 그립니다: 검정 바탕, 흰 C, 빨간 사선.

외부 라이브러리 없이 도형을 4배 크기로 샘플링해 PNG로 저장합니다.
python scripts/make_icons.py 로 icons/ 폴더를 다시 만들 수 있어요.
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
BG, WHITE, RED = (17, 17, 17), (255, 255, 255), (210, 10, 10)
SLASH = [(0.585, 0.80), (0.705, 0.80), (0.875, 0.20), (0.755, 0.20)]


def in_poly(x, y, pts):
    inside = False
    for i in range(len(pts)):
        (x1, y1), (x2, y2) = pts[i], pts[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def color_at(x, y):
    """0~1 좌표의 색."""
    if in_poly(x, y, SLASH):
        return RED
    dx, dy = x - 0.43, y - 0.5
    r = math.hypot(dx, dy)
    ang = abs(math.degrees(math.atan2(dy, dx)))
    if 0.165 <= r <= 0.305 and ang > 48:
        return WHITE
    return BG


def render(size, scale=1.0, ss=4):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    u = (px + (sx + .5) / ss) / size
                    v = (py + (sy + .5) / ss) / size
                    u, v = (u - .5) / scale + .5, (v - .5) / scale + .5
                    c = color_at(u, v)
                    for i in range(3):
                        acc[i] += c[i]
            row += bytes(round(a / ss / ss) for a in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = {"icon-32.png": (32, 1.0), "apple-touch-icon.png": (180, 0.92), "icon-192.png": (192, 1.0),
            "icon-512.png": (512, 1.0), "icon-maskable-512.png": (512, 0.78)}
    for name, (size, scale) in jobs.items():
        with open(os.path.join(OUT, name), "wb") as fh:
            fh.write(render(size, scale))
        print(name)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
           '<rect width="100" height="100" fill="#111"/>'
           '<path d="M%.2f %.2fA30.5 30.5 0 1 0 %.2f %.2fL%.2f %.2fA16.5 16.5 0 1 1 %.2f %.2fZ" fill="#fff"/>'
           '<path d="M58.5 80h12L87.5 20h-12z" fill="#D20A0A"/></svg>')
    a = math.radians(48)
    p = lambda r, s: (43 + r * math.cos(a), 50 + s * r * math.sin(a))
    o1, o2, i2, i1 = p(30.5, -1), p(30.5, 1), p(16.5, 1), p(16.5, -1)
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg % (*o1, *o2, *i2, *i1))
    print("icon.svg")


if __name__ == "__main__":
    main()
