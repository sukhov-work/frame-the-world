# Session-end auto-ship hook (owner order 2026-08-13)

`.claude/hooks/session-end-ship.sh` wired to **SessionEnd** in `.claude/settings.json`
(self-daemonizes via nohup — an in-process hook would die with the CLI, so the hook entry
returns in <1s and the detached child does the work).

## Flow
1. GATES (abort → log only): `.claude/BLOCKING_QUESTIONS.md` exists (standing owner questions
   — Claude writes/deletes it, convention in .claude/CLAUDE.md) · clean tree (then mirror-sync
   only) · `npm test` or `npx astro check` red (never automerge red).
2. SHIP: branch `claude/ship-YYYYmmdd-HHMMSS` · title from gitignored `.claude/.ship-title`
   (Claude leaves it in Phase 4; fallback "session work <date>") · commit message ends
   `#pr #skipreview #automerge` (Wix push automation opens + automerges the PR) · push.
3. WAIT: poll `git fetch origin master` + `git merge-base --is-ancestor <sha> origin/master`
   every 60s, 45-min timeout (NO gh dependency).
4. MIRROR: `git push --force private refs/remotes/origin/master:refs/heads/master`
   (remote `private` = git@github.com:sukhov-work/frame-the-world.git — validated live).
   Mirror also syncs on the nothing-to-ship path.
5. RESTORE: checkout master + ff-only merge + delete ship branch — ONLY if HEAD is still the
   ship branch and the tree stayed clean (a new session may have started meanwhile).

## Ops
- Log `~/.claude/logs/ftw-session-ship.log` · lock `~/.claude/locks/ftw-ship.lock` (mkdir-atomic,
  stale >2h broken) · `DRY_RUN=1` exercises gates + plan without touching git (tested: blocking
  gate + full dirty-tree dry-run both pass).
- Gitignored markers: `/.claude/.ship-title`, `/.claude/BLOCKING_QUESTIONS.md`.
- Timeout path: work stays safe on the pushed branch; mirror NOT synced; log warns.
- If the hook doesn't fire on the very next session end: the settings watcher may need a
  reload — owner opens `/hooks` once or restarts the CLI.
Related: [[decisions/session_workflow]]
