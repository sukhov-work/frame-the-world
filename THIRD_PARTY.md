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
