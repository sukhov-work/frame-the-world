# Memory maintenance
How to keep this memory graph useful. Domain-agnostic; applies to every memory here.
## Discovery model
- `mem:core` is the graph root — start there. It indexes every other memory.
- A memory refers to another with `mem:<name>` in backticks. The *referring* memory says when to read
  the target; targets don't describe their own when-to-read. Nested topics live in folders.
## Style
- Dense agent notes, not prose docs. Invariants, terse bullets, tables, code over prose.
- Lead with the rule, then **Why:** / **How to apply:** when it aids judgement. Absolute dates.
## What to write
- Stable, non-obvious project facts: invariants, decisions, gotchas, measured numbers (decode ms, heap MB,
  ion streaming burn), Wix API shapes confirmed via MCP, TODO-VERIFY answers once resolved.
## What NOT to write
- One-off task state, generic language/library knowledge, anything already in `.claude/` docs, anything
  re-derivable from current code or `git log`.
## Naming
`architecture/<component>`, `decisions/<topic>`, `patterns/<pattern>`, `bugs/<issue>`, `project/<area>`.
One memory per logical unit. Update or delete when stale; never duplicate.
