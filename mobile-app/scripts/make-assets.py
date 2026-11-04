#!/usr/bin/env python3
"""Store assets for the DocTurn native shell, generated from the web app's icons.

Source of truth: ../webapp/icons/ (the PWA's icons — the blue #2563EB field
with the white "D"). Everything in mobile-app/assets/ is derived from them so
the home-screen icon of the shell and of the home-screen web app are the same.

    python3 scripts/make-assets.py        # needs Pillow (pip install pillow)

Outputs (mobile-app/assets/):
  icon.png                       1024×1024 opaque RGB — iOS App Store icon
                                 (Apple rejects alpha). An upscale of the
                                 512 px master: replace with a 1024 px master
                                 from the designer before submission.
  android-icon-foreground.png    1024×1024 RGBA — the glyph only, placed as in
                                 the full-bleed icon; the adaptive icon's
                                 backgroundColor (#2563EB) restores the field.
  android-icon-monochrome.png    1024×1024 RGBA — Android 13+ themed icon.
  splash-icon.png                1024×1024 RGBA glyph — shown at 200 px wide
                                 on the splash background by expo-splash-screen.
  notification-icon.png          96×96 RGBA white glyph — Android status-bar
                                 (small) notification icon; must be white on
                                 transparent.
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ICONS = HERE.parent.parent / "webapp" / "icons"
OUT = HERE.parent / "assets"
BLUE = (37, 99, 235)  # #2563EB — the field colour in the source icons


def glyph_mask(src: Image.Image) -> Image.Image:
    """The white glyph as white-on-transparent: alpha = how far a pixel is from the blue field towards white (anti-aliased edges keep a partial alpha)."""
    rgb = src.convert("RGB")
    w, h = rgb.size
    out = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    px = rgb.load()
    op = out.load()
    span = 255 - BLUE[0]
    for y in range(h):
        for x in range(w):
            r, _g, _b = px[x, y]
            a = max(0, min(255, round((r - BLUE[0]) * 255 / span)))
            op[x, y] = (255, 255, 255, a)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    full = Image.open(ICONS / "icon-512-maskable.png").convert("RGB")
    if full.size != (512, 512):
        raise SystemExit(f"unexpected master size {full.size}")

    # iOS icon: opaque, full-bleed, 1024 px.
    full.resize((1024, 1024), Image.LANCZOS).save(OUT / "icon.png", optimize=True)

    glyph = glyph_mask(full).resize((1024, 1024), Image.LANCZOS)
    glyph.save(OUT / "android-icon-foreground.png", optimize=True)
    glyph.save(OUT / "android-icon-monochrome.png", optimize=True)
    glyph.save(OUT / "splash-icon.png", optimize=True)

    # Android small notification icon: the glyph cropped to its bounds, white on transparent.
    bbox = glyph.getbbox()
    cropped = glyph.crop(bbox)
    side = max(cropped.size)
    square = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    square.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    square.resize((96, 96), Image.LANCZOS).save(OUT / "notification-icon.png", optimize=True)

    for f in sorted(OUT.iterdir()):
        im = Image.open(f)
        print(f"{f.name}: {im.size[0]}x{im.size[1]} {im.mode}")


if __name__ == "__main__":
    main()
