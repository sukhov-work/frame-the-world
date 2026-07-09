#!/bin/bash
# Persistence hook — reminds Claude to record durable context. Wired to PreCompact
# (checkpoints long sessions before context is lost). Clean-exit persistence is
# additionally driven by the /frame skill's Phase 4. See mem:decisions/session_workflow.
cat << 'EOF'
Before context is lost, persist this session so the next one resumes cleanly. Do these silently,
then show only the 2-3 sentence summary:
1. Review what was accomplished this session.
2. Serena memories — if significant work was done, mcp__serena__write_memory using the taxonomy
   architecture/<component>, decisions/<topic>, patterns/<pattern>, bugs/<issue>, project/<area>
   (key facts, file paths, gotchas; code over prose). Update stale memories via mcp__serena__edit_memory.
3. DECISIONS.md — append ONE dated line to .claude/claude-docs/DECISIONS.md per meaningful change:
   what was decided, files touched, numbers measured, and verification status
   (wix-VERIFIED / local-tested / UNVERIFIED). Append-only; never edit old lines.
4. NEXT_SESSION_PROMPT.md — write/refresh .claude/claude-docs/NEXT_SESSION_PROMPT.md (gitignored):
   mission, working mode, facts table, phased plan, acceptance checkboxes, safety/rollback, pointers.
   Advance the "Next step" in mem:core if the phase moved.
5. Summarize what was done and what's next in 2-3 sentences for the user.
EOF
