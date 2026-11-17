# Agent Sleep (Enhanced for Antigravity, Kiro, Claude & Codex)

A "Sleeping" list docked in Herdr's sidebar. Idle or completed agents automatically (or on-demand) quit to their shell to free precious RAM, while saving full session state. Clicking a sleeping agent immediately wakes and resumes it with its complete conversation history.

## What you see

- Docks under the `agents` block in the sidebar (`weight: 0.5` next to agents' `1.0`), background `chrome`, text 13px.
- **Header (30px):**
  - "Sleeping", the count of sleeping agents.
  - Quick action chip: **"sleep now"** to immediately put the active/focused agent to sleep without waiting for the timer.
  - Sorting chip: "by space", "longest" or "newest".
  - Auto-sleep delay chip: "after 5m", "after 10m", "after 20m", "after 60m", or "off".
- **Rows (30px each):**
  - Agent icon: Antigravity (`icons/antigravity.svg`), Kiro (`icons/kiro.svg`), Claude Code (`icons/claude.svg`), or Codex (`icons/codex.svg`).
  - Space name (`muted`), session title (`dim`), and **freed RAM indicator** (e.g. `· 384 MB`).
  - Sleep duration (`4m`, `2h`) and sleep indicator ("z" or `done` dot if finished unseen).
  - Hover tooltip displays exact resume command and memory saved.
  - While waking: shows "waking…"; while quitting: shows "falling asleep…".

## How it behaves

- **Automatic Sleep:** Periodically checks idle agents against the configured delay (5m default). When safe (no unsent draft in prompt, no active background jobs or running subagents), saves session UUID, measures resident RAM, and safely exits to the shell.
- **Manual "Sleep Now":** Puts the focused agent to sleep immediately via header button or `alt-z` shortcut.
- **Instant Wake & Resume:** Clicking any sleeping row focuses its terminal and types the native resume command into the shell:
  - Antigravity: `agy --conversation <session-id>`
  - Kiro: `kiro-cli --resume-id <session-id>`
  - Claude Code: `claude --resume <session-id>`
  - Codex: `codex resume <session-id>`

## Built from

- **`mods/agent-sleep/`**:
  - `main.js`: Sidebar view, automated sweep timers, manual sleep handler, and state machine.
  - `adapters.js`: Agent adapters detecting processes, session IDs from SQLite/leases/rollouts, prompt draft markers, and RAM measurement (`/proc/<pid>/statm`).
  - `mod.json`: `{ "place": "none", "title": "Sleeping agents" }`.
- **`keys.json`**: `{ "global": { "alt-z": "agent-sleep.sleep" } }`.

## Done when

- `herdr-app check` passes cleanly.
- Shows sleeping agents under the sidebar.
- Antigravity and Kiro sessions are recognized and their active session IDs correctly detected.
- Clicking "sleep now" puts the focused agent to sleep and displays freed memory.
- Clicking the sleeping row resumes the exact conversation.
