#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Draw "FM-1" as chiselled, extruded bronze letters in the manner of a 1993 shooter's title, and write:

  site/make_logo.py

  frontend/public/favicon.svg   the tab icon: narrow letters, no grain, on a dark rounded square
  art/fm1-logo.svg              the full logo, with grain, on nothing (for the page, a social preview, a poster)

The letters are drawn here from scratch: no font, and nothing of id Software's logo. Each stroke is bevelled
up to a flat top and lit from above; its sides run back toward a point below the middle; the outer letters
drop to long points. Change the measures in WIDE / NARROW or the colours, run this, and commit both files.
Nothing here needs more than Python.
"""
import math
from pathlib import Path

SITE = Path(__file__).resolve().parent

# s stroke; HO, SP the outer letters' height and their point (the inner ones are 100 high); k the flare;
# w the widths of F, M, hyphen and 1, the gap, and the 1's flag; vp, depth where the sides run and how far;
# bev the bevel (of s); grain the texture's scale
WIDE = dict(s=34, HO=128, SP=46, k=0.0016, w=(96, 128, 40, 58, 10, 22), vp=4.0, depth=0.035, bev=0.34, grain=0.16)
NARROW = dict(s=26, HO=118, SP=34, k=0.0013, w=(46, 76, 19, 37, 5, 11), vp=4.0, depth=0.03, bev=0.32, grain=None)

LIGHT = (-0.38, -0.92)  # it falls from above and a little from the left
FACETS = [(-1, "#24150a"), (-0.3, "#5c3d1c"), (0.25, "#a07a3e"), (0.75, "#d9b66c"), (1, "#f6e2a2")]  # facing away .. facing it
TOP = [(0, "#e9cf86"), (0.45, "#b8924c"), (1, "#7a5326")]  # the flat tops, from the letters' top down
OUTLINE, BACK, UNDERSIDE = "#140b05", "#2a180b", "#3b2310"
GROUND = "#0b0a09"  # the page's ground (--bg), behind the tab icon


def area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def clockwise(p):
    return p if area(p) > 0 else p[::-1]


def meet(l1, l2):
    (p1, d1), (p2, d2) = l1, l2
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-9:
        return None
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
    return (p1[0] + d1[0] * t, p1[1] + d1[1] * t)


def inset(p, d):
    """The outline moved in by d, mitred, with point i still answering to corner i of p."""
    n = len(p)
    lines = []
    for i in range(n):
        (x1, y1), (x2, y2) = p[i], p[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        k = math.hypot(dx, dy)
        lines.append(((x1 - dy / k * d, y1 + dx / k * d), (dx, dy)))
    out = []
    for i in range(n):
        q = meet(lines[i - 1], lines[i]) or lines[i][0]
        v = p[i]
        far = math.hypot(q[0] - v[0], q[1] - v[1])
        (d1, d2) = lines[i - 1][1], lines[i][1]
        if d1[0] * d2[1] - d1[1] * d2[0] < 0 and far > 2.5 * d:
            # an inside corner of a narrow slot: its mitre would leave the letter, so stop it short
            q = (v[0] + (q[0] - v[0]) * 2.5 * d / far, v[1] + (q[1] - v[1]) * 2.5 * d / far)
        out.append(q)
    # an edge shorter than the bevel turns over: shrink it to the point where its neighbours meet
    for _ in range(4):
        turned = False
        for i in range(n):
            a, b = out[i], out[(i + 1) % n]
            ex, ey = p[(i + 1) % n][0] - p[i][0], p[(i + 1) % n][1] - p[i][1]
            if (b[0] - a[0]) * ex + (b[1] - a[1]) * ey < -1e-6:
                m = meet(lines[i - 1], lines[(i + 1) % n])
                if m:
                    out[i] = out[(i + 1) % n] = m
                    turned = True
        if not turned:
            break
    return out


def letters(P):
    """F, M, hyphen, 1 as clockwise polygons, y down, letter tops at 0; also the full height and the middle."""
    s, H, HO, SP, k = P["s"], 100, P["HO"], P["SP"], P["k"]
    wF, wM, wH, w1, gap, fl = P["w"]
    bar, c, f = H * 0.42, s * 0.45, wM * 0.06  # the F's middle bar, the chamfers, half the flat of the M's notches
    F = [(0, 0), (wF, 0), (wF - c, s), (s, s), (s, bar), (wF * 0.8, bar), (wF * 0.8 - c * 0.8, bar + s * 0.85), (s, bar + s * 0.85),
         (s, HO), (0, HO + SP)]
    M = [(0, c * 0.6), (c * 0.6, 0), (s * 1.05, 0), (wM / 2 - f, H * 0.34), (wM / 2 + f, H * 0.34), (wM - s * 1.05, 0), (wM - c * 0.6, 0),
         (wM, c * 0.6), (wM, H), (wM - s, H), (wM - s, H * 0.48), (wM / 2 + f, H * 0.82), (wM / 2 - f, H * 0.82), (s, H * 0.48), (s, H), (0, H)]
    hyphen = [(0, H * 0.38), (wH, H * 0.38), (wH, H * 0.38 + s * 0.8), (0, H * 0.38 + s * 0.8)]
    one = [(fl, 0), (w1, 0), (w1, HO + SP), (w1 - s, HO), (w1 - s, s * 1.15), (0, s * 1.15 + fl * 0.25), (0, s * 0.5)]
    x, out = 0, []
    for poly, w in ((F, wF), (M, wM), (hyphen, wH), (one, w1)):
        out.append([(px + x, py) for px, py in poly])
        x += w + gap
    # the flare: each letter leans away from the middle toward the bottom, as if it were coming at you
    cx = (x - gap) / 2
    return [clockwise([(cx + (px - cx) * (1 + k * py), py) for px, py in poly]) for poly in out], HO + SP, cx


def d(p):
    return "M" + "L".join(f"{x:.2f},{y:.2f}" for x, y in p) + "Z"


def mix(a, b, t):
    a, b = ([int(c[i : i + 2], 16) for i in (1, 3, 5)] for c in (a, b))
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(a, b))


def lit(nx, ny):
    """The colour of a bevel facet whose outward normal is (nx, ny)."""
    v = nx * LIGHT[0] + ny * LIGHT[1]
    for (a, ca), (b, cb) in zip(FACETS, FACETS[1:]):
        if v <= b:
            return mix(ca, cb, (v - a) / (b - a))
    return FACETS[-1][1]


def svg(P, square):
    polys, height, cx = letters(P)
    vp = (cx, height * P["vp"])
    outline, body, xs, ys = [], [], [], []
    for p in polys:
        n = len(p)
        back = [(x + (vp[0] - x) * P["depth"], y + (vp[1] - y) * P["depth"]) for x, y in p]
        top = inset(p, P["s"] * P["bev"])
        outline += [p, back]
        body.append(f'<path d="{d(back)}" fill="{BACK}"/>')
        for i in range(n):
            a, b, a2, b2 = p[i], p[(i + 1) % n], back[i], back[(i + 1) % n]
            ex, ey = b[0] - a[0], b[1] - a[1]
            k = math.hypot(ex, ey)
            nx, ny = ey / k, -ex / k
            if nx * (vp[0] - a[0]) + ny * (vp[1] - a[1]) > 0:  # a side that faces the way the letter runs back
                outline.append([a, b, b2, a2])
                body.append(f'<path d="{d([a, b, b2, a2])}" fill="{UNDERSIDE if ny > 0.5 else BACK}"/>')
        for i in range(n):
            a, b = p[i], p[(i + 1) % n]
            ex, ey = b[0] - a[0], b[1] - a[1]
            k = math.hypot(ex, ey)
            colour = lit(ey / k, -ex / k)
            body.append(f'<path d="{d([a, b, top[(i + 1) % n], top[i]])}" fill="{colour}" stroke="{colour}" stroke-width=".4"/>')
        body.append(f'<path d="{d(top)}" fill="url(#top)"/>')
        xs += [x for q in (p, back) for x, _ in q]
        ys += [y for q in (p, back) for _, y in q]

    pad = 8 if square else 24
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = max(xs) + pad - x0, max(ys) + pad - y0
    if square:
        side = max(w, h)
        x0, y0, w, h = x0 - (side - w) / 2, y0 - (side - h) / 2, side, side
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in TOP)
    defs = f'<linearGradient id="top" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="{height}">{stops}</linearGradient>'
    grain = ""
    if P["grain"]:
        # a fine mottle, darkening the metal here and there
        defs += (
            f'<filter id="grain" x="-5%" y="-5%" width="110%" height="110%">'
            f'<feTurbulence type="fractalNoise" baseFrequency="{P["grain"]}" numOctaves="3" seed="3"/>'
            '<feColorMatrix values="0 0 0 0 .45  0 0 0 0 .4  0 0 0 0 .35  .7 .7 .7 0 -.78"/>'
            '<feComposite in2="SourceAlpha" operator="in" result="n"/><feBlend in="SourceGraphic" in2="n" mode="multiply"/></filter>'
        )
        grain = ' filter="url(#grain)"'
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.1f} {y0:.1f} {w:.1f} {h:.1f}"><defs>{defs}</defs>']
    if square:
        out.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{w * 3 / 16:.1f}" fill="{GROUND}"/>')
    out.append(f'<g fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="8" stroke-linejoin="round">' + "".join(f'<path d="{d(q)}"/>' for q in outline) + "</g>")
    out.append(f"<g{grain}>" + "".join(body) + "</g></svg>\n")
    return "".join(out)


def main():
    for path, P, square in ((SITE / "frontend" / "public" / "favicon.svg", NARROW, True), (SITE / "art" / "fm1-logo.svg", WIDE, False)):
        path.parent.mkdir(exist_ok=True)
        path.write_text(svg(P, square))
        print(f"{path.relative_to(SITE)}: {path.stat().st_size} B")


if __name__ == "__main__":
    main()
