#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Draw "FM-1" as extruded letters in the manner of a 1993 shooter's title, and write:

  site/make_logo.py

  frontend/public/favicon.svg   the tab icon: narrow letters, flat colours, on a dark rounded square
  art/fm1-logo.svg              the full logo, textured, on nothing (for the page, a social preview, a poster)

The letters are drawn here from scratch: no font, and nothing of id Software's logo. Each face is steel above
a jagged line and gold brick below it, inside a bright rim that runs from red at the top to yellow at the
bottom; the sides are darker brick and run back toward a point below the middle; the outer letters drop to
long points. Change the measures in WIDE / NARROW or the colours, run this, and commit both files.
Nothing here needs more than Python.
"""
import math
import random
from pathlib import Path

SITE = Path(__file__).resolve().parent

# s stroke; HO, SP the outer letters' height and their point (the inner ones are 100 high); k the flare;
# w the widths of F, M, hyphen and 1, the gap, and the 1's flag; vp, depth where the sides run and how far;
# rim the bright edge (of s); line the dark line inside it; split the jagged line's valleys and peaks (y);
# teeth how many peaks; textured: brick and steel patterns and grain, or flat colours
WIDE = dict(s=34, HO=128, SP=46, k=0.0004, w=(96, 128, 40, 58, 10, 22), vp=6.0, depth=0.022, rim=0.14, line=0.8, split=(62, 34), teeth=9, textured=True)
NARROW = dict(s=26, HO=118, SP=34, k=0.0003, w=(46, 76, 19, 37, 5, 11), vp=6.0, depth=0.016, rim=0.16, line=0.8, split=(64, 36), teeth=4, textured=False)

OUTLINE = "#140b05"
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


RIM = [(0, "#d9466f"), (0.35, "#f2603a"), (0.65, "#ffa22b"), (1, "#ffe65c")]  # the bright edge, top to bottom
STEEL, STEEL_LIT, STEEL_DARK = "#3e5a77", "#86a3bd", "#1f3044"
GOLD, GOLD_LIT, MORTAR = "#dda334", "#f3c552", "#b47a24"
SIDE, SIDE_MORTAR = "#5b3a10", "#2f1c06"
SIDE_SHADE = {"down": 0.0, "out": 0.3}  # how much darker a side is, by the way it faces


def zigzag(x0, x1, P):
    """The jagged line between steel and gold: peaks of gold rising into the steel, deterministic."""
    teeth = P["teeth"]
    lo, hi = P["split"]
    jitter = [0.15, -0.1, 0.05, 0.2, -0.15, 0.1, -0.05, 0.15, -0.2, 0.1, 0.0, -0.1]
    pts = []
    step = (x1 - x0) / teeth
    for i in range(teeth + 1):
        x = x0 + i * step
        pts.append((x, lo + jitter[i % len(jitter)] * (hi - lo) * 0.3))  # a valley: steel reaching down
        if i < teeth:
            pts.append((x + step * (0.5 + jitter[(i + 3) % len(jitter)] * 0.4), hi))  # a peak: gold reaching up
    return pts


def tech_tile(size, seed=11):
    """Short light and dark strokes and little plates: a fine, machine-made texture for the steel."""
    r = random.Random(seed)
    out = [f'<rect width="{size}" height="{size}" fill="{STEEL}"/>']
    for _ in range(int(size * 2.2)):
        x, y = r.random() * size, r.random() * size
        length = 1.2 + r.random() * size * 0.16
        colour = STEEL_LIT if r.random() < 0.45 else STEEL_DARK
        if r.random() < 0.5:
            out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{length:.1f}" height=".5" fill="{colour}" fill-opacity=".8"/>')
        else:
            out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width=".5" height="{length:.1f}" fill="{colour}" fill-opacity=".8"/>')
        if r.random() < 0.15:
            out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="1.6" height="1.6" fill="none" stroke="{STEEL_LIT}" stroke-width=".35" stroke-opacity=".8"/>')
    return "".join(out)


def brick_tile(w, h, face, mortar, lit):
    """Two courses of bricks, the second set over by half a brick."""
    m = 0.55
    return (f'<rect width="{w}" height="{h}" fill="{mortar}"/>'
            f'<rect x="0" y="0" width="{w / 2 - m}" height="{h / 2 - m}" fill="{face}"/>'
            f'<rect x="{w / 2}" y="0" width="{w / 2 - m}" height="{h / 2 - m}" fill="{face}"/>'
            f'<rect x="{-w / 4}" y="{h / 2}" width="{w / 2 - m}" height="{h / 2 - m}" fill="{face}"/>'
            f'<rect x="{w / 4}" y="{h / 2}" width="{w / 2 - m}" height="{h / 2 - m}" fill="{face}"/>'
            f'<rect x="{3 * w / 4}" y="{h / 2}" width="{w / 2 - m}" height="{h / 2 - m}" fill="{face}"/>'
            f'<rect x="0" y="0" width="{w / 2 - m}" height=".4" fill="{lit}"/><rect x="{w / 4}" y="{h / 2}" width="{w / 2 - m}" height=".4" fill="{lit}"/>')


def svg(P, square):
    polys, height, cx = letters(P)
    vp = (cx, height * P["vp"])
    outline, sides, shades, rims, faces, xs, ys = [], [], [], [], [], [], []
    for p in polys:
        n = len(p)
        back = [(x + (vp[0] - x) * P["depth"], y + (vp[1] - y) * P["depth"]) for x, y in p]
        outline += [p, back]
        sides.append(back)
        for i in range(n):
            a, b, a2, b2 = p[i], p[(i + 1) % n], back[i], back[(i + 1) % n]
            ex, ey = b[0] - a[0], b[1] - a[1]
            k = math.hypot(ex, ey)
            nx, ny = ey / k, -ex / k
            if nx * (vp[0] - a[0]) + ny * (vp[1] - a[1]) > 0:
                outline.append([a, b, b2, a2])
                sides.append([a, b, b2, a2])
                shades.append(([a, b, b2, a2], SIDE_SHADE["down"] if ny > 0.6 else SIDE_SHADE["out"]))
        rims.append(p)
        faces.append(inset(p, P["s"] * P["rim"]))
        xs += [x for q in (p, back) for x, _ in q]
        ys += [y for q in (p, back) for _, y in q]

    pad = 8 if square else 24
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = max(xs) + pad - x0, max(ys) + pad - y0
    if square:
        side = max(w, h)
        x0, y0, w, h = x0 - (side - w) / 2, y0 - (side - h) / 2, side, side
    rim = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in RIM)
    sky = zigzag(min(xs) - 10, max(xs) + 10, P)
    sky = [(sky[0][0], -400)] + sky + [(sky[-1][0], -400)]
    defs = [f'<linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="{height}">{rim}</linearGradient>',
            f'<clipPath id="sky"><path d="{d(sky)}"/></clipPath>']
    if P["textured"]:
        t = 40
        defs += [f'<pattern id="steel" patternUnits="userSpaceOnUse" width="{t}" height="{t}">{tech_tile(t)}</pattern>',
                 f'<pattern id="gold" patternUnits="userSpaceOnUse" width="12" height="6">{brick_tile(12, 6, GOLD, MORTAR, GOLD_LIT)}</pattern>',
                 f'<pattern id="side" patternUnits="userSpaceOnUse" width="12" height="6">{brick_tile(12, 6, SIDE, SIDE_MORTAR, SIDE)}</pattern>',
                 '<filter id="grain" x="-5%" y="-5%" width="110%" height="110%">'
                 '<feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="2" seed="5"/>'
                 '<feColorMatrix values="0 0 0 0 .3  0 0 0 0 .25  0 0 0 0 .2  .6 .6 .6 0 -.75"/>'
                 '<feComposite in2="SourceAlpha" operator="in" result="n"/><feBlend in="SourceGraphic" in2="n" mode="multiply"/></filter>']
        steel, gold, side_fill, grain = "url(#steel)", "url(#gold)", "url(#side)", ' filter="url(#grain)"'
    else:
        steel, gold, side_fill, grain = STEEL, GOLD, SIDE, ""
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.1f} {y0:.1f} {w:.1f} {h:.1f}"><defs>{"".join(defs)}</defs>']
    if square:
        out.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{w * 3 / 16:.1f}" fill="{GROUND}"/>')
    paths = lambda ps: "".join(f'<path d="{d(q)}"/>' for q in ps)
    # back to front: a dark outline round everything; the sides; the rim; the face, gold below and steel above
    out.append(f'<g fill="{OUTLINE}" stroke="{OUTLINE}" stroke-width="8" stroke-linejoin="round">{paths(outline)}</g>')
    out.append(f'<g{grain}>')
    out.append(f'<g fill="{side_fill}">{paths(sides)}</g>')
    out.append("".join(f'<path d="{d(q)}" fill="{OUTLINE}" fill-opacity="{a}"/>' for q, a in shades if a))
    out.append(f'<g fill="url(#rim)">{paths(rims)}</g>')
    out.append(f'<g fill="{gold}">{paths(faces)}</g>')
    out.append(f'<g fill="{steel}" clip-path="url(#sky)">{paths(faces)}</g>')
    out.append(f'<g fill="none" stroke="{OUTLINE}" stroke-width="{P["line"]}">{paths(faces)}</g>')
    out.append("</g></svg>\n")
    return "".join(out)


def main():
    for path, P, square in ((SITE / "frontend" / "public" / "favicon.svg", NARROW, True), (SITE / "art" / "fm1-logo.svg", WIDE, False)):
        path.parent.mkdir(exist_ok=True)
        path.write_text(svg(P, square))
        print(f"{path.relative_to(SITE)}: {path.stat().st_size} B")


if __name__ == "__main__":
    main()
