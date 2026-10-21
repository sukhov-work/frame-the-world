#!/usr/bin/env python3
"""The facade-projection test pattern (the photo flow (b) prototype, 2026-10-18).

A 1600x1200 orientation-unambiguous pattern: four saturated quadrants (TL red, TR green, BL blue,
BR yellow), a black UP arrow, TOP/BOTTOM/LEFT/RIGHT labels and a numbered 8x6 grid, written as a
JPEG with iPhone-style EXIF (GPS at the `legacy-fpv-eye` catalogue pose — central Dnipro, facades across the street — heading 25, 26 mm eq,
NO altitude so the frustum seats at eye height on the rendered ground). Regenerate:

    python3 scripts/fixtures/make-facade-pattern.py && exiftool -overwrite_original \
      -GPSLatitude=48.4647 -GPSLatitudeRef=N -GPSLongitude=35.0462 -GPSLongitudeRef=E \
      -GPSImgDirection=25 -GPSImgDirectionRef=T -FocalLength=4.25 -FocalLengthIn35mmFormat=26 \
      -Make=Apple -Model="iPhone 12 Pro" -DateTimeOriginal="2026:10:18 10:30:00" \
      -ExifImageWidth=1600 -ExifImageHeight=1200 test/fixtures/facade-pattern.jpg
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 1200
img = Image.new("RGB", (W, H), (120, 120, 120))
d = ImageDraw.Draw(img)
quads = {(0, 0): (220, 40, 40), (1, 0): (40, 200, 60), (0, 1): (40, 80, 230), (1, 1): (240, 220, 40)}
for (qx, qy), col in quads.items():
    d.rectangle([qx * W // 2, qy * H // 2, (qx + 1) * W // 2 - 1, (qy + 1) * H // 2 - 1], fill=col)
# grid 8x6, numbered
for i in range(1, 8):
    d.line([(i * W // 8, 0), (i * W // 8, H)], fill=(0, 0, 0), width=4)
for j in range(1, 6):
    d.line([(0, j * H // 6), (W, j * H // 6)], fill=(0, 0, 0), width=4)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 120)
    small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 44)
except Exception:
    font = ImageFont.load_default()
    small = font
n = 1
for j in range(6):
    for i in range(8):
        d.text((i * W // 8 + 12, j * H // 6 + 8), str(n), fill=(0, 0, 0), font=small)
        n += 1
# the UP arrow (black), centred
cx, cy = W // 2, H // 2
d.polygon([(cx, cy - 300), (cx - 160, cy - 100), (cx - 60, cy - 100), (cx - 60, cy + 300),
           (cx + 60, cy + 300), (cx + 60, cy - 100), (cx + 160, cy - 100)], fill=(0, 0, 0))
for text, pos in (("TOP", (cx - 150, 20)), ("BOTTOM", (cx - 300, H - 150)),
                  ("LEFT", (30, cy - 60)), ("RIGHT", (W - 420, cy - 60))):
    d.text(pos, text, fill=(255, 255, 255), font=font, stroke_width=6, stroke_fill=(0, 0, 0))
img.save("test/fixtures/facade-pattern.jpg", "JPEG", quality=82, optimize=True)
print("wrote test/fixtures/facade-pattern.jpg")
