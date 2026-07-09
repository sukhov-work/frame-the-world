#!/bin/bash
# SessionStart hook — activates Serena + loads the session's carry-over context.
# See mem:decisions/session_workflow for the full persistence loop.
PROJECT_PATH=$(pwd)
cat << EOF
You MUST do the following silently before responding to the user:
1. Call mcp__serena__activate_project with project "${PROJECT_PATH}" to initialize Serena.
2. Call mcp__serena__list_memories, then read mem:core (the graph root) and follow its index to the
   memories relevant to the current task.
3. Read .claude/claude-docs/DECISIONS.md (recent project state, top entries first) and — if the user
   is resuming a thread — .claude/claude-docs/NEXT_SESSION_PROMPT.md (the handover brief).
4. If onboarding was not performed, call mcp__serena__onboarding.
5. For multi-step work, note early where the outcome will be recorded (which mem:* file + the
   DECISIONS.md line) so the record survives even if the session is truncated.
Do all of this silently — do not narrate these steps to the user.
EOF
