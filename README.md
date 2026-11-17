# Herdr Mods by @Thi0x40go

A collection of custom mods and productivity extensions for the [Herdr](https://herdr.dev) desktop application.

---

## 📦 Mods Included

### 💤 [agent-sleep](agent-sleep/)
Puts idle or completed coding agents to sleep to free RAM and system resources, with instant resume on click.
- **Supported Agents:** Antigravity (`agy`), Kiro (`kiro-cli`), Claude Code, and Codex.
- **Key Features:**
  - Auto-sleep timer (5m–60m) or instant manual "Sleep now" action.
  - Aggregated RAM measurement (`/proc/<pid>/statm`) showing freed memory across the process tree (wrapper + child engines).
  - Modern Remix Icon SVG controls.
  - Shell prompt clean line clearing (`ctrl+u`) before sending resume commands.
  - Survives app restarts via native Herdr terminal labels.

### 🌳 [orchestrator-wt](orchestrator-wt/)
Fast, keyboard-friendly Git worktree and repository manager built for the Orchestrator development environment.
- **Keybinding:** `alt-w`
- **Key Features:**
  - Instant repository scanning and worktree discovery.
  - Direct launch into Neovim (`ghostty -e nvim`), IntelliJ IDEA, or Zed.
  - Keyboard-driven picker for rapid branch switching.

### ❄️ [hibernate](hibernate/)
Terminal hibernation and auto-revive system for coding agents on Herdr restart or machine boot.
- **Keybinding:** `alt-z` (`hibernate.sleep`)
- **Supported Agents:** Kiro (`kiro-cli`), Antigravity (`agy`), Claude Code, Codex.
- **Key Features:**
  - Automatically revives kept terminals (`--keep`) from shells upon restart.
  - Space and pane sleep/wake toggle commands.
  - Dual-phase startup timer (1.5s & 4.5s) to guarantee delayed Zsh/Starship prompts are revived cleanly.

---

## 🚀 Installation

### Option A: Install All Mods (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Thi0x40go/herdr-thi0x40go ~/Projects/herdr-thi0x40go
   ```

2. **Symlink all mods into Herdr's mods directory:**
   ```bash
   mkdir -p ~/.config/herdr-app/mods
   ln -snf ~/Projects/herdr-thi0x40go/agent-sleep/mods/agent-sleep ~/.config/herdr-app/mods/agent-sleep
   ln -snf ~/Projects/herdr-thi0x40go/orchestrator-wt/mods/orchestrator-wt ~/.config/herdr-app/mods/orchestrator-wt
   ln -snf ~/Projects/herdr-thi0x40go/hibernate/mods/hibernate ~/.config/herdr-app/mods/hibernate
   ```

3. **Validate mod integrity:**
   ```bash
   herdr-app check ~/.config/herdr-app/mods/agent-sleep
   herdr-app check ~/.config/herdr-app/mods/orchestrator-wt
   herdr-app check ~/.config/herdr-app/mods/hibernate
   ```

4. **Register Keybindings in `~/.config/herdr-app/keys.json`:**
   Add the following shortcuts inside your `keys.json`:
   ```json
   {
     "alt-w": "orchestrator-wt",
     "alt-z": "hibernate.sleep"
   }
   ```

---

### Option B: Install Individual Mods

#### 1. Installing `agent-sleep` only
```bash
ln -snf ~/Projects/herdr-thi0x40go/agent-sleep/mods/agent-sleep ~/.config/herdr-app/mods/agent-sleep
herdr-app check ~/.config/herdr-app/mods/agent-sleep
```
*To display in the sidebar:* In your custom layout (e.g. `layouts/workspace.json`), place the `agent-sleep` block right below the `agents` list:
```json
{
  "id": "agent-sleep",
  "type": "block",
  "content": {
    "mod": "agent-sleep"
  },
  "size": {
    "weight": 0.5
  }
}
```

#### 2. Installing `orchestrator-wt` only
```bash
ln -snf ~/Projects/herdr-thi0x40go/orchestrator-wt/mods/orchestrator-wt ~/.config/herdr-app/mods/orchestrator-wt
herdr-app check ~/.config/herdr-app/mods/orchestrator-wt
```
Add the keybinding to `~/.config/herdr-app/keys.json`:
```json
{
  "alt-w": "orchestrator-wt"
}
```

#### 3. Installing `hibernate` only
```bash
ln -snf ~/Projects/herdr-thi0x40go/hibernate/mods/hibernate ~/.config/herdr-app/mods/hibernate
herdr-app check ~/.config/herdr-app/mods/hibernate
```
Add the keybinding to `~/.config/herdr-app/keys.json`:
```json
{
  "alt-z": "hibernate.sleep"
}
```

---

## ⚠️ Herdr Layout Guidelines (from AGENTS.md)

- **Do NOT edit Herdr's shipped `main.json` directly:** Herdr replaces shipped files on every start. If you edit `main.json`, Herdr automatically renames it to `main-edited.json` and restores factory defaults.
- **Use custom clones:** Clone the layout first and edit the clone (e.g. `layouts/workspace.json`), keeping `shared.json` pointing to your custom layout:
  ```bash
  herdr-app do layout.clone '{"name":"main","as":"workspace"}'
  ```
- **Hot-Reload:** Herdr watches files live and reloads changes within a second.
