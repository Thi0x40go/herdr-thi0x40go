// To-dos across every project, shared with agents: the right panel's "To-do" (a
// child of the panel-body stack; over9k-tabs has its button).
// Each project's list is ~/.local/share/over9k/todos/<slug>.md (DATA_DIR; as todo.sh,
// $XDG_DATA_HOME/over9k/todos when that's set): a
// "<!-- folder: … -->" line, then "- [ ] text" / "- [x] text" lines, with
// "<!-- due: 2026-11-04 15:00 -->" (or a date alone) and "<!-- done: 2026-11-03 -->"
// after the text. The `todo` command (todo.sh) reads and writes the same files,
// so what an agent adds shows here at once (watchFolder), and back.
// In a space on another computer, the project you're in is that computer's: its
// list, TODO.md and new agents are there (read every 5s; HERE, loadThere).
// Shown: today's date; a chip per project with open to-dos (its colour, as the
// sidebar's: a hash of its folder's name) and "All"; one list, the project
// you're in first, then by due time; each to-do with its project and when it's
// due (red once past); "Done today". Adding: to the project you're in, or
// "#name" for another; "@today" / "@fri" / "@nextweek" / "@in2h" / "@12nov" / "@4/11"
// (day and month in the computer's order; every form is listed above readWhen), with a time
// ("@14:30", "@fri 9am") or not. A circle ticks; double-click edits; × deletes.
// Ticked ones from before today stay in the file (`todo clear` removes them).
// A project's own TODO.md (read only for suggestions, "From TODO.md") gets
// its line crossed out when that to-do is ticked here or by `todo done`
// (todo-cross.py, next to this file; needs python3, else nothing is crossed out),
// and back in when unticked.
// Optional: shared "projects.names" / "projects.pinned" / "projects.auto" (the
// over9k sidebar writes them) add renamed and listed projects to "#" matches.
// The agent button by an open to-do or a TODO.md suggestion (on hover) lists the
// installed agents; one picked starts in that project's space (opened if it
// isn't) on that one to-do only, told to tick it with `todo done "<text>"` when
// it's finished. A suggestion goes on the list first.
// Two tabs: All (your pinned projects, the sidebar's list, and the project
// you're in) and the project you're in (following you as you move).
// On the project tab, Shift, Cmd/Meta or Ctrl + click picks to-dos (Shift:
// every one from the last picked); a bar then marks them done, sends them to
// an agent or deletes them together.
// Log and Sync are per project: the header's two tags switch them for the
// project you're in (hover names it). A project with neither
// switch set follows Options › To-do (shared "sidebar.options": todoLog,
// todoSync), as `todo` does (its todo-defaults file).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agentTask } from "./agent-name.js";
import { theme, exec, home, appHome, spaces, focused, shared, readTextFile, writeTextFile, watchFolder, knownAgents, run, notify, panes, hc, agents, setShared, openOverlay } from "herdr";

// Python 3 runs as "python3", else "python" (as on Windows): found once.
let PY = null;
const python = (args) => (PY ??= exec("python3", ["-c", "1"]).then((r) => (r?.code === 0 ? "python3" : "python"), () => "python"))
  .then((p) => exec(p, args));

// Where the lists live: the same folder todo.sh uses. Resolved once at start
// (dataDir), from $XDG_DATA_HOME when the user's environment sets it.
const DATA_DIR = ".local/share/herdr/todos"; // under home
const XDG_DIR = 'printf %s "${XDG_DATA_HOME:+$XDG_DATA_HOME/herdr/todos}"';
let dataDir = null;
const DIR = () => dataDir ?? `${home()}/${DATA_DIR}`;
// Crosses a to-do out of (or back into) a project's own TODO.md.
const CROSS = () => `${appHome()}/mods/todos/todo-cross.py`;
// The project you're in when its space is on another computer: its list, its
// TODO.md and its agents are that computer's (findHere sets it).
const HERE = { folder: null, machine: null };
const mOf = (folder) => (folder && folder === HERE.folder ? HERE.machine : null);
const onM = (m) => (m ? { on: m } : {});
// A list there is keyed "@<machine>:<slug>"; this computer's by its slug alone.
const keyOf = (folder) => (mOf(folder) ? `@${mOf(folder)}:${slugOf(folder)}` : slugOf(folder));
const machineOf = (key) => (key.startsWith("@") ? key.slice(1, key.indexOf(":")) : null);
// There, the list is read and written with sh (todo.sh's folder): a write only
// when the file still holds what was read ($3; $4 set: it was there), else 3.
const THERE_DIR = 'd="${XDG_DATA_HOME:-$HOME/.local/share}/herdr/todos"';
const THERE_READ = `${THERE_DIR}; cat "$d/$1.md" 2>/dev/null`;
const THERE_WRITE = `${THERE_DIR}; f="$d/$1.md"; mkdir -p "$d" || exit 1
if [ -e "$f" ]; then [ "$(cat "$f")" = "$(printf %s "$3")" ] || exit 3; elif [ -n "$4" ]; then exit 3; fi
printf %s "$2" > "$f.tmp" && mv "$f.tmp" "$f"`;
// todo-cross.py on the computer the folder is on (there: its text, run with -c).
let crossText = null;
const cross = async (folder, ...args) => {
  const m = mOf(folder);
  if (!m) return python(["-I", CROSS(), folder, ...args]).catch(() => null);
  crossText ??= await readTextFile(CROSS()).catch(() => null);
  if (!crossText) return null;
  return exec("python3", ["-I", "-c", crossText, folder, ...args], onM(m)).catch(() => null);
};
// Sync on: what's added, edited or deleted here goes into the project's TODO.md too.
const toFile = (folder, ...args) => (SYNCED.has(folder) ? cross(folder, ...args) : null);
// Each project's switches, kept in its list file ("<!-- log: off -->",
// "<!-- sync: on -->"; `todo log|sync on|off` writes the same): Log, whether
// agents add what's asked for (on unless off); Sync, whether the project's
// TODO.md follows what's added, edited or deleted here (off unless on).
const SYNCED = new Set(); // folders with Sync on
const slugOf = (folder) => folder.replace(/\/+$/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ITEM = /^- \[( |x)\] (.*)$/;
// A click that picks rather than acts, as in the over9k sidebar.
// Log and Sync for a project that never set them: Options › To-do.
const defOpts = () => { const o = shared("sidebar.options") ?? {}; return { log: o.todoLog !== false, sync: o.todoSync === true }; };
const multi = (e) => Boolean(e?.modifiers && (e.modifiers.shift || e.modifiers.platform || e.modifiers.control));
const stamp = () => `${today()} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// over9k's project colours (MARK, hue): the same project, the same colour.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
function hue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
  const keys = Object.keys(MARK);
  return MARK[keys[h % keys.length]];
}

const prioCol = (p) => {
  if (!p) return "#64748b";
  const norm = String(p).toLowerCase();
  if (norm === "critical" || norm === "p0" || norm === "urgent") return "#ef4444";
  if (norm === "high" || norm === "p1") return "#f59e0b";
  if (norm === "medium" || norm === "p2" || norm === "med") return "#3b82f6";
  if (norm === "low" || norm === "p3") return "#64748b";
  return "#64748b";
};

function normalizeCard(str) {
  if (!str) return "";
  let c = str.trim().replace(/^#/, "").trim();
  const m = /^([a-zA-Z]{2,8})[-_ ]?([0-9]{2,6})$/i.exec(c);
  if (m) {
    return `${m[1].toUpperCase()}-${m[2]}`;
  }
  return c.toUpperCase();
}

export function parseCards(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return [...new Set(val.map(normalizeCard).filter(Boolean))];
  }
  const str = String(val).trim();
  if (str === "none" || !str) return [];
  return [...new Set(str.split(/[,;\s]+/).map(normalizeCard).filter(Boolean))];
}

function getTaskCard(x, cardList) {
  if (!x || !cardList || !cardList.length) return null;
  for (const card of cardList) {
    if (x.group && cardsMatch(x.group, card)) return card;
    if (cardsMatch(x.text, card)) return card;
    const cardInText = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(x.text);
    if (cardInText && cardsMatch(`${cardInText[1]}-${cardInText[2]}`, card)) return card;
  }
  return null;
}

function cardsMatch(a, b) {
  if (!a || !b) return false;
  const sa = String(a).trim().toUpperCase().replace(/^#/, "");
  const sb = String(b).trim().toUpperCase().replace(/^#/, "");
  if (sa === sb) return true;

  const normA = normalizeCard(sa);
  const normB = normalizeCard(sb);
  if (normA && normB && normA === normB) return true;

  const digitsA = sa.replace(/\D/g, "");
  const digitsB = sb.replace(/\D/g, "");
  if (digitsA && digitsB && digitsA === digitsB) {
    const isPureDigitsA = /^\d+$/.test(sa);
    const isPureDigitsB = /^\d+$/.test(sb);
    if (isPureDigitsA || isPureDigitsB) return true;
    const prefixA = sa.replace(/[-_ ]?[0-9]+$/, "");
    const prefixB = sb.replace(/[-_ ]?[0-9]+$/, "");
    if (!prefixA || !prefixB || prefixA === prefixB) return true;
  }

  if (sa.endsWith("-" + sb) || sb.endsWith("-" + sa)) return true;

  return false;
}

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dayKey(new Date());

// The computer's date and time preferences: day/month/year order and
// separator (its locale's d_fmt), 12- or 24-hour clock (GNOME's clock-format,
// macOS's 12/24-hour switch, else the locale's t_fmt). Read once at start
// (loadFormat); until then, and when nothing answers, 24-hour day/month/year.
const FORMAT_SH = `if [ "$(uname)" = Darwin ]; then
  loc=$(defaults read -g AppleLocale 2>/dev/null); loc=\${loc%%@*}
  LC_ALL="\${loc:-en_US}.UTF-8" locale -k d_fmt t_fmt 2>/dev/null
  [ "$(defaults read -g AppleICUForce24HourTime 2>/dev/null)" = 1 ] && echo 'clock="24h"'
  [ "$(defaults read -g AppleICUForce12HourTime 2>/dev/null)" = 1 ] && echo 'clock="12h"'
else
  locale -k d_fmt t_fmt 2>/dev/null
  c=$(gsettings get org.gnome.desktop.interface clock-format 2>/dev/null | tr -d "'")
  [ -n "$c" ] && echo "clock=\\"$c\\""
fi; true`;
let FMT = { order: ["d", "m", "y"], sep: "/", h12: false };
async function loadFormat() {
  const r = await exec("sh", ["-c", FORMAT_SH]).catch(() => null);
  const kv = Object.fromEntries([...(r?.stdout ?? "").matchAll(/^(\w+)="(.*)"$/gm)].map((m) => [m[1], m[2]]));
  const d = (kv.d_fmt ?? "").replace(/%D/g, "%m/%d/%y").replace(/%F/g, "%Y-%m-%d");
  const at = { d: d.search(/%[de]/), m: d.search(/%m/), y: d.search(/%[yY]/) };
  if (at.d >= 0 && at.m >= 0 && at.y >= 0) FMT.order = Object.keys(at).sort((a, b) => at[a] - at[b]);
  FMT.sep = /%[a-zA-Z]([^%\s])/.exec(d)?.[1] ?? FMT.sep;
  FMT.h12 = kv.clock ? kv.clock === "12h" : /%[Ilpr]/.test(kv.t_fmt ?? "");
}
// A date as the computer writes it: "4/11" (no year) or "04/11/2026" (`full`).
function fmtDate(d, full = false) {
  const part = { d: full ? pad(d.getDate()) : String(d.getDate()), m: full ? pad(d.getMonth() + 1) : String(d.getMonth() + 1), y: String(d.getFullYear()) };
  return FMT.order.filter((k) => full || k !== "y").map((k) => part[k]).join(FMT.sep);
}
// "HH:MM" as the computer's clock shows it: "15:30", or "3:30pm".
function fmtTime(hm) {
  if (!FMT.h12 || !hm) return hm;
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`;
}
// A typed day and month ("4/11", "4.11", "4-11", "4/11/2027") in the computer's
// order: [month, day, year or undefined].
function readDayMonth(word) {
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(word);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined;
  const order = FMT.order.filter((k) => k !== "y");
  return order[0] === "d" ? [+m[2], +m[1], y] : [+m[1], +m[2], y];
}

function parseLine(text) {
  const due = /<!-- due: ([^>]*?) -->/.exec(text)?.[1] ?? null;
  const done = /<!-- done: ([^>]*?) -->/.exec(text)?.[1] ?? null;
  let meta = null;
  const metaM = /<!-- meta: (\{.*?\}) -->/.exec(text);
  if (metaM) {
    try { meta = JSON.parse(metaM[1]); } catch { meta = null; }
  }
  const clean = text.replace(/\s*<!--[^>]*-->/g, "").trim();
  let group = meta?.group ?? null;
  if (!group) {
    const cardM = /(?:^|\s)(?:#|\[)?(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)(?:\])?/i.exec(clean);
    if (cardM) group = `${cardM[1].toUpperCase()}-${cardM[2]}`;
  }
  if (!group) {
    const numM = /^(?:\[|\b)([0-9]{3,6})(?:\]|:|\b)/.exec(clean);
    if (numM) group = numM[1];
  }
  let priority = meta?.priority ?? null;
  if (priority) {
    const norm = String(priority).toLowerCase();
    if (norm === "p0" || norm === "urgent" || norm === "critical" || norm === "crit") priority = "Critical";
    else if (norm === "p1" || norm === "high") priority = "High";
    else if (norm === "p2" || norm === "medium" || norm === "med") priority = "Medium";
    else if (norm === "p3" || norm === "low") priority = "Low";
  }
  if (!priority) {
    const prioM = /(?:^|\s)!(critical|high|medium|med|low|urgent|crit|p0|p1|p2|p3)\b/i.exec(clean);
    if (prioM) {
      const p = prioM[1].toLowerCase();
      priority = (p === "p0" || p === "urgent" || p === "critical" || p === "crit") ? "Critical"
               : (p === "p1" || p === "high") ? "High"
               : (p === "p2" || p === "med" || p === "medium") ? "Medium"
               : "Low";
    }
  }

  let urls = [];
  if (meta?.urls) {
    if (Array.isArray(meta.urls)) urls = meta.urls.map((u) => (typeof u === "string" ? { name: "link", url: u } : u));
    else if (typeof meta.urls === "object") urls = Object.entries(meta.urls).map(([name, url]) => ({ name, url }));
  } else if (meta?.url) {
    urls = [{ name: "link", url: meta.url }];
  }
  const mdLinks = [...clean.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)];
  for (const m of mdLinks) {
    if (!urls.some((u) => u.url === m[2])) urls.push({ name: m[1], url: m[2] });
  }
  const rawLinks = [...clean.matchAll(/(?<!\()(https?:\/\/[^\s)]+)/g)];
  for (const m of rawLinks) {
    if (!urls.some((u) => u.url === m[1])) {
      const domain = m[1].replace(/^https?:\/\/(?:www\.)?/, "").split("/")[0];
      urls.push({ name: domain || "link", url: m[1] });
    }
  }

  const resMeta = meta ? { ...meta } : ((group || priority || urls.length) ? {} : null);
  if (resMeta) {
    if (group) resMeta.group = group;
    if (priority) resMeta.priority = priority;
    if (urls.length) resMeta.urls = urls;
  }

  return { text: clean, due, doneOn: done, group, priority, urls, meta: resMeta };
}
// "<!-- skip: text -->" lines: TODO.md items hidden from the suggestions.
function parse(raw) {
  let folder = null, log = null, sync = null;
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(raw ?? "");
  if (fmMatch) {
    const fmLines = fmMatch[1].split("\n");
    for (const line of fmLines) {
      const [k, ...vParts] = line.split(":");
      if (!k || !vParts.length) continue;
      const v = vParts.join(":").trim().replace(/^["']|["']$/g, "");
      if (k.trim() === "folder") folder = v;
      if (k.trim() === "log") log = v;
      if (k.trim() === "sync") sync = v;
    }
  }
  folder ??= /^<!-- folder: (.*) -->$/m.exec(raw ?? "")?.[1] ?? null;
  log ??= /^<!-- log: (on|off) -->$/m.exec(raw ?? "")?.[1];
  sync ??= /^<!-- sync: (on|off) -->$/m.exec(raw ?? "")?.[1];
  const skipped = [...(raw ?? "").matchAll(/^<!-- skip: (.*) -->$/gm)].map((m) => m[1]);
  const d = defOpts();
  const opts = { log: log ? log === "on" : d.log, sync: sync ? sync === "on" : d.sync, set: { log: Boolean(log), sync: Boolean(sync) } };

  const lines = (raw ?? "").split("\n");
  const items = [];
  let cur = null;
  let inDesc = false;
  let descLines = [];
  let inFm = /^---\r?$/.test(lines[0]?.trim() ?? "");

  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    if (inFm) {
      if (li > 0 && l.trim() === "---") inFm = false;
      continue;
    }
    if (inDesc) {
      if (/^\s*-->$/.test(l)) {
        inDesc = false;
        if (cur) cur.description = descLines.join("\n");
        descLines = [];
      } else {
        descLines.push(l.trim());
      }
      continue;
    }
    if (/^\s*<!--\s*desc:/.test(l)) {
      inDesc = true;
      descLines = [];
      continue;
    }
    const mTop = /^-\s*\[([ xX~-])\]\s*(.*)$/.exec(l);
    if (mTop) {
      cur = { done: mTop[1] === "x" || mTop[1] === "X", subtasks: [], description: "", ...parseLine(mTop[2]) };
      items.push(cur);
      continue;
    }
    const mSub = /^\s{2,}-\s*\[([ xX~-])\]\s*(.*)$/.exec(l);
    if (mSub && cur) {
      const parsedSub = parseLine(mSub[2]);
      cur.subtasks.push({ done: mSub[1] === "x" || mSub[1] === "X", text: parsedSub.text, doneOn: parsedSub.doneOn });
      continue;
    }
  }

  return { folder, items, skipped, opts };
}
const line = (i) => {
  const parts = [];
  const metaStr = i.meta && Object.keys(i.meta).length ? ` <!-- meta: ${JSON.stringify(i.meta)} -->` : "";
  const dueStr = i.due ? ` <!-- due: ${i.due} -->` : "";
  const doneStr = i.done && i.doneOn ? ` <!-- done: ${i.doneOn} -->` : "";
  parts.push(`- [${i.done ? "x" : " "}] ${i.text.replace(/\n/g, " ")}${metaStr}${dueStr}${doneStr}`);
  if (i.description) {
    parts.push("  <!-- desc:");
    for (const dl of i.description.trim().split("\n")) parts.push(`  ${dl}`);
    parts.push("  -->");
  }
  if (i.subtasks?.length) {
    for (const s of i.subtasks) {
      const sDone = s.done && s.doneOn ? ` <!-- done: ${s.doneOn} -->` : "";
      parts.push(`  - [${s.done ? "x" : " "}] ${s.text.replace(/\n/g, " ")}${sDone}`);
    }
  }
  return parts.join("\n");
};
const serialize = (folder, items, skipped = [], opts = {}) => `---
folder: ${folder}
log: ${opts.log ? "on" : "off"}
sync: ${opts.sync ? "on" : "off"}
---
${skipped.map((x) => `<!-- skip: ${x.replace(/-->/g, "")} -->\n`).join("")}${items.map(line).join("\n")}${items.length ? "\n" : ""}`;

// A project's own to-do file (TODO.md and the like), read, never written: its
// open items ("- [ ] …", or every bullet when it has no checkboxes).
const TODO_FILE = `for f in TODO.md todo.md Todo.md TODO TODO.txt docs/TODO.md; do [ -f "$1/$f" ] && { printf '%s\\n' "$f"; head -c 65536 "$1/$f"; exit 0; }; done`;
function fileItems(text) {
  const lines = text.split("\n");
  const boxes = lines.some((l) => /^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]/.test(l));
  const clean = (x) => x.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  return lines.map((l) => (boxes ? /^\s*(?:[-*+]|\d+\.)\s+\[ \]\s+(.+)$/.exec(l) : /^\s*(?:[-*+]|\d+\.)\s+(.+)$/.exec(l))?.[1])
    .filter((x) => x && !/^~~.*~~\s*$/.test(x.trim())).map(clean).filter((x) => x && x.length < 300).slice(0, 40);
}

