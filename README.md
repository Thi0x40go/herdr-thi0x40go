# Herdr Mods by @Thi0x40go

A collection of custom mods and tools for the [Herdr](https://herdr.dev) desktop application.

## Mods

### 💤 [agent-sleep](agent-sleep/)
Puts idle or completed coding agents to sleep to free RAM and system resources, with instant resume on click.
- **Supported Agents:** Antigravity (`agy`), Kiro (`kiro-cli`), Claude Code, and Codex.
- **Features:** Auto-sleep timer (5m–60m), instant manual "Sleep now" action, resident RAM measurement (`statm`), session preservation, and seamless resume.

### 🌳 [orchestrator-wt](orchestrator-wt/)
Fast, keyboard-friendly Git worktree and repository manager for the Orchestrator development environment.
- **Keybinding:** `alt-w`
- **Features:** Instant repository scanning, worktree discovery, detached Neovim/Kitty launcher, Zed/IDEA detection, and custom path configuration.

### ❄️ [hibernate](hibernate/)
Terminal hibernation and auto-revive system for coding agents on Herdr restart or machine boot.
- **Keybinding:** `alt-z` (`hibernate.sleep`)
- **Supported Agents:** Kiro (`kiro-cli`), Antigravity (`agy`), Claude Code, Codex.
- **Features:** Auto-revives kept agent terminals (`--keep`) from shells upon restart, space/pane sleep and wake commands, and local state persistence.

## Installation

To install any mod in this repository into your local Herdr configuration:

```bash
# Clone the repository
git clone https://github.com/Thi0x40go/herdr-thi0x40go ~/Projects/herdr-thi0x40go

# Symlink the desired mod into ~/.config/herdr-app/mods/
ln -s ~/Projects/herdr-thi0x40go/agent-sleep/mods/agent-sleep ~/.config/herdr-app/mods/agent-sleep
ln -s ~/Projects/herdr-thi0x40go/orchestrator-wt/mods/orchestrator-wt ~/.config/herdr-app/mods/orchestrator-wt
ln -s ~/Projects/herdr-thi0x40go/hibernate/mods/hibernate ~/.config/herdr-app/mods/hibernate

# Verify mod validity
herdr-app check ~/.config/herdr-app/mods/agent-sleep
herdr-app check ~/.config/herdr-app/mods/orchestrator-wt
herdr-app check ~/.config/herdr-app/mods/hibernate
```
