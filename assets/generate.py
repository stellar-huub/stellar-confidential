#!/usr/bin/env python3
"""Generate the project's logo, banner and social assets.

  ./generate.py            write every SVG in this directory
  ./generate.py --png      also rasterise via headless Chrome

The marks are geometric, so they are computed rather than hand-drawn: every
coordinate comes from one set of polar helpers, which is why the blades line up
exactly and why changing a single constant restyles all of it.

Deliberate constraints, both from where these files are actually used:

  * No <style> blocks or CSS. GitHub sanitises SVG rendered in Markdown and
    stylesheets do not survive it. Everything is a presentation attribute.
  * No @media (prefers-color-scheme) inside the SVG. It is unreliable for
    images; light and dark are separate files, selected by <picture> in the
    README instead.
"""
import argparse
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------- palette
INK = '#0B1220'          # deep navy, the dark-mode ground
INK_SOFT = '#111A2E'     # raised surface on ink
PAPER = '#FFFFFF'
ACCENT_FROM = '#5B8DEF'  # azure
ACCENT_TO = '#2ED3B7'    # teal
MUTED_LIGHT = '#64748B'
MUTED_DARK = '#94A3B8'

FONT = (
    "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', "
    "Roboto, Helvetica, Arial, sans-serif"
)


def polar(cx, cy, radius, degrees):
    """Cartesian point at `degrees` around (cx, cy). 0 deg points right, y grows down."""
    rad = math.radians(degrees)
    return (cx + radius * math.cos(rad), cy + radius * math.sin(rad))


def fmt(points):
    return ' '.join(f'{x:.2f},{y:.2f}' for x, y in points)


def hexagon(cx, cy, radius, rotation=-90):
    """Pointy-top hexagon: a vertex at the top reads as a seal rather than a tile."""
    return [polar(cx, cy, radius, rotation + 60 * i) for i in range(6)]


def gradient(gid, x1=0, y1=0, x2=1, y2=1):
    return (
        f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
        f'<stop offset="0" stop-color="{ACCENT_FROM}"/>'
        f'<stop offset="1" stop-color="{ACCENT_TO}"/>'
        f'</linearGradient>'
    )


# ------------------------------------------------------------------------ mark
def aperture_blades(cx, cy, outer, hole, gap=3.0, twist=26.0):
    """Six blades closing over a hexagonal opening.

    An aperture rather than a padlock, on purpose. The project is not about
    hiding everything from everyone -- it is about controlled disclosure, and an
    iris is the shape that says "opens by exactly as much as it is told to".

    Each blade spans 60 degrees minus a gap, and its inner edge is rotated by
    `twist` against its outer edge. That offset is what makes the six pieces
    read as overlapping blades instead of a plain ring.
    """
    blades = []
    for i in range(6):
        base = -90 + 60 * i
        outer_a = base + gap / 2
        outer_b = base + 60 - gap / 2
        blades.append([
            polar(cx, cy, outer, outer_a),
            polar(cx, cy, outer, outer_b),
            polar(cx, cy, hole, outer_b + twist),
            polar(cx, cy, hole, outer_a + twist),
        ])
    return blades


def mark(size=128, gid='m', ring_color=None, blade_fill=None, ring_width=None):
    """The logo mark: a hexagonal seal ring around a six-blade aperture."""
    c = size / 2
    scale = size / 128.0
    ring_r = 54 * scale
    ring_w = (ring_width if ring_width is not None else 7) * scale
    blades = aperture_blades(c, c, 41 * scale, 13.5 * scale)

    ring = ring_color or f'url(#{gid}-g)'
    fill = blade_fill or f'url(#{gid}-g)'

    parts = [
        f'<polygon points="{fmt(hexagon(c, c, ring_r))}" fill="none" '
        f'stroke="{ring}" stroke-width="{ring_w:.2f}" stroke-linejoin="round"/>'
    ]
    # Alternating opacity gives the blades depth without a second colour, so the
    # mark still works when it is stamped in a single ink.
    for i, blade in enumerate(blades):
        parts.append(
            f'<polygon points="{fmt(blade)}" fill="{fill}" '
            f'opacity="{1.0 if i % 2 == 0 else 0.74:.2f}"/>'
        )
    return '\n  '.join(parts)


def svg(width, height, body, defs=''):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img">\n'
        f'  <defs>{defs}</defs>\n  {body}\n</svg>\n'
    )