// Ways to say when, after "@" (one word; a time may follow a day word):
//   today, tonight (20:00), tomorrow / tmr / tmrw
//   mon … sun (the coming one), nextfri (next week's), weekend (Saturday),
//   eow / "end of week" (Friday), "next week" (Monday), eom / "end of month",
//   "next month" (the 1st); "in 2 hours", "in a day", "this fri" (as below, spaced)
//   morning 9:00, noon 12:00, afternoon 14:00, evening 18:00, eod 17:00
//     (today, or tomorrow once that time has passed)
//   in30m, in2h, in3d, in2w, in1mo (from now)
//   4/11, 4/11/2027 (day and month in the computer's order), 2026-11-04, 12nov, nov12
//   14:30, 9am, 9:30pm (today, or tomorrow once passed)
// e.g. "@fri 9am", "@nextweek morning", "@12nov 15:00".
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PARTS = { morning: "09:00", noon: "12:00", midday: "12:00", afternoon: "14:00", evening: "18:00", tonight: "20:00", eod: "17:00", midnight: "00:00" };
// A time: "14:30", "9am", "9:30pm", "3p", "3.30pm", "9 a.m.", "15h", "15h30",
// "1530", "5 o'clock", "15" (13–23 can only be an hour), or a part of the day.
// `loose`: any bare hour counts (it follows a day or "at"): 1–7 read as the
// afternoon ("fri 3" → 15:00), and every hour before noon does after an
// evening word (`pm`: "tonight 9" → 21:00).
function readTime(s, loose = false, pm = false) {
  let w = (s ?? "").toLowerCase().replace(/\s+/g, "").replace(/([ap])\.m\.?$/, "$1m");
  if (PARTS[w]) return PARTS[w];
  const oclock = /o'?clock$/.test(w);
  w = w.replace(/o'?clock$/, "");
  const m = /^(\d{1,2})(?:[:.](\d{2})|h(\d{2})?|(\d{2}))?([ap]m?)?$/.exec(w);
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] ?? m[3] ?? m[4] ?? 0);
  const bare = !m[2] && !m[4] && !w.includes("h") && !m[5];
  if (bare && !oclock && !loose && !(h >= 13 && h <= 23)) return null;
  if (m[5]) { if (h > 12 || h === 0) return null; if (h === 12) h = 0; if (m[5][0] === "p") h += 12; }
  else if (bare && h >= 1 && h < 12 && (pm || h <= 7)) h += 12;
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}
const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayOf = (s) => DAYS.findIndex((x) => s.startsWith(x));
const monthOf = (s) => (s.length >= 3 ? MONTHS.findIndex((x) => s.startsWith(x)) : -1);
// A date this year, or next year's once it has passed.
function ahead(mo, da, today) {
  const d = new Date(today.getFullYear(), mo, da);
  if (d.getMonth() !== mo) return null;
  if (d < today) d.setFullYear(d.getFullYear() + 1);
  return d;
}
// One "@" word as { d: the day, at: "HH:MM" or null }, or null when it isn't one.
function readWhen(word, now = new Date()) {
  const w = word.toLowerCase(), today = startOf(now), dow = today.getDay();
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let m;
  if (w === "today") return { d: today, at: null };
  if (w === "tonight") return { d: today, at: PARTS.tonight };
  if (["tomorrow", "tmr", "tmrw", "tom"].includes(w)) return { d: plusDays(today, 1), at: null };
  if (PARTS[w]) return { d: PARTS[w] <= hm ? plusDays(today, 1) : today, at: PARTS[w] };
  if (w === "weekend") return { d: plusDays(today, dow === 0 ? 0 : 6 - dow), at: null };
  if (w === "eow") return { d: plusDays(today, (5 - dow + 7) % 7), at: null };
  if (w === "nextweek") return { d: plusDays(today, (1 - dow + 7) % 7 || 7), at: null };
  if (w === "eom") return { d: new Date(today.getFullYear(), today.getMonth() + 1, 0), at: null };
  if (w === "nextmonth") return { d: new Date(today.getFullYear(), today.getMonth() + 1, 1), at: null };
  if ((m = /^next([a-z]{3,})$/.exec(w)) && dayOf(m[1]) >= 0) {
    const monday = plusDays(today, (1 - dow + 7) % 7 || 7);
    return { d: plusDays(monday, (dayOf(m[1]) + 6) % 7), at: null };
  }
  if (/^[a-z]{3,}$/.test(w) && dayOf(w) >= 0) return { d: plusDays(today, (dayOf(w) - dow + 7) % 7 || 7), at: null };
  if ((m = /^in(\d+)(m|min|mins|h|hr|hrs|d|w|wk|mo)$/.exec(w))) {
    const n = +m[1], u = m[2];
    if (/^(m|min|mins|h|hr|hrs)$/.test(u)) {
      const t = new Date(now.getTime() + n * (u.startsWith("h") ? 3600000 : 60000));
      return { d: startOf(t), at: `${pad(t.getHours())}:${pad(t.getMinutes())}` };
    }
    if (u === "mo") { const d = new Date(today); d.setMonth(d.getMonth() + n); return { d, at: null }; }
    return { d: plusDays(today, n * (u === "d" ? 1 : 7)), at: null };
  }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w))) return { d: new Date(+m[1], +m[2] - 1, +m[3]), at: null };
  const dm = readDayMonth(w);
  if (dm) { const [mo, da, y] = dm; const d = y ? new Date(y, mo - 1, da) : ahead(mo - 1, da, today); return d ? { d, at: null } : null; }
  if ((m = /^(\d{1,2})([a-z]{3,})$/.exec(w) ?? /^([a-z]{3,})(\d{1,2})$/.exec(w))) {
    const [da, mon] = /^\d/.test(m[1]) ? [+m[1], m[2]] : [+m[2], m[1]];
    const d = monthOf(mon) >= 0 ? ahead(monthOf(mon), da, today) : null;
    return d ? { d, at: null } : null;
  }
  const at = readTime(w);
  if (at) return { d: at <= hm ? plusDays(today, 1) : today, at };
  return null;
}
// A phrase as the one word readWhen knows: "next week" → nextweek, "in 2 hours"
// → in2h, "in a day" → in1d, "end of week" → eow, "this fri" → fri, "12 nov" → 12nov.
function normWhen(s) {
  const w = s.toLowerCase().replace(/\s+/g, "");
  const m = /^in(\d+|an?|one)(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mo)$/.exec(w);
  if (m) {
    const u = m[2].startsWith("mo") ? "mo" : m[2] === "m" || m[2].startsWith("mi") ? "m" : m[2][0];
    return `in${/^\d+$/.test(m[1]) ? m[1] : "1"}${u}`;
  }
  return { endofweek: "eow", endofmonth: "eom", endofday: "eod", thisweekend: "weekend", thisweek: "eow", thismonth: "eom" }[w] ?? w.replace(/^this(?=[a-z]{3,}$)/, "");
}
// "@tomorrow 15:00", "@fri 9am", "@next week morning", "@in 2 hours" in what's
// typed: the due ("YYYY-MM-DD" or "YYYY-MM-DD HH:MM") and the text without it.
// The longest run of up to four words after "@" that reads as a when wins, then
// a time may follow ("at" before it is fine).
function takeDue(text) {
  const head = /(?:^|\s)@(?=\S)/.exec(text);
  if (!head) return { text, due: null };
  const from = head.index + head[0].length;
  const words = [...text.slice(from).matchAll(/\S+/g)].slice(0, 9).map((x) => ({ w: x[0], end: from + x.index + x[0].length }));
  const lw = (i) => words[i]?.w.toLowerCase() ?? "";
  // A time from word i ("at" before it, a spaced "pm" after it): [time, its last word] or null.
  const timeAt = (i, loose = false, pm = false) => {
    if (lw(i) === "at") { i++; loose = true; }
    if (/^[ap]\.?m\.?$/.test(lw(i + 1))) { const t = readTime(`${lw(i)}${lw(i + 1)}`); if (t) return [t, i + 1]; }
    const t = readTime(lw(i), loose, pm);
    return t ? [t, i] : null;
  };
  // A day from word i (up to four words, "on" before it): [when, its last word] or null.
  const dayAt = (i) => {
    if (lw(i) === "on") i++;
    for (let k = Math.min(4, words.length - i); k >= 1; k--) {
      const when = readWhen(normWhen(words.slice(i, i + k).map((x) => x.w).join(" ")));
      if (when) return [when, i + k - 1];
    }
    return null;
  };
  let when, end;
  const t0 = lw(0) === "tonight" ? null : timeAt(0);
  if (t0) {
    // A time first: a day may follow ("3pm tomorrow"), else today or tomorrow.
    const d = dayAt(t0[1] + 1);
    if (d && !d[0].at) [when, end] = [{ d: d[0].d, at: t0[0] }, d[1]];
    else [when, end] = [readWhen(t0[0]), t0[1]];
  } else {
    const d = dayAt(0);
    if (!d) return { text, due: null };
    [when, end] = [{ ...d[0] }, d[1]];
    const t = timeAt(end + 1, true, (when.at ?? "") >= "12:00");
    if (t) [when.at, end] = [t[0], t[1]];
  }
  const rest = (text.slice(0, head.index) + " " + text.slice(words[end].end)).replace(/\s+/g, " ").trim();
  return { text: rest, due: when.at ? `${dayKey(when.d)} ${when.at}` : dayKey(when.d) };
}
// The phrases offered while typing after "@" (each also works as typed).
const PHRASES = ["today", "tonight", "tomorrow", "morning", "noon", "afternoon", "evening", "end of day", "this weekend", "end of week", "next week",
  "next mon", "next tue", "next wed", "next thu", "next fri", "next sat", "next sun", "end of month", "next month",
  "in 30 minutes", "in 1 hour", "in 2 hours", "in 3 hours", "in 1 day", "in 2 days", "in 3 days", "in 1 week", "in 2 weeks", "in 1 month"];

// A due as words: "today 15:00", "tomorrow", "fri 9:00", "4/11" (in the computer's formats).
function dueWords(due) {
  const [day, at] = due.split(" ");
  const d = new Date(`${day}T00:00:00`), now = new Date();
  const diff = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const words = diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff === -1 ? "yesterday" : diff > 1 && diff < 7 ? DAYS[d.getDay()] : fmtDate(d);
  return at ? `${words} ${fmtTime(at)}` : words;
}
// When it was ticked: "15:30" (today), "yesterday 9:00", "mon 9:00", "28/10".
function doneWords(on) {
  const [day, at] = on.split(" ");
  const d = new Date(`${day}T00:00:00`), now = new Date();
  const diff = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  // Today: just the time.
  if (diff === 0) return at ? fmtTime(at) : "today";
  const words = diff === -1 ? "yesterday" : diff < 0 && diff > -7 ? DAYS[d.getDay()] : fmtDate(d);
  return at ? `${words} ${fmtTime(at)}` : words;
}
const overdue = (due) => (due.includes(" ") ? new Date(due.replace(" ", "T")) : new Date(`${due}T23:59:59`)) < new Date();

// What to offer for the word being typed (the last one): "#…" projects,
// "@…" days, dates and times, and a time after "@<day> ". Each: what goes in
// (replacing that word), a label and a hint.
const TIMES = () => { const out = []; for (let h = 7; h <= 22; h++) for (const m of [0, 30]) out.push(FMT.h12 ? fmtTime(`${pad(h)}:${pad(m)}`) : `${h}:${pad(m)}`); return out; };
function suggest(value, projects) {
  const last = /(\S*)$/.exec(value)[1];
  const lower = last.toLowerCase();
  const now = new Date();
  const dayHint = (d) => `${DAYS[d.getDay()][0].toUpperCase()}${DAYS[d.getDay()].slice(1)} ${fmtDate(d)}`;
  const timeList = (want) => {
    const ampm = /^(\d{1,2})(a|p)/i.exec(want);
    if (ampm) return [`${ampm[1]}${ampm[2].toLowerCase()}m`, `${ampm[1]}:30${ampm[2].toLowerCase()}m`];
    return TIMES().filter((x) => !want || x.startsWith(want) || pad(+x.split(":")[0]) === want.padStart(2, "0").slice(0, 2) && x.startsWith(String(+want)));
  };
  if (lower.startsWith("#")) {
    const want = lower.slice(1);
    return projects.filter((p) => !want || p.key.toLowerCase().startsWith(want) || p.name.toLowerCase().startsWith(want)).slice(0, 7)
      .map((p) => ({ insert: `#${p.key}`, label: p.name, hint: p.key !== p.name ? p.key : "", color: p.color }));
  }
  // When a word lands, as its hint: "today 9:00", "Fri 7/11 9:00".
  const hintOf = (word) => {
    const r = readWhen(word, now);
    if (!r) return null;
    const diff = Math.round((r.d - startOf(now)) / 86400000);
    return `${diff === 0 ? "today" : diff === 1 ? "tomorrow" : dayHint(r.d)}${r.at ? ` ${fmtTime(r.at)}` : ""}`;
  };
  // Further words of an "@" phrase: "@next w" → week, "@in 2 h" → hours.
  const ph = /(?:^|\s)@([a-z]+(?:\s+[a-z0-9]*){1,3})$/i.exec(value);
  if (ph && !lower.startsWith("@")) {
    const typed = ph[1].toLowerCase().replace(/\s+/g, " "), n = /^in (\d+) ?[a-z]*$/.exec(typed)?.[1];
    const list = n ? ["minutes", "hours", "days", "weeks", "months"].map((u) => `in ${n} ${+n === 1 ? u.slice(0, -1) : u}`) : PHRASES;
    const got = list.filter((p) => p.startsWith(typed) && p !== typed).map((p) => ({ p, hint: hintOf(normWhen(p)) })).filter((x) => x.hint).slice(0, 7)
      .map(({ p, hint }) => ({ insert: p.slice(typed.length - last.length), label: p, hint }));
    if (got.length) return got;
  }
  if (lower.startsWith("@")) {
    const want = lower.slice(1), out = [];
    const offer = (words) => words.filter((w) => w.startsWith(want)).map((w) => ({ w, hint: hintOf(w) })).filter((x) => x.hint).slice(0, 7)
      .map(({ w, hint }) => ({ insert: `@${w}`, label: w, hint }));
    if (/^\d/.test(want)) {
      // A date (4/11, 4/11/2027) or a time (14:30, 9am) or a day and month (12nov).
      if (/[/.-]/.test(want) && !/^\d{1,2}:/.test(want)) {
        for (let k = 0; k < 400 && out.length < 7; k++) { const d = plusDays(now, k); const md = fmtDate(d); if (md.startsWith(want.replace(/[/.-]/g, FMT.sep)) && !out.some((x) => x.label === md)) out.push({ insert: `@${md}`, label: md, hint: dayHint(d) }); }
        return out;
      }
      const dm = /^(\d{1,2})([a-z]*)$/.exec(want);
      if (dm && dm[2]) return offer(MONTHS.map((x) => `${dm[1]}${x}`));
      const mins = (x) => { const t = readTime(x); return t ? +t.slice(0, 2) * 60 + +t.slice(3) : 0; };
      const nowMin = now.getHours() * 60 + now.getMinutes();
      return timeList(want).slice(0, 7).map((x) => ({ insert: `@${x}`, label: x, hint: mins(x) <= nowMin ? "tomorrow" : "today" }));
    }
    // "in…": from now.
    if (/^in\d*[a-z]*$/.test(want) && want.startsWith("i")) {
      const n = /^in(\d+)/.exec(want)?.[1];
      if (!n) return PHRASES.filter((p) => p.startsWith("in ")).map((p) => ({ p, hint: hintOf(normWhen(p)) })).slice(0, 7).map(({ p, hint }) => ({ insert: `@${p}`, label: p, hint }));
      return offer(["m", "h", "d", "w", "mo"].map((u) => `in${n}${u}`));
    }
    // A month and day: "nov", "nov1…".
    const md = /^([a-z]{3,})(\d{0,2})$/.exec(want);
    if (md && monthOf(md[1]) >= 0 && !(dayOf(md[1]) >= 0) && (md[2] || md[1].length >= 3)) {
      const mon = MONTHS[monthOf(md[1])], days = [];
      for (let k = 1; k <= 31; k++) if (String(k).startsWith(md[2])) days.push(`${mon}${k}`);
      const got = offer(days.filter((x) => x.startsWith(want) || md[2] === ""));
      if (got.length) return got;
    }
    const coming = []; for (let k = 2; k < 8; k++) coming.push(DAYS[plusDays(now, k).getDay()]);
    const list = [...PHRASES.slice(0, 3), ...coming, ...PHRASES.slice(3)];
    return list.filter((w) => w.startsWith(want)).map((w) => ({ w, hint: hintOf(normWhen(w)) })).filter((x) => x.hint).slice(0, 7)
      .map(({ w, hint }) => ({ insert: `@${w}`, label: w, hint }));
  }
  // A time after a day: "@fri 9…".
  if (/(?:^|\s)@\S+\s+\S*$/.test(value) && /^\d/.test(lower) && !/(?:^|\s)@\d/.test(value.slice(0, value.length - last.length).trim().split(/\s+/).slice(-1)[0] ?? "")) {
    return timeList(lower).slice(0, 7).map((x) => ({ insert: x, label: x, hint: "" }));
  }
  return [];
}

