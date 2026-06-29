#!/usr/bin/env python3
"""
Life Package logo — described mathematically and rendered to SVG or PNG.

The mark is an isometric OPEN BOX made from three wall planes: left face, right
face, and a top plane with two touching semicircle lobes. The gaps between the
three planes share one width, so the white "Y" in the middle is just the
background showing through equal spacing.

Same spirit as freedomclock.io/internal/freedom_clock_icon.py.

Examples:
  python3 scripts/logo.py --format svg --size 512 --out logo.svg
  python3 scripts/logo.py --format png --size 1024 --bg transparent --out logo.png
"""

import argparse
import math


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

# The mark is built in an arbitrary unit space centred on x = 0 and fitted into
# the canvas afterwards, so these are just ratios.
#
# The box is seen open from the front. Two equal side faces form the vertical
# stem of the Y; the top plane is parallel-offset from the side faces so the
# diagonal Y arms have the same gap as the stem. Its left and right corners
# extend to the outer side-wall x-lines, slightly above the side wall corners.

EDGE = 1.15         # diagonal top arm length
WALL_HEIGHT = EDGE * 0.80
ARM_ANGLE_DEGREES = 43.5
SEMICIRCLE_SAMPLES = 32


def arm_unit():
    a = math.radians(ARM_ANGLE_DEGREES)
    return math.cos(a), -math.sin(a)


def triangle_tip(gap, ux, uy):
    """Return the triangle point that makes the diagonal Y-arm gap equal."""
    g = gap / 2.0
    lift = (gap + g * uy) / ux
    return (0.0, -lift)


def top_side_length(gap, ux):
    """Return the top-plane side length needed to touch the side-wall x-lines."""
    return EDGE + (gap / 2.0) / ux


def touching_semicircles(left, middle, right, samples):
    """Return the two upper semicircles from left -> middle -> right."""
    y = left[1]
    left_radius = (middle[0] - left[0]) / 2.0
    right_radius = (right[0] - middle[0]) / 2.0
    left_cx = (left[0] + middle[0]) / 2.0
    right_cx = (middle[0] + right[0]) / 2.0

    pts = []
    for i in range(samples + 1):
        a = math.pi - (math.pi * i / samples)
        pts.append((left_cx + left_radius * math.cos(a), y - left_radius * math.sin(a)))
    for i in range(1, samples + 1):
        a = math.pi - (math.pi * i / samples)
        pts.append((right_cx + right_radius * math.cos(a), y - right_radius * math.sin(a)))
    return pts


def build_shapes(gap):
    """Return {name: [(x, y), ...]} for the three wall planes."""
    ux, uy = arm_unit()

    e = EDGE
    h = WALL_HEIGHT
    g = gap / 2.0
    tl = (-g - e * ux, e * uy)           # top-left corner (arm up-left)
    tr = (g + e * ux, e * uy)            # top-right corner (arm up-right)
    left_face = [(-g, 0.0), tl, (tl[0], tl[1] + h), (-g, h)]
    right_face = [(g, 0.0), tr, (tr[0], tr[1] + h), (g, h)]

    tip = triangle_tip(gap, ux, uy)
    top_len = top_side_length(gap, ux)
    top_left = (tip[0] - top_len * ux, tip[1] + top_len * uy)
    top_right = (tip[0] + top_len * ux, tip[1] + top_len * uy)
    lobes = touching_semicircles(top_left, (0.0, top_left[1]), top_right, SEMICIRCLE_SAMPLES)
    top_shape = lobes + [tip]

    return {"left": left_face, "right": right_face, "top": top_shape}


def fit(shapes, size, padding):
    """Scale + centre all shapes to fill the canvas inside `padding` (ratio)."""
    pts = [p for s in shapes.values() for p in s]
    minx = min(x for x, _ in pts)
    maxx = max(x for x, _ in pts)
    miny = min(y for _, y in pts)
    maxy = max(y for _, y in pts)
    w, h = maxx - minx, maxy - miny
    content = size * (1.0 - 2.0 * padding)
    scale = content / max(w, h)
    ox = (size - w * scale) / 2.0 - minx * scale
    oy = (size - h * scale) / 2.0 - miny * scale
    return {name: [(x * scale + ox, y * scale + oy) for x, y in s] for name, s in shapes.items()}


# ---------- renderers ----------

def save_svg(out, size, blue, bg, gap, padding):
    blue_rgba = parse_color(blue)
    if blue_rgba is None:
        raise ValueError("Logo colour cannot be transparent.")
    shapes = fit(build_shapes(gap), size, padding)
    blue_hex = rgba_to_hex(blue_rgba)
    bg_hex = rgba_to_hex(parse_color(bg))

    def poly(pts):
        s = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        return f'  <polygon points="{s}" fill="{blue_hex}"/>'

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}" fill="none">'
    ]
    if bg_hex != "none":
        lines.append(f'  <rect width="{size}" height="{size}" fill="{bg_hex}"/>')
    lines.append(poly(shapes["left"]))
    lines.append(poly(shapes["right"]))
    lines.append(poly(shapes["top"]))
    lines.append("</svg>")

    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def save_png(out, size, blue, bg, gap, padding):
    from PIL import Image, ImageDraw

    blue_rgba = parse_color(blue)
    if blue_rgba is None:
        raise ValueError("Logo colour cannot be transparent.")
    bg_rgba = parse_color(bg)

    # Supersample for clean anti-aliased edges, then downscale.
    ss = 4
    big = size * ss
    shapes = fit(build_shapes(gap), big, padding)

    image = Image.new("RGBA", (big, big), bg_rgba if bg_rgba else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for name in ("left", "right", "top"):
        draw.polygon(shapes[name], fill=blue_rgba)

    image = image.resize((size, size), Image.LANCZOS)
    image.save(out)


def main():
    p = argparse.ArgumentParser(description="Generate the Life Package logo.")
    p.add_argument("--format", choices=["png", "svg"], required=True)
    p.add_argument("--size", type=int, default=1024)
    p.add_argument("--blue", default="#3C6FB2", help="Logo colour.")
    p.add_argument("--bg", default="transparent", help='Background colour, or "transparent".')
    p.add_argument("--gap", type=float, default=0.30, help="Width of the white gaps (design units).")
    p.add_argument("--padding", type=float, default=0.10, help="Margin around the mark (ratio of size).")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    if args.format == "svg":
        save_svg(args.out, args.size, args.blue, args.bg, args.gap, args.padding)
    else:
        save_png(args.out, args.size, args.blue, args.bg, args.gap, args.padding)
    print(f"Saved: {args.out}")


if __name__ == "__main__":
    main()
