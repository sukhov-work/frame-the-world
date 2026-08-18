#!/bin/bash
# SessionEnd hook — auto-ship the session's work (owner order 2026-08-13; hardened v2 2026-08-14):
#   commit everything on a claude/ship-* branch → SELF-HEAL any squash-merge divergence
#   (reseat onto origin/master) → push with "#pr #skipreview #automerge" (the Wix push
#   automation opens + automerges the PR) → wait until the content lands on origin/master
#   (SQUASH-AWARE: PR-state / tree-equality, not just SHA ancestry) → force-push origin/master
#   to the `private` mirror remote → fast-forward the local checkout back onto master.
#
# WHY v2 (2026-08-14 pipeline incident): Wix automation SQUASH-merges, so a shipped commit SHA
# is NEVER an ancestor of origin/master — v1's wait loop always timed out, left the checkout on
# the ship branch, and the next session built on pre-squash history → every later PR was
# permanently CONFLICTING and automerge never fired (PRs #35/#36 sat stuck holding two sessions
# of work). v2 rules:
#   · NEVER lose content: refs/backups/* snapshot before anything moves; branches are only
#     deleted after tree-level containment in origin/master is PROVEN; no forced merges ever.
#   · SELF-HEAL divergence: if origin/master is not an ancestor of the ship commit, find the
#     nearest local ancestor whose TREE equals origin/master's tree and rebase --onto it —
#     conflict-free by construction; stale pre-squash commits replay empty and are dropped.
#     If no such ancestor exists (master moved with foreign work) → push AS-IS and report; a
#     human (or the next session) resolves — never a guessed merge/rebase.
#   · SQUASH-AWARE landing: merged = SHA ancestor OR tree-equal OR gh-reported PR merge.
#   · Anomalies (reseat happened / timeout / stale open ship PRs) are written to
#     .claude/SHIP_ATTENTION.md (gitignored) — the next session MUST read + clear it.
#
# GATES (any one aborts the ship, loudly, in the log):
#   1. .claude/BLOCKING_QUESTIONS.md exists  → standing owner questions; Claude writes/removes
#      this marker (convention in .claude/CLAUDE.md). Nothing ships while it exists.
#   2. Working tree clean                    → nothing to ship (the private mirror still syncs).
#   3. npm test / npx astro check fail       → the repo's done-gates; never automerge red.
#
# Commit title: first line of .claude/.ship-title when Claude left one (gitignored), else generic.
# Log: ~/.claude/logs/ftw-session-ship.log   Lock: ~/.claude/locks/ftw-ship.lock (mkdir-atomic)
# DRY_RUN=1 exercises every gate + the divergence preflight without touching git state.

set -u
REPO="/Users/yevhens/Projects/wix-private/headless-frame-the-world"
LOG_DIR="$HOME/.claude/logs"
LOG="$LOG_DIR/ftw-session-ship.log"
LOCK="$HOME/.claude/locks/ftw-ship.lock"
ATTENTION="$REPO/.claude/SHIP_ATTENTION.md"
MIRROR_REMOTE="private"
MERGE_TIMEOUT_S=2700   # 45 min for CI + automerge
POLL_S=60
RESEAT_SEARCH_DEPTH=100

mkdir -p "$LOG_DIR" "$(dirname "$LOCK")"

# Self-daemonize: the hook invocation returns immediately; the detached child does the work
# (an in-process async hook dies with the CLI on session exit — nohup survives it).
if [ -z "${FTW_SHIP_DAEMON:-}" ] && [ -z "${DRY_RUN:-}" ]; then
  FTW_SHIP_DAEMON=1 nohup "$0" >>"$LOG" 2>&1 &
  echo '{"suppressOutput": true}'
  exit 0
fi

