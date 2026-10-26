"""Generate the Windows icon from the same geometry as `public/favicon.svg`.

Tauri's Windows resource step requires `icons/icon.ico`. Keeping the icon
generated from the favicon's own coordinates means the taskbar/title-bar mark
cannot drift from the browser tab mark; the SVG stays the source of truth and
this script is the rasteriser.

    python shells/tauri/icons/make_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

# Favicon coordinates are authored in a 32-unit square.
UNIT = 32
SUPERSAMPLE = 16  # draw big, downsample for clean edges
S = UNIT * SUPERSAMPLE

BG = "#3A3128"
SHEET = "#F3EAD7"
SPINE = "#9C3B2E"
RULE = "#2A2118"

OUT_DIR = Path(__file__).resolve().parent
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def u(value: float) -> float:
    return value * SUPERSAMPLE


def rounded(draw: ImageDraw.ImageDraw, box, radius: float, fill: str) -> None:
    x0, y0, x1, y1 = (u(v) for v in box)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=u(radius), fill=fill)


def main() -> None:
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    rounded(draw, (0, 0, 32, 32), 7, BG)
    rounded(draw, (9, 5, 26, 27), 1.4, SHEET)
    rounded(draw, (5.5, 8, 10.5, 15), 1.1, SPINE)

    rules = [(12.2, 12.2, 23.2), (12.2, 16.0, 23.2), (12.2, 19.8, 20.2)]
    ink = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ink_draw = ImageDraw.Draw(ink)
    for x0, y, x1 in rules:
        ink_draw.line([(u(x0), u(y)), (u(x1), u(y))], fill=RULE, width=int(u(1.35)), joint="curve")
        # Round caps, the SVG's `stroke-linecap="round"`.
        r = u(1.35) / 2
        for cx in (u(x0), u(x1)):
            ink_draw.ellipse([cx - r, u(y) - r, cx + r, u(y) + r], fill=RULE)
    ink.putalpha(ink.getchannel("A").point(lambda a: int(a * 0.72)))
    canvas.alpha_composite(ink)

    master = canvas.resize((1024, 1024), Image.LANCZOS)
    master.save(OUT_DIR / "icon.png")

    frames = [master.resize((n, n), Image.LANCZOS) for n in ICO_SIZES]
    frames[-1].save(
        OUT_DIR / "icon.ico",
        format="ICO",
        sizes=[(n, n) for n in ICO_SIZES],
        append_images=frames[:-1],
    )
    print(f"wrote {OUT_DIR / 'icon.ico'} ({len(ICO_SIZES)} sizes) and icon.png")


if __name__ == "__main__":
    main()
