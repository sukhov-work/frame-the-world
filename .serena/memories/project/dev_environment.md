# mem:project/dev_environment
Where this runs and what CAN'T be trusted from a local test. (Referred by `mem:core`, `mem:task_completion`.)

## Machines
- **This Mac** = author / test / git / `wix dev`. Node v22.14, nvm, Wix-scoped npm registry, Wix CLI authed. Source of truth.
- **"Prod" = Wix managed cloud** — reached via `npx @wix/cli@latest release` (NOT SSH; there is no prod box, no `deploy/` scripts).
  The site + business are provisioned by `npm create @wix/new` onto the owner's Wix account.

## What CAN be verified locally
- Unit math (vitest): FOV, geohash, projection, ephemeris. `astro check` types. Lint. Component logic.

## What CANNOT be verified by a local unit test (mark UNVERIFIED until run in the right place)
- **Browser-only** (verify in `wix dev` on desktop Chrome + a real device): globe render + OSM buildings load,
  `load-model` stylization, cinematic camera flight, `libraw-wasm`/HEIC decode correctness + timing, peak WASM
  heap, WebGPU-vs-WebGL2 fallback, mobile memory pressure, OPFS/tile caching, View Transitions.
- **Wix-cloud-only** (verify in `wix dev` / Wix test mode / after `release`): resumable upload of a 25–80MB RAW,
  `onFileDescriptorFileReady` timing, quota `beforeInsert` rejecting insert #11, geohash viewport query results,
  digital purchase + 30-day download delivery, Wix AI credit cost + which Claude/vision models are exposed, and
  whether COOP/COEP page headers are settable (WASM threads). These are the TODO-VERIFY items — each has a safe default.

## Claude Design MCP — bidirectional round-trip (env gotcha FIXED + round-trip CONFIRMED 2026-07-10)
- STATUS: after the fix + restart, `/design consent` granted and `list_projects` returns "Frame the World" —
  read/write round-trip works. Design system imported → `mem:patterns/design-system`. History of the fix below.
- The `claude-design` first-party HTTP MCP (`api.anthropic.com/v1/design/mcp`) is registered globally in
  `~/.claude.json` + permission-allowlisted (project `.claude/settings.json`). Bidirectional project read/write
  (`list_projects`/`read_file`/`write_files`) AND `/design-sync` are HARD-GATED OFF whenever
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set — binary string: "Projects is unavailable while nonessential
  network traffic is restricted (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set)". SYMPTOM: MCP tools load but
  every call errors "hasn't granted this — run /design consent"; and `/design consent` itself silently no-ops
  because the consent POST to `/v1/design/consent` is classed nonessential and blocked (telemetry label
  "design consent POST blocked by policy gate"). NOT a consent/login bug — an upstream killswitch.
- FIX applied 2026-07-10: removed `"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1"` from the `env` block of the
  **GLOBAL** `~/.claude/settings.json` (user chose full removal over the granular DISABLE_TELEMETRY/ERROR_REPORTING/
  AUTOUPDATER/BUG_COMMAND alternative). REQUIRES a full Claude Code quit+relaunch (env is read only at process start;
  the session that applied it still carried the flag). After restart: run `/design consent`. Real CLI subcommands are
  `/design consent | /design login | /design revoke` (v2.1.205 binary); the web app's hyphenated `/design-login` is
  NOT a CLI command. `/design login` = separate design-system credential for `/design-sync`; `/design consent` =
  grant the agent MCP `agent_design_projects` scope (read/edit projects). Also-gated by feature flag
  `CLAUDE_CODE_ENABLE_DESIGN_MCP` (default via server flag) — currently on (tools reach the server).
- Design project "Frame the World" = `fb0d7afa-8a4f-4b2f-9a59-517fb1eeb46c` (owner acct jaysonx1009@gmail.com,
  accountUuid 9cbd958a-4b7f-40ab-bb2c-4f22a28a46d0). Account match matters: `list_projects` only returns projects
  owned by the logged-in Anthropic account. Round-trip workflow rules live in `.claude/claude-docs/provenance/CLAUDE_DESIGN_MEMO.md`
  (fence: design writes ONLY under `src/components/panels|ui/**` + `src/styles/**`, never `globe/**` or `lib/**`).

## Empirical benchmarks owed before Phase 3
a6700 26MP ARW decode ms + heap (desktop + mid phone); Dnipro + 2 rural OSM building coverage; one sun-azimuth almanac spot-check.
