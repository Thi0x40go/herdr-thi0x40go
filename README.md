# Herdr Mods by @Thi0x40go

A collection of custom mods and tools for the [Herdr](https://herdr.dev) desktop application.

## Mods

### 🌳 [orchestrator-wt](orchestrator-wt/)
Fast, keyboard-friendly Git worktree and repository manager for the Orchestrator development environment.
- **Keybinding:** `alt-w`
- **Features:** Instant repository scanning, worktree discovery, detached Neovim/Kitty launcher, Zed/IDEA detection, and custom path configuration.

## Installation

To install any mod in this repository into your local Herdr configuration:

```bash
# Clone the repository
git clone https://github.com/Thi0x40go/herdr-thi0x40go ~/Projects/herdr-thi0x40go

# Symlink the desired mod into ~/.config/herdr-app/mods/
ln -s ~/Projects/herdr-thi0x40go/orchestrator-wt/mods/orchestrator-wt ~/.config/herdr-app/mods/orchestrator-wt

# Verify mod validity
herdr-app check ~/.config/herdr-app/mods/orchestrator-wt
```

Add the mod's recommended keybindings from its `keys.json` to your `~/.config/herdr-app/keys.json`.
