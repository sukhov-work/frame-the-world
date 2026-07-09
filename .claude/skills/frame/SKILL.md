---
name: frame
description: >
  Universal development skill for Frame the World (Wix headless / Astro 5 photo-on-3D-globe instrument).
  Handles feature implementation, architecture decisions, bug fixing, research, and design. Parallel-first
  with confidence tracking. Trigger on: "implement", "build", "add", "fix", "debug", "design", "plan",
  "investigate", "research", any IMPLEMENTATION_PLAN.md phase reference (e.g. "Phase 3"), the globe/decode/
  projection/ephemeris/Wix-backend subsystems, or any task requiring multi-file changes.
argument-hint: <what to build, fix, investigate, or design>
---

# frame: Parallel-First Development

Implementing, designing, investigating, and fixing code for **Frame the World** — a Wix-managed headless
(Astro 5) app that projects camera photos onto a stylized 3D globe with real OSM buildings; client-heavy
(WASM decode + three.js), Wix as the backend. Design docs: `.claude/claude-docs/ARCHITECTURE.md` (canonical
map), `.claude/claude-docs/IMPLEMENTATION_PLAN.md` (7-phase build). Conventions: `.claude/conventions/`
(especially `wix-headless.md`). Heavy design/migration → reach for `investigate-design-v3` skill (/Users/yevhens/Projects/wix-private/ecom/ecom/.claude/ecom-grill-agent-kb/skills/investigate-design-v3) instead.

## Workflow
```
Phase 0: Parse intent + load context (+ read DECISIONS.md / NEXT_SESSION_PROMPT.md)
Phase 1: Parallel research — every claim cited or UNVERIFIED (if needed)
Phase 2: Implement / Fix / Design
Phase 3: Verify — split by tier (local-runnable vs browser/Wix-cloud-only)
Phase 4: Record — Serena memory + DECISIONS.md + NEXT_SESSION_PROMPT.md
```

## Phase 0: Classify + load
| Type | Depth | Skip |
|------|-------|------|
| Implement | research → code → test → verify | — |
| Fix | locate → diagnose → fix → verify | Phase 1 if location known |
| Design | research → options → recommend → doc | Phase 3 tests |
| Research | parallel agents → synthesize → report | Phase 2–3 |

Load: `list_memories` → `mem:core` + topical memories; the relevant `ARCHITECTURE.md`/`IMPLEMENTATION_PLAN.md`
section (**read the plan's phase before touching its code**); conventions. Build a shared-context block for
sub-agents (request · type · affected modules · related doc section · known constraints · key files).

## Phase 1: Parallel research (when needed)
Launch applicable agents as `Agent(subagent_type="general-purpose")` (or `Explore`) in a SINGLE message.
Roles: **Codebase** (map existing code via Serena), **Architecture-reference** (check ARCHITECTURE/plan +
conventions to catch deviations early), **Library-research** (verify external libs — `three`,
`3d-tiles-renderer`, `libraw-wasm`, `exifr`, `astronomy-engine` — from source/docs, not marketing). For
**Wix framework APIs, use the Wix MCP / Wix Skills** — never fabricate a signature. Each agent returns:
`## Findings` · key facts (each with `file:line`/doc/URL) · constraints · `Confidence: XX%` · gaps.

### Evidence discipline (every claim — main agent + sub-agents)
- Cite `file:line`, a doc section, or a URL — or mark it **UNVERIFIED**. "Could work" is not a finding.
- **Confidence gate:** ≥70% → act; <30% → fall back to reading code / the design doc / Wix MCP; in
  between → reformulate once, then proceed with the gap named.

## Phase 2: Execute
- **Implement:** read the `IMPLEMENTATION_PLAN.md` phase + conventions first; write code + tests together;
  run `npm test` + `npx astro check`. Prefer the Wix JS SDK; `elevate()` only where required.
- **Fix:** reproduce → locate (Serena `find_symbol` / `find_referencing_symbols`) → minimal fix + regression test.
- **Design:** options table (complexity / fits-arch / risk) → recommend with evidence → write to
  `.claude/claude-docs/`. If it changes a locked ADR (D1–D15), supersede via a new `DECISIONS.md` line.

### Non-negotiables while executing (from CLAUDE.md / conventions)
- Globe = `client:only`; **never SSR WebGL**. Decode in a **Web Worker**; free RAW buffers immediately.
- **Never fabricate a Wix API signature** — verify via Wix MCP. Keep endpoints thin (heavy compute client-side, C1).
- **Fence the globe:** design imports write only under `src/components/panels|ui/**` + `src/styles/**`,
  never `src/components/globe/**` or `src/lib/**`. Regenerate `lib/theme/tokens.ts` after any token import.
- **C6 privacy:** never expose exact GPS on a public pin — hard bug.

## Phase 3: Verify — split by tier
**"Compiles" ≠ verified. "Runs a unit test" ≠ "the globe renders."** State each claim's tier.
### Local-runnable (every time)
```
npm test            # vitest — FOV / geohash / projection / ephemeris math green (or the focused module)
npx astro check     # types
npm run lint        # lint clean
```
Fix all failures before claiming success.
### Browser / Wix-cloud-only (mark UNVERIFIED until actually run there — see mem:project/dev_environment)
- **Browser:** globe render, cinematic flight, `libraw-wasm`/HEIC decode, WebGPU fallback, mobile memory —
  verify in `wix dev` on desktop Chrome (+ a real device for mobile decode).
- **Wix cloud:** quota #11 rejection, resumable upload, geohash viewport query, digital purchase, AI credit
  cost — verify in `wix dev` / Wix test mode. `wix release` publishes to the live URL (there is no SSH box).

## Phase 4: Record the decision (bookend-out — don't skip)
1. `write_memory` under the taxonomy (`architecture/`, `decisions/`, `patterns/`, `bugs/`, `project/`):
   decisions, file paths, gotchas, measured numbers (decode ms, heap MB). Code over prose. `edit_memory` for stale.
2. Append ONE dated line to `DECISIONS.md`: change · files · numbers · verification tier.
3. Refresh `NEXT_SESSION_PROMPT.md` if the phase moved; advance "Next step" in `mem:core`; tick the plan's phase checkbox.
An artifact without a memory + DECISIONS twin is not done.

## Deploy / "prod" (no SSH — Wix is the cloud)
`npx @wix/cli@latest build` → `release` publishes to Wix hosting. Auth: `token --site "$SITE_ID"` (mint once).
See `conventions/wix-headless.md` for the full mechanics + recovery ladder.

## Anti-Patterns
| Don't | Do |
|---|---|
| Implement without reading the plan phase | Read `IMPLEMENTATION_PLAN.md` first |
| Fabricate a Wix SDK method | Verify via Wix MCP / Wix Skills |
| SSR the globe / decode on the main thread | `client:only` island + Web Worker |
| Let a design import touch the globe/lib | Fence it to `panels/ui/styles` |
| Skip tests | Tests alongside code (FOV/geohash are load-bearing) |
| Serialize independent research | Parallel sub-agents in one message |
| Claim the globe "works" from a passing unit test | Mark UNVERIFIED until run in the browser |
| Expose exact GPS on a public pin | Reduced precision only (C6) |
| Report success with failing tests / `astro check` errors | Fix all failures first |
