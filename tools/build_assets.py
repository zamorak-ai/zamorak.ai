"""Regenerate the site's binary assets from the Zamorak branding package.

Outputs (all under the repository root):
  assets/img/hat.png            white partyhat mark, cropped; nav logo and halftone source
  assets/img/og-image.png       1200x630 social card built from the 1b lockup
  assets/img/icon-192.png       PNG favicon
  apple-touch-icon.png          180x180 home-screen icon
  favicon.ico                   16/32/48 tab icon
  assets/fonts/*.woff2          Latin subsets of the Computer Modern Unicode fonts
  assets/fonts/OFL.txt          the fonts' licence

Usage:
  pip install pillow fonttools brotli
  python tools/build_assets.py [path/to/zamorak-branding]

The branding path defaults to ../zamorak-branding (a sibling of this repository).
Font sources are fetched from a pinned commit of github.com/aaaakshat/cm-web-fonts.
"""

import io
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRANDING = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "zamorak-branding"
IMG = ROOT / "assets" / "img"
FONTS = ROOT / "assets" / "fonts"

BG = (10, 5, 5)  # --bg in site.css
RED = (179, 20, 27)  # --red in site.css
GRID = (196, 36, 32)  # the halftone's empty matrix in halftone.js
MUTED = (154, 113, 107)  # --text-3 in site.css
FONT_BASE = "https://cdn.jsdelivr.net/gh/aaaakshat/cm-web-fonts@333f55ec19733c28cdc43567ecf72eafd6b0af61/font"

# The OFL reserves the name "Computer Modern Unicode fonts", and a subset is a
# modified font, so the subsets are renamed. Each entry: source file, new family, style.
FONT_FILES = {
    "zamorak-serif-regular.woff2": ("Serif/cmunrm.ttf", "Zamorak Serif", "Regular"),
    "zamorak-mono-regular.woff2": ("Typewriter/cmuntt.ttf", "Zamorak Mono", "Regular"),
}
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013-2014,U+2018-201A,"
    "U+201C-201E,U+2022,U+2026,U+2039-203A,U+20AC,U+2122"
)


def fetch(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError(f"refusing to fetch {url!r}: not an https URL")
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def crop_to_content(im: Image.Image, pad: float = 0.02) -> Image.Image:
    left, top, right, bottom = im.getbbox()
    p = round(max(right - left, bottom - top) * pad)
    return im.crop((max(left - p, 0), max(top - p, 0), min(right + p, im.width), min(bottom + p, im.height)))


def fit(im: Image.Image, width: int) -> Image.Image:
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def dot_grid(size: tuple[int, int], pitch: int, radius: float, alpha: int) -> Image.Image:
    """A faint red dot matrix, matching the site's hero background."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for y in range(pitch // 2, size[1], pitch):
        for x in range(pitch // 2, size[0], pitch):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=GRID + (alpha,))
    return layer


def icon(hat: Image.Image, size: int, scale: float, rounded: bool) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=size * 0.22 if rounded else 0, fill=255)
    canvas.paste(Image.new("RGBA", (size, size), RED + (255,)), (0, 0), mask)
    mark = fit(hat, round(size * scale))
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2 + round(size * 0.02)))
    return canvas


def build_images() -> None:
    IMG.mkdir(parents=True, exist_ok=True)
    hat = crop_to_content(Image.open(BRANDING / "hat-only" / "zamorak-hat.png").convert("RGBA"))

    # 360px wide covers the nav logo at 3x and the largest halftone grid the site draws.
    fit(hat, 360).save(IMG / "hat.png", optimize=True)

    icon(hat, 192, 0.72, rounded=True).save(IMG / "icon-192.png", optimize=True)
    icon(hat, 180, 0.66, rounded=False).convert("RGB").save(ROOT / "apple-touch-icon.png", optimize=True)
    icon(hat, 256, 0.76, rounded=True).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    card = Image.new("RGBA", (1200, 630), BG + (255,))
    card.alpha_composite(dot_grid(card.size, pitch=14, radius=1.3, alpha=40))
    lockup = fit(crop_to_content(Image.open(BRANDING / "png" / "1b-lockup.png").convert("RGBA")), 700)
    top = 185
    card.alpha_composite(lockup, ((1200 - lockup.width) // 2, top))
    mono = ImageFont.truetype(io.BytesIO(fetch(f"{FONT_BASE}/Typewriter/cmuntt.ttf")), 30)
    label = "zamorak.ai  ·  coming soon"
    width = ImageDraw.Draw(card).textlength(label, font=mono)
    ImageDraw.Draw(card).text(((1200 - width) / 2, top + lockup.height + 58), label, font=mono, fill=MUTED)
    card.convert("RGB").save(IMG / "og-image.png", optimize=True)


def rename(font: TTFont, family: str, style: str) -> None:
    """Replace every name record that carries the original family name."""
    full = f"{family} {style}" if style != "Regular" else family
    values = {
        1: family,
        2: style,
        3: f"{family.replace(' ', '')}-{style};subset",
        4: full,
        6: f"{family.replace(' ', '')}-{style}",
        16: family,
        17: style,
    }
    name = font["name"]
    for record in list(name.names):
        if record.nameID in values:
            name.setName(values[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)


def build_fonts() -> None:
    FONTS.mkdir(parents=True, exist_ok=True)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    unicodes = subset.parse_unicodes(UNICODES)
    for out, (source, family, style) in FONT_FILES.items():
        font = TTFont(io.BytesIO(fetch(f"{FONT_BASE}/{source}")))
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=unicodes)
        subsetter.subset(font)
        rename(font, family, style)
        font.flavor = "woff2"
        font.save(FONTS / out)
    (FONTS / "OFL.txt").write_bytes(fetch(f"{FONT_BASE}/Serif/OFL.txt"))


if __name__ == "__main__":
    build_images()
    build_fonts()
    for path in sorted([*IMG.iterdir(), *FONTS.iterdir(), ROOT / "favicon.ico", ROOT / "apple-touch-icon.png"]):
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.1f} KB")
