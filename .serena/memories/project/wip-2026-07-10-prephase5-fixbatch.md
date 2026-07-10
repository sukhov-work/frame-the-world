# DONE — 2026-07-10 pre-Phase-5 owner fix batch (8 asks)

Shipped + browser-VERIFIED same day (Playwright MCP on wix dev, shots verify-shots/prephase5-01..11).
Full mechanics live in the taxonomy (this file is the session closure pointer — safe to delete on
the next maintenance pass):
- Terminator narrowing + low-altitude sky/haze regime + dome re-anchor trap + night stars + Milky
  Way (galactic transform + sub-pixel-point trap) + high-alt patchwork fix →
  `mem:patterns/sky-bodies-terrain` §"Pre-Phase-5 fix batch"
- ROTATE/ZOOM sliders + glide frame-consistency + getPivotPoint-null traps →
  `mem:patterns/globe-rendering` §"Manual heading/zoom sliders"
- Projection pose retune + plane opacity → `mem:patterns/photo-frustum` (FLIGHT/FRUSTUM tunables;
  slider in PhotoDetailPanel via store/upload.planeOpacity)
- One-line record → DECISIONS.md top entry 2026-07-10 "Pre-Phase-5 owner fix batch SHIPPED"
- Carried follow-ups → NEXT_SESSION_PROMPT.md
145 vitest (+11) · astro check 0 · wix build green.

## Batch #2 same day (multiday scrubber + crisper shadows + patchwork root cause)
Browser-VERIFIED (shots prephase5b-01..10) · 149 vitest (+4) · astro check 0 · wix build green.
Mechanics → `mem:patterns/sky-bodies-terrain` §Owner batch #2 · DECISIONS 2nd-from-top entry.
Key rulings: Esri patchwork = mosaic seams IN THE SOURCE imagery (fade band → 750/380 km, Blue
Marble owns orbit); shadow contrast is palette-limited (mask always crisp — debug contrast
first); date picker = browser-TZ day boundaries (v1).