log() { echo "[$(date '+%F %T')] $*"; }
attention() {
  # Append an anomaly line the NEXT session must read (file is gitignored).
  # v3 (audit-2 F3): DEDUP — the detached watcher's late write raced a boot deletion and
  # re-created the file with an already-resolved entry (observed 2x 2026-08-18). Identical
  # anomaly text is never appended twice; entry text is stable (no timestamps inside $*).
  [ -n "${DRY_RUN:-}" ] && { log "DRY_RUN: would flag ATTENTION: $*"; return 0; }
  grep -qF -- "$*" "$ATTENTION" 2>/dev/null && { log "attention (dup, skipped): $*"; return 0; }
  { [ -s "$ATTENTION" ] || echo "# SHIP ATTENTION — anomalies from the last auto-ship. Read, act, DELETE this file."; \
    echo "- [$(date '+%F %T')] $*"; } >>"$ATTENTION"
}

# Reap leftover dev servers (owner order 2026-08-18): `wix dev` trees (wix/npm wrappers +
# `astro dev` + vite children) outlive sessions, squat :4321 and confuse the next session
# (a stale pre-config-change server served the 2026-08-18 checkOrigin trial until killed).
# Scope: ONLY processes whose cwd is THIS repo — other projects' dev servers are not ours.
kill_dev_servers() {
  local p cwd cmd
  for p in $(pgrep -f "wix dev|astro dev|npm exec (wix|astro) dev" 2>/dev/null); do
    cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    [ "$cwd" = "$REPO" ] || continue
    cmd=$(ps -p "$p" -o command= 2>/dev/null | head -c 100)
    if [ -n "${DRY_RUN:-}" ]; then log "DRY_RUN: would reap dev-server pid $p ($cmd)"; continue; fi
    log "reaping dev-server pid $p ($cmd)"
    kill "$p" 2>/dev/null
  done
  [ -n "${DRY_RUN:-}" ] && return 0
  sleep 2
  for p in $(pgrep -f "wix dev|astro dev|npm exec (wix|astro) dev" 2>/dev/null); do
    cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    [ "$cwd" = "$REPO" ] && kill -9 "$p" 2>/dev/null && log "force-killed lingering dev pid $p"
  done
  return 0
}

# Prune stale claude/ship-* branches (audit-2 F3 — the "leaving branches as-is" paths leaked
# them forever). Deletion needs PROOF that origin/master contains the branch's content:
#   (a) SHA ancestry, (b) tree equal to master's tip, or (c) tree equal to ANY recent
# origin/master commit (squash landed, master moved on). A proof-failing branch ≥3 days old
# is REPORTED with evidence, never deleted (backup refs in refs/backups cover the true tips).
prune_stale_ship_branches() {
  git fetch -q origin master 2>/dev/null || return 0
  local branch tip proof target_tree c age_days
  for branch in $(git for-each-ref --format='%(refname:short)' 'refs/heads/claude/ship-*'); do
    [ "$branch" = "${BRANCH:-}" ] && continue
    [ "$(git rev-parse --abbrev-ref HEAD)" = "$branch" ] && continue
    tip=$(git rev-parse "$branch" 2>/dev/null) || continue
    proof=""
    if git merge-base --is-ancestor "$tip" origin/master 2>/dev/null; then proof="SHA-ancestor"
    elif git diff --quiet "$tip" origin/master 2>/dev/null; then proof="tree==master-tip"
    else
      target_tree=$(git rev-parse "$tip^{tree}" 2>/dev/null) || continue
      for c in $(git rev-list --first-parent -"$RESEAT_SEARCH_DEPTH" origin/master); do
        if [ "$(git rev-parse "$c^{tree}")" = "$target_tree" ]; then proof="tree@${c:0:9}"; break; fi
      done
    fi
    if [ -n "$proof" ]; then
      if [ -n "${DRY_RUN:-}" ]; then log "DRY_RUN: would prune $branch (proof: $proof)"; continue; fi
      git branch -q -D "$branch" && log "pruned stale ship branch $branch (containment proof: $proof)"
      git push -q origin --delete "$branch" 2>/dev/null || true
    else
      age_days=$(( ( $(date +%s) - $(git log -1 --format=%ct "$branch" 2>/dev/null || date +%s) ) / 86400 ))
      if [ "$age_days" -ge 3 ]; then
        attention "Stale ship branch $branch fails ALL containment proofs vs origin/master (age ${age_days}d) — inspect: git diff $branch origin/master --stat; true tip is backed up under refs/backups. Delete by hand only after review."
      fi
    fi
  done
}

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

