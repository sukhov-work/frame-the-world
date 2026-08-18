#!/bin/bash
# SessionStart hook — activates Serena + loads the session's carry-over context.
# See mem:decisions/session_workflow for the full persistence loop.
PROJECT_PATH=$(pwd)

# CDP-Chrome presence check (owner order 2026-08-18): the owner keeps a PERSISTENT Chrome on
# :9222 via the zsh alias `chrome-playwright` (--user-data-dir=~/Playwright_Chrome_data). It is
# the Playwright-MCP attach target — killing it kills the MCP for the whole session (happened
# 2026-08-18). Detect it here so the session ATTACHES instead of launching/killing.
CDP_PID=$(lsof -nP -tiTCP:9222 -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$CDP_PID" ] && ps -p "$CDP_PID" -o command= 2>/dev/null | grep -q "Playwright_Chrome_data"; then
  CDP_MSG="CDP Chrome is ALREADY UP on :9222 (the owner's chrome-playwright instance, pid ${CDP_PID},
   persistent profile). ATTACH to it (Playwright MCP is configured with --cdp-endpoint
   http://localhost:9222); NEVER kill or relaunch it — not even at session end (owner ruling
   2026-08-18; killing it also disconnects the Playwright MCP irrecoverably). It runs WITHOUT
   the occlusion flags: bringToFront + in-page rAF-tick guards before any timed probe, or run
   headless probes on a separate instance: scripts/verify-chrome.mjs --headless --port 9333
   --profile /tmp/ftw-cdp."
elif [ -n "$CDP_PID" ]; then
  CDP_MSG="Port 9222 is owned by a FOREIGN process (pid ${CDP_PID} — not the chrome-playwright
   profile). Do NOT kill it; use another port for CDP work (scripts/verify-chrome.mjs --port 9333)."
else
  CDP_MSG="No CDP Chrome on :9222. If browser verification is needed, launch via
   node scripts/verify-chrome.mjs (occlusion flags + attach info) — or ask the owner to run
   their \`chrome-playwright\` alias; never assume a running instance."
fi

cat << EOF
You MUST do the following silently before responding to the user:
1. Call mcp__serena__activate_project with project "${PROJECT_PATH}" to initialize Serena.
2. Call mcp__serena__list_memories, then read mem:core (the graph root) and follow its index to the
   memories relevant to the current task.
3. Read .claude/claude-docs/NEXT_SESSION_PROMPT.md (the handover brief — freshest state, read it
   FIRST) then the TOP of .claude/claude-docs/DECISIONS.md. DECISIONS carries multi-KB single
   lines — read it PAGED (offset/limit) or grep for the entry you need; a naive full Read can
   truncate before §Recent sessions (audit-2 F1).
4. If onboarding was not performed, call mcp__serena__onboarding.
5. SHIP-PIPELINE CHECK: if .claude/SHIP_ATTENTION.md exists, READ it — it lists auto-ship
   anomalies (reseat events, unlanded PRs, stale ship branches) from the last session end.
   Resolve what it reports (verify via tree-identity: git diff <tip> origin/master — see
   mem:decisions/session-end-autoship), then DELETE the file. RE-CHECK it once LATE in the
   session too — the detached ship watcher can append up to ~45 min after the previous
   session ended (its writes now dedup + re-verify, audit-2 F3, but a late legitimate
   anomaly still lands mid-session). Also: if the checkout is on a
   claude/ship-* branch or git status shows the last ship never landed, re-seat onto
   origin/master BEFORE building (tree-identity check → rebase --onto; never force-merge).
6. For multi-step work, note early where the outcome will be recorded (which mem:* file + the
   DECISIONS.md line) so the record survives even if the session is truncated.
7. BROWSER-VERIFY CHROME STATUS (checked just now by this hook): ${CDP_MSG}
Do all of this silently — do not narrate these steps to the user.
EOF
