"""Ordinary Telegram gifts: the picture is the gift on its own coloured background (taken from the gift's own colour), not too big in the frame."""
import io
import colorsys
from PIL import Image

SIZE = 512
SHARE = 0.60            # the gift takes this share of the frame: it is moved away from the edges


# the background colour (hue 0-360, saturation) for each gift; an unknown gift takes the colour of its own picture
TONES = {'heart': (330, .62), 'bear': (28, .5), 'rose': (352, .62), 'gift': (8, .55), 'cake': (320, .3), 'bouquet': (140, .42),
         'rocket': (214, .6), 'champagne': (95, .4), 'trophy': (42, .6), 'ring': (200, .35), 'diamond': (205, .6)}


def compose(raw: bytes, key: str = '') -> bytes:
    gift = Image.open(io.BytesIO(raw)).convert('RGBA')
    box = gift.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if box:
        gift = gift.crop(box)
    # the colour of the gift: the average of its solid pixels, weighted towards the saturated ones
    small = gift.resize((48, 48))
    total = [0.0, 0.0, 0.0]
    weight = 0.0
    for r, g, b, a in zip(*[iter(small.tobytes())] * 4):
        if a < 200:
            continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        w = 0.15 + s * v
        total[0] += r * w; total[1] += g * w; total[2] += b * w; weight += w
    r, g, b = [c / weight / 255 for c in total] if weight else (0.5, 0.5, 0.6)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    s = max(0.35, min(0.8, s))
    if key in TONES:
        h, s = TONES[key][0] / 360, TONES[key][1]
    centre = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(h, s * 0.85, 0.55))
    edge = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(h, s, 0.26))
    mask = Image.radial_gradient('L').resize((SIZE, SIZE))          # black in the centre, white at the edge
    background = Image.composite(Image.new('RGB', (SIZE, SIZE), edge), Image.new('RGB', (SIZE, SIZE), centre), mask).convert('RGBA')
    scale = SIZE * SHARE / max(gift.size)
    gift = gift.resize((max(1, round(gift.width * scale)), max(1, round(gift.height * scale))), Image.LANCZOS)
    background.alpha_composite(gift, ((SIZE - gift.width) // 2, (SIZE - gift.height) // 2))
    out = io.BytesIO()
    background.convert('RGB').save(out, 'PNG', optimize=True)
    return out.getvalue()
