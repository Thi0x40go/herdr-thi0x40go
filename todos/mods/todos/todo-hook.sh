#!/bin/sh
# UserPromptSubmit hook for coding agents (Claude Code, Kiro, Antigravity):
# while this project's request logging is on (`todo log`; the To-do panel's Log switch),
# injects a note with each message reminding the agent to update its to-do list.
rule_ok=false
for r in "$HOME/.claude/CLAUDE.md" "$HOME/.kiro/steering/todo.md" "$HOME/.gemini/GEMINI.md" "$HOME/.codex/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"; do
  if grep -E -q '<!-- (over9k|herdr):todo -->' "$r" 2>/dev/null; then
    rule_ok=true
    break
  fi
done
[ "$rule_ok" = true ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
# todo.sh sits next to this file (the hook runs it by its full path).
t="$(dirname "$0")/todo.sh"
sh "$t" log 2>/dev/null | grep -q ': on$' || exit 0
echo "Request logging is on for this project: if this message asks for something here (or changes or drops an earlier request), update the to-do list now (todo add / todo edit / todo rm), as the Project to-do lists rule says."