# ------------------------------------------------------------------ background
# Varied so the rows read as records rather than as a placeholder grid.
ROW_WIDTHS = (118, 96, 126, 104, 112, 88, 120)


def ledger_rows(x, y, rows, ground, gid):
    """Faint ledger rows: a public column beside a sealed amount column.

    The background is the problem statement in one glyph. Everything about a
    payment stays legible except the amount, which is the only column that goes
    dark -- and the sealed cells carry the accent, so what is protected is also
    what the eye lands on.

    `gid` is threaded through rather than assumed. Each document defines its own
    gradient, and referencing another document's id fails silently, painting
    nothing at all -- which is exactly what happened before this was a parameter.
    """
    out = []
    for r in range(rows):
        top = y + r * 26
        width = ROW_WIDTHS[r % len(ROW_WIDTHS)]
        out.append(
            f'<rect x="{x}" y="{top}" width="{width}" height="12" rx="6" '
            f'fill="{ground}" opacity="0.28"/>'
        )
        out.append(
            f'<rect x="{x + 132}" y="{top}" width="76" height="12" rx="6" '
            f'fill="url(#{gid})" opacity="0.62"/>'
        )
    return '\n  '.join(out)


# ------------------------------------------------------------------- documents
def logo_mark():
    return svg(128, 128, mark(128, 'm'), gradient('m-g'))


def logo_mark_mono(color=INK):
    return svg(128, 128, mark(128, 'mono', ring_color=color, blade_fill=color), '')


def favicon():
    # Heavier ring: at 32px the detail of the full mark closes into a blob, so
    # the small size gets its own weight rather than a naive scale-down.
    return svg(32, 32, mark(32, 'f', ring_width=9), gradient('f-g'))


def wordmark(x, y, title_fill, sub_fill, title_size=34, sub_size=13):
    return (
        f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{title_size}" '
        f'font-weight="700" fill="{title_fill}" letter-spacing="-0.5">'
        f'Confidential Stellar</text>\n  '
        f'<text x="{x}" y="{y + sub_size + 9}" font-family="{FONT}" font-size="{sub_size}" '
        f'font-weight="600" fill="{sub_fill}" letter-spacing="3.4">INFRASTRUCTURE</text>'
    )


def logo(dark):
    width, height = 420, 104
    ground = INK if dark else PAPER
    title = PAPER if dark else INK
    sub = MUTED_DARK if dark else MUTED_LIGHT
    body = (
        f'<rect width="{width}" height="{height}" fill="{ground}"/>\n  '
        f'<g transform="translate(8, 12)">{mark(80, "l")}</g>\n  '
        + wordmark(104, 52, title, sub)
    )
    return svg(width, height, body, gradient('l-g'))


def banner(dark):
    width, height = 1280, 320
    ground = INK if dark else PAPER
    title = PAPER if dark else INK
    sub = MUTED_DARK if dark else MUTED_LIGHT
    rows_ink = MUTED_DARK if dark else MUTED_LIGHT

    body = (
        f'<rect width="{width}" height="{height}" fill="{ground}"/>\n  '
        f'<g opacity="{0.6 if dark else 0.8}">'
        f'{ledger_rows(940, 82, 6, rows_ink, "b-g")}</g>\n  '
        f'<g transform="translate(88, 96)">{mark(128, "b")}</g>\n  '
        f'<text x="252" y="150" font-family="{FONT}" font-size="52" font-weight="700" '
        f'fill="{title}" letter-spacing="-1">Confidential Stellar</text>\n  '
        f'<text x="252" y="188" font-family="{FONT}" font-size="19" font-weight="600" '
        f'fill="url(#b-g)" letter-spacing="5.5">INFRASTRUCTURE</text>\n  '
        f'<text x="252" y="232" font-family="{FONT}" font-size="18" font-weight="400" '
        f'fill="{sub}">Private assets. Verifiable transactions. Recoverable state.</text>'
    )
    return svg(width, height, body, gradient('b-g'))


