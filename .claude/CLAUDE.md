# CLAUDE.md — Frame the World

Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project the
photo as an oriented **camera frustum + image plane** at its real capture location on a **stylized 3D
globe with real OSM buildings**; tweak EXIF (focal/heading/pitch/position/time) in real time; ephemeris
(sun/moon/stars) drives the same scene; members save/publish pins; light RAW marketplace; premium AI
shot-analysis. **The client does the heavy lifting** (WASM decode, projection, rendering); Wix is the
backend (auth, Data, Media, Pricing Plans, eCommerce, AI proxy).

## Knowledge — Search Order (stop at first hit)
1. **Serena memories**: `list_memories` → read `mem:core` (graph root) → follow its index.
2. **`.claude/claude-docs/`** — `DECISIONS.md` (recent state, top-first) · `ARCHITECTURE.md` +
   `IMPLEMENTATION_PLAN.md` (repo-native working docs) · `PROJECT_SEED.md` + `DEEP_RESEARCH.md`
   (canonical provenance — intent & research) · `CLAUDE_DESIGN_MEMO.md` (design workflow).
3. **`.claude/conventions/`** — `wix-headless.md` (the distilled Wix mechanics) · architecture · testing · naming · errors · `globe-tuning.md` (globe scene modules + tunables contract).
4. **Codebase**: Serena semantic tools → `Grep` → `Read`.
5. **External**: Wix MCP / Wix Skills (framework APIs — never fabricate signatures), `gh` CLI, web.

After significant work: `write_memory` + append `DECISIONS.md` (see `mem:decisions/session_workflow`).

## Authority
`PROJECT_SEED.md` §3 (constraints C1–C6) and §4 (ADR-000, D1–D15) are **binding**. `ARCHITECTURE.md`
and `IMPLEMENTATION_PLAN.md` are the source of truth on *execution* and distill `DEEP_RESEARCH.md`
(Handoff #2) — that doc stays as provenance. Any new decision **extends** `DECISIONS.md` or explicitly
supersedes a prior line; it never edits history.

## Tools — Serena First
Serena MCP is PRIMARY for code navigation + editing. Navigate: `get_symbols_overview` → `find_symbol`
→ `find_referencing_symbols` → `type_hierarchy`. Edit: `replace_symbol_body`, `insert_before/after_symbol`.
Fall back to Grep/Read for broad text search, and Claude Read/Edit/Write for config/markdown.

## Workflow — the `/frame` skill
Use **`/frame`** for all implementation / design / fix / research (classify → cited parallel research →
execute → machine-split verify → record). For flagship cross-cutting design or migrations, reach for
`investigate-design-v3`. Persist via `mem:decisions/session_workflow` (DECISIONS + NEXT_SESSION + memories).

## Build / Test / Run — Node/TS + Astro 5 (Wix headless)
> Commands below become live **after Phase 1 scaffolds the Astro app** (`npm create @wix/new`). See
> `mem:suggested_commands` for the full list and `conventions/wix-headless.md` for auth/build/release.
- Deps: `npm install --legacy-peer-deps`  (pnpm **fails** against the `@wix/cli` template)
- Dev: `wix dev`  ·  Types: `npx astro check`  ·  Test: `npm test` (vitest). **No lint script** — `astro check` + `npm test` are the done-gates.
- Release: `npx @wix/cli@latest build` → `npx @wix/cli@latest release`  (no SSH — "prod" is Wix cloud)
- Auth: `npx @wix/cli@latest token --site "$SITE_ID"` (site-scoped REST; mint once, cache). `whoami` to check.
- **Never claim done with failing tests or `astro check` errors.** Never fabricate a Wix API signature.
- **Browser-verification screenshots go in `verify-shots/` (git-ignored) — NEVER the repo root.**
  Pass the folder in the screenshot filename (e.g. `verify-shots/phase4-01-terminator.jpeg`).

## Hard Constraints (from PROJECT_SEED §3 — violations = bugs)
- **C1 Client-heavy.** WASM RAW decode is the primary path; offload to the client. Server-side decode
  never runs on Wix HTTP endpoints (timeout/quota unfit for 26–60MP).
- **C2 Accuracy AND beauty.** Real 3D buildings + geo-accuracy AND a stylized cinematic look with full
  camera control — neither half may be sacrificed (the engine hybrid D1 exists to satisfy both).
- **C3 Marketplace v1 is light.** Digital-only, owner-mediated payout (Wix has **no** split payments).
- **C4 Platform pins.** Astro **5** only (Astro 6 unsupported). The globe is a `client:only` island —
  **never SSR WebGL**.
- **C5 Google tiles untouched.** Photorealistic 3D Tiles ToS bans styling/derivation — optional
  "realistic mode" only, off by default, unmodified, with mandatory attribution.
- **C6 Wartime geo-sensitivity.** Owner is in Dnipro, UA. Public pins default to **reduced precision**
  (exact / ~1km / city); exact GPS is **never** exposed on public low-res pins; moderation gates publication.

## Platform gotchas (encode these — full list in conventions/wix-headless.md)
- Media >10MB **must** use `generateFileResumableUploadUrl` (TUS). Uploads are async → `onFileDescriptorFileReady`.
- Backend admin calls need `elevate()` (`@wix/essentials`); visitor context is anonymous → 403 otherwise.
- Wix Data has **no** geo query → geohash-prefix `hasSome` + client refine.
- Claude vision does **not** accept RAW → always send a downsized JPEG/PNG preview.
- No cron on headless → external scheduler hits a token-secured HTTP endpoint if ever needed.
- Digital download links expire after 30 days (not shortenable) → message buyers.

## Design workflow (Claude Design — see CLAUDE_DESIGN_MEMO.md)
Tokens source of truth = `src/styles/tokens.css` (plain CSS custom properties — **no Tailwind** in this repo). After any design import, regenerate the
GL bridge `src/lib/theme/tokens.ts`. Design imports write ONLY under `src/components/panels|ui/**` +
`src/styles/**` — **NEVER** `src/components/globe/**` or `src/lib/**` (the canvas globe is motion-spec only).