log "=== session-end ship run v2 (dry-run: ${DRY_RUN:-0}) ==="

# Machine hygiene FIRST — runs even when a gate aborts the ship (owner order 2026-08-18).
# NOTE: the owner's persistent chrome-playwright CDP instance (:9222) is deliberately NOT
# touched here — it outlives sessions by design (see activate-serena.sh step 7).
kill_dev_servers

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

# Nearest first-parent ancestor of $1 whose TREE equals origin/master's tree — the provably
# safe reseat point after a squash merge (the squash twin). Prints the SHA; rc 1 = none found.
find_reseat_point() {
  local target_tree c
  target_tree=$(git rev-parse origin/master^{tree}) || return 1
  for c in $(git rev-list --first-parent -"$RESEAT_SEARCH_DEPTH" "$1"); do
    if [ "$(git rev-parse "$c^{tree}")" = "$target_tree" ]; then echo "$c"; return 0; fi
  done
  return 1
}

# Squash-aware "has our ship landed?" — $1 = ship commit SHA, $2 = ship branch name.
ship_landed() {
  # (a) true-merge / rebase-merge: the SHA itself is reachable.
  git merge-base --is-ancestor "$1" origin/master 2>/dev/null && return 0
  # (b) squash: master's tree caught up to exactly our shipped tree.
  git diff --quiet "$1" origin/master 2>/dev/null && return 0
  # (c) squash + master moved further: ask GitHub whether the PR for our branch merged.
  if command -v gh >/dev/null 2>&1; then
    local st
    st=$(gh pr list --head "$2" --state merged --json number -q 'length' 2>/dev/null)
    [ -n "$st" ] && [ "$st" != "0" ] && return 0
  fi
  return 1
}

# --- Housekeeping: sweep stale ship branches (runs even on clean-tree sessions) -----------------
prune_stale_ship_branches

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
  git fetch -q origin master 2>/dev/null
  if git merge-base --is-ancestor origin/master HEAD 2>/dev/null; then
    log "DRY_RUN: preflight — HEAD descends from origin/master (no reseat needed)"
  else
    RESEAT=$(find_reseat_point HEAD) \
      && log "DRY_RUN: preflight — DIVERGED; would reseat via rebase --onto origin/master ${RESEAT:0:9}" \
      || log "DRY_RUN: preflight — DIVERGED and NO tree-equal ancestor; would push AS-IS + flag attention"
  fi
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

# NO-LOSS SNAPSHOT: a backup ref outside the branch namespace — survives every later rebase /
# branch deletion; prune manually via `git for-each-ref refs/backups`.
git update-ref "refs/backups/ship-$(date +%Y%m%d-%H%M%S)" "$SHA"
log "backup ref stored for $SHA"

# --- Divergence preflight (the squash-merge self-heal) -------------------------------------------
# If a previous ship was squash-merged but this checkout still carries the pre-squash commits,
# origin/master is NOT an ancestor of HEAD and the PR would be permanently CONFLICTING.
git fetch -q origin master || log "WARN: preflight fetch failed — shipping from local view"
if ! git merge-base --is-ancestor origin/master "$SHA" 2>/dev/null; then
  log "preflight: HEAD does not descend from origin/master — attempting tree-equal reseat"
  if RESEAT=$(find_reseat_point "$SHA"); then
    log "preflight: reseat point ${RESEAT:0:9} (tree == origin/master) — rebasing --onto"
    if git rebase --onto origin/master "$RESEAT" "$BRANCH" >/dev/null 2>&1; then
      SHA="$(git rev-parse HEAD)"
      log "preflight: reseated cleanly; ship commit is now $SHA"
      attention "Ship reseated onto origin/master (squash divergence healed automatically; backup in refs/backups)."
    else
      git rebase --abort >/dev/null 2>&1
      log "WARN: reseat rebase failed — shipping the un-rebased branch (content safe; PR may conflict)"
      attention "Reseat rebase FAILED for $BRANCH — PR may be CONFLICTING; resolve via tree-identity check + rebase --onto (see mem:decisions/session-end-autoship)."
    fi
  else
    log "WARN: no tree-equal ancestor within $RESEAT_SEARCH_DEPTH commits — master has foreign work; shipping AS-IS"
    attention "Ship $BRANCH pushed WITHOUT reseat (no tree-equal ancestor — origin/master carries foreign work). PR may conflict; merge by hand, NEVER force."
  fi
