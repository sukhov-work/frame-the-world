# Test fixtures

Only `gps-heading.jpg` (2.5 KB) is committed. The larger binaries are gitignored — tests that use
them auto-skip when absent. To regenerate on a new machine:

```bash
# 26 MP Sony ARW (31 MB) — libraw-wasm's own integration fixture (Sony ILME-FX30, no GPS)
curl -sL https://raw.githubusercontent.com/ybouane/LibRaw-Wasm/master/example-sony.ARW \
  -o test/fixtures/example-sony.arw

# HEIC twin of the committed JPEG (macOS: sips + exiftool)
sips -s format heic test/fixtures/gps-heading.jpg --out test/fixtures/gps-heading.heic
exiftool -overwrite_original -TagsFromFile test/fixtures/gps-heading.jpg -all:all \
  test/fixtures/gps-heading.heic
```

`gps-heading.jpg` itself was generated with sips (64 px JPEG) + exiftool writing iPhone-15-Pro-style
EXIF: GPS 48.4647 N / 35.0462 E, altitude 96 m, **GPSImgDirection 214**, FocalLength 6.86,
FocalLengthIn35mmFormat 24, DateTimeOriginal `2026:05:03 07:15:02`.
