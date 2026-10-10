#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Draw "FM-1" in heavy, flared, bevelled metal lettering, in the spirit of a 1993 shooter's title, and write:

  site/make_logo.py

  frontend/public/favicon.svg   the tab icon: narrow letters, no bevel, on a dark rounded square
  art/fm1-logo.svg              the full logo, bevelled, on nothing (for the page, a social preview, a poster)

The letters are drawn here from scratch: no font, and nothing of id Software's logo. Change the measures in
letters() or the colours below, run this, and commit both files. Nothing here needs more than Python.
"""
import math
from pathlib import Path

SITE = Path(__file__).resolve().parent

FACE = [(0, "#fff2a8"), (0.18, "#ffcf3a"), (0.45, "#f28a1e"), (0.75, "#c63a10"), (1, "#7c1807")]  # top to bottom
RIM = [(0, "#d98a22"), (0.5, "#9c3a0e"), (1, "#4e0f05")]
OUTLINE, DROP, DEPTH = "#1c0905", "#120604", "#5a1407"
LIGHT, SHADE = "#ffe7a0", "#6e1806"  # the bevel's two edges
GROUND = "#0b0a09"  # the page's ground (--bg)


def area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def offset(p, d):
    """The outline moved out by d (in, if d < 0), with mitred corners."""
    if area(p) < 0:
        p = p[::-1]
    lines = []
    for i in range(len(p)):
        (x1, y1), (x2, y2) = p[i], p[(i + 1) % len(p)]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy)
        lines.append(((x1 + dy / n * d, y1 - dx / n * d), (dx, dy)))
    out = []
    for (p1, d1), (p2, d2) in zip(lines[-1:] + lines[:-1], lines):
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-9:  # two edges in line: the corner is just the moved point
            out.append(p2)
            continue
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
        out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
    return out


def letters(narrow):
    """F, M, hyphen, 1 as polygons, y down, letter tops at 0. The outer two reach lower and end in a point."""
    if narrow:
        s, H, HO, SP, k = 26, 100, 110, 16, 0.0011  # stroke, height, outer letters' height, their point, flare
        wF, wM, wH, w1, gap, fl = 46, 76, 19, 37, 5, 11  # widths, gap, the 1's flag
    else:
        s, H, HO, SP, k = 34, 100, 118, 20, 0.0011
        wF, wM, wH, w1, gap, fl = 96, 128, 40, 56, 12, 22
    bar = H * 0.44
    F = [(0, 0), (wF, 0), (wF, s), (s, s), (s, bar), (wF * 0.82, bar), (wF * 0.82, bar + s * 0.85), (s, bar + s * 0.85), (s, HO), (0, HO + SP)]
    f = wM * 0.06  # the M's notches end flat, never in a hairline point
    M = [(0, 0), (s * 1.05, 0), (wM / 2 - f, H * 0.34), (wM / 2 + f, H * 0.34), (wM - s * 1.05, 0), (wM, 0), (wM, H), (wM - s, H),
         (wM - s, H * 0.46), (wM / 2 + f, H * 0.8), (wM / 2 - f, H * 0.8), (s, H * 0.46), (s, H), (0, H)]
    hyphen = [(0, H * 0.4), (wH, H * 0.4), (wH, H * 0.4 + s * 0.75), (0, H * 0.4 + s * 0.75)]
    one = [(fl, 0), (w1, 0), (w1, HO + SP), (fl, HO), (fl, s * 1.1), (0, s * 1.1 + fl * 0.2), (0, s * 0.55)]
    x, out = 0, []
    for poly, w in ((F, wF), (M, wM), (hyphen, wH), (one, w1)):
        out.append([(px + x, py) for px, py in poly])
        x += w + gap
    # the flare: each letter leans away from the middle toward the bottom, as if it were coming at you
    cx = (x - gap) / 2
    return [[(cx + (px - cx) * (1 + k * py), py) for px, py in poly] for poly in out], HO + SP


def d(p, dx=0.0, dy=0.0):
    return "M" + "L".join(f"{x + dx:.2f},{y + dy:.2f}" for x, y in p) + "Z"


def gradient(name, stops, height):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{name}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="{height}">{s}</linearGradient>'


def svg(narrow):
    polys, height = letters(narrow)
    ol, inset, drop, bevel = (8, 5, 7, 0) if narrow else (9, 6, 9, 1.6)
    outlines = [offset(p, ol) for p in polys]
    faces = [offset(p, -inset) for p in polys]
    xs = [x for p in outlines for x, _ in p]
    ys = [y for p in outlines for _, y in p]
    pad = 6 if narrow else 24
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = max(xs) + pad - x0, max(ys) + drop + pad - y0
    if narrow:  # centred in a square
        side = max(w, h)
        x0, y0, w, h = x0 - (side - w) / 2, y0 - (side - h) / 2, side, side
    layer = lambda fill, ps, dx=0.0, dy=0.0: f'<g fill="{fill}">' + "".join(f'<path d="{d(p, dx, dy)}"/>' for p in ps) + "</g>"
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.1f} {y0:.1f} {w:.1f} {h:.1f}">',
        f"<defs>{gradient('face', FACE, height)}{gradient('rim', RIM, height)}</defs>",
    ]
    if narrow:
        out.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{w * 3 / 16:.1f}" fill="{GROUND}"/>')
    out += [layer(DROP, outlines, dy=drop), layer(OUTLINE, outlines), layer(DEPTH, polys, dy=drop * 0.6), layer("url(#rim)", polys)]
    if bevel:
        out += [layer(LIGHT, faces, -bevel, -bevel), layer(SHADE, faces, bevel, bevel)]
        faces = [offset(p, -bevel * 0.6) for p in faces]
    out += [layer("url(#face)", faces), "</svg>"]
    return "".join(out) + "\n"


def main():
    for path, narrow in ((SITE / "frontend" / "public" / "favicon.svg", True), (SITE / "art" / "fm1-logo.svg", False)):
        path.parent.mkdir(exist_ok=True)
        path.write_text(svg(narrow))
        print(f"{path.relative_to(SITE)}: {path.stat().st_size} B")


if __name__ == "__main__":
    main()