export default class Todos extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => { await loadFormat(); cx.notify(); });
    this.lists = {}; // slug -> { folder, items, raw }
    this.here = null;
    this.hereFrom = null;
    // The tabs: "all" (your pinned projects, and the one you're in) or "here"
    // (only the project you're in, following you). this.filter is worked out
    // from it on each render: here's slug, or null for All.
    try { this.mode = localStorage.getItem("todos.mode") === "all" ? "all" : "here"; } catch { this.mode = "here"; }
    this.filter = null;
    this.editing = null; // { slug, i }
    this.hover = null;
    this.input = InputState.new({ placeholder: "Add a to-do (#project @when)" });
    this.typed = "";
    this.sugAt = 0;
    this.sugOff = null; // the text Esc hid suggestions for
    this.input.on("change", (_e, cx) => { this.typed = this.input.value(); this.sugAt = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => { if (this.sugs?.length) this.accept(cx); else this.add(this.input.value(), cx); });
    this.editInput = InputState.new({});
    this.editInput.on("submit", (_e, cx) => this.saveEdit(cx));
    this.editInput.on("blur", (_e, cx) => this.saveEdit(cx));
    cx.spawn(async (cx) => {
      dataDir = (await exec("sh", ["-c", XDG_DIR]).catch(() => null))?.stdout.trim() || null;
      await exec("mkdir", ["-p", DIR()]).catch(() => null);
      await this.load(cx);
      for (;;) {
        await watchFolder(DIR()).catch(() => cx.sleep(5000));
        await this.load(cx);
      }
    });
    this.currentSpaceId = null;
    cx.timer.every(250, (cx) => this.findHere(cx));
    // A list on another computer can't be watched: read again every 5s.
    cx.timer.every(5000, (cx) => { if (HERE.machine) cx.spawn(async (cx) => this.loadThere(cx)); });
    cx.timer.every(15000, (cx) => { this.checkRule(cx); cx.notify(); }); // "today", overdue, TODO.md re-read, the rule
    this.ruleOk = true; // agents have the to-do rule (CLAUDE.md); off: a hint offers to set it up
    this.checkRule(cx);
    this.startFor = null; // the to-do whose agent choices show
    this.agentChoices = [];
    cx.spawn(async (cx) => { this.agentChoices = (await knownAgents().catch(() => [])).filter((a) => a.installed); cx.notify(); });
    this.sel = new Map(); // "slug:i" -> its text (a pick whose text moved is dropped)
    this.anchor = null; // the last one picked, for Shift
    this.fromFile = {}; // folder -> { file, items }
    this.fileAt = {}; // folder -> when it was last read (ms)
    this.fileStale = {}; // folder -> its list changed since TODO.md was read
    this.expanded = new Set();
    this.groupFilter = null;
    this.queueItems = [];
    cx.spawn(async (cx) => { await this.loadQueue(cx); });
    cx.timer.every(10000, (cx) => this.loadQueue(cx));
    cx.timer.every(20000, (cx) => this.runQueueCron(cx));
    this.subFor = null;
    this.subInput = InputState.new({ placeholder: "Add a subtask..." });
    this.subInput.on("submit", (_e, cx) => this.saveSub(cx));
    this.subInput.on("blur", (_e, cx) => { if (this.subFor) { const k = this.subFor; this.subFor = null; this.closeAction(k, cx); } });

    this.createPrio = null;
    this.createGroup = "";
    this.showDrawer = false;
    this.pendingUrls = [];
    this.pendingSubs = [];
    this.descInput = InputState.new({ placeholder: "Markdown description / specs..." });
    this.groupInput = InputState.new({ placeholder: "CARD-XXXX" });
    this.urlNameInput = InputState.new({ placeholder: "Label (MR, Card)" });
    this.urlLinkInput = InputState.new({ placeholder: "https://..." });
    this.subDraftInput = InputState.new({ placeholder: "Subtask title..." });
    this.linkFor = null;
    this.linkNameInput = InputState.new({ placeholder: "Label" });
    this.linkUrlInput = InputState.new({ placeholder: "https://..." });
    this.tagFor = null;
    this.tagInput = InputState.new({ placeholder: "tag..." });
    this.descFor = null;
    this.taskDescInput = InputState.new({ placeholder: "Description markdown..." });

    // Modal de Detalhes Completo
    this.detailTask = null; // { slug, i }
    this.modalTitleInput = InputState.new({ placeholder: "Task title..." });
    this.modalDescInput = InputState.new({ placeholder: "Markdown description / specs..." });
    this.modalEditingTitle = false;
    this.modalEditingDesc = false;
    this.modalDescTextarea = TextareaState.new({
      value: "",
      placeholder: "Add markdown description, specs, or acceptance criteria...",
      rows: 10
    });
    this.modalGroupInput = InputState.new({ placeholder: "CARD-XXXX..." });
    this.modalRepoInput = InputState.new({ placeholder: "Nome do repositório ou caminho..." });
    this.modalSubInput = InputState.new({ placeholder: "Adicionar subtarefa..." });
    this.modalTagInput = InputState.new({ placeholder: "Adicionar tag..." });
    this.modalLinkNameInput = InputState.new({ placeholder: "Rótulo (MR, PRD...)" });
    this.modalLinkUrlInput = InputState.new({ placeholder: "https://..." });
    this.modalDeleteArmed = false;

    this.modalTitleInput.on("submit", (_e, cx) => this.saveModalTitle(cx));
    this.modalDescInput.on("submit", (_e, cx) => this.saveModalDesc(cx));
    this.modalGroupInput.on("submit", (_e, cx) => this.saveModalGroup(cx));
    this.modalRepoInput.on("submit", (_e, cx) => this.saveModalRepo(cx));
    this.modalSubInput.on("submit", (_e, cx) => this.saveModalSub(cx));
    this.modalTagInput.on("submit", (_e, cx) => this.saveModalTag(cx));

    // Modal de Criar Tarefa Completo
    this.showCreateModal = false;
    this.createTitleInput = InputState.new({ placeholder: "O que precisa ser feito?" });
    this.createProjectInput = InputState.new({ placeholder: "Nome do projeto..." });
    this.createGroupInput = InputState.new({ placeholder: "CARD-XXXX (opcional)" });
    this.createGroupDropdownOpen = false;
    this.createDescTextarea = TextareaState.new({
      value: "",
      placeholder: "Escreva especificações, detalhes, logs ou notas em Markdown...",
      rows: 8
    });
    this.createPrioSelected = null;
    this.createInitialSubs = [];
    this.createSubInput = InputState.new({ placeholder: "Adicionar subtarefa inicial..." });

    this.createTitleInput.on("submit", (_e, cx) => this.submitCreateModal(cx));
    this.createGroupInput.on("change", (_e, cx) => {
      this.createGroupDropdownOpen = true;
      cx.notify();
    });
    this.createGroupInput.on("focus", (_e, cx) => {
      this.createGroupDropdownOpen = true;
      cx.notify();
    });
    this.createGroupInput.on("submit", (_e, cx) => {
      this.createGroupDropdownOpen = false;
      this.submitCreateModal(cx);
    });
    this.createSubInput.on("submit", (_e, cx) => {
      const val = this.createSubInput.value().trim();
      if (val) {
        this.createInitialSubs.push(val);
        this.createSubInput.set_value("");
        cx.notify();
      }
    });
    this.modalLinkUrlInput.on("submit", (_e, cx) => this.saveModalLink(cx));

    // Filtro e Visualização Customizada de Cards
    this.customCardFilter = null; // null = segue os cards do Space ativo; Array de cards = filtro customizado
    this.cardDropdownOpen = false;
    this.cardSearchInput = InputState.new({ placeholder: "Filtrar cards..." });
    this.cardSearchInput.on("change", (_e, cx) => cx.notify());

    this.showCardFilterModal = false;
    this.modalCardSearchInput = InputState.new({ placeholder: "Buscar por nome do card, projeto ou space..." });
    this.modalCardSearchInput.on("change", (_e, cx) => cx.notify());
    this.modalSelectedCards = new Set();
  }

  getAllProjectCards() {
    const sc = shared("spaces.cards") ?? {};
    const spList = spaces() ?? [];
    const activeSpace = spList.find((s) => s.active);

    // Mapeamento de Card -> Space
    const cardToSpace = new Map();
    if (sc.spaces) {
      for (const [sId, cardVal] of Object.entries(sc.spaces)) {
        if (!cardVal || cardVal === "none") continue;
        const sObj = spList.find((s) => s.id === sId);
        const sName = sObj?.name || sId;
        const isCurrent = activeSpace?.id === sId;
        const cList = parseCards(cardVal);
        for (const c of cList) {
          cardToSpace.set(c, { id: sId, name: sName, isCurrent });
        }
      }
    }

    // Coleta todas as tarefas de todas as listas
    const allItems = Object.values(this.lists).flatMap((l) => l.items ?? []);
    const cardStats = new Map();

    const registerCard = (c, isDone) => {
      const norm = normalizeCard(c);
      if (!norm) return;
      let stat = cardStats.get(norm);
      if (!stat) {
        stat = { name: norm, open: 0, done: 0, space: cardToSpace.get(norm) || null };
        cardStats.set(norm, stat);
      }
      if (isDone) stat.done += 1;
      else stat.open += 1;
    };

    for (const item of allItems) {
      if (item.group) registerCard(item.group, item.done);
      const inText = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(item.text);
      if (inText) registerCard(`${inText[1]}-${inText[2]}`, item.done);
    }

    // Também garante que os cards explicitamente cadastrados no spaces.cards apareçam
    for (const [c, sInfo] of cardToSpace.entries()) {
      if (!cardStats.has(c)) {
        cardStats.set(c, { name: c, open: 0, done: 0, space: sInfo });
      } else {
        cardStats.get(c).space = sInfo;
      }
    }

    return [...cardStats.values()].sort((a, b) => {
      const aCur = a.space?.isCurrent ? 1 : 0;
      const bCur = b.space?.isCurrent ? 1 : 0;
      if (aCur !== bCur) return bCur - aCur;

      const aHasSp = a.space ? 1 : 0;
      const bHasSp = b.space ? 1 : 0;
      if (aHasSp !== bHasSp) return bHasSp - aHasSp;

      if (b.open !== a.open) return b.open - a.open;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }

  openCardFilterModal(cx) {
    this.showCardFilterModal = true;
    this.cardDropdownOpen = false;
    this.modalCardSearchInput.set_value("");

    const activeSpace = spaces().find((s) => s.active);
    const sc = shared("spaces.cards") ?? {};
    const detectCard = (name) => {
      if (!name) return "";
      const m = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(name);
      return m ? `${m[1].toUpperCase()}-${m[2]}` : "";
    };
    const explicit = sc.spaces?.[activeSpace?.id];
    const spaceLinkedCards = parseCards(explicit && explicit !== "none" ? explicit : (detectCard(activeSpace?.name) || ""));

    const initial = this.customCardFilter !== null ? this.customCardFilter : spaceLinkedCards;
    this.modalSelectedCards = new Set(initial);
    cx.notify();
  }

  closeCardFilterModal(cx) {
    this.showCardFilterModal = false;
    cx.notify();
  }

  applyCardFilterModal(cx) {
    const selected = [...this.modalSelectedCards];
    if (selected.length === 0) {
      this.customCardFilter = null;
    } else {
      this.customCardFilter = selected;
    }
    this.showCardFilterModal = false;
    cx.notify();
  }

  resetCardFilterToSpace(cx) {
    this.customCardFilter = null;
    this.cardDropdownOpen = false;
    this.showCardFilterModal = false;
    cx.notify();
  }

  cyclePrio(cx) {
    const seq = [null, "Critical", "High", "Medium", "Low"];
    const idx = seq.indexOf(this.createPrio);
    this.createPrio = seq[(idx + 1) % seq.length];
    cx.notify();
  }

  addPendingUrl(cx) {
    const url = this.urlLinkInput.value().trim();
    if (!url) return;
    const name = this.urlNameInput.value().trim() || "link";
    this.pendingUrls.push({ name, url });
    this.urlLinkInput.set_value("");
    this.urlNameInput.set_value("");
    cx.notify();
  }

  removePendingUrl(idx, cx) {
    this.pendingUrls = this.pendingUrls.filter((_, i) => i !== idx);
    cx.notify();
  }

  addPendingSub(cx) {
    const text = this.subDraftInput.value().trim();
    if (!text) return;
    this.pendingSubs.push(text);
    this.subDraftInput.set_value("");
    cx.notify();
  }

  removePendingSub(idx, cx) {
    this.pendingSubs = this.pendingSubs.filter((_, i) => i !== idx);
    cx.notify();
  }

  closeAction(key, cx) {
    if (key) {
      const [slug, iStr] = key.split(":");
      const idx = Number(iStr);
      const it = this.lists[slug]?.items?.[idx];
      const hasDetails = Boolean(it?.subtasks?.length || it?.description || it?.urls?.length || it?.tags?.length);
      if (!hasDetails) {
        this.expanded.delete(key);
      }
    }
    cx.notify();
  }

  saveTaskLink(cx) {
    const k = this.linkFor;
    const url = this.linkUrlInput.value().trim();
    if (!k || !url) { this.linkFor = null; return this.closeAction(k, cx); }
    const name = this.linkNameInput.value().trim() || "link";
    const [slug, iStr] = k.split(":");
    const idx = Number(iStr);
    this.linkUrlInput.set_value("");
    this.linkNameInput.set_value("");
    this.linkFor = null;
    this.change(slug, (items) => items.map((it, j) => {
      if (j === idx) {
        const urls = [...(it.urls ?? []), { name, url }];
        const meta = { ...(it.meta ?? {}), urls };
        return { ...it, urls, meta };
      }
      return it;
    }), cx);
  }

  cycleTaskPrio(key, cx) {
    const [slug, iStr] = key.split(":");
    const idx = Number(iStr);
    const seq = [null, "Critical", "High", "Medium", "Low"];
    this.change(slug, (items) => items.map((it, j) => {
      if (j === idx) {
        let cur = it.priority ?? null;
        if (cur === "P0") cur = "Critical";
        else if (cur === "P1") cur = "High";
        else if (cur === "P2") cur = "Medium";
        else if (cur === "P3") cur = "Low";
        const curIdx = seq.indexOf(cur);
        const next = seq[(curIdx + 1) % seq.length];
        const meta = { ...(it.meta ?? {}), priority: next };
        return { ...it, priority: next, meta };
      }
      return it;
    }), cx);
  }

  saveTaskTag(cx) {
    const k = this.tagFor;
    const tag = this.tagInput.value().trim().replace(/^#/, "");
    if (!k || !tag) { this.tagFor = null; return this.closeAction(k, cx); }
    const [slug, iStr] = k.split(":");
    const idx = Number(iStr);
    this.tagInput.set_value("");
    this.tagFor = null;
    this.change(slug, (items) => items.map((it, j) => {
      if (j === idx) {
        const tags = [...(it.tags ?? []).filter((t) => t !== tag), tag];
        const meta = { ...(it.meta ?? {}), tags };
        return { ...it, tags, meta };
      }
      return it;
    }), cx);
  }

  removeTaskTag(key, tag, cx) {
    const [slug, iStr] = key.split(":");
    const idx = Number(iStr);
    this.change(slug, (items) => items.map((it, j) => {
      if (j === idx) {
        const tags = (it.tags ?? []).filter((t) => t !== tag);
        const meta = { ...(it.meta ?? {}), tags };
        if (!tags.length && !it.description && !it.urls?.length && !it.subtasks?.length) {
          this.expanded.delete(key);
        }
        return { ...it, tags, meta };
      }
      return it;
    }), cx);
  }

  saveTaskDesc(cx) {
    const k = this.descFor;
    if (!k) return;
    const desc = this.taskDescInput.value().trim();
    const [slug, iStr] = k.split(":");
    const idx = Number(iStr);
    this.descFor = null;
    this.change(slug, (items) => items.map((it, j) => (j === idx ? { ...it, description: desc } : it)), cx);
  }

  toggleExpand(key, cx) {
    if (this.expanded.has(key)) this.expanded.delete(key);
    else this.expanded.add(key);
    cx.notify();
  }

  saveSub(cx) {
    const k = this.subFor;
    const text = this.subInput.value().trim();
    if (!k || !text) { this.subFor = null; return this.closeAction(k, cx); }
    const [slug, iStr] = k.split(":");
    const idx = Number(iStr);
    this.subInput.set_value("");
    this.subFor = null;
    this.change(slug, (items) => items.map((it, j) => {
      if (j === idx) {
        const subtasks = [...(it.subtasks ?? []), { done: false, text, doneOn: null }];
        return { ...it, subtasks };
      }
      return it;
    }), cx);
  }

  async load(cx) {
    const r = await exec("ls", ["-1", DIR()]).catch(() => null);
    const lists = {};
    for (const f of (r?.stdout ?? "").split("\n").filter((x) => x.endsWith(".md"))) {
      const raw = await readTextFile(`${DIR()}/${f}`).catch(() => null);
      if (raw == null) continue;
      const { folder, items, skipped, opts } = parse(raw);
      if (folder) lists[f.slice(0, -3)] = { folder, items, skipped, opts, raw };
    }
    // A list that changed: its TODO.md is read again before suggesting from it
    // (an agent's edit reaches TODO.md a moment after the list).
    for (const [slug, l] of Object.entries(lists)) if (this.lists?.[slug]?.raw !== l.raw) { this.fileAt[l.folder] = 0; this.fileStale[l.folder] = true; }
    for (const [k, l] of Object.entries(this.lists ?? {})) if (l.machine) lists[k] = l;
    this.lists = lists;
    SYNCED.clear();
    for (const l of Object.values(lists)) if (l.opts.sync) SYNCED.add(l.folder);
    cx.notify();
  }

  // The list of the project you're in, when that's on another computer (the
  // only one read from there); any other computer's is dropped.
  async loadThere(cx) {
    const m = HERE.machine, folder = HERE.folder, key = m && keyOf(folder);
    const raw = m ? (await exec("sh", ["-c", THERE_READ, "sh", slugOf(folder)], onM(m)).catch(() => null))?.stdout || null : null;
    if (m !== HERE.machine || folder !== HERE.folder) return; // moved on meanwhile
    for (const k of Object.keys(this.lists)) if (this.lists[k].machine && k !== key) delete this.lists[k];
    const was = key && this.lists[key];
    if (!key || raw === (was?.raw ?? null)) return cx.notify();
    const p = raw && parse(raw);
    if (p?.folder) {
      this.lists[key] = { ...p, raw, machine: m };
      this.fileAt[p.folder] = 0; this.fileStale[p.folder] = true;
      if (p.opts.sync) SYNCED.add(p.folder); else SYNCED.delete(p.folder);
    } else delete this.lists[key];
    cx.notify();
  }

  // The project you're in: the focused terminal's folder (else the shown
  // space's), as a repo's main checkout (worktrees share it), as `todo` decides.
  // A project's Log or Sync switch (its list file is made if there's none).
  setOpt(folder, key, on, cx) {
    const slug = keyOf(folder), l = this.lists[slug];
    cx.spawn(async (cx) => this.write(slug, folder, l?.items ?? [], cx, l?.skipped ?? [], { ...(l?.opts ?? defOpts()), [key]: on, set: { ...(l?.opts?.set ?? {}), [key]: true } }));
  }

  // Whether agents know about the lists: the rule in Claude Code's CLAUDE.md.
  checkRule(cx) {
    readTextFile(`${home()}/.claude/CLAUDE.md`).then((text) => {
      const ok = (text ?? "").includes("<!-- herdr:todo -->") || (text ?? "").includes("<!-- over9k:todo -->");
      if (ok !== this.ruleOk) { this.ruleOk = ok; cx.notify(); }
    }).catch(() => { if (this.ruleOk) { this.ruleOk = false; cx.notify(); } });
  }

  // Sets agents up: the rule, the `todo` command and Claude Code's hook
  // (setup.sh: this mod's own copy, else Over9k Options').
  setUpAgents(cx) {
    const mods = `${appHome().replace(/\\/g, "/")}/mods`;
    cx.spawn(async (cx) => {
      let r = await exec("sh", [`${mods}/todos/setup.sh`, "todo", "on", mods]).catch(() => null);
      if (r?.code === 127 || r == null || /No such file|can't open/i.test(r?.stderr ?? "")) r = await exec("sh", [`${mods}/over9k-options/setup.sh`, "todo", "on", mods]).catch(() => null);
      notify(r?.code === 0
        ? { title: "Agents can use the to-do lists", body: "New agents get the rule and the todo command (~/.local/bin).", level: "info" }
        : { title: "Couldn't set up agents", body: (r?.stderr ?? "").trim() || "Needs sh (Git Bash on Windows).", level: "warning" });
      this.checkRule(cx);
    });
  }

  findHere(cx) {
    const f = focused(), s = spaces().find((x) => x.active);
    if (f?.agent || (f?.terminal && agents().some((a) => a.address === f.terminal))) this.lastAgent = f.agent ?? f.terminal;

    // Detect space switch: automatically select linked card (starred group)
    const spaceId = s?.id ?? null;
    if (spaceId !== this.currentSpaceId) {
      this.currentSpaceId = spaceId;
      const sc = shared("spaces.cards") ?? {};
      const detectCard = (name) => {
        if (!name) return null;
        const m = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(name);
        return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
      };
      const explicit = sc.spaces?.[spaceId];
      const linked = (explicit && explicit !== "none" ? explicit : null) || detectCard(s?.name) || null;
      this.groupFilter = linked || null;
      cx.notify();
    }

    // A space on another computer: the project is worked out there, and its home
    // (printed second) counts as no project, as home does here.
    const m = s?.machine ?? null;
    const from = (f?.cwd || s?.folder || (m ? "" : home())).replace(/\/+$/, "");
    if (`${m}|${from}` === this.hereFrom) return;
    this.hereFrom = `${m}|${from}`;
    cx.spawn(async (cx) => {
      const r = from ? await exec("sh", ["-c", 'c=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); case "$c" in */.git) echo "${c%/.git}" ;; *) git -C "$1" rev-parse --show-toplevel 2>/dev/null || echo "$1" ;; esac; printf "%s\\n" "$HOME"', "sh", from], onM(m)).catch(() => null) : null;
      if (this.hereFrom !== `${m}|${from}`) return; // moved on meanwhile
      const [top, theirHome] = (r?.stdout ?? "").split("\n");
      let here = (top?.trim() || from).replace(/\/+$/, "") || null;
      if (m && (!here || here === (theirHome ?? "").trim().replace(/\/+$/, ""))) here = null;
      if (here === this.here && m === HERE.machine) return;
      this.here = here;
      HERE.folder = m ? here : null;
      HERE.machine = m && here ? m : null;
      await this.loadThere(cx);
      cx.notify();
    });
  }

  name(folder) {
    if (folder === home()) return "~";
    return (shared("projects.names") ?? {})[folder] || folder.split("/").pop();
  }
  color(folder, t) {
    return folder === home() ? t.muted : hue(folder.split("/").pop());
  }

  async write(slug, folder, items, cx, skipped = this.lists[slug]?.skipped ?? [], opts = this.lists[slug]?.opts ?? defOpts()) {
    const path = `${DIR()}/${slug}.md`, old = this.lists[slug]?.raw ?? null;
    const text = serialize(folder, items, skipped, opts);
    const m = machineOf(slug);
    if (m) {
      const r = await exec("sh", ["-c", THERE_WRITE, "sh", slugOf(folder), text, old ?? "", old != null ? "1" : ""], onM(m)).catch(() => null);
      if (r?.code !== 0) return this.loadThere(cx); // changed there meanwhile: show theirs
      this.lists[slug] = { folder, items, skipped, opts, raw: text, machine: m };
      if (opts.sync) SYNCED.add(folder); else SYNCED.delete(folder);
      return cx.notify();
    }
    try {
      await writeTextFile(path, text, old);
      this.lists[slug] = { folder, items, skipped, opts, raw: text };
      if (opts.sync) SYNCED.add(folder); else SYNCED.delete(folder);
    } catch {
      await this.load(cx); // an agent changed it meanwhile: show theirs
    }
    cx.notify();
  }

  // "#name" picks the project (a listed one with to-dos, a space's, or a
  // known project's name), else the one you're in.
  projectFor(tag) {
    const want = tag.toLowerCase();
    const known = [...Object.values(this.lists).map((l) => l.folder), ...spaces().filter((s) => !s.machine).map((s) => (s.folder ?? "").replace(/\/+$/, "")),
      ...Object.keys(shared("projects.names") ?? {}), ...(shared("projects.pinned") ?? []), ...(shared("projects.auto") ?? [])].filter(Boolean);
    const match = (f) => [this.name(f), f.split("/").pop()].map((x) => x.toLowerCase());
    return known.find((f) => match(f).includes(want)) ?? known.find((f) => match(f).some((x) => x.startsWith(want))) ?? null;
  }

  // The project's TODO.md items (read once per folder, again every 15s).
  readFile(folder, cx) {
    if (!folder || Date.now() - (this.fileAt[folder] ?? 0) < 15000) return;
    this.fileAt[folder] = Date.now();
    this.fromFile[folder] ??= { file: null, items: [] };
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", TODO_FILE, "sh", folder], onM(mOf(folder))).catch(() => null);
      const out = r?.stdout ?? "", nl = out.indexOf("\n");
      const next = nl > 0 ? { file: out.slice(0, nl), items: fileItems(out.slice(nl + 1)) } : { file: null, items: [] };
      const was = this.fileStale[folder];
      this.fileStale[folder] = false;
      if (was || JSON.stringify(next) !== JSON.stringify(this.fromFile[folder])) { this.fromFile[folder] = next; cx.notify(); }
    });
  }

  // TODO.md items not on the list (open, done or hidden): the suggestions.
  suggested(folder) {
    const f = this.fromFile[folder];
    if (!f?.items.length || this.fileStale[folder]) return { file: f?.file, items: [] };
    const l = this.lists[keyOf(folder)];
    const have = new Set([...(l?.items ?? []).map((x) => x.text.toLowerCase()), ...(l?.skipped ?? []).map((x) => x.toLowerCase())]);
    return { file: f.file, items: f.items.filter((x) => !have.has(x.toLowerCase())) };
  }

  take(folder, texts, cx) {
    const slug = keyOf(folder), l = this.lists[slug];
    cx.spawn(async (cx) => this.write(slug, folder, [...(l?.items ?? []), ...texts.map((text) => ({ done: false, text, due: null, doneOn: null }))], cx));
  }

  // All, or only the project you're in (kept for next time); picks are dropped.
  setMode(mode) {
    this.mode = mode;
    try { localStorage.setItem("todos.mode", mode); } catch {}
    this.unpick();
  }

  // A TODO.md suggestion's ×: the line goes from TODO.md itself (gone from here at once).
  dropFromFile(folder, text, cx) {
    const f = this.fromFile[folder];
    if (f) this.fromFile[folder] = { ...f, items: f.items.filter((x) => x !== text) };
    cross(folder, "rm", text);
    this.fileAt[folder] = 0;
    cx.notify();
  }

  skip(folder, text, cx) {
    const slug = keyOf(folder), l = this.lists[slug];
    cx.spawn(async (cx) => this.write(slug, folder, l?.items ?? [], cx, [...(l?.skipped ?? []), text]));
  }

  // A TODO.md suggestion straight to an agent: on the list first, then started.
  startFromFile(a, folder, text, cx, running = null) {
    this.take(folder, [text], cx);
    if (running) this.sendTo(running, { text, folder, due: null });
    else this.startAgent(a, { text, folder, due: null });
  }

  // What an agent is told for to-do `x` (or several).
  taskFor(x) {
    const xs = [x].flat(), when = (y) => (y.due ? ` (due ${dueWords(y.due)})` : "");
    const tick = (y) => `\`todo done "${y.text.replace(/"/g, '\\"')}"\``;
    if (xs.length === 1) return `Work on this one to-do from the project's list, and only this one: ${xs[0].text}${when(xs[0])}\n\nWhen it's finished, tick it: ${tick(xs[0])}.`;
    return `Work on these to-dos from the project's list, and only these:\n\n${xs.map((y, i) => `${i + 1}. ${y.text}${when(y)}`).join("\n")}\n\nTick each one once it's finished: ${xs.map(tick).join(", ")}.`;
  }

  // The picked to-dos as they are now (by their text: an agent may have moved them).
  picked() {
    return [...this.sel].map(([key, text]) => {
      const [slug, i] = [key.slice(0, key.lastIndexOf(":")), +key.slice(key.lastIndexOf(":") + 1)], l = this.lists[slug];
      const x = l?.items[i];
      return x && x.text === text ? { ...x, slug, i, folder: l.folder } : null;
    }).filter(Boolean);
  }

  // Shift+click picks every to-do from the last picked one to this one (as
  // shown); Cmd/Meta or Ctrl+click adds or drops one.
  pick(x, e, cx) {
    const key = `${x.slug}:${x.i}`, order = this.visible ?? [];
    const from = order.findIndex((y) => `${y.slug}:${y.i}` === this.anchor), to = order.findIndex((y) => `${y.slug}:${y.i}` === key);
    if (e?.modifiers?.shift && from >= 0 && to >= 0) {
      if (!(e.modifiers.platform || e.modifiers.control)) this.sel.clear();
      order.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((y) => this.sel.set(`${y.slug}:${y.i}`, y.text));
    } else {
      this.sel.has(key) ? this.sel.delete(key) : this.sel.set(key, x.text);
      this.anchor = key;
    }
    if (!this.sel.size && this.startFor === "sel") this.startFor = null;
    cx.notify();
  }
  unpick() { this.sel.clear(); this.anchor = null; if (this.startFor === "sel") this.startFor = null; this.pickOpen = false; }

  // Ticks the picked ones (or unticks them, when they're all ticked already).
  tickPicked(cx) {
    const xs = this.picked(), on = xs.some((x) => !x.done);
    for (const slug of new Set(xs.map((x) => x.slug))) {
      const at = new Set(xs.filter((x) => x.slug === slug).map((x) => x.i));
      this.change(slug, (items) => items.map((y, j) => (at.has(j) && y.done !== on ? { ...y, done: on, doneOn: on ? stamp() : null } : y)), cx);
    }
    for (const x of xs) if (x.done !== on) { cross(x.folder, on ? "done" : "undo", x.text); this.fileAt[x.folder] = 0; }
    this.unpick();
  }

  deletePicked(cx) {
    const xs = this.picked();
    for (const slug of new Set(xs.map((x) => x.slug))) {
      const at = new Set(xs.filter((x) => x.slug === slug).map((x) => x.i));
      this.change(slug, (items) => items.filter((_, j) => !at.has(j)), cx);
    }
    for (const x of xs) toFile(x.folder, "rm", x.text);
    this.unpick();
  }

  // Agents already running in a project (their pane's folder in it), the one
  // you were last in first.
  runningIn(folder) {
    if (!folder) return [];
    const ps = panes();
    return agents().filter((a) => {
      const c = (ps.find((p) => p.terminal === a.address)?.cwd ?? "").replace(/\/+$/, "");
      return c === folder || c.startsWith(folder + "/");
    }).sort((a, b) => (b.address === this.lastAgent) - (a.address === this.lastAgent));
  }

  // What the sidebar calls an agent: a name given to its tab, else its
  // conversation's (agent-name.js, as over9k), else the program.
  agentName(a) {
    const p = panes().find((x) => x.terminal === a.address);
    const tab = spaces().flatMap((s) => s.tabs ?? []).find((t) => t.id === p?.tab);
    const named = tab && !/^(\d+|tb?[0-9a-z]+)$/.test(tab.name) && tab.name !== a.program?.name ? tab.name : "";
    return named || agentTask(a, p?.cwd) || a.tab_name || a.program?.name || "Agent";
  }

  // To-do `x` to agent `a` that's already running: into its conversation, shown.
  sendTo(a, x) {
    this.startFor = null;
    const xs = [x].flat();
    hc(["send", a.address, this.taskFor(xs)]).catch(() => null);
    run("pane.focus", { terminal: a.address });
    notify({ title: `Sent to ${a.tab_name || a.program?.name || "the agent"}`, body: xs.map((y) => y.text).join("\n"), level: "info" });
  }

  // Starts agent `a` on to-do `x` in its project's space (made if needed).
  // Several to-dos (all of one project): one agent on them all.
  startAgent(a, x) {
    this.startFor = null;
    const xs = [x].flat(), folder = xs[0].folder, task = this.taskFor(xs);
    const first = xs.length > 1 ? `${xs.length} to-dos` : xs[0].text;
    const name = first.length > 28 ? `${first.slice(0, 27)}\u2026` : first;
    const m = mOf(folder);
    const there = spaces().find((s) => (s.machine ?? null) === m && (s.folder ?? "").replace(/\/+$/, "") === folder);
    if (there) run("tab.new", { space: there.id, name, folder, argv: a.run, task });
    else run("space.new", { name: this.name(folder), folder, tab: name, argv: a.run, task, machine: m ?? "" });
    if (there && !there.active) run("space.select", { id: there.id });
    notify({ title: `${a.name} is on it`, body: xs.map((y) => y.text).join("\n"), level: "info" });
  }

  // The picked open to-dos to agents: one already running (when they're all
  // one project's), or a new one per project.
  sendPicked(a, target) {
    const xs = this.picked().filter((x) => !x.done);
    if (!xs.length) return;
    if (target) this.sendTo(target, xs);
    else for (const f of new Set(xs.map((x) => x.folder))) this.startAgent(a, xs.filter((x) => x.folder === f));
    this.unpick();
  }

  // Projects to offer after "#": ones with to-dos, open spaces, listed projects.
  projectChoices(t) {
    const folders = [...new Set([...Object.values(this.lists).map((l) => l.folder), ...spaces().filter((s) => !s.machine).map((s) => (s.folder ?? "").replace(/\/+$/, "")),
      ...(shared("projects.pinned") ?? []), ...(shared("projects.auto") ?? [])].filter((f) => f && f !== home()))];
    const hereFirst = (f) => (f === this.here ? 0 : this.lists[keyOf(f)]?.items.some((x) => !x.done) ? 1 : 2);
    return folders.sort((a, b) => hereFirst(a) - hereFirst(b) || this.name(a).localeCompare(this.name(b)))
      .map((f) => ({ key: f.split("/").pop(), name: this.name(f), color: this.color(f, t) }));
  }

  accept(cx) {
    const s = this.sugs?.[this.sugAt];
    if (!s) return;
    const value = this.input.value().replace(/\S*$/, "") + s.insert + " ";
    this.input.set_value(value);
    this.input.set_selected_range?.({ start: value.length, end: value.length });
    this.typed = value;
    this.sugAt = 0;
    cx.notify();
  }

  add(typed, cx) {
    let text = typed.trim();
    if (!text) return;
    let folder = this.filter ? this.lists[this.filter]?.folder ?? this.here : this.here;
    const tag = /(?:^|\s)#([\w.-]+)/.exec(text);
    if (tag) { const f = this.projectFor(tag[1]); if (f) { folder = f; text = (text.slice(0, tag.index) + text.slice(tag.index + tag[0].length)).replace(/\s+/g, " ").trim(); } }
    if (!folder) return;

    let priority = this.createPrio;
    const prioM = /(?:^|\s)!(critical|high|medium|med|low|urgent|crit|p0|p1|p2|p3)\b/i.exec(text);
    if (prioM) {
      const p = prioM[1].toLowerCase();
      priority = (p === "p0" || p === "urgent" || p === "critical" || p === "crit") ? "Critical"
               : (p === "p1" || p === "high") ? "High"
               : (p === "p2" || p === "med" || p === "medium") ? "Medium"
               : "Low";
      text = (text.slice(0, prioM.index) + text.slice(prioM.index + prioM[0].length)).replace(/\s+/g, " ").trim();
    }

    let group = (this.groupInput.value().trim() || this.createGroup?.trim() || null);
    if (!group) {
      const activeSpace = spaces().find((s) => s.active);
      const sc = shared("spaces.cards") ?? {};
      const detectCard = (name) => {
        if (!name) return null;
        const m = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(name);
        return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
      };
      const explicit = sc.spaces?.[activeSpace?.id];
      const linkedCard = (explicit && explicit !== "none" ? explicit : null) || detectCard(activeSpace?.name) || null;
      if (linkedCard) group = linkedCard;
    }
    const cardM = /(?:^|\s)(?:#|\[)?(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)(?:\])?/i.exec(text);
    if (cardM) {
      group = `${cardM[1].toUpperCase()}-${cardM[2]}`;
    }

    const { text: rest, due } = takeDue(text);
    if (!rest) return;
    const slug = keyOf(folder), l = this.lists[slug];
    this.input.set_value("");
    this.typed = "";

    const urls = [...(this.pendingUrls ?? [])];
    const subtasks = (this.pendingSubs ?? []).map((st) => ({ done: false, text: st, doneOn: null }));
    const description = this.descInput.value().trim();

    this.createPrio = null;
    this.createGroup = "";
    this.groupInput.set_value("");
    this.pendingUrls = [];
    this.pendingSubs = [];
    this.descInput.set_value("");
    this.showDrawer = false;

    const meta = (group || priority || urls.length) ? { group, priority, urls } : null;
    const newItem = {
      done: false,
      text: rest,
      due,
      doneOn: null,
      group,
      priority,
      meta,
      subtasks,
      urls,
      description
    };

    cx.spawn(async (cx) => this.write(slug, folder, [...(l?.items ?? []), newItem], cx));
    toFile(folder, "add", rest);
  }

  change(slug, fn, cx) {
    const l = this.lists[slug];
    if (!l) return;
    const items = fn(l.items.map((x) => ({ ...x })));
    l.items = items;
    cx.notify();
    cx.spawn(async (cx) => this.write(slug, l.folder, items, cx));
  }

  saveEdit(cx) {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const { text, due } = takeDue(this.editInput.value().trim());
    const was = this.lists[e.slug]?.items[e.i], folder = this.lists[e.slug]?.folder;
    if (was && folder && text !== was.text) toFile(folder, ...(text ? ["rename", was.text, text] : ["rm", was.text]));
    this.change(e.slug, (items) => (text ? items.map((x, i) => (i === e.i ? { ...x, text, due: due ?? x.due } : x)) : items.filter((_, i) => i !== e.i)), cx);
  }


  openDetailModal(x, cx) {
    this.detailTask = { slug: x.slug, i: x.i };
    this.modalTitleInput.set_value(x.text || "");
    this.modalDescInput.set_value(x.description || "");
    this.modalEditingTitle = false;
    this.modalEditingDesc = false;
    this.modalDescTextarea.set_value(x.description || "");
    this.modalGroupInput.set_value(x.group || "");
    const curFolder = this.lists[x.slug]?.folder || x.folder;
    const curRepo = x.meta?.repo || (curFolder ? this.name(curFolder) : "");
    this.modalRepoInput.set_value(curRepo);
    this.modalSubInput.set_value("");
    this.modalTagInput.set_value("");
    this.modalLinkNameInput.set_value("");
    this.modalLinkUrlInput.set_value("");
    this.modalDeleteArmed = false;
    cx.notify();
  }

  closeDetailModal(cx) {
    this.detailTask = null;
    this.modalEditingTitle = false;
    this.modalEditingDesc = false;
    this.modalDeleteArmed = false;
    cx.notify();
  }

  async loadQueue(cx) {
    try {
      const qPath = `${DIR()}/queue.json`;
      const raw = await readTextFile(qPath).catch(() => null);
      if (raw) {
        const data = JSON.parse(raw);
        this.queueItems = Array.isArray(data.items) ? data.items : [];
        if (cx) cx.notify();
      }
    } catch {}
  }

  async enqueueTask(task, cx) {
    if (!task) return;
    const activeSpace = spaces().find((s) => s.active);
    const spaceId = activeSpace?.id;
    const spaceName = activeSpace?.name;
    const folder = task.folder || this.lists[task.slug]?.folder || activeSpace?.folder || this.here;

    // Find agent/kiro terminal specifically in this active Space
    const allAgents = (typeof agents === "function" ? agents() : []) || [];
    const ps = (typeof panes === "function" ? panes() : []) || [];
    const spaceTabIds = new Set((activeSpace?.tabs ?? []).map((t) => t.id));

    const spaceAgents = allAgents.filter((a) => {
      const pane = ps.find((p) => p.terminal === a.address);
      if (pane && spaceTabIds.has(pane.tab)) return true;
      if (spaceId && (a.space === spaceId || a.space_id === spaceId)) return true;
      if (spaceName && a.space_name === spaceName) return true;
      return false;
    });

    const spaceTerminals = ps.filter((p) => spaceTabIds.has(p.tab) && p.terminal).map((p) => p.terminal);
    const targetAddr = spaceAgents[0]?.address || spaceTerminals[0] || null;

    const cmdArgs = ["-p", folder, "queue", "add", task.text];
    if (spaceId) cmdArgs.push("--space", spaceId);
    if (spaceName) cmdArgs.push("--space-name", spaceName);
    if (targetAddr) cmdArgs.push("--terminal", targetAddr);
    if (spaceAgents[0]?.program?.name) cmdArgs.push("--agent", spaceAgents[0].program.name);

    await exec("todo", cmdArgs).catch(async () => {
      await python([`${appHome()}/mods/todos/todo_engine.py`, ...cmdArgs]).catch(() => null);
    });
    await this.loadQueue(cx);
    if (cx) cx.notify();
  }

  async dequeueTask(task, cx) {
    if (!task) return;
    const idx = (this.queueItems || []).findIndex((it) => it.text === task.text && it.status === "queued");
    if (idx >= 0) {
      await exec("todo", ["queue", "rm", String(idx + 1)]).catch(async () => {
        await python([`${appHome()}/mods/todos/todo_engine.py`, "queue", "rm", String(idx + 1)]).catch(() => null);
      });
      await this.loadQueue(cx);
      if (cx) cx.notify();
    }
  }

  async runQueueCron(cx) {
    await exec("todo", ["queue", "cron"]).catch(async () => {
      await python([`${appHome()}/mods/todos/todo_engine.py`, "queue", "cron"]).catch(() => null);
    });
    await this.loadQueue(cx);
    if (cx) cx.notify();
  }

  navModalPrev(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const items = this.lists[slug]?.items ?? [];
    if (i > 0) {
      this.openDetailModal({ ...items[i - 1], slug, i: i - 1 }, cx);
    }
  }

  navModalNext(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const items = this.lists[slug]?.items ?? [];
    if (i < items.length - 1) {
      this.openDetailModal({ ...items[i + 1], slug, i: i + 1 }, cx);
    }
  }

  saveModalTitle(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const val = this.modalTitleInput.value().trim();
    if (!val) return;
    this.modalEditingTitle = false;
    const was = this.lists[slug]?.items[i], folder = this.lists[slug]?.folder;
    if (was && folder && val !== was.text) toFile(folder, "rename", was.text, val);
    this.change(slug, (items) => items.map((it, idx) => (idx === i ? { ...it, text: val } : it)), cx);
  }

  saveModalDesc(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const val = (this.modalDescTextarea ? this.modalDescTextarea.value() : this.modalDescInput.value()).trim();
    this.modalEditingDesc = false;
    this.change(slug, (items) => items.map((it, idx) => (idx === i ? { ...it, description: val } : it)), cx);
  }

  saveModalGroup(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const val = this.modalGroupInput.value().trim().toUpperCase().replace(/^#/, "");
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const meta = { ...(it.meta ?? {}), group: val || null };
        return { ...it, group: val || null, meta };
      }
      return it;
    }), cx);
  }

  resolveRepo(input, defaultFolder) {
    const raw = (input || "").trim();
    const def = defaultFolder || this.here || (this.filter ? this.lists[this.filter]?.folder : null) || home();
    if (!raw) {
      return { folder: def, slug: keyOf(def), name: this.name(def) };
    }

    // 1. Direct match on existing loaded lists by name, slug or folder basename
    for (const [s, l] of Object.entries(this.lists)) {
      const pName = this.name(l.folder);
      const base = l.folder.split("/").pop();
      if (pName.toLowerCase() === raw.toLowerCase() || base.toLowerCase() === raw.toLowerCase() || s.toLowerCase() === raw.toLowerCase()) {
        return { folder: l.folder, slug: s, name: pName };
      }
    }

    // 2. Direct match on known space folders or shared project names
    const knownFolders = [...new Set([
      ...Object.values(this.lists).map((l) => l.folder),
      ...spaces().map((s) => (s.folder ?? "").replace(/\/+$/, "")),
      ...Object.keys(shared("projects.names") ?? {}),
      ...(shared("projects.pinned") ?? []),
      ...(shared("projects.auto") ?? [])
    ])].filter((f) => Boolean(f) && f !== home());

    for (const f of knownFolders) {
      const pName = this.name(f);
      const base = f.split("/").pop();
      if (pName.toLowerCase() === raw.toLowerCase() || base.toLowerCase() === raw.toLowerCase() || f.toLowerCase() === raw.toLowerCase()) {
        return { folder: f, slug: keyOf(f), name: pName };
      }
    }

    // 3. Path input: expanded if starts with ~ or /
    let cleanPath = raw;
    if (cleanPath.startsWith("~/")) cleanPath = `${home()}/${cleanPath.slice(2)}`;
    else if (cleanPath === "~") cleanPath = home();

    if (cleanPath.startsWith("/")) {
      const cleanFolder = cleanPath.replace(/\/+$/, "");
      return { folder: cleanFolder, slug: keyOf(cleanFolder), name: this.name(cleanFolder) };
    }

    // 4. Check if any existing list folder ends with /raw
    for (const [s, l] of Object.entries(this.lists)) {
      if (l.folder.endsWith("/" + raw)) {
        return { folder: l.folder, slug: s, name: this.name(l.folder) };
      }
    }

    // Fallback: ~/Projects/<raw>
    const fallback = `${home()}/Projects/${raw}`;
    return { folder: fallback, slug: keyOf(fallback), name: raw };
  }

  setModalRepo(newRepoInput, cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const item = this.lists[slug]?.items?.[i];
    if (!item) return;

    const oldFolder = this.lists[slug]?.folder;
    const resolved = this.resolveRepo(newRepoInput, oldFolder);
    const targetSlug = resolved.slug;
    const targetFolder = resolved.folder;
    const targetName = resolved.name;

    const nextMeta = { ...(item.meta ?? {}), repo: targetName };
    const updatedItem = { ...item, meta: nextMeta };

    if (targetSlug === slug) {
      this.modalRepoInput.set_value(targetName);
      this.change(slug, (items) => items.map((it, idx) => (idx === i ? updatedItem : it)), cx);
      return;
    }

    // Move task to target list
    const oldItems = (this.lists[slug]?.items ?? []).filter((_, idx) => idx !== i);
    const targetList = this.lists[targetSlug] ?? { folder: targetFolder, items: [], skipped: [], opts: defOpts() };
    const targetItems = [...(targetList.items ?? []), updatedItem];

    if (this.lists[slug]) this.lists[slug].items = oldItems;
    targetList.items = targetItems;
    this.lists[targetSlug] = targetList;

    this.detailTask = { slug: targetSlug, i: targetItems.length - 1 };
    this.modalRepoInput.set_value(targetName);
    cx.notify();

    cx.spawn(async (cx) => {
      await this.write(slug, oldFolder, oldItems, cx);
      await this.write(targetSlug, targetFolder, targetItems, cx);
      if (oldFolder) toFile(oldFolder, "rm", item.text);
      if (targetFolder) toFile(targetFolder, "add", item.text);
    });
  }

  saveModalRepo(cx) {
    const val = this.modalRepoInput.value().trim();
    this.setModalRepo(val, cx);
  }

  setModalPrio(prio, cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const meta = { ...(it.meta ?? {}), priority: prio };
        return { ...it, priority: prio, meta };
      }
      return it;
    }), cx);
  }

  saveModalSub(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const text = this.modalSubInput.value().trim();
    if (!text) return;
    this.modalSubInput.set_value("");
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const subtasks = [...(it.subtasks ?? []), { done: false, text, doneOn: null }];
        return { ...it, subtasks };
      }
      return it;
    }), cx);
  }

  toggleModalSub(subIdx, cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const nextSubs = it.subtasks.map((sub, sj) => (sj === subIdx ? { ...sub, done: !sub.done, doneOn: sub.done ? null : stamp() } : sub));
        return { ...it, subtasks: nextSubs };
      }
      return it;
    }), cx);
  }

  deleteModalSub(subIdx, cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const nextSubs = it.subtasks.filter((_, sj) => sj !== subIdx);
        return { ...it, subtasks: nextSubs };
      }
      return it;
    }), cx);
  }

  saveModalLink(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const url = this.modalLinkUrlInput.value().trim();
    if (!url) return;
    const name = this.modalLinkNameInput.value().trim() || "link";
    this.modalLinkUrlInput.set_value("");
    this.modalLinkNameInput.set_value("");
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const urls = [...(it.urls ?? []), { name, url }];
        const meta = { ...(it.meta ?? {}), urls };
        return { ...it, urls, meta };
      }
      return it;
    }), cx);
  }

  deleteModalLink(linkIdx, cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const urls = (it.urls ?? []).filter((_, uj) => uj !== linkIdx);
        const meta = { ...(it.meta ?? {}), urls };
        return { ...it, urls, meta };
      }
      return it;
    }), cx);
  }

  saveModalTag(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const tag = this.modalTagInput.value().trim().replace(/^#/, "");
    if (!tag) return;
    this.modalTagInput.set_value("");
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const tags = [...(it.tags ?? []).filter((t) => t !== tag), tag];
        const meta = { ...(it.meta ?? {}), tags };
        return { ...it, tags, meta };
      }
      return it;
    }), cx);
  }

  deleteModalTag(tag, cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    this.change(slug, (items) => items.map((it, idx) => {
      if (idx === i) {
        const tags = (it.tags ?? []).filter((t) => t !== tag);
        const meta = { ...(it.meta ?? {}), tags };
        return { ...it, tags, meta };
      }
      return it;
    }), cx);
  }

  toggleModalTaskDone(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const item = this.lists[slug]?.items[i];
    const folder = this.lists[slug]?.folder;
    if (!item) return;
    this.change(slug, (items) => items.map((y, j) => (j === i ? { ...y, done: !y.done, doneOn: y.done ? null : stamp() } : y)), cx);
    if (folder) {
      cross(folder, item.done ? "undo" : "done", item.text);
      this.fileAt[folder] = 0;
    }
  }

  deleteModalTask(cx) {
    if (!this.detailTask) return;
    const { slug, i } = this.detailTask;
    const item = this.lists[slug]?.items[i];
    const folder = this.lists[slug]?.folder;
    this.closeDetailModal(cx);
    this.change(slug, (items) => items.filter((_, j) => j !== i), cx);
    if (folder && item) toFile(folder, "rm", item.text);
  }


  renderMarkdownBlock(markdownText, t, customColors) {
    if (!markdownText) return div();
    const lines = markdownText.split("\n");
    const colors = customColors ?? {
      text: t.foreground,
      accent: t.accent,
      muted: t.muted,
      codeBg: t.raised,
      codeBorder: t.border,
      codeText: t.accent,
    };

    const renderTextPieces = (str, isHeader = false) => {
      const tokens = str.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
      if (tokens.length === 1 && !tokens[0].startsWith("`") && !tokens[0].startsWith("**")) {
        return div().w_full().text_size(12).line_height("18px").text_color(isHeader ? colors.accent : colors.text)
          .whitespace_normal().child(str);
      }
      return h_flex().w_full().flex_wrap().gap_x(2).gap_y(1).items_baseline()
        .children(tokens.map((tok) => {
          if (tok.startsWith("`") && tok.endsWith("`") && tok.length >= 2) {
            return div().font_family("JetBrains Mono").text_size(11).px(4).py(0.5).rounded(4)
              .bg(colors.codeBg).border_1().border_color(colors.codeBorder).text_color(colors.codeText).whitespace_normal().child(tok.slice(1, -1));
          }
          if (tok.startsWith("**") && tok.endsWith("**") && tok.length >= 4) {
            return div().font_bold().text_size(12).text_color(colors.accent).whitespace_normal().child(tok.slice(2, -2));
          }
          return div().text_size(12).line_height("18px").text_color(isHeader ? colors.accent : colors.text).whitespace_normal().child(tok);
        }));
    };

    return v_flex().w_full().gap(6).children(lines.map((l) => {
      const trimmed = l.trim();
      if (!trimmed) return div().h(4);

      if (trimmed.startsWith("# ")) {
        return div().w_full().mt(6).mb(2).font_bold().text_size(13.5).text_color(colors.text).whitespace_normal().child(trimmed.slice(2));
      }
      if (trimmed.startsWith("## ")) {
        return div().w_full().mt(4).mb(2).font_bold().text_size(12.5).text_color(colors.text).whitespace_normal().child(trimmed.slice(3));
      }
      if (trimmed.startsWith("### ")) {
        return div().w_full().mt(3).mb(1).font_semibold().text_size(12).text_color(colors.accent).whitespace_normal().child(trimmed.slice(4));
      }

      // Key-Value Label: **Label:** rest
      const labelMatch = /^\*\*([^*]+)\*\*:?\s*(.*)$/.exec(trimmed);
      if (labelMatch) {
        const label = labelMatch[1].trim();
        const rest = labelMatch[2].trim();
        if (!rest) {
          return div().w_full().mt(4).mb(1).font_bold().text_size(12).text_color(colors.accent).whitespace_normal().child(label);
        }
        return h_flex().w_full().gap(6).items_start()
          .child(div().font_bold().text_size(12).text_color(colors.accent).flex_none().child(label.endsWith(":") ? label : label + ":"))
          .child(
            div().flex_1().min_w(0).child(renderTextPieces(rest))
          );
      }

      // Bullet list item (- ... or * ...)
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        return h_flex().w_full().gap(6).items_start().pl(2)
          .child(div().size(5).mt(6).rounded(9999).bg(colors.accent).flex_none())
          .child(
            div().flex_1().min_w(0).child(renderTextPieces(trimmed.slice(2)))
          );
      }

      // Numbered list item (1. ...)
      const numMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
      if (numMatch) {
        return h_flex().w_full().gap(6).items_start().pl(2)
          .child(div().text_size(11).font_family("JetBrains Mono").font_bold().text_color(colors.muted).flex_none().child(numMatch[1] + "."))
          .child(
            div().flex_1().min_w(0).child(renderTextPieces(numMatch[2]))
          );
      }

      // Markdown table row (| ... |)
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.every((c) => /^[-:]+$/.test(c))) {
          return div().w_full().h(1).bg(colors.codeBorder).my(2);
        }
        return h_flex().w_full().gap(4).px(4).py(1).rounded(3).bg(colors.codeBg).border_1().border_color(colors.codeBorder)
          .children(cells.map((cell) =>
            div().flex_1().min_w(0).text_size(10.5).font_family("JetBrains Mono").truncate().text_color(colors.text).child(cell)
          ));
      }

      // Regular text paragraph
      return div().w_full().child(renderTextPieces(l));
    }));
  }

  openCreateModal(cx) {
    this.showCreateModal = true;
    this.detailTask = null;

    // Projeto padrão: o atual do filtro ou do space ativo
    let currentProjectName = "orchestrator";
    if (this.filter && this.lists[this.filter]) {
      currentProjectName = this.name(this.lists[this.filter].folder) || this.filter;
    } else if (this.here) {
      currentProjectName = this.name(this.here);
    } else {
      const firstSlug = Object.keys(this.lists)[0];
      if (firstSlug && this.lists[firstSlug]) {
        currentProjectName = this.name(this.lists[firstSlug].folder) || firstSlug;
      }
    }
    this.createProjectInput.set_value(currentProjectName);

    // Card padrão: o primeiro card vinculado ao space ativo
    const activeSpace = spaces().find((s) => s.active);
    const sc = shared("spaces.cards") ?? {};
    const detectCard = (name) => {
      if (!name) return "";
      const m = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(name);
      return m ? `${m[1].toUpperCase()}-${m[2]}` : "";
    };
    const explicit = sc.spaces?.[activeSpace?.id];
    const linkedCards = parseCards(explicit && explicit !== "none" ? explicit : (detectCard(activeSpace?.name) || ""));
    const defaultCard = linkedCards[0] || "";
    this.createGroupInput.set_value(defaultCard);

    this.createTitleInput.set_value("");
    this.createDescTextarea.set_value("");
    this.createPrioSelected = null;
    this.createInitialSubs = [];
    this.createSubInput.set_value("");
    this.createGroupDropdownOpen = false;

    this.createTitleInput.focus();
    cx.timer.after(200, () => this.createTitleInput.focus());
    cx.notify();
  }

  closeCreateModal(cx) {
    this.showCreateModal = false;
    this.createGroupDropdownOpen = false;
    cx.notify();
  }

  submitCreateModal(cx) {
    const title = this.createTitleInput.value().trim();
    if (!title) return;

    const projectName = this.createProjectInput.value().trim();
    const resolved = this.resolveRepo(projectName);
    const targetSlug = resolved.slug;
    const targetFolder = resolved.folder;
    const targetName = resolved.name;

    const group = normalizeCard(this.createGroupInput.value().trim()) || null;
    const priority = this.createPrioSelected || null;
    const description = this.createDescTextarea.value().trim();
    const subtasks = this.createInitialSubs.map((text) => ({ done: false, text, doneOn: null }));

    const meta = (group || priority || targetName) ? { ...(group ? { group } : {}), ...(priority ? { priority } : {}), repo: targetName } : null;
    const newItem = {
      done: false,
      text: title,
      due: null,
      doneOn: null,
      group,
      priority,
      meta,
      subtasks,
      urls: [],
      description,
    };

    const l = this.lists[targetSlug] ?? { folder: targetFolder, items: [] };
    const nextItems = [...(l.items ?? []), newItem];
    l.items = nextItems;
    this.lists[targetSlug] = l;

    this.showCreateModal = false;
    cx.notify();

    cx.spawn(async (cx) => this.write(targetSlug, targetFolder, nextItems, cx));
    toFile(targetFolder, "add", title);
  }

  renderCreateModal(t, cx) {
    if (!this.showCreateModal) return div();

    const prios = [
      { id: "Critical", label: "Crítica", col: "#ef4444" },
      { id: "High", label: "Alta", col: "#f59e0b" },
      { id: "Medium", label: "Média", col: "#3b82f6" },
      { id: "Low", label: "Baixa", col: "#64748b" },
      { id: null, label: "Nenhuma", col: t.dim },
    ];

    const availableProjects = Object.entries(this.lists).map(([slug, l]) => ({
      slug,
      name: this.name(l.folder),
      color: this.color(l.folder, t),
    })).filter((p) => Boolean(p.name));

    const all = Object.values(this.lists).flatMap((l) => l.items);
    const sc = shared("spaces.cards") ?? {};
    const cardSet = new Set(all.map((it) => it.group).filter(Boolean));
    if (sc.spaces) {
      Object.values(sc.spaces).forEach((c) => {
        if (c && c !== "none") parseCards(c).forEach((card) => cardSet.add(card));
      });
    }
    if (sc.folders) {
      Object.values(sc.folders).forEach((c) => {
        if (c && c !== "none") parseCards(c).forEach((card) => cardSet.add(card));
      });
    }
    const existingCards = [...cardSet].sort();

    const activeSpace = spaces().find((s) => s.active);
    const linkedSpaceCards = parseCards(sc.spaces?.[activeSpace?.id] ?? "");

    const currentProject = this.createProjectInput.value().trim();
    const currentGroup = this.createGroupInput.value().trim();

    return div().id("create-modal-drawer").absolute().inset_0().bg(t.background).rounded(10)
      .border_1().border_color(t.border).shadow_lg().overflow_hidden().flex().flex_col()
      // Header
      .child(
        h_flex().h(46).px(14).items_center().border_b(1).border_color(t.border).gap(10).flex_none()
          .child(
            h_flex().id("btn-create-back").h(28).px(10).rounded(6).cursor_pointer().items_center().gap(5)
              .bg(t.accent + "22").border_1().border_color(t.accent + "55")
              .hover((s) => s.bg(t.accent + "38").border_color(t.accent))
              .tooltip("Cancelar e voltar para a lista (Esc)")
              .on_click((_e, cx) => this.closeCreateModal(cx))
              .child(svg("mods/workspace-chrome/chevron-left.svg").size(13).text_color(t.accent))
              .child(div().text_size(12).font_semibold().text_color(t.accent).child("Voltar")),
          )
          .child(div().w(1).h(16).bg(t.border))
          .child(
            h_flex().gap(6).items_center()
              .child(svg("mods/workspace-chrome/plus.svg").size(13).text_color(t.accent))
              .child(div().font_semibold().text_size(13).child("Criar Nova Tarefa")),
          )
          .child(div().flex_1())
          .child(
            div().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).child("Enter para criar"),
          ),
      )
      // Scrollable Body
      .child(
        v_flex().id("create-modal-scroll").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(16)
          // 1. Task Title
          .child(
            v_flex().gap(6)
              .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Título da Tarefa *"))
              .child(
                Input.new(this.createTitleInput).h(36).px(10).rounded(8)
                  .border_1().border_color(t.accent).bg(t.raised)
                  .text_size(13).font_medium().text_color(t.foreground),
              ),
          )
          // 2. Project Selector
          .child(
            v_flex().gap(6)
              .child(
                h_flex().justify_between().items_center()
                  .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Projeto"))
                  .child(div().text_size(10.5).text_color(t.dim).child("Clique no projeto abaixo ou digite o nome")),
              )
              .child(
                Input.new(this.createProjectInput).h(32).px(9).rounded(7)
                  .border_1().border_color(t.border).bg(t.raised)
                  .text_size(12.5).text_color(t.foreground),
              )
              .child(
                h_flex().gap(6).flex_wrap()
                  .children(availableProjects.map((p) => {
                    const isPicked = currentProject.toLowerCase() === p.name.toLowerCase();
                    return h_flex().id(`pick-proj-${p.slug}`).h(24).px(8).rounded(9999).cursor_pointer().items_center().gap(5)
                      .border_1().border_color(isPicked ? p.color : t.border)
                      .bg(isPicked ? p.color + "22" : t.raised + "44")
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => {
                        this.createProjectInput.set_value(p.name);
                        cx.notify();
                      })
                      .child(div().size(6).rounded(3).bg(p.color))
                      .child(div().text_size(11).font_medium().text_color(isPicked ? t.foreground : t.muted).child(p.name));
                  })),
              ),
          )
          // 3. Card / Group & Priority Row
          .child(
            h_flex().gap(12).items_start()
              // Group / Card with Autocomplete Dropdown
              .child(
                v_flex().flex_1().min_w(0).gap(6)
                  .child(
                    h_flex().justify_between().items_center()
                      .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Card / Grupo"))
                      .when(this.createGroupDropdownOpen, (b) =>
                        b.child(
                          h_flex().gap(3).items_center().cursor_pointer()
                            .on_click((_e, cx) => {
                              this.createGroupDropdownOpen = false;
                              cx.notify();
                            })
                            .child(svg("mods/workspace-chrome/chevron-up.svg").size(10).text_color(t.dim))
                            .child(div().text_size(10.5).text_color(t.dim).hover((s) => s.text_color(t.foreground)).child("Fechar sugestões"))
                        )
                      )
                  )
                  .when(linkedSpaceCards.length > 1, (b) =>
                    b.child(
                      h_flex().gap(5).items_center().flex_wrap()
                        .child(div().text_size(10.5).text_color(t.dim).child("Cards do Space:"))
                        .children(
                          linkedSpaceCards.map((c) => {
                            const isPicked = normalizeCard(currentGroup) === c;
                            return h_flex().h(22).px(7).rounded(5).cursor_pointer().items_center().gap(3)
                              .bg(isPicked ? t.ansi6 + "28" : t.raised).border_1().border_color(isPicked ? t.ansi6 : t.border)
                              .hover((s) => s.border_color(t.ansi6))
                              .on_click((_e, cx) => {
                                this.createGroupInput.set_value(c);
                                this.createGroupDropdownOpen = false;
                                cx.notify();
                              })
                              .child(div().text_size(10.5).font_semibold().text_color(isPicked ? t.ansi6 : t.muted).child(`#${c}`));
                          })
                        )
                    )
                  )
                  // Input Bar
                  .child(
                    h_flex().h(32).px(8).rounded(7).border_1()
                      .border_color(this.createGroupDropdownOpen ? t.accent : t.border)
                      .bg(t.raised).items_center().gap(5)
                      .child(div().text_size(12).font_semibold().text_color(t.ansi6).child("#"))
                      .child(Input.new(this.createGroupInput).flex_1().h_full().text_size(12.5).text_color(t.foreground))
                      .when(Boolean(currentGroup), (b) =>
                        b.child(
                          div().id("btn-clear-group").size(18).rounded(4).cursor_pointer().flex().items_center().justify_center()
                            .hover((s) => s.bg(t.hover))
                            .tooltip("Limpar")
                            .on_click((_e, cx) => {
                              this.createGroupInput.set_value("");
                              this.createGroupDropdownOpen = true;
                              cx.notify();
                            })
                            .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted))
                        )
                      )
                      .child(
                        div().id("btn-toggle-group-dropdown").size(20).rounded(4).cursor_pointer().flex().items_center().justify_center()
                          .hover((s) => s.bg(t.hover))
                          .tooltip(this.createGroupDropdownOpen ? "Ocultar sugestões" : "Mostrar sugestões de card")
                          .on_click((_e, cx) => {
                            this.createGroupDropdownOpen = !this.createGroupDropdownOpen;
                            cx.notify();
                          })
                          .child(svg(`mods/workspace-chrome/chevron-${this.createGroupDropdownOpen ? "up" : "down"}.svg`).size(10).text_color(t.muted))
                      )
                  )
                  // Autocomplete dropdown (only visible when open)
                  .when(this.createGroupDropdownOpen, (el) => {
                    const query = currentGroup.toLowerCase().replace(/^#/, "").trim();
                    const matchingCards = existingCards.filter((c) => !query || c.toLowerCase().includes(query));
                    const exactMatch = existingCards.some((c) => c.toLowerCase() === query);

                    return el.child(
                      v_flex().id("group-autocomplete-menu")
                        .p(4).gap(2).rounded(7).border_1().border_color(t.border).bg(t.popover).shadow_lg()
                        .max_h(140).overflow_y_scrollbar()
                        .when(!exactMatch && query.length > 0, (box) =>
                          box.child(
                            h_flex().id("card-opt-custom").h(28).px(8).rounded(5).cursor_pointer().items_center().gap(6)
                              .bg(t.accent + "18")
                              .hover((s) => s.bg(t.accent + "2c"))
                              .on_click((_e, cx) => {
                                this.createGroupInput.set_value(normalizeCard(currentGroup));
                                this.createGroupDropdownOpen = false;
                                cx.notify();
                              })
                              .child(div().text_size(11).font_bold().text_color(t.accent).child("+"))
                              .child(div().text_size(11.5).font_semibold().text_color(t.accent).child(`Usar novo card #${normalizeCard(currentGroup)}`))
                          )
                        )
                        .children(matchingCards.slice(0, 10).map((c) => {
                          const isPicked = currentGroup.toUpperCase() === c.toUpperCase();
                          return h_flex().id(`card-opt-${c}`).h(28).px(8).rounded(5).cursor_pointer().items_center().justify_between()
                            .bg(isPicked ? t.ansi6 + "22" : "#00000000")
                            .hover((s) => s.bg(t.hover))
                            .on_click((_e, cx) => {
                              this.createGroupInput.set_value(c);
                              this.createGroupDropdownOpen = false;
                              cx.notify();
                            })
                            .child(
                              h_flex().gap(6).items_center()
                                .child(div().text_size(11).font_bold().text_color(t.ansi6).child("#"))
                                .child(div().text_size(12).font_medium().text_color(isPicked ? t.ansi6 : t.foreground).child(c))
                            )
                            .when(isPicked, (b) =>
                              b.child(div().text_size(11).font_semibold().text_color(t.ansi6).child("✓"))
                            );
                        }))
                        .when(matchingCards.length === 0 && !query, (box) =>
                          box.child(
                            div().px(8).py(6).text_size(11).text_color(t.dim).child("Nenhum card encontrado. Digite um nome.")
                          )
                        )
                    );
                  }),
              )
              // Priority
              .child(
                v_flex().flex_none().gap(6)
                  .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Prioridade"))
                  .child(
                    h_flex().gap(4).items_center()
                      .children(prios.map((p) => {
                        const isPicked = this.createPrioSelected === p.id;
                        return h_flex().id(`create-prio-${p.label}`).h(30).px(8).rounded(6).cursor_pointer().items_center().gap(5)
                          .border_1().border_color(isPicked ? p.col : t.border)
                          .bg(isPicked ? p.col + "25" : t.raised)
                          .hover((s) => s.bg(t.hover))
                          .on_click((_e, cx) => {
                            this.createPrioSelected = p.id;
                            cx.notify();
                          })
                          .when(Boolean(p.id), (el) => el.child(div().size(6).rounded(3).bg(p.col)))
                          .child(div().text_size(11).font_medium().text_color(isPicked ? t.foreground : t.muted).child(p.label));
                      })),
                  ),
              ),
          )
          // 4. Description (Markdown) com a área verde escura
          .child(
            v_flex().gap(6)
              .child(
                h_flex().justify_between().items_center()
                  .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Descrição & Detalhes (Markdown)"))
                  .child(div().text_size(10.5).text_color(t.dim).child("Suporta formatação Markdown")),
              )
              .child(
                div().w_full().min_h(140).h(180).rounded(8).border_1().border_color("#ffffff44").bg("#0c2818").p(8).overflow_hidden()
                  .child(
                    Textarea.new(this.createDescTextarea)
                      .w_full().h_full().text_size(12.5).text_color("#ffffff"),
                  ),
              ),
          )
          // 5. Initial Subtasks
          .child(
            v_flex().gap(6)
              .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Subtarefas (opcional)"))
              .child(
                h_flex().gap(6).items_center()
                  .child(Input.new(this.createSubInput).flex_1().h(30).px(8).rounded(6).border_1().border_color(t.border).bg(t.raised).text_size(12).text_color(t.foreground))
                  .child(
                    h_flex().id("btn-add-create-sub").h(30).px(10).rounded(6).bg(t.raised).border_1().border_color(t.border).cursor_pointer().items_center().justify_center()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => {
                        const val = this.createSubInput.value().trim();
                        if (val) {
                          this.createInitialSubs.push(val);
                          this.createSubInput.set_value("");
                          cx.notify();
                        }
                      })
                      .child(div().text_size(11).font_medium().text_color(t.foreground).child("+ Adicionar")),
                  ),
              )
              .when(this.createInitialSubs.length > 0, (el) =>
                el.child(
                  v_flex().gap(4).pt(2)
                    .children(this.createInitialSubs.map((subText, sIdx) =>
                      h_flex().h(26).px(8).rounded(5).bg(t.raised).items_center().justify_between().gap(8)
                        .child(div().flex_1().truncate().text_size(11.5).text_color(t.foreground).child(`• ${subText}`))
                        .child(
                          div().id(`rm-sub-${sIdx}`).size(18).rounded(4).cursor_pointer().flex().items_center().justify_center()
                            .hover((s) => s.bg(t.hover))
                            .on_click((_e, cx) => {
                              this.createInitialSubs.splice(sIdx, 1);
                              cx.notify();
                            })
                            .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted)),
                        ),
                    )),
                ),
              ),
          ),
      )
      // Footer
      .child(
        h_flex().h(52).px(16).items_center().border_t(1).border_color(t.border).justify_between().flex_none()
          .child(
            h_flex().id("btn-create-cancel").h(32).px(14).rounded(8).border_1().border_color(t.border).cursor_pointer().items_center().justify_center()
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.closeCreateModal(cx))
              .child(div().text_size(12).font_medium().text_color(t.muted).child("Cancelar")),
          )
          .child(
            h_flex().id("btn-create-submit").h(32).px(16).rounded(8).bg(t.accent).cursor_pointer().items_center().justify_center().gap(6)
              .hover((s) => s.opacity(0.88))
              .on_click((_e, cx) => this.submitCreateModal(cx))
              .child(svg("mods/workspace-chrome/check.svg").size(13).text_color("#ffffff"))
              .child(div().text_size(12.5).font_semibold().text_color("#ffffff").child("Criar Tarefa")),
          ),
      );
  }

  renderCardDropdown(t, cx, activeSpace, linkedCards) {
    if (!this.cardDropdownOpen) return div();

    const allCards = this.getAllProjectCards();
    const query = this.cardSearchInput.value().trim().toLowerCase().replace(/^#/, "");
    const matching = allCards.filter((c) => {
      if (!query) return true;
      if (c.name.toLowerCase().includes(query)) return true;
      if (c.space?.name?.toLowerCase().includes(query)) return true;
      return false;
    }).slice(0, 10);

    const effectiveCards = this.customCardFilter !== null ? this.customCardFilter : linkedCards;
    const isCustom = this.customCardFilter !== null;

    return div()
      .id("card-dropdown-backdrop")
      .absolute()
      .inset_0()
      .on_click((_e, cx) => {
        this.cardDropdownOpen = false;
        cx.notify();
      })
      .child(
        div()
          .id("card-dropdown-popover")
          .absolute()
          .top(44)
          .left(14)
          .w(340)
          .max_h(400)
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .bg(t.popover)
          .shadow_lg()
          .flex()
          .flex_col()
          .overflow_hidden()
          .on_click((_e, cx) => {
            cx.stop_propagation();
          })
          // Top search input
      .child(
        h_flex()
          .p(8)
          .border_b(1)
          .border_color(t.border)
          .gap(6)
          .items_center()
          .child(svg("mods/todos/tag.svg").size(12).text_color(t.dim))
          .child(
            Input.new(this.cardSearchInput)
              .flex_1()
              .h(26)
              .px(6)
              .rounded(5)
              .border_1()
              .border_color(t.input)
              .bg(t.background)
              .text_size(11.5)
              .text_color(t.foreground),
          )
          .child(
            div()
              .size(18)
              .rounded(4)
              .cursor_pointer()
              .flex()
              .items_center()
              .justify_center()
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => {
                this.cardDropdownOpen = false;
                cx.notify();
              })
              .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted)),
          ),
      )
      // Reset to Space option
      .when(isCustom, (el) =>
        el.child(
          h_flex()
            .px(10)
            .py(7)
            .gap(6)
            .items_center()
            .cursor_pointer()
            .bg(t.accent + "18")
            .border_b(1)
            .border_color(t.accent + "44")
            .hover((s) => s.bg(t.accent + "2c"))
            .on_click((_e, cx) => this.resetCardFilterToSpace(cx))
            .child(svg("mods/todos/star.svg").size(11).text_color(t.accent))
            .child(div().text_size(11.5).font_semibold().text_color(t.accent).child(`★ Voltar para o Space (${activeSpace?.name || "Space"})`)),
        ),
      )
      // List of cards
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(4)
          .gap(1)
          .when(matching.length === 0, (el) =>
            el.child(
              div().px(10).py(8).text_size(11.5).text_color(t.dim).child("Nenhum card encontrado"),
            ),
          )
          .children(
            matching.map((c) => {
              const isPicked = effectiveCards.includes(c.name);
              return h_flex()
                .id(`dropdown-card-${c.name}`)
                .h(30)
                .px(8)
                .gap(6)
                .items_center()
                .rounded(5)
                .cursor_pointer()
                .bg(isPicked ? t.accent + "20" : "#00000000")
                .hover((s) => s.bg(isPicked ? t.accent + "2c" : t.hover))
                .on_click((_e, cx) => {
                  if (effectiveCards.includes(c.name) && effectiveCards.length > 1) {
                    this.customCardFilter = effectiveCards.filter((x) => x !== c.name);
                  } else {
                    this.customCardFilter = [c.name];
                  }
                  this.cardDropdownOpen = false;
                  cx.notify();
                })
                .child(
                  div()
                    .size(6)
                    .rounded(3)
                    .bg(isPicked ? t.accent : c.space ? t.ansi4 : t.dim),
                )
                .child(
                  div()
                    .text_size(12)
                    .font_semibold()
                    .text_color(isPicked ? t.accent : t.foreground)
                    .child(`#${c.name}`),
                )
                .child(
                  div()
                    .text_size(10.5)
                    .text_color(t.dim)
                    .child(`(${c.open})`),
                )
                .child(div().flex_1())
                .child(
                  div()
                    .text_size(10)
                    .text_color(c.space?.isCurrent ? t.accent : c.space ? t.ansi4 : t.dim)
                    .child(c.space?.isCurrent ? "Space atual" : c.space ? c.space.name : "sem space"),
                );
            }),
          ),
      )
      // Footer action: open full modal
      .child(
        h_flex()
          .h(34)
          .px(10)
          .gap(6)
          .items_center()
          .justify_between()
          .border_t(1)
          .border_color(t.border)
          .bg(t.raised)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.openCardFilterModal(cx))
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(svg("mods/todos/tag.svg").size(11).text_color(t.accent))
              .child(div().text_size(11).font_medium().text_color(t.foreground).child("Gerenciador completo de Cards...")),
          )
          .child(svg("mods/todos/arrow-up-right.svg").size(11).text_color(t.accent)),
      ),
    );
  }

  renderCardFilterModal(t, cx) {
    if (!this.showCardFilterModal) return div();

    const allCards = this.getAllProjectCards();
    const query = this.modalCardSearchInput.value().trim().toLowerCase().replace(/^#/, "");

    const filteredCards = allCards.filter((c) => {
      if (!query) return true;
      if (c.name.toLowerCase().includes(query)) return true;
      if (c.space?.name?.toLowerCase().includes(query)) return true;
      return false;
    });

    const activeSpace = spaces().find((s) => s.active);
    const sc = shared("spaces.cards") ?? {};
    const detectCard = (name) => {
      if (!name) return "";
      const m = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(name);
      return m ? `${m[1].toUpperCase()}-${m[2]}` : "";
    };
    const explicit = sc.spaces?.[activeSpace?.id];
    const spaceLinkedCards = parseCards(explicit && explicit !== "none" ? explicit : (detectCard(activeSpace?.name) || ""));

    const currentSpaceGroup = filteredCards.filter((c) => c.space?.isCurrent);
    const otherSpaceGroup = filteredCards.filter((c) => c.space && !c.space.isCurrent);
    const noSpaceGroup = filteredCards.filter((c) => !c.space);

    const isAllSelected = filteredCards.length > 0 && filteredCards.every((c) => this.modalSelectedCards.has(c.name));
    const selectedCount = this.modalSelectedCards.size;
    const selectedTasksCount = allCards
      .filter((c) => this.modalSelectedCards.has(c.name))
      .reduce((acc, c) => acc + c.open, 0);

    const toggleCard = (cardName) => {
      if (this.modalSelectedCards.has(cardName)) {
        this.modalSelectedCards.delete(cardName);
      } else {
        this.modalSelectedCards.add(cardName);
      }
      cx.notify();
    };

    const cardRow = (c) => {
      const isSelected = this.modalSelectedCards.has(c.name);
      return h_flex()
        .id(`modal-card-row-${c.name}`)
        .min_h(36)
        .px(10)
        .py(6)
        .gap(10)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .bg(isSelected ? t.accent + "18" : "#00000000")
        .border_1()
        .border_color(isSelected ? t.accent + "44" : "#00000000")
        .hover((s) => s.bg(isSelected ? t.accent + "26" : t.hover))
        .on_click((_e, _cx) => toggleCard(c.name))
        .child(
          div()
            .size(16)
            .rounded(5)
            .border_1()
            .border_color(isSelected ? t.accent : t.muted)
            .bg(isSelected ? t.accent : t.raised)
            .flex()
            .items_center()
            .justify_center()
            .when(isSelected, (el) =>
              el.child(svg("mods/workspace-chrome/check.svg").size(10).text_color("#ffffff"))
            )
        )
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(8)
            .items_center()
            .child(
              div()
                .text_size(13)
                .font_bold()
                .text_color(isSelected ? t.foreground : t.ansi6)
                .child(`#${c.name}`)
            )
            .child(
              div()
                .text_size(11)
                .text_color(t.dim)
                .child(`${c.open} ${c.open === 1 ? "aberta" : "abertas"}${c.done > 0 ? ` · ${c.done} conc.` : ""}`)
            )
        )
        .child(
          c.space?.isCurrent
            ? h_flex()
                .px(7)
                .py(2)
                .gap(5)
                .items_center()
                .rounded(5)
                .bg(t.accent + "22")
                .border_1()
                .border_color(t.accent + "55")
                .child(div().size(6).rounded(3).bg(t.accent))
                .child(div().text_size(10.5).font_semibold().text_color(t.accent).child(`Space atual (${c.space.name})`))
            : c.space
            ? h_flex()
                .px(7)
                .py(2)
                .gap(5)
                .items_center()
                .rounded(5)
                .bg(t.ansi4 + "1a")
                .border_1()
                .border_color(t.ansi4 + "44")
                .child(div().size(6).rounded(3).bg(t.ansi4))
                .child(div().text_size(10.5).font_medium().text_color(t.ansi4).child(`Space: ${c.space.name}`))
            : h_flex()
                .px(7)
                .py(2)
                .gap(5)
                .items_center()
                .rounded(5)
                .bg(t.raised)
                .border_1()
                .border_color(t.border)
                .child(div().size(6).rounded(3).bg(t.dim))
                .child(div().text_size(10.5).text_color(t.dim).child("Sem Space"))
        );
    };

    const sectionHeader = (title, count) =>
      h_flex()
        .pt(10)
        .pb(4)
        .px(6)
        .gap(6)
        .items_center()
        .child(div().text_size(11).font_bold().text_color(t.muted).child(title.toUpperCase()))
        .child(div().text_size(10).text_color(t.dim).child(`(${count})`))
        .child(div().flex_1().h(1).bg(t.border));

    const btn = (id, text, primary, action, icon = null) =>
      h_flex()
        .id(id)
        .h(30)
        .px(12)
        .items_center()
        .gap(5)
        .rounded(6)
        .border_1()
        .border_color(primary ? t.accent : t.border)
        .bg(primary ? t.accent : t.raised)
        .text_color(primary ? "#ffffff" : t.foreground)
        .text_size(12)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_click(action)
        .when(Boolean(icon), (el) => el.child(svg(icon).size(11).text_color(primary ? "#ffffff" : t.muted)))
        .child(text);

    return div()
      .id("card-filter-modal-drawer")
      .absolute()
      .inset_0()
      .bg(t.background)
      .rounded(10)
      .border_1()
      .border_color(t.border)
      .shadow_lg()
      .overflow_hidden()
      .flex()
      .flex_col()
      // Header
      .child(
        h_flex()
          .h(46)
          .px(14)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .gap(10)
          .flex_none()
          .child(
            h_flex()
              .id("btn-card-filter-back")
              .h(28)
              .px(10)
              .rounded(6)
              .cursor_pointer()
              .items_center()
              .gap(5)
              .bg(t.accent + "22")
              .border_1()
              .border_color(t.accent + "55")
              .hover((s) => s.bg(t.accent + "38").border_color(t.accent))
              .tooltip("Fechar e voltar para a lista (Esc)")
              .on_click((_e, cx) => this.closeCardFilterModal(cx))
              .child(svg("mods/workspace-chrome/chevron-left.svg").size(13).text_color(t.accent))
              .child(div().text_size(12).font_semibold().text_color(t.accent).child("Voltar")),
          )
          .child(div().w(1).h(16).bg(t.border))
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(svg("mods/todos/tag.svg").size(14).text_color(t.accent))
              .child(div().font_semibold().text_size(13).child("Gerenciador de Cards / Visualização")),
          )
          .child(div().flex_1())
          .child(
            div()
              .id("btn-close-filter-modal-x")
              .size(24)
              .rounded(5)
              .flex()
              .items_center()
              .justify_center()
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.closeCardFilterModal(cx))
              .child(svg("mods/workspace-chrome/x.svg").size(12).text_color(t.muted)),
          ),
      )
      // Controls & Search Bar
      .child(
        v_flex()
          .p(12)
          .pb(6)
          .gap(8)
          .flex_none()
          .border_b(1)
          .border_color(t.border)
          // Search input
          .child(
            h_flex()
              .h(34)
              .px(10)
              .rounded(7)
              .border_1()
              .border_color(t.border)
              .bg(t.raised)
              .items_center()
              .gap(6)
              .child(svg("mods/todos/tag.svg").size(13).text_color(t.dim))
              .child(
                Input.new(this.modalCardSearchInput)
                  .flex_1()
                  .h_full()
                  .text_size(12.5)
                  .text_color(t.foreground),
              )
              .when(Boolean(query), (el) =>
                el.child(
                  div()
                    .size(18)
                    .rounded(4)
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .justify_center()
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      this.modalCardSearchInput.set_value("");
                      cx.notify();
                    })
                    .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted)),
                ),
              ),
          )
          // Action pills
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .flex_wrap()
              .child(
                h_flex()
                  .id("btn-modal-select-all")
                  .h(24)
                  .px(8)
                  .rounded(5)
                  .gap(4)
                  .items_center()
                  .cursor_pointer()
                  .bg(isAllSelected ? t.accent + "28" : t.raised)
                  .border_1()
                  .border_color(isAllSelected ? t.accent : t.border)
                  .hover((s) => s.border_color(t.accent))
                  .on_click((_e, cx) => {
                    if (isAllSelected) {
                      filteredCards.forEach((c) => this.modalSelectedCards.delete(c.name));
                    } else {
                      filteredCards.forEach((c) => this.modalSelectedCards.add(c.name));
                    }
                    cx.notify();
                  })
                  .child(svg("mods/workspace-chrome/check.svg").size(10).text_color(isAllSelected ? t.accent : t.muted))
                  .child(
                    div()
                      .text_size(11)
                      .font_medium()
                      .text_color(isAllSelected ? t.accent : t.foreground)
                      .child(isAllSelected ? "Desmarcar visíveis" : "Selecionar todos visíveis"),
                  ),
              )
              .child(
                h_flex()
                  .id("btn-modal-space-only")
                  .h(24)
                  .px(8)
                  .rounded(5)
                  .gap(4)
                  .items_center()
                  .cursor_pointer()
                  .bg(t.raised)
                  .border_1()
                  .border_color(t.border)
                  .hover((s) => s.border_color(t.accent))
                  .on_click((_e, cx) => {
                    this.modalSelectedCards = new Set(spaceLinkedCards);
                    cx.notify();
                  })
                  .child(svg("mods/todos/star.svg").size(10).text_color(t.accent))
                  .child(div().text_size(11).font_medium().text_color(t.foreground).child("Apenas Cards deste Space")),
              )
              .when(selectedCount > 0, (el) =>
                el.child(
                  h_flex()
                    .id("btn-modal-clear-all")
                    .h(24)
                    .px(8)
                    .rounded(5)
                    .gap(4)
                    .items_center()
                    .cursor_pointer()
                    .bg(t.raised)
                    .border_1()
                    .border_color(t.border)
                    .hover((s) => s.border_color(t.ansi1))
                    .on_click((_e, cx) => {
                      this.modalSelectedCards.clear();
                      cx.notify();
                    })
                    .child(div().text_size(11).font_medium().text_color(t.dim).child("Limpar seleção")),
                ),
              ),
          ),
      )
      // Card List
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(10)
          .gap(3)
          .when(filteredCards.length === 0, (el) =>
            el.child(
              v_flex()
                .size_full()
                .items_center()
                .justify_center()
                .py(30)
                .gap(6)
                .child(div().font_medium().text_size(13).text_color(t.muted).child("Nenhum card encontrado"))
                .child(div().text_size(11).text_color(t.dim).child(`Nenhum resultado para "${query}"`)),
            ),
          )
          .when(currentSpaceGroup.length > 0, (el) =>
            el
              .child(sectionHeader(`Cards vinculados a este Space (${activeSpace?.name || "Space"})`, currentSpaceGroup.length))
              .children(currentSpaceGroup.map(cardRow)),
          )
          .when(otherSpaceGroup.length > 0, (el) =>
            el
              .child(sectionHeader("Outros Cards com Space atribuído", otherSpaceGroup.length))
              .children(otherSpaceGroup.map(cardRow)),
          )
          .when(noSpaceGroup.length > 0, (el) =>
            el
              .child(sectionHeader("Cards sem Space atribuído (avulsos / backlog)", noSpaceGroup.length))
              .children(noSpaceGroup.map(cardRow)),
          ),
      )
      // Footer
      .child(
        h_flex()
          .h(48)
          .px(14)
          .items_center()
          .justify_between()
          .border_t(1)
          .border_color(t.border)
          .bg(t.raised + "44")
          .flex_none()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                div()
                  .text_size(11.5)
                  .font_semibold()
                  .text_color(selectedCount > 0 ? t.accent : t.muted)
                  .child(`${selectedCount} ${selectedCount === 1 ? "card selecionado" : "cards selecionados"}`),
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child(`(${selectedTasksCount} tarefas abertas)`),
              ),
          )
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                btn("btn-modal-reset-space", "Redefinir para o Space", false, (_e, cx) => this.resetCardFilterToSpace(cx), "mods/todos/star.svg"),
              )
              .child(
                btn("btn-modal-cancel", "Cancelar", false, (_e, cx) => this.closeCardFilterModal(cx)),
              )
              .child(
                btn("btn-modal-apply", "✓ Visualizar Cards", true, (_e, cx) => this.applyCardFilterModal(cx)),
              ),
          ),
      );
  }

  renderDetailModal(t, cx) {
    if (!this.detailTask) return div();
    const { slug, i } = this.detailTask;
    const task = this.lists[slug]?.items[i];
    if (!task) {
      this.detailTask = null;
      return null;
    }
    const folder = this.lists[slug]?.folder;
    const key = `${slug}:${i}`;
    const prios = [
      { id: "Critical", label: "Crítica", col: "#ef4444" },
      { id: "High", label: "Alta", col: "#f59e0b" },
      { id: "Medium", label: "Média", col: "#3b82f6" },
      { id: "Low", label: "Baixa", col: "#64748b" },
      { id: null, label: "Nenhuma", col: t.dim },
    ];
    const subtasks = task.subtasks ?? [];
    const subDone = subtasks.filter((s) => s.done).length;
    const subTotal = subtasks.length;
    const pct = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0;

    return div().id("detail-modal-drawer").absolute().inset_0().bg(t.background).rounded(10)
      .border_1().border_color(t.border).shadow_lg().overflow_hidden().flex().flex_col()
          // Header
          .child(
            h_flex().h(46).px(14).items_center().border_b(1).border_color(t.border).gap(10).flex_none()
              // Highlighted Back button (primary way to close/return)
              .child(
                h_flex().id("btn-modal-back").h(28).px(10).rounded(6).cursor_pointer().items_center().gap(5)
                  .bg(t.accent + "22").border_1().border_color(t.accent + "55")
                  .hover((s) => s.bg(t.accent + "38").border_color(t.accent))
                  .tooltip("Voltar para a lista (Esc)")
                  .on_click((_e, cx) => this.closeDetailModal(cx))
                  .child(svg("mods/workspace-chrome/chevron-left.svg").size(13).text_color(t.accent))
                  .child(div().text_size(12).font_semibold().text_color(t.accent).child("Voltar"))
              )
              .child(div().w(1).h(16).bg(t.border))
              .child(div().font_semibold().text_size(12.5).child(`Tarefa #${i + 1}`))
              .when(Boolean(folder || task.meta?.repo), (el) => el.child(
                h_flex().id("modal-header-repo-pill").px(8).py(1.5).rounded(9999)
                  .bg(this.color(folder, t) + "22").border_1().border_color(this.color(folder, t) + "44")
                  .items_center().gap(5).tooltip(`Repositório: ${folder || ""}`)
                  .child(div().size(6).rounded(9999).bg(this.color(folder, t)))
                  .child(div().text_size(10.5).font_semibold().text_color(this.color(folder, t)).child(task.meta?.repo || (folder ? this.name(folder) : "")))
              ))
              .child(div().flex_1())
              // Navigation Prev / Next (cleanly on the right)
              .child(
                h_flex().items_center().gap(3)
                  .child(
                    div().id("btn-modal-prev").size(26).rounded(5).flex().items_center().justify_center()
                      .tooltip("Tarefa anterior")
                      .when(i > 0, (b) => b.cursor_pointer().hover((s) => s.bg(t.raised))
                        .on_click((_e, cx) => this.navModalPrev(cx))
                        .child(svg("mods/workspace-chrome/chevron-left.svg").size(12).text_color(t.foreground)))
                      .when(i <= 0, (b) => b.opacity(0.3).child(svg("mods/workspace-chrome/chevron-left.svg").size(12).text_color(t.muted)))
                  )
                  .child(div().text_size(11).font_family("JetBrains Mono").text_color(t.dim).px(4).child(`${i + 1}/${(this.lists[slug]?.items ?? []).length}`))
                  .child(
                    div().id("btn-modal-next").size(26).rounded(5).flex().items_center().justify_center()
                      .tooltip("Próxima tarefa")
                      .when(i < (this.lists[slug]?.items ?? []).length - 1, (b) => b.cursor_pointer().hover((s) => s.bg(t.raised))
                        .on_click((_e, cx) => this.navModalNext(cx))
                        .child(svg("mods/workspace-chrome/chevron-right.svg").size(12).text_color(t.foreground)))
                      .when(i >= (this.lists[slug]?.items ?? []).length - 1, (b) => b.opacity(0.3).child(svg("mods/workspace-chrome/chevron-right.svg").size(12).text_color(t.muted)))
                  )
              )
          )
          // Body (Scrollable with explicit ID)
          .child(
            v_flex().id("modal-body-scroll").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(16)
              // Title row with main checkbox
              .child(
                h_flex().gap(10).items_start()
                  .child(
                    div().id("modal-main-tick").size(20).mt(4).rounded(6).border(2).cursor_pointer().border_color(task.done ? t.ansi2 : t.muted)
                      .when(task.done, (b) => b.bg(t.ansi2).flex().items_center().justify_center().child(svg("mods/workspace-chrome/check.svg").size(12).text_color(t.background)))
                      .on_click((_e, cx) => this.toggleModalTaskDone(cx))
                  )
                  .child(
                    div().px(5).py(1).rounded(4).bg(t.raised).border_1().border_color(t.border).flex_none()
                      .child(div().text_size(11).font_family("JetBrains Mono").font_bold().text_color(t.accent).child(`#${i + 1}`))
                  )
                  .child(
                    v_flex().flex_1().min_w(0).gap(4)
                      // Reading mode: Multi-line wrapped title with hover/click edit trigger
                      .when(!this.modalEditingTitle, (b) => b.child(
                        h_flex().w_full().items_start().justify_between().gap(8)
                          .child(
                            div().id("modal-title-view").flex_1().min_w(0).cursor_pointer()
                              .text_size(14).font_bold().line_height("20px")
                              .text_color(task.done ? t.dim : t.foreground)
                              .when(task.done, (st) => st.line_through())
                              .whitespace_normal()
                              .tooltip("Clique para editar o título")
                              .on_click((_e, cx) => {
                                this.modalEditingTitle = true;
                                this.modalTitleInput.set_value(task.text || "");
                                cx.notify();
                              })
                              .child(task.text)
                          )
                          .child(
                            div().id("btn-edit-title").size(24).rounded(5).cursor_pointer().flex_none().flex().items_center().justify_center()
                              .hover((s) => s.bg(t.raised))
                              .tooltip("Editar título")
                              .on_click((_e, cx) => {
                                this.modalEditingTitle = true;
                                this.modalTitleInput.set_value(task.text || "");
                                cx.notify();
                              })
                              .child(svg("mods/todos/edit.svg").size(12).text_color(t.muted))
                          )
                      ))
                      // Editing mode: Input with Save and Cancel buttons
                      .when(this.modalEditingTitle, (b) => b.child(
                        h_flex().w_full().gap(6).items_center()
                          .child(
                            Input.new(this.modalTitleInput).flex_1().h(32).px(8).rounded(6)
                              .border_1().border_color(t.accent).bg(t.background)
                              .text_size(13).font_medium().text_color(t.foreground)
                          )
                          .child(
                            div().h(30).px(10).rounded(6).bg(t.raised).cursor_pointer().flex().items_center().justify_center()
                              .hover((st) => st.bg(t.hover))
                              .on_click((_e, cx) => { this.modalEditingTitle = false; cx.notify(); })
                              .child(div().text_size(11).text_color(t.muted).child("Cancelar"))
                          )
                          .child(
                            div().h(30).px(12).rounded(6).bg(t.accent).cursor_pointer().flex().items_center().justify_center()
                              .hover((st) => st.opacity(0.85))
                              .on_click((_e, cx) => this.saveModalTitle(cx))
                              .child(div().text_size(11.5).font_semibold().text_color("#ffffff").child("Salvar"))
                          )
                      ))
                      .when(task.done && Boolean(task.doneOn), (b) => b.child(div().text_size(10.5).text_color(t.dim).child(`Concluída: ${task.doneOn}`)))
                      .when(!task.done && Boolean(task.due), (b) => b.child(div().text_size(10.5).text_color(overdue(task.due) ? t.ansi1 : t.dim).child(`Prazo: ${task.due}`)))
                  )
              )
              // Priority selector bar
              .child(
                v_flex().gap(6)
                  .child(div().text_size(11).font_semibold().text_color(t.muted).child("PRIORIDADE"))
                  .child(
                    h_flex().gap(6).flex_wrap().children(
                      prios.map((pr) => {
                        const isCur = String(task.priority || "").toLowerCase() === String(pr.id || "").toLowerCase();
                        return h_flex().h(26).px(10).gap(4).items_center().rounded(9999).cursor_pointer()
                          .border_1().border_color(isCur ? pr.col : t.border)
                          .bg(isCur ? pr.col + "26" : t.raised + "55")
                          .hover((st) => st.bg(isCur ? pr.col + "33" : t.hover))
                          .on_click((_e, cx) => this.setModalPrio(pr.id, cx))
                          .child(div().size(7).rounded(9999).bg(pr.col))
                          .child(div().text_size(11).font_semibold().text_color(isCur ? pr.col : t.muted).child(pr.label));
                      })
                    )
                  )
              )
              // Card / Group row
              .child(
                v_flex().gap(6)
                  .child(div().text_size(11).font_semibold().text_color(t.muted).child("CARD / GRUPO"))
                  .child(
                    h_flex().gap(6).items_center()
                      .child(Input.new(this.modalGroupInput).w(180).h(28).px(8).rounded(6).border_1().border_color(t.border).bg(t.background).text_size(12).text_color(t.foreground))
                      .child(
                        div().h(28).px(10).rounded(6).bg(t.raised).border_1().border_color(t.border).cursor_pointer().flex().items_center().justify_center()
                          .hover((st) => st.bg(t.hover))
                          .on_click((_e, cx) => this.saveModalGroup(cx))
                          .child(div().text_size(11).text_color(t.foreground).child("Atualizar"))
                      )
                      .when(Boolean(task.group), (b) => b.child(
                        div().px(8).py(2).rounded(9999).bg(t.ansi6 + "22").border_1().border_color(t.ansi6 + "44")
                          .text_size(11).font_semibold().text_color(t.ansi6).child(`#${task.group}`)
                      ))
                  )
              )
              // Repositório / Projeto row & quick-select pills
              .child(
                v_flex().gap(6)
                  .child(
                    h_flex().justify_between().items_center()
                      .child(div().text_size(11).font_semibold().text_color(t.muted).child("REPOSITÓRIO / PROJETO"))
                      .child(div().text_size(10.5).text_color(t.dim).child("Nome (ex: evah-v1) ou caminho (vazio = padrão)"))
                  )
                  .child(
                    h_flex().gap(8).items_center().flex_wrap()
                      // Pill do repositório atual
                      .child(
                        h_flex().id("modal-current-repo-pill").h(28).px(10).rounded(9999).items_center().gap(6)
                          .bg(this.color(folder, t) + "22").border_1().border_color(this.color(folder, t) + "55")
                          .tooltip(`Caminho: ${folder || "Padrão"}`)
                          .child(div().size(7).rounded(9999).bg(this.color(folder, t)))
                          .child(div().text_size(11.5).font_semibold().text_color(this.color(folder, t)).child(task.meta?.repo || (folder ? this.name(folder) : "Padrão")))
                      )
                      .child(
                        Input.new(this.modalRepoInput).w(180).h(28).px(8).rounded(6)
                          .border_1().border_color(t.border).bg(t.background)
                          .text_size(12).text_color(t.foreground)
                      )
                      .child(
                        div().id("btn-modal-save-repo").h(28).px(10).rounded(6).bg(t.raised).border_1().border_color(t.border).cursor_pointer().flex().items_center().justify_center()
                          .hover((st) => st.bg(t.hover).border_color(t.accent))
                          .on_click((_e, cx) => this.saveModalRepo(cx))
                          .child(div().text_size(11).text_color(t.foreground).child("Vincular"))
                      )
                      .child(
                        div().id("btn-modal-default-repo").h(28).px(8).rounded(6).bg(t.raised + "66").border_1().border_color(t.border).cursor_pointer().flex().items_center().justify_center()
                          .hover((st) => st.bg(t.hover))
                          .tooltip("Redefinir para o repositório padrão / atual")
                          .on_click((_e, cx) => this.setModalRepo("", cx))
                          .child(div().text_size(10.5).text_color(t.muted).child("Padrão"))
                      )
                  )
                  // Pills dos repositórios disponíveis para troca rápida com 1 clique
                  .child(
                    h_flex().gap(6).flex_wrap().children(
                      this.projectChoices(t).map((p) => {
                        const curName = task.meta?.repo || (folder ? this.name(folder) : "");
                        const isCur = curName.toLowerCase() === p.name.toLowerCase();
                        return h_flex().id(`repo-pick-${p.name}`).h(24).px(8).rounded(9999).cursor_pointer().items_center().gap(5)
                          .border_1().border_color(isCur ? p.color : t.border)
                          .bg(isCur ? p.color + "26" : t.raised + "55")
                          .hover((st) => st.bg(isCur ? p.color + "38" : t.hover))
                          .on_click((_e, cx) => this.setModalRepo(p.name, cx))
                          .child(div().size(6).rounded(9999).bg(p.color))
                          .child(div().text_size(11).font_semibold().text_color(isCur ? p.color : t.muted).child(p.name));
                      })
                    )
                  )
              )
              // Description section (Markdown View + Textarea Edit)
              .child(
                v_flex().w_full().gap(6)
                  .child(
                    h_flex().w_full().items_center().justify_between()
                      .child(div().text_size(11).font_semibold().text_color(t.muted).child("DESCRIÇÃO & ESPECIFICAÇÕES"))
                      .when(Boolean(task.description) && !this.modalEditingDesc, (b) => b.child(
                        div().cursor_pointer().flex().items_center().gap(3).hover((s) => s.opacity(0.8))
                          .on_click((_e, cx) => {
                            this.modalEditingDesc = true;
                            this.modalDescTextarea.set_value(task.description || "");
                            cx.notify();
                          })
                          .child(svg("mods/todos/edit.svg").size(10).text_color(t.accent))
                          .child(div().text_size(11).text_color(t.accent).child("Editar"))
                      ))
                  )
                  // Editing mode: Textarea with matching elegant green background
                  .when(this.modalEditingDesc, (b) => b.child(
                    v_flex().w_full().gap(6).p(8).rounded(8).border_1().border_color("#ffffff44").bg("#0c2818")
                      .child(
                        Textarea.new(this.modalDescTextarea).w_full().min_h(220).h(320).px(8).py(6).rounded(6)
                          .border_1().border_color("#ffffff38").bg("#00000040")
                          .text_size(12).line_height("18px").text_color("#ffffff")
                      )
                      .child(
                        h_flex().w_full().items_center().justify_between().px(2)
                          .child(div().text_size(10.5).text_color("#86efac").child("Markdown (#, -, 1., **bold**, `code`)"))
                          .child(
                            h_flex().gap(6).items_center()
                              .child(
                                div().h(26).px(10).rounded(5).cursor_pointer().flex().items_center().justify_center()
                                  .bg("#ffffff20").hover((s) => s.bg("#ffffff38"))
                                  .on_click((_e, cx) => { this.modalEditingDesc = false; cx.notify(); })
                                  .child(div().text_size(11).text_color("#ffffff").child("Cancelar"))
                              )
                              .child(
                                div().h(26).px(12).rounded(5).bg("#16a34a").cursor_pointer().flex().items_center().justify_center()
                                  .hover((s) => s.bg("#22c55e"))
                                  .on_click((_e, cx) => this.saveModalDesc(cx))
                                  .child(div().text_size(11).font_semibold().text_color("#ffffff").child("Salvar"))
                              )
                          )
                      )
                  ))
                  // Reading mode: Formatted Markdown with green bg, white text, and white border
                  .when(!this.modalEditingDesc, (b) => b.child(
                    Boolean(task.description)
                      ? div().id("desc-markdown-box").w_full().min_h(220).max_h(440).overflow_y_scrollbar().overflow_x_hidden()
                          .p(12).rounded(8).border_1().border_color("#ffffff44").bg("#0c2818")
                          .cursor_pointer().tooltip("Clique para editar a descrição")
                          .on_click((_e, cx) => {
                            this.modalEditingDesc = true;
                            this.modalDescTextarea.set_value(task.description || "");
                            cx.notify();
                          })
                          .child(this.renderMarkdownBlock(task.description, t, {
                            text: "#ffffff",
                            accent: "#4ade80",
                            muted: "#86efac",
                            codeBg: "#ffffff20",
                            codeBorder: "#ffffff40",
                            codeText: "#86efac",
                          }))
                      : div().w_full().h(38).px(12).rounded(6).border_1().border_dashed().border_color(t.border).cursor_pointer()
                          .flex().items_center().gap(6).hover((s) => s.border_color(t.accent).bg(t.raised + "44"))
                          .on_click((_e, cx) => {
                            this.modalEditingDesc = true;
                            this.modalDescTextarea.set_value("");
                            cx.notify();
                          })
                          .child(svg("mods/todos/edit.svg").size(11).text_color(t.muted))
                          .child(div().text_size(11.5).text_color(t.muted).child("+ Adicionar descrição / especificações em Markdown..."))
                  ))
              )
              // Subtasks section
              .child(
                v_flex().gap(6)
                  .child(
                    h_flex().items_center().justify_between()
                      .child(div().text_size(11).font_semibold().text_color(t.muted).child(`SUBTAREFAS (${subDone}/${subTotal})`))
                      .when(subTotal > 0, (b) => b.child(div().text_size(10.5).text_color(t.dim).child(`${pct}% concluído`)))
                  )
                  // Progress bar
                  .when(subTotal > 0, (b) => b.child(
                    div().h(4).w_full().rounded(9999).bg(t.raised).overflow_hidden()
                      .child(div().h_full().w(`${pct}%`).bg(pct === 100 ? t.ansi2 : t.accent))
                  ))
                  // List of subtasks
                  .when(subTotal > 0, (b) => b.child(
                    v_flex().gap(4).rounded(8).p(6).bg(t.raised + "33").border_1().border_color(t.border)
                      .children(subtasks.map((s, si) =>
                        h_flex().id(`modal-sub-${si}`).min_h(26).px(6).py(2).gap(8).items_center().rounded(6).hover((st) => st.bg(t.hover))
                          .child(
                            div().size(14).rounded(4).border_1().cursor_pointer().border_color(s.done ? t.ansi2 : t.muted)
                              .when(s.done, (bx) => bx.bg(t.ansi2).flex().items_center().justify_center().child(svg("mods/workspace-chrome/check.svg").size(8).text_color(t.background)))
                              .on_click((_e, cx) => this.toggleModalSub(si, cx))
                          )
                          .child(div().flex_none().text_size(10).font_family("JetBrains Mono").text_color(t.dim).child(`#${i + 1}.${si + 1}`))
                          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(s.done ? t.dim : t.foreground).when(s.done, (bx) => bx.line_through()).child(s.text))
                          .child(
                            div().size(16).rounded(4).cursor_pointer().flex().items_center().justify_center().hover((st) => st.bg(t.raised))
                              .on_click((_e, cx) => this.deleteModalSub(si, cx))
                              .child(svg("mods/workspace-chrome/x.svg").size(9).text_color(t.muted))
                          )
                      ))
                  ))
                  // Add subtask input
                  .child(
                    h_flex().gap(6).items_center()
                      .child(Input.new(this.modalSubInput).flex_1().h(28).px(8).rounded(6).border_1().border_color(t.border).bg(t.background).text_size(12).text_color(t.foreground))
                      .child(
                        div().h(28).px(10).rounded(6).bg(t.accent + "22").border_1().border_color(t.accent).cursor_pointer().flex().items_center().justify_center()
                          .hover((st) => st.bg(t.accent + "44"))
                          .on_click((_e, cx) => this.saveModalSub(cx))
                          .child(div().text_size(11.5).font_semibold().text_color(t.accent).child("+ Adicionar"))
                      )
                  )
              )
              // Links & URLs section
              .child(
                v_flex().gap(6)
                  .child(div().text_size(11).font_semibold().text_color(t.muted).child("LINKS & REFERÊNCIAS"))
                  .when(Boolean(task.urls?.length), (b) => b.child(
                    h_flex().gap(6).flex_wrap().children((task.urls ?? []).map((u, ui) =>
                      h_flex().h(26).px(8).rounded(6).bg(t.background).border_1().border_color(t.border).gap(5).items_center()
                        .child(
                          h_flex().gap(4).items_center().cursor_pointer()
                            .on_click((_e, _cx) => { exec("xdg-open", [u.url]).catch(() => null); })
                            .child(svg("mods/todos/link.svg").size(11).text_color(t.ansi4))
                            .child(div().text_size(11.5).text_color(t.ansi4).child(u.name || "link"))
                        )
                        .child(
                          div().size(14).rounded(3).cursor_pointer().flex().items_center().justify_center().hover((st) => st.text_color(t.ansi1))
                            .on_click((_e, cx) => this.deleteModalLink(ui, cx))
                            .child(svg("mods/workspace-chrome/x.svg").size(8).text_color(t.muted))
                        )
                    ))
                  ))
                  .child(
                    h_flex().gap(6).items_center()
                      .child(Input.new(this.modalLinkNameInput).w(100).h(26).px(6).rounded(5).border_1().border_color(t.border).bg(t.background).text_size(11.5).text_color(t.foreground))
                      .child(Input.new(this.modalLinkUrlInput).flex_1().h(26).px(6).rounded(5).border_1().border_color(t.border).bg(t.background).text_size(11.5).text_color(t.foreground))
                      .child(
                        div().h(26).px(9).rounded(5).bg(t.raised).border_1().border_color(t.border).cursor_pointer().flex().items_center().justify_center()
                          .hover((st) => st.bg(t.hover).border_color(t.accent))
                          .on_click((_e, cx) => this.saveModalLink(cx))
                          .child(div().text_size(11).text_color(t.accent).child("+ Link"))
                      )
                  )
              )
              // Tags section
              .child(
                v_flex().gap(6)
                  .child(div().text_size(11).font_semibold().text_color(t.muted).child("TAGS"))
                  .child(
                    h_flex().gap(6).flex_wrap().items_center()
                      .children((task.tags ?? []).map((tg) =>
                        h_flex().h(24).px(8).gap(4).items_center().rounded(9999).bg(t.raised).border_1().border_color(t.border)
                          .child(div().text_size(11).text_color(t.ansi6).child(`#${tg}`))
                          .child(
                            div().size(12).cursor_pointer().flex().items_center().justify_center().hover((st) => st.text_color(t.ansi1))
                              .on_click((_e, cx) => this.deleteModalTag(tg, cx))
                              .child(svg("mods/workspace-chrome/x.svg").size(8).text_color(t.muted))
                          )
                      ))
                      .child(Input.new(this.modalTagInput).w(90).h(24).px(6).rounded(4).border_1().border_color(t.border).bg(t.background).text_size(11).text_color(t.foreground))
                      .child(
                        div().h(24).px(8).rounded(4).bg(t.raised).border_1().border_color(t.border).cursor_pointer().flex().items_center().justify_center()
                          .hover((st) => st.bg(t.hover))
                          .on_click((_e, cx) => this.saveModalTag(cx))
                          .child(div().text_size(11).text_color(t.accent).child("+ Tag"))
                      )
                  )
              )
          )
          // Footer
          .child(
            h_flex().h(48).px(16).items_center().border_t(1).border_color(t.border).bg(t.raised + "44").gap(10).flex_none()
              // Trash Delete Button (Icon with confirmation state)
              .child(
                h_flex().id("btn-modal-delete").h(32).px(8).rounded(6).cursor_pointer().items_center().gap(5)
                  .border_1().border_color(this.modalDeleteArmed ? t.ansi1 : t.border)
                  .bg(this.modalDeleteArmed ? t.ansi1 + "26" : t.background)
                  .hover((s) => s.bg(t.ansi1 + "20").border_color(t.ansi1))
                  .tooltip(this.modalDeleteArmed ? "Clique novamente para confirmar a exclusão" : "Excluir tarefa")
                  .on_click((_e, cx) => {
                    if (!this.modalDeleteArmed) {
                      this.modalDeleteArmed = true;
                      cx.spawn(async (cx) => { await cx.sleep(3000); this.modalDeleteArmed = false; cx.notify(); });
                    } else {
                      this.deleteModalTask(cx);
                    }
                    cx.notify();
                  })
                  .child(svg("mods/todos/trash.svg").size(14).text_color(this.modalDeleteArmed ? t.ansi1 : t.muted))
                  .when(this.modalDeleteArmed, (b) => b.child(div().text_size(11).font_semibold().text_color(t.ansi1).child("Confirmar?")))
              )
              // Run Agent Button (Modern styled button)
              .when(this.agentChoices?.length > 0 && !task.done, (el) => el.child(
                h_flex().id("btn-modal-agent").h(32).px(12).gap(6).rounded(6).cursor_pointer().items_center().justify_center()
                  .bg(t.accent + "18").border_1().border_color(t.accent + "55")
                  .hover((s) => s.bg(t.accent + "33").border_color(t.accent))
                  .tooltip("Iniciar um agente autônomo nesta tarefa")
                  .on_click((_e, cx) => {
                    this.closeDetailModal(cx);
                    this.startFor = key;
                    cx.notify();
                  })
                  .child(svg("mods/todos/bot.svg").size(13).text_color(t.accent))
                  .child(div().text_size(11.5).font_semibold().text_color(t.accent).child("Executar Agente"))
                  .child(svg("mods/workspace-chrome/chevron-right.svg").size(10).text_color(t.accent))
              ))
              // Queue Button
              .when(!task.done, (el) => {
                const isQueued = (this.queueItems || []).some((it) => it.text === task.text && it.status === "queued");
                return el.child(
                  h_flex().id("btn-modal-queue").h(32).px(12).gap(6).rounded(6).cursor_pointer().items_center().justify_center()
                    .bg(isQueued ? t.ansi3 + "1c" : t.raised).border_1().border_color(isQueued ? t.ansi3 + "88" : t.border)
                    .hover((s) => s.bg(isQueued ? t.ansi3 + "33" : t.hover))
                    .tooltip(isQueued ? "Tarefa já está na fila dos agentes. Clique para desenfileirar." : "Adicionar esta tarefa na fila de execução automática (injetada quando um agente estiver idle)")
                    .on_click(async (_e, cx) => {
                      if (isQueued) {
                        await this.dequeueTask(task, cx);
                      } else {
                        await this.enqueueTask(task, cx);
                      }
                    })
                    .child(svg("mods/todos/sync.svg").size(12).text_color(isQueued ? t.ansi3 : t.muted))
                    .child(div().text_size(11.5).font_semibold().text_color(isQueued ? t.ansi3 : t.foreground).child(isQueued ? "Na Fila" : "Enfileirar"))
                );
              })
              .child(div().flex_1())
              // Mark as Done / Open
              .child(
                h_flex().h(32).px(14).rounded(6).cursor_pointer().items_center().gap(6)
                  .bg(task.done ? t.raised : t.ansi2 + "22").border_1().border_color(task.done ? t.border : t.ansi2)
                  .hover((s) => s.bg(task.done ? t.hover : t.ansi2 + "38"))
                  .on_click((_e, cx) => this.toggleModalTaskDone(cx))
                  .child(svg(task.done ? "mods/todos/sync.svg" : "mods/workspace-chrome/check.svg").size(12).text_color(task.done ? t.muted : t.ansi2))
                  .child(div().text_size(11.5).font_semibold().text_color(task.done ? t.muted : t.ansi2).child(task.done ? "Reabrir Tarefa" : "Concluir Tarefa"))
              )
          );
  }

  render(cx) {
    const t = theme();
    const hereSlug = this.here && keyOf(this.here);
    // Only pinned projects (the sidebar's list), and the one you're in.
    // All: the projects Over9k's sidebar pins, and the one you're in; without
    // that sidebar (this panel on its own), every project's list.
    const pinList = shared("projects.pinned");
    const pinned = new Set((pinList ?? []).map((f) => f.replace(/\/+$/, "")));
    const hereOk = Boolean(this.here && this.here !== home());
    const inScope = (l) => !Array.isArray(pinList) || pinned.has(l.folder) || (hereOk && l.folder === this.here);
    this.filter = this.mode === "here" && hereOk ? hereSlug : null;
    const all = Object.entries(this.lists).filter(([, l]) => inScope(l)).flatMap(([slug, l]) => l.items.map((x, i) => ({ ...x, slug, i, folder: l.folder })));
    const activeSpace = spaces().find((s) => s.active);
    const sc = shared("spaces.cards") ?? {};
    const detectCard = (name) => {
      if (!name) return null;
      const m = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(name);
      return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
    };
    const explicitSpace = sc.spaces?.[activeSpace?.id];
    let linkedCards = [];
    if (explicitSpace === "none") {
      linkedCards = [];
    } else if (explicitSpace) {
      linkedCards = parseCards(explicitSpace);
    } else {
      const fromName = detectCard(activeSpace?.name);
      linkedCards = fromName ? [fromName] : [];
    }

    // Filtro efetivo: customizado pelo seletor ou padrão vinculado ao Space
    const effectiveCards = this.customCardFilter !== null ? this.customCardFilter : linkedCards;

    // Strict Card scope: display tasks belonging to the active Space's assigned Card(s) or custom filter
    const cardItems = effectiveCards.length > 0 ? all.filter((x) => {
      const matched = getTaskCard(x, effectiveCards);
      if (matched) {
        x._matchedCard = matched;
        return true;
      }
      return false;
    }) : [];
    const open = cardItems.filter((x) => !x.done);
    const doneToday = cardItems.filter((x) => x.done).sort((a, b) => (b.doneOn ?? "").localeCompare(a.doneOn ?? ""));
    const dueKey = (x) => (x.due ? x.due.padEnd(16, " ") : "~");

    // Grouping & Card-scoped indexing:
    // When multiple cards are viewed, group open tasks by card and index 1..N per card!
    const cardGroups = [];
    let allGroupedOpen = [];
    if (effectiveCards.length > 1) {
      for (const card of effectiveCards) {
        const groupTasks = open.filter((x) => x._matchedCard === card || cardsMatch(x.group, card));
        groupTasks.sort((a, b) => (b.slug === hereSlug) - (a.slug === hereSlug) || dueKey(a).localeCompare(dueKey(b)) || a.slug.localeCompare(b.slug) || a.i - b.i);
        groupTasks.forEach((t, idx) => {
          t.displayIndex = idx + 1;
          t.cardGroup = card;
        });
        cardGroups.push({ card, tasks: groupTasks });
        allGroupedOpen = allGroupedOpen.concat(groupTasks);
      }
    } else {
      open.sort((a, b) => (b.slug === hereSlug) - (a.slug === hereSlug) || dueKey(a).localeCompare(dueKey(b)) || a.slug.localeCompare(b.slug) || a.i - b.i);
      open.forEach((t, idx) => {
        t.displayIndex = idx + 1;
        t.cardGroup = effectiveCards[0] || null;
      });
      allGroupedOpen = open;
    }
    const list = allGroupedOpen;
    const done = doneToday;
    this.visible = [...list, ...done.slice(0, this.doneShown ?? 5)];
    const picks = this.picked();
    if (picks.length !== this.sel.size) { this.sel = new Map(picks.map((x) => [`${x.slug}:${x.i}`, x.text])); if (!picks.length) this.unpick(); }
    const now = new Date();
    const focusFolder = this.filter ? this.lists[this.filter]?.folder ?? this.here : this.here;
    if (focusFolder) this.readFile(focusFolder, cx);
    const fromFile = focusFolder ? this.suggested(focusFolder) : { items: [] };
    this.sugs = this.typed && this.typed !== this.sugOff ? suggest(this.typed, this.projectChoices(t)) : [];
    if (this.sugAt >= this.sugs.length) this.sugAt = 0;

    // A filter tab, as the sidebar's All / Agents: plain text, the picked one
    // shaded; a project's name in its colour, its count, and a small Log and
    // Sync icon when they're on.
    const chip = (key, label, n, color, on, fn, folder, isStar) => {
      const o = folder ? this.lists[keyOf(folder)]?.opts ?? defOpts() : null;
      return h_flex().id(`chip-${key}`).h(26).px(9).gap(5).flex_none().items_center().rounded(9999).cursor_pointer()
        .border_1().border_color(on ? t.accent : t.border)
        .text_color(on ? t.foreground : t.muted).bg(on ? t.raised : t.background)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { fn(); this.unpick(); cx.notify(); })
        .when(Boolean(isStar), (el) =>
          el.child(svg("mods/todos/star.svg").size(11).flex_none().text_color(on ? t.accent : (color ?? t.accent)))
        )
        .child(div().font_semibold().text_color(color ?? (on ? t.foreground : t.muted)).child(label))
        .when(n != null, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(String(n))))
        .when(Boolean(o?.log), (el) => el.child(svg("mods/todos/log.svg").size(11).flex_none().text_color(t.dim)))
        .when(Boolean(o?.sync), (el) => el.child(svg("mods/todos/sync.svg").size(11).flex_none().text_color(t.dim)));
    };

    // A to-do, as the sidebar's agent rows: its circle, the text on one line
    // (all of it on hover, or double-click to edit), and on the right when it's
    // due or was done; on hover, the agent and delete buttons.
    const row = (x) => {
      const key = `${x.slug}:${x.i}`, editing = this.editing?.slug === x.slug && this.editing.i === x.i, c = this.color(x.folder, t);
      const on = this.sel.get(key) === x.text, hovered = this.hover === key;
      const meta = x.done ? (x.doneOn ? doneWords(x.doneOn) : "") : x.due ? dueWords(x.due) : "";
      const prioColor = x.priority ? prioCol(x.priority) : t.dim;
      const subDone = x.subtasks?.filter(s => s.done).length ?? 0;
      const subTotal = x.subtasks?.length ?? 0;
      const isExp = this.expanded?.has(key);
      const hasSubtasks = subTotal > 0;
      const repoName = x.meta?.repo || (x.folder ? this.name(x.folder) : "");
      const hasGroup = Boolean(x.group) && !x.text.toUpperCase().includes(x.group);
      const hasInfo = Boolean(x.priority || hasGroup || repoName || hasSubtasks || meta);

      return h_flex().id(`todo-${key}`).min_h(38).px(10).py(5).gap(8).items_start().rounded(8)
        .when(on, (el) => el.bg(t.accent + "38")).hover((s) => s.bg(on ? t.accent + "38" : t.hover))
        .on_click((e, cx) => { if (multi(e) && !editing && this.filter) this.pick(x, e, cx); })
        .on_hover((on, cx) => { this.hover = on ? key : this.hover === key ? null : this.hover; cx.notify(); })
        // Checkbox pai (alinhado no topo da tarefa)
        .child(div().id(`tick-${key}`).size(16).mt(2).flex_none().rounded(6).border(1.5).cursor_pointer().border_color(x.done ? t.ansi2 : c)
          .when(x.done, (el) => el.bg(t.ansi2).flex().items_center().justify_center().child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.background)))
          .on_click((e, cx) => {
            if (multi(e) && this.filter) return;
            this.change(x.slug, (items) => items.map((y, j) => (j === x.i ? { ...y, done: !y.done, doneOn: y.done ? null : stamp() } : y)), cx);
            cross(x.folder, x.done ? "undo" : "done", x.text);
            this.fileAt[x.folder] = 0;
          }))
        // Conteúdo em 2 linhas responsivo
        .child(
          v_flex().flex_1().min_w(0).gap(3)
            // Linha 1: Número da tarefa (#X), Texto e Ações de hover
            .child(
              h_flex().w_full().items_center().gap(6)
                // Número da tarefa (#1, #2, #15...)
                .child(
                  div().id(`num-${key}`).flex_none().text_size(10.5).font_family("JetBrains Mono").font_semibold()
                    .text_color(x.done ? t.dim : t.muted)
                    .child(`#${x.displayIndex ?? (x.i + 1)}`)
                )
                // Texto da tarefa - SEMPRE truncate, sem tremor no hover! Clique abre modal de detalhes
                .child(editing
                  ? Input.new(this.editInput).flex_1().h(26).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(13).text_color(t.foreground)
                  : div().id(`text-${key}`).flex_1().min_w(0).text_size(13).line_height("18px").text_color(x.done ? t.dim : t.foreground).when(x.done, (el) => el.line_through())
                    .truncate().cursor_pointer()
                    .tooltip(x.text.length > 40 ? x.text : "Clique para ver detalhes")
                    .on_click((e, cx) => {
                      if (e.click_count === 2 && !multi(e)) {
                        this.editing = { slug: x.slug, i: x.i };
                        this.editInput.set_value(x.text + (x.due ? ` @${fmtDate(new Date(`${x.due.split(" ")[0]}T00:00:00`))}${x.due.includes(" ") ? ` ${fmtTime(x.due.split(" ")[1])}` : ""}` : ""));
                        this.editInput.focus();
                        cx.notify();
                      } else if (!multi(e)) {
                        this.openDetailModal(x, cx);
                      }
                    })
                    .child(x.text))
                // Acoes discretas no hover
                .when(hovered && !editing, (el) => el.child(
                  h_flex().id(`actions-${key}`).gap(2).items_center().flex_none()
                    .child(div().id(`act-modal-${key}`).size(20).flex().items_center().justify_center().rounded(5).cursor_pointer()
                      .hover((s) => s.bg(t.accent + "22")).tooltip("Ver detalhes da tarefa (↗)")
                      .on_click((_e, cx) => this.openDetailModal(x, cx))
                      .child(svg("mods/todos/arrow-up-right.svg").size(12).text_color(t.accent)))
                    .when(this.agentChoices.length > 0 && !x.done, (el) => el.child(
                      div().id(`start-${key}`).size(20).flex().items_center().justify_center().rounded(5).cursor_pointer()
                        .when(this.startFor === key, (el) => el.bg(t.selected))
                        .hover((s) => s.bg(t.raised)).tooltip("Executar agente")
                        .on_click((_e, cx) => { this.pickOpen = false; this.startFor = this.startFor === key ? null : key; cx.notify(); })
                        .child(svg("mods/todos/bot.svg").size(11).text_color(t.muted))
                    ))
                    .child(div().id(`del-${key}`).size(20).flex().items_center().justify_center().rounded(5).cursor_pointer()
                      .hover((s) => s.bg(t.raised)).tooltip("Excluir tarefa")
                      .on_click((_e, cx) => {
                        this.change(x.slug, (items) => items.filter((_, j) => j !== x.i), cx);
                        toFile(x.folder, "rm", x.text);
                      })
                      .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted)))
                ))
            )
            // Linha 2: Informações distribuídas embaixo em pills responsivas
            .when(hasInfo && !editing, (infoRow) => infoRow.child(
              h_flex().w_full().items_center().gap(5).flex_wrap().pt(1)
                // Prioridade do pai
                .when(Boolean(x.priority), (el) => el.child(
                  div().px(6).py(1).rounded(9999).border_1().border_color(prioColor + "44").bg(prioColor + "14")
                    .text_size(9.5).font_semibold().text_color(prioColor).cursor_pointer()
                    .hover((st) => st.bg(prioColor + "28"))
                    .tooltip(`Prioridade: ${x.priority} (clique para alternar)`)
                    .on_click((_e, cx) => this.cycleTaskPrio(key, cx))
                    .child(x.priority)
                ))
                // Card / Grupo
                .when(Boolean(hasGroup), (el) => el.child(
                  div().px(6).py(1).rounded(9999).bg(t.ansi6 + "18").border_1().border_color(t.ansi6 + "44")
                    .text_size(9.5).font_semibold().text_color(t.ansi6).child(`#${x.group}`)
                ))
                // Repositório / Projeto pill
                .when(Boolean(repoName), (el) => el.child(
                  div().id(`repo-${key}`).px(6).py(1).rounded(9999)
                    .border_1().border_color(c + "44").bg(c + "18")
                    .text_size(9.5).font_semibold().text_color(c)
                    .tooltip(`Repositório: ${repoName} (${x.folder || ""})`)
                    .child(repoName)
                ))
                // Accordion chevron badge de subtasks
                .when(hasSubtasks, (el) => el.child(
                  h_flex().id(`exp-${key}`).h(18).px(5).gap(3).items_center().rounded(5).bg(t.raised).cursor_pointer()
                    .border_1().border_color(t.border)
                    .hover((st) => st.bg(t.hover).border_color(t.accent))
                    .tooltip(isExp ? "Recolher subtarefas" : "Expandir subtarefas")
                    .on_click((_e, cx) => { cx.stop_propagation(); this.toggleExpand(key, cx); })
                    .child(svg(`mods/workspace-chrome/chevron-${isExp ? "down" : "right"}.svg`).size(7).text_color(t.muted))
                    .child(div().text_size(9.5).font_semibold().text_color(subDone === subTotal ? t.ansi2 : t.muted).child(`${subDone}/${subTotal}`))
                ))
                // Metadados (data / vencimento)
                .when(Boolean(meta), (el) => el.child(
                  div().flex_none().text_size(10).text_color(!x.done && overdue(x.due) ? t.ansi1 : t.dim).child(meta)
                ))
            ))
        );
    };
    // A section, as the sidebar's Parked: a chevron that folds it, its name and
    // count, and an action on the right.
    const section = (id, label, n, open, toggleFn, right) => h_flex().id(`sec-${id}`).h(26).flex_none().mt(6).px(8).gap(7).items_center()
      .text_size(11).text_color(t.dim).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { toggleFn(); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().child(label)).child(div().text_color(t.muted).child(String(n)))
      .child(div().flex_1())
      .when(Boolean(right) && open, (el) => el.child(right));
    // Under a to-do whose ▶ was clicked: an agent per button.
    // Under a to-do whose agent button was clicked, two choices: Send to this
    // agent (the one you were last in, else the latest one in that project), or
    // New agent, of the kind the pill shows (click it to pick; kept for next time).
    const icon = (a, size = 13) => (a?.icon ? (a.tint ? svg(a.icon).size(size).flex_none().text_color(t.foreground) : image(a.icon).w(size).h(size).flex_none())
      : svg("mods/todos/bot.svg").size(size).flex_none().text_color(t.muted));
    const option = (id, fn, kids) => h_flex().id(id).h(26).px(7).gap(7).items_center().rounded(5).cursor_pointer()
      .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { fn(cx); cx.notify(); }).children(kids);
    // Under a to-do whose agent button was clicked: Current conversation, each
    // agent already running in that project by the name the sidebar gives it
    // (its icon and status dot), then New conversation, of the kind its pill
    // shows (click the pill to pick; kept for next time).
    const starter = (x, go) => {
      const running = this.runningIn(x.folder).slice(0, 4), make = go ?? ((a) => this.startAgent(a, x));
      const pick = this.agentChoices.find((a) => a.key === this.newPick) ?? this.agentChoices[0];
      const label = (text) => div().px(7).pt(4).pb(1).text_size(10.5).text_color(t.dim).child(text);
      const kind = (a) => this.agentChoices.find((c) => c.key === a.program?.key || c.key === a.app);
      return v_flex().relative().ml(30).mr(6).mb(6).p(3).gap(1).rounded(8).border_1().border_color(t.border).bg(t.popover)
        // × closes it (as does the agent button again).
        .child(div().id("starter-close").absolute().top(4).right(4).size(18).flex().items_center().justify_center().rounded(4).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip("Close")
          .on_click((_e, cx) => { this.startFor = null; this.pickOpen = false; cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted)))
        .when(running.length > 0, (el) => el.child(label(running.length > 1 ? "Current conversations" : "Current conversation"))
          .children(running.map((r) => option(`send-${r.address}`, (cx) => (go ? go(null, cx, r) : this.sendTo(r, x)), [
            icon(kind(r), 13),
            div().flex_1().min_w(0).truncate().child(this.agentName(r)),
            div().size(6).flex_none().rounded(3).bg(t[r.status] ?? t.idle),
          ]))))
        .when(Boolean(pick), (el) => el.child(label("Nova conversa"))
          .child(option("new", (cx) => make(pick, cx), [
            div().size(13).flex_none().flex().items_center().justify_center().text_size(14).text_color(t.muted).child("+"),
            div().flex_1().child("Iniciar nova conversa"),
            h_flex().id("new-pick").h(20).px(6).gap(4).flex_none().items_center().rounded(5).border_1().border_color(this.pickOpen ? t.accent : t.border)
              .text_size(11).text_color(t.muted).hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); this.pickOpen = !this.pickOpen; cx.notify(); })
              .child(icon(pick, 11)).child(pick?.name ?? "").child(svg(`mods/workspace-chrome/chevron-${this.pickOpen ? "right" : "down"}.svg`).size(8)),
          ])))
        .when(Boolean(this.pickOpen), (el) => el.child(v_flex().ml(20).pt(1).border_t_1().border_color(t.border)
          .children(this.agentChoices.map((a) => option(`pick-${a.key}`, () => { this.newPick = a.key; this.pickOpen = false; }, [
            icon(a, 12), div().flex_1().text_size(11.5).child(a.name),
            ...(a.key === pick?.key ? [svg("mods/workspace-chrome/check.svg").size(10).flex_none().text_color(t.accent)] : []),
          ])))));
    };
    // The picked ones, as a bar under the add box: how many, then plain labelled
    // actions (as the sidebar's buttons: no borders, shaded on hover): Mark done
    // (Mark not done when all are), Send to agent (open ones; the agent card
    // under the bar), Delete (click twice), Cancel.
    const pickBar = () => {
      const open = picks.filter((x) => !x.done), folders = new Set(open.map((x) => x.folder));
      const allDone = picks.every((x) => x.done);
      const act = (id, icon, label, fn, color, share) => h_flex().id(id).h(24).px(6).gap(5).items_center().rounded(5).cursor_pointer().text_size(12)
        .flex_none()
        .text_color(color ?? t.muted).hover((s) => s.bg(t.hover).text_color(color ?? t.foreground))
        .on_click((_e, cx) => { fn(cx); cx.notify(); })
        .when(Boolean(icon), (el) => el.child(svg(icon).size(12).flex_none())).child(label);
      const many = folders.size > 1, target = many ? null : this.runningIn([...folders][0])[0];
      return v_flex().px(8).pb(4).gap(4)
        // Top: how many, and Cancel on the right; below: the three actions.
        .child(v_flex().px(6).py(4).gap(2).rounded(8).bg(t.accent + "26")
          .child(h_flex().h(24).items_center()
            .child(div().flex_1().min_w(0).px(4).text_size(12).text_color(t.foreground).child(`${picks.length} selected`))
            .child(act("pick-clear", null, "Cancel", () => this.unpick(), t.dim)))
          .child(h_flex().flex_wrap().justify_between().gap(2).items_center()
          .child(act("pick-tick", "mods/workspace-chrome/check.svg", allDone ? "Mark not done" : "Mark done", (cx) => this.tickPicked(cx), null, true))
          .when(open.length > 0 && this.agentChoices.length > 0, (el) => el.child(act("pick-send", "mods/todos/bot.svg", "Send to agent", () => { this.pickOpen = false; this.startFor = this.startFor === "sel" ? null : "sel"; }, null, true)))
          .child(act("pick-del", "mods/workspace-chrome/x.svg", this.delArmed ? `Delete ${picks.length}? Click again` : "Delete", (cx) => {
            if (this.delArmed) { this.delArmed = false; return this.deletePicked(cx); }
            this.delArmed = true; cx.spawn(async (cx) => { await cx.sleep(3000); this.delArmed = false; cx.notify(); });
          }, this.delArmed ? t.ansi1 : null, true))))
        .when(this.startFor === "sel" && open.length > 0, (el) => el.child(
          starter({ ...open[0], folder: many ? null : open[0].folder }, (a, _cx, to) => this.sendPicked(a, to)).ml(0).mr(0).mb(0)))
        .when(this.startFor === "sel" && many, (el) => el.child(div().px(4).text_size(11).text_color(t.dim).child(`A new agent in each of the ${folders.size} projects`)));
    };
    const detailsBlock = (x) => {
      const key = `${x.slug}:${x.i}`;
      const subtasks = x.subtasks ?? [];
      const adding = this.subFor === key;
      if (!subtasks.length && !adding) {
        this.expanded.delete(key);
        return null;
      }
      return v_flex().id(`details-${key}`).ml(34).mr(10).mb(6).p(8).gap(6).rounded(8).border_l(2).border_color(t.accent).bg(t.raised + "22")
        // Subtasks list
        .children(subtasks.map((s, si) =>
          h_flex().id(`sub-${key}-${si}`).min_h(24).px(6).py(2).gap(8).items_center().rounded(5).hover((st) => st.bg(t.hover))
            .child(div().id(`subtick-${key}-${si}`).size(13).flex_none().rounded(4).border_1().cursor_pointer().border_color(s.done ? t.ansi2 : t.muted)
              .when(s.done, (b) => b.bg(t.ansi2).flex().items_center().justify_center().child(svg("mods/workspace-chrome/check.svg").size(8).text_color(t.background)))
              // Número da subtask (#15.1, #15.2...)
            .child(div().flex_none().text_size(9.5).font_family("JetBrains Mono").text_color(t.dim).child(`#${x.displayIndex ?? (x.i + 1)}.${si + 1}`))
            .on_click((_e, cx) => {
                this.change(x.slug, (items) => items.map((it, j) => {
                  if (j === x.i) {
                    const nextSubs = it.subtasks.map((sub, sj) => (sj === si ? { ...sub, done: !sub.done, doneOn: sub.done ? null : stamp() } : sub));
                    return { ...it, subtasks: nextSubs };
                  }
                  return it;
                }), cx);
              }))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(s.done ? t.dim : t.foreground).when(s.done, (b) => b.line_through()).child(s.text))
            .child(div().size(16).flex_none().flex().items_center().justify_center().rounded(3).cursor_pointer()
              .hover((st) => st.bg(t.raised)).on_click((_e, cx) => {
                this.change(x.slug, (items) => items.map((it, j) => {
                  if (j === x.i) {
                    const nextSubs = it.subtasks.filter((_, sj) => sj !== si);
                    if (!nextSubs.length) this.expanded.delete(key);
                    return { ...it, subtasks: nextSubs };
                  }
                  return it;
                }), cx);
              })
              .child(svg("mods/workspace-chrome/x.svg").size(9).text_color(t.muted)))
        ))
        // Inline subtask adder
        .when(adding, (el) => el.child(
          h_flex().gap(6).items_center().pt(2)
            .child(Input.new(this.subInput).flex_1().h(24).px(7).rounded(5).border_1().border_color(t.accent).bg(t.background).text_size(11.5).text_color(t.foreground))
            .child(div().h(24).px(8).rounded(5).bg(t.accent + "22").border_1().border_color(t.accent).cursor_pointer()
              .hover((st) => st.bg(t.accent + "44")).flex().items_center().justify_center()
              .on_click((_e, cx) => this.saveSub(cx))
              .child(div().text_size(11).font_semibold().text_color(t.accent).child("Save")))
            .child(div().size(18).cursor_pointer().flex().items_center().justify_center()
              .on_click((_e, cx) => { this.subFor = null; this.closeAction(key, cx); })
              .child(svg("mods/workspace-chrome/x.svg").size(9).text_color(t.muted)))
        ))
        // Accordion footer: quick add subtask and link to open modal
        .child(
          h_flex().gap(8).items_center().pt(2)
            .when(!adding, (b) => b.child(
              div().cursor_pointer().text_size(11).text_color(t.accent).hover((st) => st.underline())
                .on_click((_e, cx) => {
                  this.subFor = key;
                  this.subInput.set_value("");
                  this.subInput.focus();
                  cx.notify();
                })
                .child("+ Subtarefa")
            ))
            .child(div().flex_1())
            .child(
              div().cursor_pointer().text_size(11).text_color(t.muted).hover((st) => st.text_color(t.foreground))
                .on_click((_e, cx) => this.openDetailModal(x, cx))
                .child("Ver detalhes completos na modal ↗")
            )
        );
    };
    const withStarter = (x) => {
      const key = `${x.slug}:${x.i}`;
      const isExp = this.expanded?.has(key);
      const res = [row(x)];
      if (this.startFor === key) res.push(starter(x));
      if (isExp) {
        const d = detailsBlock(x);
        if (d) res.push(d);
      }
      return res;
    };

    const renderCardGroup = (grp) => {
      return v_flex()
        .id(`card-group-${grp.card}`)
        .w_full()
        .pt(6)
        .pb(2)
        .child(
          h_flex()
            .h(28)
            .px(8)
            .gap(6)
            .items_center()
            .rounded(6)
            .bg(t.raised + "55")
            .border_1()
            .border_color(t.border)
            .child(svg("mods/todos/tag.svg").size(12).text_color(t.ansi6))
            .child(
              div()
                .font_bold()
                .text_size(12)
                .text_color(t.ansi6)
                .child(`#${grp.card}`)
            )
            .child(
              div()
                .text_size(10.5)
                .text_color(t.dim)
                .child(`(${grp.tasks.length} ${grp.tasks.length === 1 ? "tarefa" : "tarefas"})`)
            )
            .child(div().flex_1())
            .child(
              h_flex()
                .h(20)
                .px(6)
                .gap(3)
                .items_center()
                .rounded(4)
                .bg(t.background)
                .border_1()
                .border_color(t.border)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  this.openCreateModal(cx);
                  this.createGroupInput.set_value(grp.card);
                })
                .child(svg("mods/workspace-chrome/plus.svg").size(9).text_color(t.muted))
                .child(div().text_size(10).font_medium().text_color(t.muted).child("Nova"))
            )
        )
        .children(
          grp.tasks.length > 0
            ? grp.tasks.flatMap(withStarter)
            : [
                div()
                  .px(10)
                  .py(6)
                  .text_size(11.5)
                  .text_color(t.dim)
                  .child(`Nenhuma tarefa aberta para #${grp.card}`),
              ]
        );
    };

    // A project switch in the header: Log and Sync toggle buttons in standard size
    const toggle = (id, label, icon, on, tip, fn) => h_flex().id(`switch-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
      .border_1()
      .when(on, (el) => el.bg(t.accent + "18").border_color(t.accent + "55").text_color(t.accent))
      .when(!on, (el) => el.bg(t.raised).border_color(t.border).text_color(t.muted))
      .hover((s) => s.bg(t.hover).text_color(on ? t.accent : t.foreground).border_color(on ? t.accent : t.border))
      .tooltip(`${tip} (${on ? "ativo" : "inativo"}: clique para ${on ? "desativar" : "ativar"})`)
      .on_click((_e, cx) => { fn(cx); cx.notify(); })
      .child(svg(icon).size(12).flex_none().text_color(on ? t.accent : t.muted))
      .child(div().text_size(11.5).font_medium().child(label))
      .child(div().size(5).rounded(9999).bg(on ? t.accent : t.border));
    const more = (id, label, fn) => div().id(id).px(5).py(2).rounded(4).cursor_pointer().text_size(11).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { fn(); cx.notify(); }).child(label);
    return div().relative().size_full().overflow_hidden()
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          if (this.showCardFilterModal) {
            this.closeCardFilterModal(cx);
            cx.stop_propagation();
            return;
          }
          if (this.cardDropdownOpen) {
            this.cardDropdownOpen = false;
            cx.notify();
            cx.stop_propagation();
            return;
          }
          if (this.showCreateModal) {
            this.closeCreateModal(cx);
            cx.stop_propagation();
            return;
          }
          if (this.detailTask) {
            this.closeDetailModal(cx);
            cx.stop_propagation();
            return;
          }
        }
        if (e.key === "n" && (e.modifiers.control || e.modifiers.platform)) {
          this.openCreateModal(cx);
          cx.stop_propagation();
          return;
        }
      })
      .child(
        v_flex().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(
          h_flex().items_center().gap(8)
            .child(div().font_semibold().text_size(13).child("To-do"))
            .when(Boolean(this.customCardFilter !== null), (b) =>
              b.child(
                h_flex().id("btn-space-card-custom-badge").h(24).px(8).rounded(6).cursor_pointer().items_center().gap(5)
                  .bg(t.ansi4 + "22").border_1().border_color(t.ansi4 + "66")
                  .hover((s) => s.bg(t.ansi4 + "38"))
                  .tooltip("Filtro customizado de cards ativo (clique para alternar)")
                  .on_click((_e, cx) => {
                    this.cardDropdownOpen = !this.cardDropdownOpen;
                    cx.notify();
                  })
                  .child(svg("mods/todos/tag.svg").size(11).text_color(t.ansi4))
                  .child(div().text_size(11.5).font_bold().text_color(t.ansi4).child(`Visualizando ${effectiveCards.length} ${effectiveCards.length === 1 ? "Card" : "Cards"}`))
                  .child(svg(`mods/workspace-chrome/chevron-${this.cardDropdownOpen ? "up" : "down"}.svg`).size(8).text_color(t.ansi4))
              )
            )
            .when(this.customCardFilter === null && linkedCards.length > 0, (b) =>
              b.child(
                h_flex()
                  .gap(5)
                  .items_center()
                  .children(
                    linkedCards.map((c) =>
                      h_flex().id(`btn-space-card-badge-${c}`).h(24).px(8).rounded(6).cursor_pointer().items_center().gap(5)
                        .bg(t.accent + "1f").border_1().border_color(t.accent + "55")
                        .hover((s) => s.bg(t.accent + "33").border_color(t.accent))
                        .tooltip(`Card atribuído: #${c} (clique para buscar ou trocar cards)`)
                        .on_click((_e, cx) => {
                          this.cardDropdownOpen = !this.cardDropdownOpen;
                          cx.notify();
                        })
                        .child(svg("mods/todos/star.svg").size(11).text_color(t.accent))
                        .child(div().text_size(11.5).font_bold().text_color(t.accent).child(`#${c}`))
                        .child(svg(`mods/workspace-chrome/chevron-${this.cardDropdownOpen ? "up" : "down"}.svg`).size(8).text_color(t.accent + "aa"))
                    )
                  )
              )
            )
            .when(this.customCardFilter === null && linkedCards.length === 0, (b) =>
              b.child(
                h_flex().id("btn-space-card-empty-badge").h(24).px(8).rounded(6).cursor_pointer().items_center().gap(5)
                  .bg(t.ansi3 + "1f").border_1().border_color(t.ansi3 + "55")
                  .hover((s) => s.bg(t.ansi3 + "33"))
                  .tooltip("Clique para buscar ou vincular Cards")
                  .on_click((_e, cx) => {
                    this.cardDropdownOpen = !this.cardDropdownOpen;
                    cx.notify();
                  })
                  .child(svg("mods/todos/tag.svg").size(11).text_color(t.ansi3))
                  .child(div().text_size(11.5).font_semibold().text_color(t.ansi3).child("Sem Card"))
                  .child(svg(`mods/workspace-chrome/chevron-${this.cardDropdownOpen ? "up" : "down"}.svg`).size(8).text_color(t.ansi3))
              )
            )
            .child(
              h_flex().id("btn-open-card-filter-modal").size(24).rounded(5).cursor_pointer().items_center().justify_center()
                .hover((s) => s.bg(t.hover))
                .tooltip("Gerenciador completo de cards e filtros")
                .on_click((_e, cx) => this.openCardFilterModal(cx))
                .child(svg("mods/todos/arrow-up-right.svg").size(11).text_color(t.muted))
            )
            .when(effectiveCards.length > 0, (b) =>
              b.child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${open.length} ${open.length === 1 ? "aberta" : "abertas"}`))
            )
        )
        .child(div().flex_1())
        .when((this.queueItems?.filter((it) => it.status === "queued")?.length ?? 0) > 0, (b) => {
          const qCount = this.queueItems.filter((it) => it.status === "queued").length;
          return b.child(
            h_flex().id("btn-header-queue").h(26).px(8).gap(4).rounded(6).cursor_pointer().items_center().justify_center()
              .bg(t.ansi3 + "1c").border_1().border_color(t.ansi3 + "66")
              .hover((s) => s.bg(t.ansi3 + "33"))
              .tooltip(`Fila: ${qCount} tarefa(s) aguardando agente livre. Clique para processar agora.`)
              .on_click(async (_e, cx) => {
                await this.runQueueCron(cx);
              })
              .child(svg("mods/todos/sync.svg").size(11).text_color(t.ansi3))
              .child(div().text_size(11).font_bold().text_color(t.ansi3).child(`Fila: ${qCount}`))
          );
        })
        .child(
          h_flex().id("btn-open-create-task").h(26).px(9).gap(5).rounded(6).cursor_pointer().items_center().justify_center()
            .bg(t.accent).hover((s) => s.opacity(0.88))
            .tooltip("Adicionar nova tarefa (Ctrl+N)")
            .on_click((_e, cx) => this.openCreateModal(cx))
            .child(svg("mods/workspace-chrome/plus.svg").size(11).text_color("#ffffff"))
            .child(div().text_size(11.5).font_semibold().text_color("#ffffff").child("Nova Tarefa"))
        )
        // Log and Sync for the project you're in (whichever tab shows).
        .when(hereOk, (el) => {
          const l = this.lists[hereSlug] ?? { folder: this.here, opts: defOpts() }, o = l.opts;
          const logTip = `Log: os agentes registram automaticamente o que você pedir na lista de tarefas${o.sync ? " e no TODO.md" : ""}`;
          const syncTip = `Sync: sincroniza as tarefas automaticamente em tempo real com o arquivo TODO.md do projeto`;
          return el.child(toggle("log", "Log", "mods/todos/log.svg", o.log, logTip, (cx) => this.setOpt(l.folder, "log", !o.log, cx)))
            .child(toggle("link", "Sync", "mods/todos/sync.svg", o.sync, syncTip, (cx) => this.setOpt(l.folder, "sync", !o.sync, cx)));
        }))
      .when(picks.length > 0, (el) => el.child(pickBar()))
      // Custom Card Filter Notification Banner
      .when(Boolean(this.customCardFilter !== null), (el) =>
        el.child(
          h_flex()
            .h(30)
            .px(12)
            .gap(8)
            .items_center()
            .bg(t.ansi4 + "15")
            .border_b(1)
            .border_color(t.ansi4 + "33")
            .child(svg("mods/todos/tag.svg").size(11).text_color(t.ansi4))
            .child(
              div()
                .text_size(11)
                .text_color(t.foreground)
                .child(`Filtro customizado ativo (${effectiveCards.length} ${effectiveCards.length === 1 ? "card" : "cards"})`),
            )
            .child(div().flex_1())
            .child(
              h_flex()
                .h(22)
                .px(7)
                .gap(4)
                .rounded(4)
                .cursor_pointer()
                .items_center()
                .bg(t.accent + "22")
                .border_1()
                .border_color(t.accent + "55")
                .hover((s) => s.bg(t.accent + "38"))
                .tooltip(`Restaurar visualização dos cards vinculados ao Space ${activeSpace?.name || ""}`)
                .on_click((_e, cx) => this.resetCardFilterToSpace(cx))
                .child(svg("mods/todos/star.svg").size(9).text_color(t.accent))
                .child(div().text_size(10.5).font_semibold().text_color(t.accent).child(`← Voltar para o Space (${activeSpace?.name || "Space"})`)),
            ),
        ),
      )
      // Agents don't know about the lists yet: one click sets them up.
      .when(!this.ruleOk, (el) => el.child(h_flex().id("todo-setup").mx(8).mb(4).px(10).py(6).gap(8).items_center().rounded(8).cursor_pointer()
        .bg(t.accent + "1f").hover((s) => s.bg(t.accent + "33")).text_size(12).text_color(t.foreground)
        .on_click((_e, cx) => this.setUpAgents(cx))
        .child(svg("mods/todos/bot.svg").size(13).flex_none().text_color(t.accent))
        .child(div().flex_1().min_w(0).child("Permitir que agentes mantenham estas tarefas"))
        .child(div().flex_none().text_size(11.5).text_color(t.accent).child("Configurar"))))
      .child(
        v_flex().id("todo-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8)
          // 1. If NO card is effective: require assigning or selecting a card!
          .when(effectiveCards.length === 0, (el) =>
            el.child(
              v_flex().id("todo-unassigned-card-prompt").size_full().items_center().justify_center().py(48).px(20).gap(12)
                .child(
                  div().size(44).rounded(22).bg(t.ansi3 + "1f").border_1().border_color(t.ansi3 + "55")
                    .flex().items_center().justify_center()
                    .child(svg("mods/todos/tag.svg").size(20).text_color(t.ansi3))
                )
                .child(div().font_bold().text_size(14).text_color(t.foreground).child("Nenhum Card / Grupo selecionado"))
                .child(
                  div().text_size(12).text_color(t.muted).text_center().max_w(340)
                    .child("Vincule um Card ao Space ou use o gerenciador de cards para visualizar tarefas de qualquer grupo do projeto.")
                )
                .child(
                  h_flex().gap(8)
                    .child(
                      h_flex().id("btn-prompt-assign-card").h(32).px(12).rounded(7).cursor_pointer().items_center().gap(5)
                        .bg(t.accent).hover((s) => s.opacity(0.88))
                        .on_click((_e, _cx) => {
                          const s = spaces().find((x) => x.active);
                          if (s) {
                            openOverlay({ mod: "space-card", kind: "dialog", width: 460, height: 420, props: { space: s.id, folder: s.folder } });
                          }
                        })
                        .child(svg("mods/todos/star.svg").size(12).text_color("#ffffff"))
                        .child(div().text_size(12).font_semibold().text_color("#ffffff").child("Vincular ao Space")),
                    )
                    .child(
                      h_flex().id("btn-prompt-browse-cards").h(32).px(12).rounded(7).cursor_pointer().items_center().gap(5)
                        .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
                        .on_click((_e, cx) => this.openCardFilterModal(cx))
                        .child(svg("mods/todos/tag.svg").size(12).text_color(t.ansi4))
                        .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Buscar outros Cards")),
                    ),
                )
            )
          )
          // 2. If card(s) are effective:
          .when(effectiveCards.length > 0, (el) =>
            el
              .when(effectiveCards.length > 1, (groupEl) =>
                groupEl.children(cardGroups.map(renderCardGroup))
              )
              .when(effectiveCards.length === 1, (singleEl) =>
                singleEl.children(list.flatMap(withStarter))
              )
              .when(!list.length && !done.length, (emptyEl) =>
                emptyEl.child(
                  v_flex().size_full().items_center().justify_center().py(36).px(16).gap(10)
                    .child(
                      div().size(40).rounded(20).bg(t.raised).border_1().border_color(t.border)
                        .flex().items_center().justify_center()
                        .child(svg("mods/todos/star.svg").size(18).text_color(t.accent))
                    )
                    .child(div().font_semibold().text_size(13).text_color(t.foreground).child(`Nenhuma tarefa para ${effectiveCards.map(c => "#" + c).join(", ")}`))
                    .child(div().text_size(11.5).text_color(t.dim).child("Crie a primeira tarefa deste Card"))
                    .child(
                      h_flex().h(28).px(12).rounded(6).cursor_pointer().items_center().gap(5)
                        .bg(t.accent + "22").border_1().border_color(t.accent + "55")
                        .hover((s) => s.bg(t.accent + "33"))
                        .on_click((_e, cx) => this.openCreateModal(cx))
                        .child(svg("mods/workspace-chrome/plus.svg").size(11).text_color(t.accent))
                        .child(div().text_size(11.5).font_semibold().text_color(t.accent).child(`+ Nova Tarefa em #${effectiveCards[0]}`))
                    )
                )
              )
              .when(!list.length && done.length > 0, (emptyEl) =>
                emptyEl.child(
                  div().px(8).py(10).text_size(12).text_color(t.dim).child(`Todas as tarefas de ${effectiveCards.map(c => "#" + c).join(", ")} foram concluídas!`)
                )
              )
              .when(fromFile.items.length > 0, (fileEl) => fileEl
                .child(section("file", `Do arquivo ${fromFile.file}`, fromFile.items.length, !this.fileFolded, () => { this.fileFolded = !this.fileFolded; },
                  div().id("take-all").px(5).rounded(4).cursor_pointer().hover((x) => x.bg(t.raised).text_color(t.foreground)).child("Adicionar todas")
                    .on_click((_e, cx) => { cx.stop_propagation(); this.take(focusFolder, fromFile.items, cx); })))
                .children(this.fileFolded ? [] : fromFile.items.flatMap((text, i) => [h_flex().id(`file-${i}`).min_h(30).px(8).gap(8).items_center().rounded(8).hover((x) => x.bg(t.hover))
                  .on_hover((on, cx) => { const k = `file:${i}`; this.hover = on ? k : this.hover === k ? null : this.hover; cx.notify(); })
                  .child(div().id(`take-${i}`).size(14).flex_none().rounded(7).border_1().border_color(t.input).cursor_pointer()
                    .flex().items_center().justify_center().hover((x) => x.border_color(this.color(focusFolder, t)))
                    .child(svg("mods/workspace-chrome/plus.svg").size(9).text_color(t.muted))
                    .on_click((_e, cx) => this.take(focusFolder, [text], cx)))
                  .child(div().flex_1().min_w(0).text_size(13).line_height("18px").text_color(t.muted).when(this.hover !== `file:${i}`, (fel) => fel.truncate()).when(this.hover === `file:${i}`, (fel) => fel.whitespace_normal().py(5)).child(text))
                  .when((this.hover === `file:${i}` || this.startFor === `file:${i}`) && this.agentChoices.length > 0, (fel) => fel.child(div().id(`fstart-${i}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
                    .when(this.startFor === `file:${i}`, (fel2) => fel2.bg(t.selected))
                    .hover((x) => x.bg(t.raised)).on_click((_e, cx) => { this.pickOpen = false; this.startFor = this.startFor === `file:${i}` ? null : `file:${i}`; cx.notify(); })
                    .child(svg("mods/todos/bot.svg").size(12).text_color(t.muted))))
                  .when(this.hover === `file:${i}`, (fel) => fel.child(div().id(`skip-${i}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
                    .hover((x) => x.bg(t.raised)).tooltip(`Remover de ${fromFile.file ?? "TODO.md"}`).on_click((_e, cx) => this.dropFromFile(focusFolder, text, cx))
                    .child(svg("mods/workspace-chrome/x.svg").size(11).text_color(t.muted)))),
                  ...(this.startFor === `file:${i}` ? [starter({ text, folder: focusFolder }, (a, cx, running) => this.startFromFile(a, focusFolder, text, cx, running))] : [])])))
              .when(done.length > 0, (doneEl) => doneEl
                .child(section("done", "Concluídas", done.length, !this.doneFolded, () => { this.doneFolded = !this.doneFolded; },
                  div().id("done-clear").px(5).rounded(4).cursor_pointer().text_color(this.clearArmed ? t.ansi1 : t.dim).hover((s) => s.bg(t.raised).text_color(t.foreground))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      if (!this.clearArmed) { this.clearArmed = true; cx.spawn(async (cx) => { await cx.sleep(3000); this.clearArmed = false; cx.notify(); }); }
                      else { this.clearArmed = false; for (const slug of new Set(done.map((x) => x.slug))) this.change(slug, (items) => items.filter((y) => !y.done), cx); }
                      cx.notify();
                    })
                    .child(this.clearArmed ? `Limpar ${done.length}?` : "Limpar")))
                .children(this.doneFolded ? [] : done.slice(0, this.doneShown ?? 5).map(row))
                .when(!this.doneFolded && done.length > 5, (doneEl2) => doneEl2.child(h_flex().mx(4).mt(2).gap(2)
                  .when(done.length > (this.doneShown ?? 5), (moreEl) => moreEl.child(more("done-more", `Mostrar mais ${Math.min(10, done.length - (this.doneShown ?? 5))}`, () => { this.doneShown = (this.doneShown ?? 5) + 10; })))
                  .when((this.doneShown ?? 5) > 5, (lessEl) => lessEl.child(more("done-less", "Mostrar menos", () => { this.doneShown = 5; }))))))
          )
        )
      )
      .when(Boolean(this.cardDropdownOpen), (el) => el.child(this.renderCardDropdown(t, cx, activeSpace, linkedCards)))
      .when(Boolean(this.showCardFilterModal), (el) => el.child(this.renderCardFilterModal(t, cx)))
      .when(Boolean(this.showCreateModal), (el) => el.child(this.renderCreateModal(t, cx)))
      .when(Boolean(!this.showCreateModal && !this.showCardFilterModal && this.detailTask && this.lists[this.detailTask.slug]?.items?.[this.detailTask.i]), (el) => el.child(this.renderDetailModal(t, cx)));
  }
}
