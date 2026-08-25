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

`esri-placeholder.jpg` (2,521 B) is Esri World Imagery's HTTP-**200** "Map data not available"
sentinel — the one it serves outside its local coverage, byte-identical at every level and
location (RC5 / owner bug B1). It is committed because `ESRI_PLACEHOLDER.fnv1a32` in
`src/lib/globe/esriPlaceholder.ts` has to be pinned against the real bytes, not against itself.
It carries no map data. Re-probe with any tile outside coverage:

```bash
curl -s https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/22/2097152/2097152 \
  -o test/fixtures/esri-placeholder.jpg
```

`gps-heading.jpg` itself was generated with sips (64 px JPEG) + exiftool writing iPhone-15-Pro-style
EXIF: GPS 48.4647 N / 35.0462 E, altitude 96 m, **GPSImgDirection 214**, FocalLength 6.86,
FocalLengthIn35mmFormat 24, DateTimeOriginal `2026:05:03 07:15:02`.
