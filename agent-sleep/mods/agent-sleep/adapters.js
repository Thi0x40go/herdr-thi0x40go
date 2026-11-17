// How to put one kind of agent to sleep and wake it up again.
// Enhanced for Antigravity, Kiro, Claude Code, and Codex.
//
// An adapter answers four questions for the agent it handles:
//   - matches(agent, terminal): is this terminal running that agent?
//   - session(pid):             which session is that process on? (id + start time)
//   - hasDraft(screen):         is there unsent text in its prompt?
//   - quit / resume(id):        what to type to leave, what command brings it back.

import { exec, home, readTextFile } from "herdr";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
// Session ids end up in a command typed into a shell: only well-formed ones pass.
export const isSessionId = (id) => typeof id === "string" && UUID_RE.test(id);

// Measure resident memory (RAM) consumed by a process via /proc/<pid>/statm
export async function getProcessMemory(pid) {
  try {
    const r = await exec("awk", ["{printf \"%d MB\", $2 * 4096 / 1024 / 1024}", `/proc/${pid}/statm`]);
    if (r && r.code === 0 && r.stdout.trim()) {
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
    matches: (agent, terminal) => (agent.app === "claude-code" || agent.app === "claude") && terminal.foreground?.name === "claude",
    isRunning: (terminal) => terminal.foreground?.name === "claude",
    async session(pid) {
      const raw = await readTextFile(`${home()}/.claude/sessions/${pid}.json`);
      if (!raw) return null;
      try {
        const s = JSON.parse(raw);
        return isSessionId(s.sessionId) ? { id: s.sessionId, startedAt: s.startedAt ?? null, status: s.status ?? null } : null;
      } catch {
        return null;
      }
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
    matches: (agent, terminal) => agent.app === "codex" && terminal.foreground?.name === "codex",
    isRunning: (terminal) => terminal.foreground?.name === "codex",
    async session(pid) {
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
      (agent.app === "antigravity" || agent.program?.key === "antigravity" || terminal.foreground?.name === "agy" || terminal.foreground?.name === "antigravity") &&
      (terminal.foreground?.name === "agy" || terminal.foreground?.name === "antigravity"),
    isRunning: (terminal) =>
      terminal.foreground?.name === "agy" || terminal.foreground?.name === "antigravity",
    async session(pid) {
      const r = await exec("ls", ["-l", `/proc/${pid}/fd`]).catch(() => null);
      if (!r || r.code !== 0) return null;
      const m = r.stdout.match(new RegExp(`/conversations/(${UUID})\\.db`)) ||
                r.stdout.match(new RegExp(`/presence/(${UUID})\\.lock`));
      return m ? { id: m[1], startedAt: null, status: null } : null;
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
      (agent.app === "kiro" || agent.program?.key === "kiro" || terminal.foreground?.name === "kiro-cli" || terminal.foreground?.name === "kiro") &&
      (terminal.foreground?.name === "kiro-cli" || terminal.foreground?.name === "kiro"),
    isRunning: (terminal) =>
      terminal.foreground?.name === "kiro-cli" || terminal.foreground?.name === "kiro",
    async session(pid) {
      // Check /proc/<pid>/fd first
      const r = await exec("ls", ["-l", `/proc/${pid}/fd`]).catch(() => null);
      if (r && r.code === 0) {
        const m = r.stdout.match(new RegExp(`sess_(${UUID})\\.lease`));
        if (m) return { id: m[1], startedAt: null, status: null };
      }
      // Check ~/.kiro/session-leases/
      const leases = await exec("sh", ["-c", `grep -l '"pid":${pid}\\b' "$HOME/.kiro/session-leases/"*.lease 2>/dev/null`]).catch(() => null);
      if (leases && leases.code === 0 && leases.stdout.trim()) {
        const m = leases.stdout.match(new RegExp(`sess_(${UUID})\\.lease`));
        if (m) return { id: m[1], startedAt: null, status: null };
      }
      return null;
    },
    hasDraft: draftAfter([">", "›", "❯"]),
    hasBackgroundWork: genericBackgroundWork,
    quit: "/quit",
    resume: (id) => `kiro-cli --resume-id ${id}`,
  },
];

export const adapterFor = (agent, terminal) => ADAPTERS.find((a) => a.matches(agent, terminal)) ?? null;
export const adapterById = (id) => ADAPTERS.find((a) => a.id === id) ?? null;
