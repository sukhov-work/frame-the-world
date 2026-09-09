#!/bin/zsh
# SessionEnd cleanup (owner order 2026-09-10): nothing of ours outlives the session.
#   1. the HOUSE headless verify Chrome(s) + every helper — `scripts/close-verify-chrome.mjs`
#      (only `/tmp/ftw-cdp*` browsers; never the owner's real Chrome, never their :9222 CDP Chrome)
#   2. THIS repo's dev server — `wix dev` / `astro dev` spawned from this checkout (matched on the
#      repo path, so another project's dev server is never touched)
# Runs beside the auto-ship hook (which needs neither); independent of it; always exits 0.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 0
LOG_DIR="$HOME/.claude/logs"; mkdir -p "$LOG_DIR"
{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] session-end cleanup ($REPO)"
  node scripts/close-verify-chrome.mjs --keep 9222 --grace 5 2>&1
  # dev servers of THIS checkout: the `wix dev` wrapper, the `astro dev` listener it spawns, the npm exec shims
  pids=$(ps -Ao pid=,command= | grep -E "$REPO/node_modules/\.bin/(wix|astro) dev|npm exec (wix|astro) dev" | grep -v grep | awk '{print $1}')
  if [[ -n "$pids" ]]; then
    echo "stopping this checkout's dev server: $(echo $pids | tr '\n' ' ')"
    echo "$pids" | xargs kill 2>/dev/null; sleep 3
    left=$(ps -Ao pid=,command= | grep -E "$REPO/node_modules/\.bin/(wix|astro) dev" | grep -v grep | awk '{print $1}')
    [[ -n "$left" ]] && { echo "  still up after SIGTERM — SIGKILL $(echo $left | tr '\n' ' ')"; echo "$left" | xargs kill -9 2>/dev/null; }
    echo "dev server stopped"
  else
    echo "no dev server of this checkout running"
  fi
} >> "$LOG_DIR/ftw-session-cleanup.log"
exit 0