def social_card(dark=True):
    width, height = 1280, 640
    ground = INK if dark else PAPER
    title = PAPER if dark else INK
    sub = MUTED_DARK if dark else MUTED_LIGHT

    chip_x = 96
    chip_parts = []
    for label in ('Indexer', 'Recovery', 'Auditing', 'Mobile'):
        chip_w = 34 + len(label) * 10.5
        chip_parts.append(
            f'<g><rect x="{chip_x:.0f}" y="492" width="{chip_w:.0f}" height="44" rx="22" '
            f'fill="{INK_SOFT if dark else "#F1F5F9"}" stroke="url(#s-g)" stroke-opacity="0.45"/>'
            f'<text x="{chip_x + chip_w / 2:.0f}" y="520" font-family="{FONT}" font-size="16" '
            f'font-weight="600" fill="{sub}" text-anchor="middle">{label}</text></g>'
        )
        chip_x += chip_w + 16

    body = (
        f'<rect width="{width}" height="{height}" fill="{ground}"/>\n  '
        f'<g opacity="{0.5 if dark else 0.75}">'
        f'{ledger_rows(944, 176, 7, MUTED_DARK if dark else MUTED_LIGHT, "s-g")}</g>\n  '
        f'<g transform="translate(96, 112)">{mark(112, "s")}</g>\n  '
        f'<text x="96" y="322" font-family="{FONT}" font-size="66" font-weight="700" '
        f'fill="{title}" letter-spacing="-1.5">Confidential Stellar</text>\n  '
        f'<text x="96" y="390" font-family="{FONT}" font-size="66" font-weight="700" '
        f'fill="url(#s-g)" letter-spacing="-1.5">Infrastructure</text>\n  '
        f'<text x="96" y="444" font-family="{FONT}" font-size="21" font-weight="400" '
        f'fill="{sub}">Open infrastructure for private, recoverable, '
        f'compliant assets on Stellar.</text>\n  '
        + '\n  '.join(chip_parts)
    )
    return svg(width, height, body, gradient('s-g'))


DOCUMENTS = {
    'logo-mark.svg': logo_mark,
    'logo-mark-mono-dark.svg': lambda: logo_mark_mono(INK),
    'logo-mark-mono-light.svg': lambda: logo_mark_mono(PAPER),
    'favicon.svg': favicon,
    'logo-light.svg': lambda: logo(dark=False),
    'logo-dark.svg': lambda: logo(dark=True),
    'banner-light.svg': lambda: banner(dark=False),
    'banner-dark.svg': lambda: banner(dark=True),
    'social-card.svg': lambda: social_card(dark=True),
}

# GitHub's social preview upload takes raster only, so that one has to exist as
# a PNG; the rest are rasterised for anywhere SVG is awkward.
PNG_TARGETS = {
    'social-card.svg': (1280, 640),
    'banner-dark.svg': (1280, 320),
    'banner-light.svg': (1280, 320),
    'logo-mark.svg': (512, 512),
}


def rasterise(name, size):
    """Screenshot the SVG with headless Chrome, the one renderer we can rely on.

    Chrome draws a bare SVG at its intrinsic size and letterboxes the rest of the
    window, so the file is wrapped in a page that stretches it to the target.
    That also makes output resolution independent of the artwork's own
    coordinate system.
    """
    source = os.path.join(HERE, name)
    target = os.path.join(HERE, name.replace('.svg', '.png'))
    width, height = size
    shim = os.path.join(HERE, f'.raster-{name}.html')
    with open(shim, 'w', encoding='utf-8') as handle:
        handle.write(
            '<!doctype html><meta charset="utf-8">'
            '<style>html,body{margin:0;padding:0;background:transparent}'
            f'img{{display:block;width:{width}px;height:{height}px}}</style>'
            f'<img src="{os.path.basename(source)}">'
        )
    try:
        subprocess.run(
            ['google-chrome', '--headless', '--disable-gpu', '--no-sandbox',
             '--hide-scrollbars', '--force-device-scale-factor=1',
             '--default-background-color=00000000',
             f'--window-size={width},{height}', f'--screenshot={target}',
             f'file://{shim}'],
            check=True, capture_output=True, timeout=120,
        )
    finally:
        os.unlink(shim)
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--png', action='store_true', help='also rasterise')
    args = parser.parse_args()

    for name, build in DOCUMENTS.items():
        with open(os.path.join(HERE, name), 'w', encoding='utf-8') as handle:
            handle.write(build())
        print(f'wrote {name}')

    if args.png:
        for name, size in PNG_TARGETS.items():
            print(f'wrote {os.path.basename(rasterise(name, size))}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
