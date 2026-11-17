// How to put one kind of agent to sleep and wake it up again.
// Enhanced for Antigravity, Kiro, Claude Code, and Codex.
//
// An adapter answers four questions for the agent it handles:
//   - matches(agent, terminal): is this terminal running that agent?
//   - session(pid, terminal):   which session is that process on? (id + start time)
//   - hasDraft(screen):         is there unsent text in its prompt?
//   - quit / resume(id):        what to type to leave, what command brings it back.

import { exec, home, readTextFile } from "herdr";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION_ID = "(?:sess_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION_ID_RE = new RegExp(`^${SESSION_ID}$`, "i");
// Session ids end up in a command typed into a shell: only well-formed ones pass.
export const isSessionId = (id) => typeof id === "string" && SESSION_ID_RE.test(id);

// Measure resident memory (RAM) consumed by a process and its children via /proc/<pid>/statm
export async function getProcessMemory(pid) {
  try {
    const r = await exec("sh", ["-c", `
      pids="${pid}"
      for c in $(pgrep -P ${pid} 2>/dev/null); do
        pids="$pids $c"
        for g in $(pgrep -P $c 2>/dev/null); do
          pids="$pids $g"
        done
      done
      pages=0
      for p in $pids; do
        if [ -f "/proc/$p/statm" ]; then
          m=$(awk '{print $2}' "/proc/$p/statm" 2>/dev/null)
          pages=$((pages + \${m:-0}))
        fi
      done
      echo "$((pages * 4096 / 1024 / 1024)) MB"
    `]);
    if (r && r.code === 0 && r.stdout.trim() && !r.stdout.includes("0 MB")) {
      return r.stdout.trim();
    }
  } catch {}
  return null;
}

// A draft is any text in the prompt: after the marker on its line, and, when
// the prompt sits in a box, on the lines below it up to the box's border (a
// multi-line draft can start with an empty line). No marker found: count it
// as a draft, so nobody's typing is ever thrown away.
function draftAfter(markers, border = null) {
  const markerList = Array.isArray(markers) ? markers : [markers];
  return (screen) => {
    const lines = screen.split("\n");
    let at = -1;
    let matched = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trimStart();
      for (const m of markerList) {
        if (trimmed.startsWith(m)) {
          at = i;
          matched = m;
          break;
        }
      }
      if (at >= 0) break;
    }
    if (at < 0) return true;
    if (lines[at].trimStart().slice(matched.length).trim() !== "") return true;
    if (!border) return false;
    for (let i = at + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith(border)) return false;
      if (l !== "") return true;
    }
    return true; // no border below: can't tell where the prompt ends
  };
}

// Check for active background processes / shells
async function claudeBackgroundWork(screen, pid) {
  const lines = screen.split("\n");
  let border = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith("─")) {
      border = i;
      break;
    }
  }
  const footer = lines.slice(border + 1).join(" ");
  if (/\b\d+\s+(background\s+)?(shells?|bash(es)?|tasks?|loops?|jobs?)\b/i.test(footer)) return true;
  if (lines.slice(border + 1).some((l) => /^\s*◯\s+\S/.test(l))) return true;
  const r = await exec("pgrep", ["-l", "-P", String(pid)]).catch(() => null);
  if (!r) return true;
  if (r.code !== 0) return r.code !== 1;
  return r.stdout.split("\n").some((l) => /\s(bash|sh|zsh|fish|dash)$/.test(l.trim()));
}

async function genericBackgroundWork(screen, pid) {
  const r = await exec("pgrep", ["-l", "-P", String(pid)]).catch(() => null);
  if (!r || r.code !== 0) return false;
  return r.stdout.split("\n").some((l) => /\s(bash|sh|zsh|fish|dash)$/.test(l.trim()));
}

