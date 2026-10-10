#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Draw the site's icon from the pixel map below and write it in the three forms browsers ask for:

  site/make_favicon.py

  frontend/public/favicon.svg            the tab icon, 32x32 pixels drawn as rectangles
  frontend/public/favicon.ico            the same as a 32x32 PNG inside an ICO, for browsers without SVG icons
  frontend/public/apple-touch-icon.png   180x180, square: iOS rounds the corners itself

An original drawing, not id Software's art: a skull whose teeth are a keyboard (C D E F, with C# and D#).
Edit the map or the colours, run this, and commit the three files. Nothing here needs more than Python.
"""
import struct
import zlib
from pathlib import Path

PUB = Path(__file__).resolve().parent / "frontend" / "public"

MAP = """
................................
................................
................................
................................
..........BBBBBBBBBBB...........
........BBBBBBBBBBBBBBB.........
......BBBBBBBBBBBBBBBBBBB.......
.....BBBBBBBBBBBBBBBBBBBBB......
....BBBBBBBBBBBBBBBBBBBBBBB.....
....BBBDDDBBBBBBBBBBBDDDBBB.....
....BBBDDDDDBBBBBBBDDDDDBBB.....
....BBBDDAADDBBBBBDDAADDBBB.....
....BBBDDAADDBBBBBDDAADDBBB.....
....BBBDDDDDDBBBBBDDDDDDBBB.....
....BBBBDDDDBBBBBBBDDDDBBBB.....
....BBBBBBBBBBDDDBBBBBBBBBB.....
....BBBBBBBBBBDDDBBBBBBBBBB.....
.....BBBBBBBBBBDBBBBBBBBBB......
......BBBBBBBBBBBBBBBBBBB.......
......BDBBDDDBDDDBBDBBBDB.......
......BDBBDDDBDDDBBDBBBDB.......
......BDBBDDDBDDDBBDBBBDB.......
......BDBBBDBBBDBBBDBBBDB.......
......BDBBBDBBBDBBBDBBBDB.......
......BDDDDDDDDDDDDDDDDDB.......
......BBBBBBBBBBBBBBBBBBB.......
.......BBBBBBBBBBBBBBBBB........
.........BBBBBBBBBBBBB..........
................................
................................
................................
................................
"""
COLOURS = {
    ".": "#d4331c",  # ground: the page's red (--red)
    "B": "#ece5d9",  # bone: the page's ink (--ink)
    "D": "#0b0a09",  # sockets, nose, the keys' well and the black keys: the page's ground (--bg)
    "A": "#ffc44d",  # the eyes
}
RADIUS = 6  # of the tab icon's rounded square, in pixels

ROWS = MAP.strip("\n").split("\n")
N = len(ROWS)
assert N == 32 and all(len(r) == N for r in ROWS), "the map is 32 x 32"


def rgb(hexcolour):
    return tuple(int(hexcolour[i : i + 2], 16) for i in (1, 3, 5))


def svg():
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}" shape-rendering="crispEdges">',
        f'<rect width="{N}" height="{N}" rx="{RADIUS}" fill="{COLOURS["."]}" shape-rendering="geometricPrecision"/>',
    ]
    for y, row in enumerate(ROWS):
        x = 0
        while x < N:
            c = row[x]
            end = x
            while end < N and row[end] == c:
                end += 1
            if c != ".":
                out.append(f'<rect x="{x}" y="{y}" width="{end - x}" height="1" fill="{COLOURS[c]}"/>')
            x = end
    out.append("</svg>")
    return "".join(out) + "\n"


def corner_alpha(x, y, size, radius):
    """How much of pixel (x, y) lies inside a rounded square, sampled 4 x 4."""
    inside = 0
    for sy in range(4):
        for sx in range(4):
            px, py = x + (sx + 0.5) / 4, y + (sy + 0.5) / 4
            cx = min(max(px, radius), size - radius)
            cy = min(max(py, radius), size - radius)
            inside += (px - cx) ** 2 + (py - cy) ** 2 <= radius**2
    return round(255 * inside / 16)


def png(width, height, pixels):
    """pixels: rows of (r, g, b, a)."""
    raw = b"".join(b"\0" + b"".join(bytes(p) for p in row) for row in pixels)
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def tab_png():
    return png(N, N, [[(*rgb(COLOURS[ROWS[y][x]]), corner_alpha(x, y, N, RADIUS)) for x in range(N)] for y in range(N)])


def touch_png():
    # the map with two more pixels of ground all round, five times over: 36 x 5 = 180
    pad, scale = 2, 5
    size = (N + 2 * pad) * scale
    def at(x, y):
        mx, my = x // scale - pad, y // scale - pad
        return ROWS[my][mx] if 0 <= mx < N and 0 <= my < N else "."
    return png(size, size, [[(*rgb(COLOURS[at(x, y)]), 255) for x in range(size)] for y in range(size)])


def ico(png32):
    # one image, stored as PNG (any browser that reads ICO at all reads this)
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", N, N, 0, 0, 1, 32, len(png32), 6 + 16)
    return header + entry + png32


def main():
    (PUB / "favicon.svg").write_text(svg())
    (PUB / "favicon.ico").write_bytes(ico(tab_png()))
    (PUB / "apple-touch-icon.png").write_bytes(touch_png())
    for name in ("favicon.svg", "favicon.ico", "apple-touch-icon.png"):
        print(f"{name}: {(PUB / name).stat().st_size} B")


if __name__ == "__main__":
    main()
