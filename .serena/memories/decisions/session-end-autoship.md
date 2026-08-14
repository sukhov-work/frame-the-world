# Session-end auto-ship hook (owner order 2026-08-13; HARDENED v2 2026-08-14)

`.claude/hooks/session-end-ship.sh` wired to **SessionEnd** in `.claude/settings.json`
(self-daemonizes via nohup — an in-process hook would die with the CLI, so the hook entry
returns in <1s and the detached child does the work).

## THE 2026-08-14 INCIDENT (why v2 exists — never regress this)
Wix push automation **SQUASH-merges** every PR → the shipped commit SHA is NEVER an ancestor
of origin/master. v1's wait loop (`merge-base --is-ancestor`) therefore ALWAYS timed out,
left the checkout on the ship branch, and the next session built on pre-squash history →
every later ship PR was permanently CONFLICTING, automerge never fired, and PRs #35/#36 sat
stuck holding TWO sessions of work (M1+M2+QoL-1). Manual fix (2026-08-14): prove twin trees
byte-identical (`git diff 692a5ab 47f081e` empty) → `git rebase --onto origin/master 692a5ab`
(conflict-free by construction) → force-push → #36 automerged instantly (master `4447ea2`);
#35 closed superseded; ALL 35 branches then audited — every tip tree-verified ≡ its master
squash commit (or SHA-ancestor). ZERO content loss.

## v2 flow (owner rules: never lose content · never block · no shady merges · mirror fresh)
1. GATES (abort → log only): `.claude/BLOCKING_QUESTIONS.md` exists · clean tree (then
   mirror-sync only) · `npm test` or `npx astro check` red (never automerge red).
2. SHIP: branch `claude/ship-YYYYmmdd-HHMMSS` · title from gitignored `.claude/.ship-title` ·
   `#pr #skipreview #automerge` trailer · **backup ref `refs/backups/ship-<ts>`** stored at the
   ship commit BEFORE anything can move (survives every rebase/branch-delete; prune via
   `git for-each-ref refs/backups`).
3. **DIVERGENCE PREFLIGHT (self-heal):** fetch; if origin/master is NOT an ancestor of the
   ship commit → find the nearest first-parent ancestor whose TREE == origin/master's tree
   (the squash twin; search depth 100) → `git rebase --onto origin/master <reseat>` —
   conflict-free by construction; stale pre-squash commits replay empty and drop. No
   tree-equal ancestor (master has foreign work) → push AS-IS + flag attention; a human/next
   session merges by hand. NEVER a guessed merge.
4. WAIT (squash-aware `ship_landed`): landed = SHA ancestor OR `git diff --quiet <sha>
   origin/master` (tree caught up) OR `gh pr list --head <branch> --state merged` (master
   moved further). 60s poll, 45-min timeout.
5. ON LAND: mirror sync · close superseded open claude/ship-* PRs whose tips are ancestors of
   the landed ship (the #35 trap) · restore checkout to master (ff-only) · delete local+remote
   ship branch ONLY with tree-level proof (`git diff --quiet <sha> origin/master`); otherwise
   keep the branch.
6. MIRROR: `git push --force private refs/remotes/origin/master:refs/heads/master`
   (remote `private` = git@github.com:sukhov-work/frame-the-world.git). Syncs on EVERY path
   now: landed, nothing-to-ship, AND timeout.
7. ANOMALIES → **`.claude/SHIP_ATTENTION.md`** (gitignored): reseat happened / reseat failed /
   PR didn't land / stale open ship PRs / checkout moved. The SessionStart hook
   (activate-serena.sh step 5) makes the next session READ it, resolve, and DELETE it.

## Boot rule (also in activate-serena.sh + NEXT_SESSION_PROMPT)
If the checkout is on a claude/ship-* branch or the last ship PR never landed: re-seat onto
origin/master FIRST — tree-identity check (`git diff <local-ancestor> origin/master` empty)
→ `rebase --onto origin/master <that-ancestor>`. Never build a session on pre-squash history;
never force-merge. Content-containment proof for any branch: its tip tree diffed against its
squash commit on master (`git diff <tip> <master-commit>` empty).

## Ops
- Log `~/.claude/logs/ftw-session-ship.log` · lock `~/.claude/locks/ftw-ship.lock` (mkdir-atomic,
  stale >2h broken) · `DRY_RUN=1` exercises gates + the divergence preflight read-only (v2
  dry-run verified 2026-08-14: gates green, preflight "no reseat needed" on a clean state;
  reseat finder validated against the real incident — finds 692a5ab from stale tip a7388a8).
- Gitignored markers: `/.claude/.ship-title`, `/.claude/BLOCKING_QUESTIONS.md`,
  `/.claude/SHIP_ATTENTION.md`.
- If the hook doesn't fire on the very next session end: the settings watcher may need a
  reload — owner opens `/hooks` once or restarts the CLI.
Related: [[decisions/session_workflow]] [[project/wip-2026-08-14-qol1-tail-trace]]