export const ADAPTERS = [
  {
    id: "claude",
    name: "Claude Code",
    icon: "icons/claude.svg",
    experimental: false,
    matches: (agent, terminal) => (agent?.app === "claude-code" || agent?.app === "claude") && terminal.foreground?.name === "claude",
    isRunning: (terminal) => terminal.foreground?.name === "claude",
    async session(pid, terminal) {
      // 1. From argv if present
      if (terminal?.foreground?.argv) {
        for (const arg of terminal.foreground.argv) {
          const m = arg.match(new RegExp(`(${UUID})`));
          if (m) return { id: m[1], startedAt: null, status: null };
        }
      }
      // 2. From sessions/<pid>.json
      const raw = await readTextFile(`${home()}/.claude/sessions/${pid}.json`);
      if (raw) {
        try {
          const s = JSON.parse(raw);
          if (isSessionId(s.sessionId)) return { id: s.sessionId, startedAt: s.startedAt ?? null, status: s.status ?? null };
        } catch {}
      }
      return null;
    },
    hasDraft: draftAfter(["❯", ">"], "─"),
    hasBackgroundWork: claudeBackgroundWork,
    quit: "/exit",
    resume: (id) => `claude --resume ${id}`,
  },
  {
    id: "codex",
    name: "Codex",
    icon: "icons/codex.svg",
    experimental: true,
    matches: (agent, terminal) => agent?.app === "codex" && terminal.foreground?.name === "codex",
    isRunning: (terminal) => terminal.foreground?.name === "codex",
    async session(pid, terminal) {
      if (terminal?.foreground?.argv) {
        for (const arg of terminal.foreground.argv) {
          const m = arg.match(new RegExp(`(${UUID})`));
          if (m) return { id: m[1], startedAt: null, status: null };
        }
      }
      const r = await exec("ls", ["-l", `/proc/${pid}/fd`]).catch(() => null);
      if (!r || r.code !== 0) return null;
      const m = r.stdout.match(new RegExp(`/rollout-[^\\s]*-(${UUID})\\.jsonl`));
      return m ? { id: m[1], startedAt: null, status: null } : null;
    },
    hasDraft: draftAfter(["›", ">"]),
    hasBackgroundWork: genericBackgroundWork,
    quit: "/quit",
    resume: (id) => `codex resume ${id}`,
  },
  {
    id: "antigravity",
    name: "Antigravity",
    icon: "icons/antigravity.svg",
    experimental: false,
    matches: (agent, terminal) =>
      (agent?.app === "antigravity" || agent?.program?.key === "antigravity" || terminal.foreground?.name === "agy" || terminal.foreground?.name === "antigravity") &&
      (terminal.foreground?.name === "agy" || terminal.foreground?.name === "antigravity"),
    isRunning: (terminal) =>
      terminal.foreground?.name === "agy" || terminal.foreground?.name === "antigravity",
    async session(pid, terminal) {
      // 1. From argv if present (e.g. agy --conversation=uuid or agy --conversation uuid)
      if (terminal?.foreground?.argv) {
        for (const arg of terminal.foreground.argv) {
          const m = arg.match(new RegExp(`(${UUID})`));
          if (m) return { id: m[1], startedAt: null, status: null };
        }
      }
      // 2. From /proc/<pid>/fd
      const r = await exec("ls", ["-l", `/proc/${pid}/fd`]).catch(() => null);
      if (r && r.code === 0) {
        const m = r.stdout.match(new RegExp(`/conversations/(${UUID})\\.db`)) ||
                  r.stdout.match(new RegExp(`/presence/(${UUID})\\.lock`));
        if (m) return { id: m[1], startedAt: null, status: null };
      }
      // 3. From presence lock files (find the lock held by flock/fuser)
      const locks = await exec("sh", ["-c", `fuser "$HOME/.gemini/antigravity-cli/presence/"*.lock 2>&1`]).catch(() => null);
      if (locks && locks.stdout) {
        const m = locks.stdout.match(new RegExp(`(${UUID})\\.lock:\\s*${pid}\\b`));
        if (m) return { id: m[1], startedAt: null, status: null };
      }
      // 4. Most recent presence lock file as reliable fallback
      const recent = await exec("sh", ["-c", `ls -t "$HOME/.gemini/antigravity-cli/presence/"*.lock 2>/dev/null | head -n 1`]).catch(() => null);
      if (recent && recent.code === 0 && recent.stdout.trim()) {
        const m = recent.stdout.match(new RegExp(`(${UUID})\\.lock`));
        if (m) return { id: m[1], startedAt: null, status: null };
      }
      return null;
    },
    hasDraft: draftAfter(["❯", ">"]),
    hasBackgroundWork: genericBackgroundWork,
    quit: "/exit",
    resume: (id) => `agy --conversation ${id}`,
  },
  {
    id: "kiro",
    name: "Kiro",
    icon: "icons/kiro.svg",
    experimental: false,
    matches: (agent, terminal) =>
      (agent?.app === "kiro" || agent?.program?.key === "kiro" || terminal.foreground?.name === "kiro-cli" || terminal.foreground?.name === "kiro") &&
      (terminal.foreground?.name === "kiro-cli" || terminal.foreground?.name === "kiro"),
    isRunning: (terminal) =>
      terminal.foreground?.name === "kiro-cli" || terminal.foreground?.name === "kiro",
    async session(pid, terminal) {
      // 1. From argv if present (e.g. kiro-cli ... --resume-id sess_... or ... <id>)
      if (terminal?.foreground?.argv) {
        for (const arg of terminal.foreground.argv) {
          const m = arg.match(new RegExp(`(${SESSION_ID})`, "i"));
          if (m && isSessionId(m[1])) return { id: m[1], startedAt: null, status: null };
        }
      }

      // 2. Resolve via process tree (kiro-cli -> bun -> node) and ~/.kiro/session-leases/
      const leaseRes = await exec("sh", ["-c", `
        pids="${pid}"
        for c in $(pgrep -P ${pid} 2>/dev/null); do
          pids="$pids $c"
          for g in $(pgrep -P $c 2>/dev/null); do
            pids="$pids $g"
          done
        done
        for f in "$HOME/.kiro/session-leases/"*.lease; do
          [ -f "$f" ] || continue
          for p in $pids; do
            if grep -q "\"pid\":$p\\b\\|\"parentPid\":$p\\b" "$f" 2>/dev/null; then
              basename "$f" .lease
              exit 0
            fi
          done
        done
      `]).catch(() => null);

      if (leaseRes && leaseRes.code === 0 && leaseRes.stdout.trim()) {
        const id = leaseRes.stdout.trim();
        if (isSessionId(id)) return { id, startedAt: null, status: null };
      }

      // 3. Check open file descriptors of pid and its children
      const fdRes = await exec("sh", ["-c", `
        pids="${pid} $(pgrep -P ${pid} 2>/dev/null)"
        for p in $pids; do
          ls -l /proc/$p/fd 2>/dev/null | grep -oE '(sess_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' && exit 0
        done
      `]).catch(() => null);

      if (fdRes && fdRes.code === 0 && fdRes.stdout.trim()) {
        const id = fdRes.stdout.trim().split("\n")[0].trim();
        if (isSessionId(id)) return { id, startedAt: null, status: null };
      }

      // 4. Fallback: most recently modified lease file
      const recent = await exec("sh", ["-c", `ls -t "$HOME/.kiro/session-leases/"*.lease 2>/dev/null | head -n 1`]).catch(() => null);
      if (recent && recent.code === 0 && recent.stdout.trim()) {
        const m = recent.stdout.match(new RegExp(`(${SESSION_ID})\\.lease`, "i"));
        if (m && isSessionId(m[1])) return { id: m[1], startedAt: null, status: null };
      }

      return null;
    },
    hasDraft: draftAfter([">", "›", "❯"]),
    hasBackgroundWork: genericBackgroundWork,
    quit: "/quit",
    resume: (id) => `kiro-cli --v3 --resume-id ${id}`,
  },
];

export const adapterFor = (agent, terminal) => ADAPTERS.find((a) => a.matches(agent, terminal)) ?? null;
export const adapterById = (id) => ADAPTERS.find((a) => a.id === id) ?? null;