fi

git push -u origin "$BRANCH" || { log "ABORT: push failed — commit $SHA stays on $BRANCH locally"; exit 1; }
log "pushed $BRANCH ($SHA) — waiting for automerge into origin/master (squash-aware)"

# --- Wait for the automerge to LAND (squash-aware) ------------------------------------------------
waited=0
while [ "$waited" -lt "$MERGE_TIMEOUT_S" ]; do
  sleep "$POLL_S"; waited=$((waited + POLL_S))
  git fetch -q origin master 2>/dev/null || continue
  if ship_landed "$SHA" "$BRANCH"; then
    log "landed on origin/master after ${waited}s"
    sync_mirror
    # Close older ship PRs whose branch tips are ancestors of what just landed (the #35 trap).
    if command -v gh >/dev/null 2>&1; then
      gh pr list --state open --json number,headRefName \
        -q '.[] | select(.headRefName | startswith("claude/ship-")) | "\(.number) \(.headRefName)"' 2>/dev/null \
      | while read -r num ref; do
          [ "$ref" = "$BRANCH" ] && continue
          tip=$(git rev-parse "origin/$ref" 2>/dev/null) || continue
          if git merge-base --is-ancestor "$tip" "$SHA" 2>/dev/null; then
            gh pr close "$num" --comment "Superseded: this branch is an ancestor of the merged ship $SHA — content already on master (tree-verified)." >/dev/null 2>&1 \
              && log "closed superseded ship PR #$num ($ref)"
          else
            attention "Older ship PR #$num ($ref) is still OPEN and not an ancestor of the merged ship — verify its content against master."
          fi
        done
    fi
    # Restore the local checkout onto the updated master — only if nothing moved meanwhile.
    if [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] && [ -z "$(git status --porcelain)" ]; then
      git checkout -q master \
        && git merge -q --ff-only origin/master \
        && log "local checkout back on master @ $(git rev-parse --short HEAD)" \
        || { log "WARN: local master restore incomplete — resolve by hand"; attention "Local master restore incomplete after ship $SHA — checkout state needs a look."; }
      # Delete branches ONLY with tree-level proof that master contains exactly what we shipped.
      if git diff --quiet "$SHA" origin/master 2>/dev/null; then
        git branch -q -D "$BRANCH" && log "local $BRANCH deleted (tree-proven in master)"
        git push -q origin --delete "$BRANCH" 2>/dev/null && log "remote $BRANCH deleted (tree-proven in master)" \
          || log "remote $BRANCH already gone (auto-delete) or delete skipped"
      else
        log "master moved past our ship — keeping $BRANCH (content proof is PR-level only)"
      fi
    else
      log "WARN: checkout moved or tree dirty during the wait — leaving branches as-is"
      attention "Ship $SHA landed but the local checkout had moved — verify you are on master and $BRANCH can be deleted."
    fi
    exit 0
  fi
done
log "WARN: automerge NOT observed within ${MERGE_TIMEOUT_S}s — work is safe on $BRANCH (pushed)"
# Only-if-unresolved (audit-2 F3): this write fires ~45 min in, often mid-NEXT-session — one
# last landing check keeps a since-landed ship from re-creating an already-resolved entry.
git fetch -q origin master 2>/dev/null
if ship_landed "$SHA" "$BRANCH"; then
  log "landed exactly at the timeout boundary — no attention entry needed"
else
  attention "Ship $BRANCH ($SHA) did NOT land within ${MERGE_TIMEOUT_S}s — check the PR state (gh pr list --head $BRANCH); the next ship run self-heals divergence, but the PR may need a manual nudge."
fi
sync_mirror
exit 0
