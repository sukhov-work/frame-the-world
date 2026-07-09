# mem:task_completion — quality gate before "done"
1. `npm test` (vitest) green — or the focused module. FOV/geohash/projection math must pass.
2. `npx astro check` (types) clean + `npm run lint` clean.
3. No import side effects / no debug leftovers / no committed tokens (ion, Wix) — env only.
4. Conventions honored (`.claude/conventions/` — esp. `wix-headless.md`, `architecture-and-patterns.md`).
5. **Tier your claims:** browser/Wix-cloud things (globe render, decode, quota #11, purchase, AI cost) are
   **UNVERIFIED** until actually run in `wix dev` / Wix test mode — a passing unit test ≠ a working globe
   (`mem:project/dev_environment`).
6. Never fabricate a Wix API signature — confirm via Wix MCP. Never expose exact GPS on a public pin (C6).
7. Record: `write_memory` + append `DECISIONS.md` + refresh `NEXT_SESSION_PROMPT.md` + tick the plan phase
   (`mem:decisions/session_workflow`).
