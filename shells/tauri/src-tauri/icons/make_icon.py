"""Generate the Windows icon and PNG sizes from the same geometry as
`public/favicon.svg`.

The favicon is the source of truth for the mark; this script is the only
rasteriser. Draw big and downsample for clean edges, and render a *simplified*
16px master: at that size the torn edge, fold highlight and hairline either blur
together or vanish, so the small icon keeps only the three shapes that read —
the cream sheet, the thick wax-red spine and a plain folded corner.

    python shells/tauri/icons/make_icon.py

Writes, next to this file:
    icon.png       1024px master (full detail)
    icon-<n>.png   PNG frames at each ICO size
    icon.ico       multi-resolution Windows icon
"""
from pathlib import Path

from PIL import Image, ImageDraw

# Favicon coordinates are authored in a 32-unit square.
UNIT = 32
SUPERSAMPLE = 16  # draw big, downsample for clean edges
S = UNIT * SUPERSAMPLE

SHEET = "#F3EAD7"
SHEET_EDGE = "#D8CBB0"
FOLD = "#E4D8C0"
SPINE = "#9C3B2E"

OUT_DIR = Path(__file__).resolve().parent
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
# The one size that gets the simplified drawing.
SIMPLIFIED_SIZE = 16

# Torn bottom edge of the full mark, right to left (favicon path).
TORN_BOTTOM = [
    (30.0, 26.8),
    (27.6, 25.9),
    (25.2, 27.7),
    (22.8, 26.1),
    (20.4, 27.9),
    (18.0, 26.2),
    (15.6, 27.8),
    (13.2, 26.1),
    (10.8, 27.6),
    (8.4, 26.3),
    (6.0, 27.2),
]


def u(value: float) -> float:
    return value * SUPERSAMPLE


def pts(points) -> list[tuple[float, float]]:
    return [(u(x), u(y)) for x, y in points]


def draw_full(draw: ImageDraw.ImageDraw) -> None:
    """The favicon's geometry: torn bottom edge and a folded corner."""
    sheet = [(6, 3), (26, 3), (30, 7), *TORN_BOTTOM]
    draw.polygon(pts(sheet), fill=SHEET, outline=SHEET_EDGE)

    # Folded top-right corner.
    draw.polygon(pts([(26, 3), (30, 7), (26, 7)]), fill=FOLD)

    # Thick wax-red spine on the left.
    draw.polygon(pts([(6, 3), (10, 3), (10, 27.4), (8, 27.3), (6, 27.2)]), fill=SPINE)


def draw_simplified(draw: ImageDraw.ImageDraw) -> None:
    """16px master: three shapes, straight edges, no hairlines."""
    draw.rounded_rectangle(pts([(6, 3), (30, 28)]), radius=u(1.2), fill=SHEET, outline=SHEET_EDGE)
    draw.polygon(pts([(26, 3), (30, 7), (26, 7)]), fill=FOLD)
    draw.rectangle(pts([(6, 4), (11, 28)]), fill=SPINE)


def master(detail: str) -> Image.Image:
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    if detail == "simplified":
        draw_simplified(draw)
    else:
        draw_full(draw)
    return canvas.resize((1024, 1024), Image.LANCZOS)


def main() -> None:
    full = master("full")
    simple = master("simplified")

    full.save(OUT_DIR / "icon.png")

    frames = []
    for n in ICO_SIZES:
        source = simple if n <= SIMPLIFIED_SIZE else full
        frame = source.resize((n, n), Image.LANCZOS)
        frame.save(OUT_DIR / f"icon-{n}.png")
        frames.append(frame)

    # PIL writes the ICO from the largest image and the supplied sizes; keep the
    # 16px frame first so it stays the simplified drawing.
    by_size = {frame.width: frame for frame in frames}
    ordered = [by_size[n] for n in sorted(by_size, reverse=True)]
    ordered[0].save(
        OUT_DIR / "icon.ico",
        format="ICO",
        sizes=[(n, n) for n in ICO_SIZES],
        append_images=ordered[1:],
    )
    print(
        f"wrote {OUT_DIR / 'icon.ico'} ({len(ICO_SIZES)} sizes), "
        f"{len(ICO_SIZES)} PNG frames and icon.png"
    )


if __name__ == "__main__":
    main()
