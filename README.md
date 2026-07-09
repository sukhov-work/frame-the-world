# Frame the World

> Working title (provisional — ADR D15). A minimalist, low-key but hi-tech web app that projects your
> camera photos into the real world: upload a RAW/JPEG, and the app reads its EXIF and renders the
> photo as an oriented **camera frustum + image plane** at its true capture location on a **stylized 3D
> globe with real OSM buildings**. Tweak focal length, heading, pitch, position and capture time in
> real time to see *what you could have done differently*. Sun/moon/star sliders (ephemeris) drive the
> same scene. Save & publish pins, sell your full-res RAWs, get AI shot-analysis.

**Owner:** Yevhen · **Status:** bootstrapped, pre-implementation (Phase 1 next) · **Platform:** Wix-managed headless (Astro 5)

---

## The stack (locked — see `.claude/claude-docs/PROJECT_SEED.md` §4 / `DECISIONS.md`)

| Layer | Choice |
|---|---|
| Framework | Astro 5 (Wix-managed headless), globe as a `client:only` island |
| 3D globe | three.js + `3d-tiles-renderer@^0.4` + Cesium OSM Buildings (ion 96188) + `GlobeControls` |
| RAW decode | `libraw-wasm` in a Web Worker + `exifr` embedded-JPEG instant preview; HEIC via Safari-native / `libheif-js` |
| Ephemeris | `astronomy-engine` (±1 arcmin) + procedural sky + Yale BSC5 stars |
| State | `zustand` |
| Backend | Wix Data Collections · Media Manager · Pricing Plans · eCommerce (digital) · AI proxy (Claude) |

## Where things live

- **Design & plan** → `.claude/claude-docs/` — start with `ARCHITECTURE.md` and `IMPLEMENTATION_PLAN.md`
  (working docs); `PROJECT_SEED.md` + `DEEP_RESEARCH.md` are the canonical intent & research provenance.
- **Decisions log** → `.claude/claude-docs/DECISIONS.md` (append-only, dated, ADR-backed).
- **How to build here** → `.claude/CLAUDE.md` (operating contract) + `.claude/conventions/`.
- **Dev skill** → run **`/frame`** in Claude Code for feature work, fixes, design, research.

## Getting started (Phase 1 — not yet run)

The Astro app is **not scaffolded yet**. Phase 1 of `IMPLEMENTATION_PLAN.md` runs:

```bash
# from this repo root (preserves the existing .git — see the plan's Phase 1 note)
npm create @wix/new@latest headless -- --folder-name . --business-name "Frame the World" --site-template
wix dev        # rotating stylized globe locally
```

Prereqs (already set up on this machine): Node ≥ 20.11 (have v22.14), Wix CLI authed (`npx @wix/cli@latest whoami`),
Wix-scoped npm registry. Cesium ion token required for the globe (Phase 1).

## Open questions to verify with internal Wix access

Tracked in `IMPLEMENTATION_PLAN.md` § TODO-VERIFY — each has a safe default so the build is never blocked
(RAW upload MB cap · COOP/COEP header control · HTTP endpoint limits · Wix AI vision model list & credit cost).
