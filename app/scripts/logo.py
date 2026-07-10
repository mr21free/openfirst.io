#!/usr/bin/env python3
"""
OpenFirst logo — "the split", described mathematically, rendered to SVG or PNG.

The mark is a SQUARE OPENED ALONG ITS DIAGONAL: two solid right triangles,
the top half lifted away toward the top-right. Something sealed, opening —
pure geometry, no outline, reads at 16px. (Chosen by Miro 2026-07-10 from
the triangle series, V5.)

Sharp edges, solid fills. Same spirit as freedomclock.io's generated mark.

Examples:
  python3 scripts/logo.py --format svg --size 1024 --out logo.svg
  python3 scripts/logo.py --format png --size 1024 --bg transparent --out logo.png
  python3 scripts/logo.py --format png --size 512 --bg '#FFFFFF' --padding 0.18 --out maskable.png
"""

import argparse


# ---------- colour helpers (as in freedom_clock_icon.py) ----------

def parse_color(value):
    if value is None:
        return None
    v = value.strip().lower()
    if v in ("transparent", "none"):
        return None
    if v.startswith("#"):
        v = v[1:]
    if len(v) == 6:
        return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    if len(v) == 8:
        return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4, 6))
    raise ValueError(f"Invalid color: {value}")


def rgba_to_hex(rgba):
    if rgba is None:
        return "none"
    r, g, b, a = rgba
    if a == 255:
        return f"#{r:02X}{g:02X}{b:02X}"
    return f"#{r:02X}{g:02X}{b:02X}{a:02X}"


# ---------- geometry ----------
#
# Built in a 100-unit design space, then fitted to the canvas. All numbers are
# ratios of that space.
#
#        ┌──────────╱ upper  (a square's top-right triangle,
#        │        ╱╱          displaced toward the top-right)
#        │      ╱╱
#   lower│    ╱╱  ← the open diagonal gap
#        │  ╱
#        └──────────
#
# Two solid right triangles from one square, split along the diagonal; the
# upper half is shifted (+SHIFT, -SHIFT) so a parallel gap opens between them.

STROKE = 0.0                     # solid mark — no strokes
SQ_L, SQ_T, SQ_R, SQ_B = 16.0, 20.0, 78.0, 82.0   # the source square
SHIFT = 12.0                     # how far the top half has lifted away


def build_mark():
    """Return (polylines, polygons): [(name, [(x, y), ...])] each.
    The split mark is two filled triangles, no strokes."""
    # Lower-left half of the square, staying put.
    lower = [(SQ_L, SQ_T), (SQ_L, SQ_B), (SQ_R, SQ_B)]
    # Upper-right half, lifted toward the top-right.
    upper = [(SQ_L + SHIFT, SQ_T - SHIFT), (SQ_R + SHIFT, SQ_T - SHIFT), (SQ_R + SHIFT, SQ_B - SHIFT)]
    return [], [("lower", lower), ("upper", upper)]


def fit(polylines, polygons, size, padding):
    """Scale + centre into the canvas inside `padding` (ratio). Returns
    (fitted polylines, fitted polygons, stroke width in canvas units)."""
    half = STROKE / 2.0
    pts = [p for _, line in polylines for p in line] + \
          [p for _, poly in polygons for p in poly]
    minx = min(x for x, _ in pts) - half
    maxx = max(x for x, _ in pts) + half
    miny = min(y for _, y in pts) - half
    maxy = max(y for _, y in pts) + half
    w, h = maxx - minx, maxy - miny
    content = size * (1.0 - 2.0 * padding)
    scale = content / max(w, h)
    ox = (size - w * scale) / 2.0 - minx * scale
    oy = (size - h * scale) / 2.0 - miny * scale
    place = lambda line: [(x * scale + ox, y * scale + oy) for x, y in line]
    return ([(name, place(line)) for name, line in polylines],
            [(name, place(poly)) for name, poly in polygons],
            STROKE * scale)


# ---------- renderers ----------

def save_svg(out, size, color, bg, padding):
    color_rgba = parse_color(color)
    if color_rgba is None:
        raise ValueError("Logo colour cannot be transparent.")
    polylines, polygons = build_mark()
    lines_fitted, polys_fitted, stroke = fit(polylines, polygons, size, padding)
    color_hex = rgba_to_hex(color_rgba)
    bg_hex = rgba_to_hex(parse_color(bg))

    def path(pts):
        d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in pts)
        return f'  <path d="{d}"/>'

    body = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}" fill="none">'
    ]
    if bg_hex != "none":
        body.append(f'  <rect width="{size}" height="{size}" fill="{bg_hex}"/>')
    body.append(f'<g stroke="{color_hex}" stroke-width="{stroke:.2f}" '
                f'stroke-linecap="round" stroke-linejoin="round" fill="none">')
    for _, pts in lines_fitted:
        body.append(path(pts))
    body.append("</g>")
    for _, pts in polys_fitted:
        s = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        body.append(f'  <polygon points="{s}" fill="{color_hex}"/>')
    body.append("</svg>")

    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(body) + "\n")


def save_png(out, size, color, bg, padding):
    from PIL import Image, ImageDraw

    color_rgba = parse_color(color)
    if color_rgba is None:
        raise ValueError("Logo colour cannot be transparent.")
    bg_rgba = parse_color(bg)

    # Supersample for clean anti-aliased edges, then downscale.
    ss = 4
    big = size * ss
    polylines, polygons = build_mark()
    lines_fitted, polys_fitted, stroke = fit(polylines, polygons, big, padding)
    w = max(1, round(stroke))
    r = stroke / 2.0

    image = Image.new("RGBA", (big, big), bg_rgba if bg_rgba else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for _, pts in lines_fitted:
        draw.line(pts, fill=color_rgba, width=w, joint="curve")
        # Round caps (PIL lines are butt-capped) — and joint="curve" misses the
        # very first/last vertex, so cap every vertex.
        for (x, y) in pts:
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color_rgba)
    for _, pts in polys_fitted:
        draw.polygon(pts, fill=color_rgba)

    image = image.resize((size, size), Image.LANCZOS)
    image.save(out)


def main():
    p = argparse.ArgumentParser(description="Generate the OpenFirst logo.")
    p.add_argument("--format", choices=["png", "svg"], required=True)
    p.add_argument("--size", type=int, default=1024)
    p.add_argument("--color", "--blue", dest="color", default="#3C6FB2", help="Logo colour.")
    p.add_argument("--bg", default="transparent", help='Background colour, or "transparent".')
    p.add_argument("--padding", type=float, default=0.06, help="Margin around the mark (ratio of size).")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    if args.format == "svg":
        save_svg(args.out, args.size, args.color, args.bg, args.padding)
    else:
        save_png(args.out, args.size, args.color, args.bg, args.padding)
    print(f"Saved: {args.out}")


if __name__ == "__main__":
    main()
