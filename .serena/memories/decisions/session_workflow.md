# mem:decisions/session_workflow
The cross-session persistence loop for this repo. (Referred by `mem:core`.)
## Four artifacts (never duplicate roles)
- **Serena memories** (`.serena/memories/`) — durable, non-obvious facts; graph at `mem:core`; taxonomy
  `architecture/ decisions/ patterns/ bugs/ project/`.
- **`DECISIONS.md`** (committed) — append-only dated log, ONE line per change: what · files · numbers ·
  verification tier (local-tested / wix-VERIFIED / UNVERIFIED). Supersede with a newer line; never edit old ones.
- **`NEXT_SESSION_PROMPT.md`** (gitignored) — copy-paste mission brief for the next session; regenerated each handover.
- **conventions + design docs** (`.claude/`) — stable rules + canonical design. `mem:core` fixes the search order.
## Lifecycle
- START: `activate-serena.sh` (SessionStart) → activate Serena on `$(pwd)`, `list_memories`, read `mem:core`
  → its index; read `DECISIONS.md`; if resuming, read `NEXT_SESSION_PROMPT.md`. Stub the outcome target early.
- RUN: the **`/frame`** skill (classify → cited parallel research → execute → tier-split verify → record).
- END: `session-end.sh` (PreCompact) → `write_memory`/`edit_memory` + append `DECISIONS.md` + refresh
  `NEXT_SESSION_PROMPT.md` + advance `mem:core` "Next step". Clean-exit persistence = stub-at-start +
  PreCompact + the `/frame` skill's Phase 4 (SessionEnd can't drive the model).
## Don't
A claude-docs artifact without a memory twin is not done. Don't duplicate roles (DECISIONS=log,
NEXT_SESSION=brief, memories=invariants).
