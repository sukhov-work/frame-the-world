#!/bin/bash
# SessionEnd hook — auto-ship the session's work (owner order 2026-08-13):
#   commit everything on a claude/ship-* branch → push with "#pr #skipreview #automerge"
#   (the Wix push automation opens + automerges the PR) → wait until the commit lands on
#   origin/master → force-push origin/master to the `private` mirror remote → fast-forward
#   the local checkout back onto master.
#
# GATES (any one aborts the ship, loudly, in the log):
#   1. .claude/BLOCKING_QUESTIONS.md exists  → standing owner questions; Claude writes/removes
#      this marker (convention in .claude/CLAUDE.md). Nothing ships while it exists.
#   2. Working tree clean                    → nothing to ship (the private mirror still syncs).
#   3. npm test / npx astro check fail       → the repo's done-gates; never automerge red.
#
# Commit title: first line of .claude/.ship-title when Claude left one (gitignored), else generic.
# Log: ~/.claude/logs/ftw-session-ship.log   Lock: ~/.claude/locks/ftw-ship.lock (mkdir-atomic)
# DRY_RUN=1 exercises every gate + prints the plan without touching git.

set -u
REPO="/Users/yevhens/Projects/wix-private/headless-frame-the-world"
LOG_DIR="$HOME/.claude/logs"
LOG="$LOG_DIR/ftw-session-ship.log"
LOCK="$HOME/.claude/locks/ftw-ship.lock"
MIRROR_REMOTE="private"
MERGE_TIMEOUT_S=2700   # 45 min for CI + automerge
POLL_S=60

mkdir -p "$LOG_DIR" "$(dirname "$LOCK")"

# Self-daemonize: the hook invocation returns immediately; the detached child does the work
# (an in-process async hook dies with the CLI on session exit — nohup survives it).
if [ -z "${FTW_SHIP_DAEMON:-}" ] && [ -z "${DRY_RUN:-}" ]; then
  FTW_SHIP_DAEMON=1 nohup "$0" >>"$LOG" 2>&1 &
  echo '{"suppressOutput": true}'
  exit 0
fi

log() { echo "[$(date '+%F %T')] $*"; }

cd "$REPO" || { log "ABORT: repo path missing"; exit 1; }

# Concurrency lock (mkdir is atomic); stale locks >2h are broken.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    log "stale lock (>2h) — breaking it"
    rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null || { log "ABORT: lock re-acquire failed"; exit 1; }
  else
    log "ABORT: another ship run holds the lock"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

log "=== session-end ship run (dry-run: ${DRY_RUN:-0}) ==="

# --- Gate 1: standing blocking questions -------------------------------------------------------
if [ -s ".claude/BLOCKING_QUESTIONS.md" ]; then
  log "ABORT: .claude/BLOCKING_QUESTIONS.md present — standing owner questions block the ship:"
  sed 's/^/    /' ".claude/BLOCKING_QUESTIONS.md" | head -20
  exit 0
fi

sync_mirror() {
  log "syncing mirror: origin/master → $MIRROR_REMOTE/master (force)"
  if [ -n "${DRY_RUN:-}" ]; then log "DRY_RUN: skip mirror push"; return 0; fi
  git fetch -q origin master || { log "WARN: fetch origin master failed"; return 1; }
  git push --force "$MIRROR_REMOTE" refs/remotes/origin/master:refs/heads/master \
    && log "mirror synced" || log "WARN: mirror push failed"
}

# --- Gate 2: anything to ship? ------------------------------------------------------------------
if [ -z "$(git status --porcelain)" ]; then
  log "nothing to ship (clean tree) — mirror-sync only"
  sync_mirror
  exit 0
fi

# --- Gate 3: the repo's done-gates --------------------------------------------------------------
log "running gates: npm test + npx astro check"
if ! npm test >/dev/null 2>&1; then
  log "ABORT: vitest FAILED — refusing to automerge red. Ship manually after fixing."
  exit 0
fi
if ! npx astro check >/dev/null 2>&1; then
  log "ABORT: astro check FAILED — refusing to automerge red. Ship manually after fixing."
  exit 0
fi
log "gates green"

# --- Ship ---------------------------------------------------------------------------------------
BRANCH="claude/ship-$(date +%Y%m%d-%H%M%S)"
TITLE="session work $(date +%F)"
if [ -s ".claude/.ship-title" ]; then
  TITLE="$(head -1 ".claude/.ship-title")"
fi

if [ -n "${DRY_RUN:-}" ]; then
  log "DRY_RUN: would ship branch=$BRANCH title=\"$TITLE #pr #skipreview #automerge\""
  log "DRY_RUN: $(git status --porcelain | wc -l | tr -d ' ') files pending"
  exit 0
fi

log "shipping branch=$BRANCH title=\"$TITLE\""
git checkout -b "$BRANCH" || { log "ABORT: branch create failed"; exit 1; }
git add -A
git commit -m "$TITLE #pr #skipreview #automerge" \
  -m "Auto-shipped by the session-end hook." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" \
  || { log "ABORT: commit failed"; exit 1; }
SHA="$(git rev-parse HEAD)"
rm -f ".claude/.ship-title"
git push -u origin "$BRANCH" || { log "ABORT: push failed — commit $SHA stays on $BRANCH locally"; exit 1; }
log "pushed $BRANCH ($SHA) — waiting for automerge into origin/master"

# --- Wait for automerge (ancestor check needs no gh auth) ---------------------------------------
waited=0
while [ "$waited" -lt "$MERGE_TIMEOUT_S" ]; do
  sleep "$POLL_S"; waited=$((waited + POLL_S))
  git fetch -q origin master 2>/dev/null || continue
  if git merge-base --is-ancestor "$SHA" origin/master 2>/dev/null; then
    log "automerged into origin/master after ${waited}s"
    sync_mirror
    # Restore the local checkout onto the updated master — only if nothing moved meanwhile.
    if [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] && [ -z "$(git status --porcelain)" ]; then
      git checkout -q master \
        && git merge -q --ff-only origin/master \
        && git branch -q -D "$BRANCH" \
        && log "local checkout back on master @ $(git rev-parse --short HEAD); $BRANCH deleted" \
        || log "WARN: local master restore incomplete — resolve by hand"
    else
      log "WARN: checkout moved or tree dirty during the wait — leaving branches as-is"
    fi
    exit 0
  fi
done
log "WARN: automerge NOT observed within ${MERGE_TIMEOUT_S}s — work is safe on $BRANCH (pushed); mirror NOT synced"
exit 0
