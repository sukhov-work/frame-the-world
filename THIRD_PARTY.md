# Third-party decode components

WASM decoders shipped to the browser (dynamic linkage from a web app — no source obligations
triggered beyond attribution; noted per IMPLEMENTATION_PLAN Phase-2 safety notes):

| Package | Version | Upstream | License |
|---|---|---|---|
| `libraw-wasm` | 1.0.5 (pinned — last single-threaded build) | LibRaw | wrapper ISC; LibRaw LGPL-2.1 / CDDL-1.0 dual |
| `libheif-js` | ^1.19 | libheif (strukturag) | wrapper ISC; libheif LGPL-3.0 |
| `exifr` | ^7.1 | — | MIT |

`libraw-wasm` is pinned to 1.0.5 because every later build requires SharedArrayBuffer
(COOP/COEP cross-origin isolation), unverified on Wix managed hosting. See DECISIONS 2026-07-10.

# Sky / ephemeris assets (pre-Phase-4, 2026-07-10)

| Component | Source | License |
|---|---|---|
| `astronomy-engine` 2.1.19 (exact-pinned, ADR D6) | github.com/cosinekitty/astronomy | MIT |
| `public/textures/moon-color.jpg` (LROC 1k colour map) | NASA SVS CGI Moon Kit — svs.gsfc.nasa.gov/4720 | NASA media — public domain (attribution appreciated) |
| Cesium World Terrain (ion asset 1, streamed) | Cesium ion | ion subscription terms; attribution in-app (D13) |

# Sky catalog & panorama assets (S6 + astro-engine era; appended 2026-08-15)

Baked catalogs — run-once `scripts/build-*.mjs` scripts fetch, validate, and commit the output;
the provenance/license contract lives in each script's header comment:

| Component | Source | License |
|---|---|---|
| `public/data/asterisms.json` + `public/data/constellation-lines.json` + `src/lib/sky/constellations.ts` (26 asterism figures; 88 IAU constellation figures + label anchors) | d3-celestial data (Olaf Frohn) — github.com/ofrohn/d3-celestial, via `scripts/build-asterisms.mjs` / `build-constellations.mjs` | BSD-3-Clause — attribution kept in the baked asset's `credit` field |
| `public/data/openngc.bin` + `src/lib/sky/ngcNames.ts` (~14k NGC/IC deep-sky objects; Messier rows deliberately excluded from this bake) | OpenNGC (mattiaverga) — github.com/mattiaverga/OpenNGC, via `scripts/build-openngc-catalog.mjs` | **CC-BY-SA-4.0** — cite "OpenNGC (mattiaverga, CC-BY-SA-4.0)" wherever this data surfaces (bake-script contract) |
| `public/textures/milkyway-2020.jpg` + the 2k mobile variant (Milky Way panorama haze) | NASA/GSFC SVS "Deep Star Maps 2020" — svs.gsfc.nasa.gov/4851 (credit rendered in `index.astro`; 2k re-bake: `scripts/build-milkyway-2k.mjs`) | NASA media — public domain per NASA media guidelines |

Live query services (long-tail sky search only — nothing redistributed, results TTL-cached in
localStorage):

| Service | Use | Terms |
|---|---|---|
| SIMBAD TAP (CDS, Strasbourg) | client-side long-tail identifier resolution — `src/lib/sky/simbad.ts` (debounced, one query per user pause per the CDS courtesy contract) | free service; CDS expects an acknowledgment — **verify exact acknowledgment wording before release** |
| JPL SSD/SBDB API | small-body osculating elements via the thin `/api/sbdb` relay — `src/lib/sky/sbdb.ts` (JPL sends no CORS) | NASA/JPL public data service, no key — **verify attribution/ToS before release** |
