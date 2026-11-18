# Orchestrator Worktree Manager

A fast, keyboard-friendly Herdr popup overlay to manage, inspect, and open Git worktrees and repositories in the Orchestrator environment. Opens editors (Neovim in Kitty, Zed, IntelliJ IDEA) and terminal tabs in one click or keystroke.

## What you see

A floating popup modal (`overlay.kind = "popup"`), centered at 820×560 px with a `radius` of 12px, 1px `border`, and `surface` / `background` colors adhering to the active Herdr theme:

- **Header (52px):**
  - Left: Mod title "Orchestrator Worktrees" (15px semibold, `foreground`), followed by a repository count badge (`muted`).
  - Center/Right: Action buttons for Refresh (`sync.svg`), New Worktree (`add.svg`), Settings gear, and Close (`Esc`).
- **Search Bar (36px):**
  - An input box with placeholder "Filter worktrees or repositories...", real-time fuzzy filtering of repos and worktree branches.
- **Repository & Worktree List:**
  - Vertically scrolling list of repository cards.
  - Each card displays the repository name, current active branch, and list of attached worktrees (`git-branch.svg`).
  - Action buttons per worktree:
    - **Kitty / Neovim:** Launches Neovim inside a dedicated Kitty terminal window matching Omarchy desktop typography and color theme.
    - **Zed / IDEA:** Rendered dynamically only if `zed` or `idea` are detected on the system PATH.
    - **Terminal:** Opens a new terminal tab in Herdr placed directly at the worktree's path.
- **In-mod Settings View:**
  - Switchable view displaying terminal emulator selection (Kitty, Alacritty, Ghostty), custom repositories root path input, and auto-detection toggles.

## How it behaves

- **Opening & Closing:**
  - Triggered globally via `alt-w` (`mod.open:worktree`).
  - Closes on `Esc`, clicking outside the popup overlay, or clicking the close button.
- **Detached Editor Execution:**
  - Editors and terminal windows are launched detached (`launchDetached`) using `nohup ... </dev/null >/dev/null 2>&1 &` so that Herdr's 30-second `EXEC_LIMIT` never terminates running processes.
- **Worktree Discovery:**
  - Discovers repositories in `orchestrator/repos` (or custom configured path).
  - Inspects active worktrees through `worktree_tool.py list` when available, falling back to git directory scanning and `~/.herdr/worktrees`.

## Built from

- **`mods/worktree/`**:
  - `main.js`: Main UI component, state management, search filter, and list rendering.
  - `config.js`: Persistent configuration storage for custom paths and terminal preferences.
  - `mod.json`: Overlay popup specification (`place: "none"`, width 820, height 560).
  - `add.svg`, `eye.svg`, `git-branch.svg`, `sync.svg`: Vector iconography.
- **Herdr APIs**:
  - `exec`: Asynchronous CLI execution (`git`, `which`, `sh`).
  - `run`: Native Herdr command execution (`terminal.open`, `space.select`).
  - `theme`: Live palette extraction.

## Watch out

- **Process Lifetime:** Never invoke long-running processes (like Neovim or GUI editors) directly through synchronous `exec()` without background detachment; Herdr enforces a 30s timeout and kills the process.
- **Font & Theme Disparity:** Running terminal-based editors in a generic subprocess can lose user shell configurations; launching through the desktop's primary emulator (e.g. Kitty) ensures full font, ligature, and theme alignment.

## Done when

- `alt-w` opens the popup modal instantly.
- Worktrees in the orchestrator environment appear cleanly grouped under their respective repositories without phantom entries.
- Clicking the Neovim button opens Kitty at the worktree root running Neovim, persisting beyond 30 seconds.
- Zed and IDEA buttons only display when their binaries exist on `$PATH`.
