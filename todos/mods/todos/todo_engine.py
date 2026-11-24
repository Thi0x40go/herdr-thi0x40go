#!/usr/bin/env python3
"""
Herdr To-do Engine (v2)
Modern task parser and manager with support for:
- YAML Frontmatter & Rich Metadata (group, priority, tags, assignee, due, status)
- Nested Subtasks (- [ ] / - [x]) with progress tracking
- Multi-line Markdown Descriptions
- JSON serialization for Herdr UI
- Shell-friendly ANSI coloring
"""

import sys
import os
import re
import json
from pathlib import Path
from datetime import datetime

# Regex patterns
RE_FOLDER = re.compile(r"^<!--\s*folder:\s*(.*?)\s*-->$")
RE_FLAG = re.compile(r"^<!--\s*(log|sync):\s*(on|off)\s*-->$")
RE_TASK = re.compile(r"^(\s*)-\s*\[([ xX~-])\]\s*(.*)$")
RE_META_COMMENT = re.compile(r"<!--\s*(meta|info|props):\s*(\{.*?\})\s*-->")
RE_DUE = re.compile(r"<!--\s*due:\s*([^>]+?)\s*-->")
RE_DONE = re.compile(r"<!--\s*done:\s*([^>]+?)\s*-->")
RE_DESC_START = re.compile(r"^(\s*)<!--\s*desc:\s*$")
RE_DESC_END = re.compile(r"^(\s*)-->$")
RE_TAG = re.compile(r"(?:^|\s)#([a-zA-Z0-9_-]+)")
RE_CARD = re.compile(r"\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b", re.IGNORECASE)
RE_PRIO = re.compile(r"(?:^|\s)!(critical|high|medium|med|low|urgent|crit|p0|p1|p2|p3)\b", re.IGNORECASE)
RE_ASSIGNEE = re.compile(r"(?:^|\s)@([a-zA-Z0-9_-]+)\b")

PRIORITY_MAP = {
    "p0": "Critical", "urgent": "Critical", "critical": "Critical", "crit": "Critical",
    "p1": "High", "high": "High",
    "p2": "Medium", "medium": "Medium", "med": "Medium",
    "p3": "Low", "low": "Low"
}

# ANSI Colors for terminal output
USE_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
CLR_RESET = "\033[0m" if USE_COLOR else ""
CLR_DIM = "\033[2m" if USE_COLOR else ""
CLR_BOLD = "\033[1m" if USE_COLOR else ""
CLR_RED = "\033[1;31m" if USE_COLOR else ""
CLR_YELLOW = "\033[1;33m" if USE_COLOR else ""
CLR_BLUE = "\033[1;34m" if USE_COLOR else ""
CLR_GRAY = "\033[0;37m" if USE_COLOR else ""
CLR_GREEN = "\033[0;32m" if USE_COLOR else ""
CLR_CYAN = "\033[0;36m" if USE_COLOR else ""
CLR_MAGENTA = "\033[0;35m" if USE_COLOR else ""

def format_priority(prio):
    if not prio:
        return ""
    p = str(prio).strip().capitalize()
    if p in ("Critical", "P0"):
        return f"{CLR_RED}[Critical]{CLR_RESET}"
    elif p in ("High", "P1"):
        return f"{CLR_YELLOW}[High]{CLR_RESET}"
    elif p in ("Medium", "P2"):
        return f"{CLR_BLUE}[Medium]{CLR_RESET}"
    elif p in ("Low", "P3"):
        return f"{CLR_GRAY}[Low]{CLR_RESET}"
    return f"{CLR_DIM}[{prio}]{CLR_RESET}"
class Task:
    def __init__(self, raw_text="", status="todo", indent=0):
        self.raw_text = raw_text
        self.status = status  # todo, done, doing
        self.indent = indent
        self.subtasks = []
        self.description = ""
        self.group = None
        self.priority = None
        self.tags = []
        self.assignee = None
        self.urls = []
        self.due = None
        self.done_at = None
        self.clean_title = ""
        if raw_text:
            self.parse_metadata()

    def parse_metadata(self):
        text = self.raw_text

        # Extract due & done comments
        m_due = RE_DUE.search(text)
        if m_due:
            self.due = m_due.group(1).strip()
            text = text.replace(m_due.group(0), "")

        m_done = RE_DONE.search(text)
        if m_done:
            self.done_at = m_done.group(1).strip()
            text = text.replace(m_done.group(0), "")

        # Extract meta json if present
        m_meta = RE_META_COMMENT.search(text)
        if m_meta:
            raw_meta = m_meta.group(2)
            try:
                meta = json.loads(raw_meta)
            except Exception:
                meta = {}
                pairs = re.findall(r'([a-zA-Z0-9_-]+)\s*:\s*([^,}]+|\[.*?\])', raw_meta)
                for k, v in pairs:
                    v = v.strip().strip('"\'')
                    if v.startswith('[') and v.endswith(']'):
                        meta[k] = [x.strip().strip('"\'') for x in v[1:-1].split(',') if x.strip()]
                    else:
                        meta[k] = v
            self.group = meta.get("group") or self.group
            raw_p = meta.get("priority") or self.priority
            if raw_p:
                self.priority = PRIORITY_MAP.get(str(raw_p).lower(), str(raw_p).capitalize())
            self.tags = meta.get("tags") or self.tags
            self.assignee = meta.get("assignee") or self.assignee
            if "urls" in meta:
                val = meta["urls"]
                if isinstance(val, dict):
                    for k, v in val.items():
                        self.urls.append({"name": str(k), "url": str(v)})
                elif isinstance(val, list):
                    for u in val:
                        if isinstance(u, dict):
                            self.urls.append(u)
                        elif isinstance(u, str):
                            self.urls.append({"name": "link", "url": u})
            elif "url" in meta:
                self.urls.append({"name": "link", "url": str(meta["url"])})
            text = text.replace(m_meta.group(0), "")

        # Extract markdown links: [text](https://...)
        for m in re.finditer(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', text):
            lname, lurl = m.group(1), m.group(2)
            if not any(x.get("url") == lurl for x in self.urls):
                self.urls.append({"name": lname, "url": lurl})

        # Extract standalone URLs: https://...
        for m in re.finditer(r'(?<!\()(https?://[^\s)]+)', text):
            lurl = m.group(1)
            if not any(x.get("url") == lurl for x in self.urls):
                domain = re.sub(r'^https?://(?:www\.)?', '', lurl).split('/')[0]
                self.urls.append({"name": domain or "link", "url": lurl})

        # Extract [CARD-XXXX] or [TASK-XXXX] or EVAH-XXXX
        m_card = RE_CARD.search(text)
        if m_card and not self.group:
            self.group = f"{m_card.group(1).upper()}-{m_card.group(2)}"

        # Extract !p0, !p1, etc.
        m_prio = RE_PRIO.search(text)
        if m_prio:
            self.priority = PRIORITY_MAP.get(m_prio.group(1).lower())
            text = text.replace(m_prio.group(0), " ")

        # Extract #tag
        for m in RE_TAG.finditer(text):
            tag = m.group(1).lower()
            if tag.upper().startswith("CARD-") or tag.upper().startswith("TASK-"):
                if not self.group:
                    self.group = tag.upper()
            else:
                if tag not in self.tags:
                    self.tags.append(tag)

        # Extract @assignee
        m_ass = RE_ASSIGNEE.search(text)
        if m_ass and not self.assignee:
            self.assignee = f"@{m_ass.group(1)}"

        # Strip extra whitespace and comment remnants
        text = re.sub(r"\s*<!--.*?-->\s*", " ", text)
        self.clean_title = " ".join(text.split()).strip()

    def to_dict(self, index=None):
        return {
            "index": index,
            "title": self.clean_title or self.raw_text,
            "status": self.status,
            "done": self.status == "done",
            "group": self.group,
            "priority": self.priority,
            "tags": self.tags,
            "urls": self.urls,
            "assignee": self.assignee,
            "due": self.due,
            "done_at": self.done_at,
            "description": self.description.strip(),
            "subtasks": [
                {
                    "index": f"{index}.{i+1}" if index is not None else str(i+1),
                    "title": s.clean_title or s.raw_text,
                    "done": s.status == "done",
                    "status": s.status,
                    "done_at": s.done_at
                }
                for i, s in enumerate(self.subtasks)
            ]
        }

class ProjectTodoList:
    def __init__(self, filepath):
        self.filepath = Path(filepath)
        self.folder = ""
        self.flags = {"log": "off", "sync": "off"}
        self.tasks = []
        self.load()

    def load(self):
        self.tasks = []
        if not self.filepath.is_file():
            return

        with open(self.filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()

        current_task = None
        in_desc = False
        desc_lines = []

        start_idx = 0
        if lines and lines[0].strip() == "---":
            for i in range(1, len(lines)):
                if lines[i].strip() == "---":
                    start_idx = i + 1
                    break
                line_str = lines[i].rstrip("\r\n")
                if ":" in line_str:
                    k, v = line_str.split(":", 1)
                    k, v = k.strip(), v.strip().strip('"\'')
                    if k == "folder":
                        self.folder = v
                    elif k in ("log", "sync"):
                        self.flags[k] = v

        for line in lines[start_idx:]:
            raw = line.rstrip("\r\n")

            # Check folder
            m_f = RE_FOLDER.match(raw.strip())
            if m_f:
                self.folder = m_f.group(1).strip()
                continue

            # Check flags
            m_flag = RE_FLAG.match(raw.strip())
            if m_flag:
                self.flags[m_flag.group(1)] = m_flag.group(2)
                continue

            # Check description block
            if in_desc:
                if RE_DESC_END.match(raw):
                    in_desc = False
                    if current_task:
                        current_task.description = "\n".join(desc_lines)
                    desc_lines = []
                else:
                    desc_lines.append(raw)
                continue

            if RE_DESC_START.match(raw):
                in_desc = True
                desc_lines = []
                continue

            # Check task or subtask
            m_t = RE_TASK.match(raw)
            if m_t:
                indent = len(m_t.group(1))
                mark = m_t.group(2)
                text = m_t.group(3)
                status = "done" if mark in ("x", "X") else ("doing" if mark == "-" else "todo")

                new_item = Task(text, status=status, indent=indent)

                if indent >= 2 and current_task:
                    # Subtask of current_task
                    current_task.subtasks.append(new_item)
                else:
                    # Top-level task
                    current_task = new_item
                    self.tasks.append(current_task)

    def save(self):
        self.filepath.parent.mkdir(parents=True, exist_ok=True)
        lines = ["---"]
        if self.folder:
            lines.append(f"folder: {self.folder}")
        for k, v in sorted(self.flags.items()):
            lines.append(f"{k}: {v}")
        lines.append("---")

        for t in self.tasks:
            mark = "x" if t.status == "done" else ("-" if t.status == "doing" else " ")
            meta_dict = {}
            if t.group:
                meta_dict["group"] = t.group
            if t.priority:
                meta_dict["priority"] = t.priority
            if t.tags:
                meta_dict["tags"] = t.tags
            if t.assignee:
                meta_dict["assignee"] = t.assignee
            if t.urls:
                meta_dict["urls"] = t.urls

            title = t.clean_title
            extra_meta = f" <!-- meta: {json.dumps(meta_dict, ensure_ascii=False)} -->" if meta_dict else ""
            due_meta = f" <!-- due: {t.due} -->" if t.due else ""
            done_meta = f" <!-- done: {t.done_at} -->" if t.done_at else ""

            lines.append(f"- [{mark}] {title}{extra_meta}{due_meta}{done_meta}")

            if t.description:
                lines.append("  <!-- desc:")
                for dline in t.description.strip().split("\n"):
                    lines.append(f"  {dline}")
                lines.append("  -->")

            for sub in t.subtasks:
                s_mark = "x" if sub.status == "done" else ("-" if sub.status == "doing" else " ")
                s_title = sub.clean_title or sub.raw_text
                s_done = f" <!-- done: {sub.done_at} -->" if sub.done_at else ""
                lines.append(f"  - [{s_mark}] {s_title}{s_done}")

        tmp = self.filepath.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        tmp.replace(self.filepath)

def get_list_path(folder=None):
    base_dir = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")) / "herdr" / "todos"
    if not base_dir.exists():
        legacy_dir = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")) / "over9k" / "todos"
        if legacy_dir.exists():
            base_dir = legacy_dir

    if not folder:
        try:
            import subprocess
            out = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], stderr=subprocess.DEVNULL).decode().strip()
            folder = out or os.getcwd()
        except Exception:
            folder = os.getcwd()

    slug = re.sub(r"[^A-Za-z0-9]+", "-", folder).strip("-")
    return base_dir / f"{slug}.md", folder

def cmd_list(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    if not p.tasks:
        print(f"No to-dos for {folder}")
        return

    # Optional filters
    group_filter = args.group.upper() if args.group else None
    tag_filter = args.tag.lower() if args.tag else None
    prio_filter = args.priority.upper() if args.priority else None

    count = 0
    for i, t in enumerate(p.tasks, 1):
        if group_filter and (t.group or "").upper() != group_filter:
            continue
        if tag_filter and tag_filter not in [x.lower() for x in t.tags]:
            continue
        if prio_filter and (t.priority or "").upper() != prio_filter:
            continue

        count += 1
        box = f"{CLR_GREEN}x{CLR_RESET}" if t.status == "done" else ("-" if t.status == "doing" else " ")
        prio_badge = f" {format_priority(t.priority)}" if t.priority else ""
        group_badge = f" {CLR_CYAN}[{t.group}]{CLR_RESET}" if t.group and t.group not in t.clean_title else ""
        
        sub_progress = ""
        if t.subtasks:
            done_cnt = sum(1 for s in t.subtasks if s.status == 'done')
            color = CLR_GREEN if done_cnt == len(t.subtasks) else CLR_DIM
            sub_progress = f" {color}({done_cnt}/{len(t.subtasks)}){CLR_RESET}"

        due_str = f" {CLR_YELLOW}(due {t.due}){CLR_RESET}" if t.due else ""
        done_str = f" {CLR_DIM}(done {t.done_at}){CLR_RESET}" if t.done_at else ""

        print(f"{i:3d}. [{box}]{prio_badge}{group_badge} {t.clean_title}{sub_progress}{due_str}{done_str}")

        if args.show_subtasks:
            for si, sub in enumerate(t.subtasks, 1):
                sbox = f"{CLR_GREEN}x{CLR_RESET}" if sub.status == "done" else " "
                sdone = f" {CLR_DIM}(done {sub.done_at}){CLR_RESET}" if sub.done_at else ""
                print(f"     {i}.{si} [{sbox}] {sub.clean_title}{sdone}")

    if count == 0:
        print(f"No matching to-dos in {folder}")

def cmd_show(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    try:
        idx = int(args.target) - 1
        t = p.tasks[idx]
    except Exception:
        print(f"Item #{args.target} not found", file=sys.stderr)
        sys.exit(1)

    print("=" * 60)
    print(f"Task #{idx+1}: {t.clean_title}")
    print(f"Status:   {t.status.upper()}")
    if t.group:
        print(f"Group:    {t.group}")
    if t.priority:
        print(f"Priority: {t.priority}")
    if t.tags:
        print(f"Tags:     {', '.join(t.tags)}")
    if t.assignee:
        print(f"Assignee: {t.assignee}")
    if t.urls:
        print(f"URLs:")
        for u in t.urls:
            print(f"  - {CLR_CYAN}{u.get('name', 'link')}{CLR_RESET}: {u.get('url', '')}")
    if t.due:
        print(f"Due Date: {t.due}")
    if t.done_at:
        print(f"Done At:  {t.done_at}")

    if t.description:
        print("-" * 60)
        print("Description:")
        print(t.description)

    if t.subtasks:
        print("-" * 60)
        done_cnt = sum(1 for s in t.subtasks if s.status == "done")
        print(f"Subtasks ({done_cnt}/{len(t.subtasks)}):")
        for si, s in enumerate(t.subtasks, 1):
            sbox = "x" if s.status == "done" else " "
            sdone = f" (done {s.done_at})" if s.done_at else ""
            print(f"  {idx+1}.{si} [{sbox}] {s.clean_title}{sdone}")
    print("=" * 60)

def cmd_add(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    if not p.folder:
        p.folder = folder

    if not args.text:
        print("usage: todo add <text>", file=sys.stderr)
        sys.exit(2)

    t = Task(" ".join(args.text))
    if args.group:
        t.group = args.group.upper()
    if args.priority:
        t.priority = PRIORITY_MAP.get(args.priority.lower(), args.priority.capitalize())
    if args.tags:
        for tg in args.tags.split(","):
            tg = tg.strip().lstrip("#")
            if tg and tg not in t.tags:
                t.tags.append(tg)
    if args.assignee:
        t.assignee = f"@{args.assignee.lstrip('@')}"
    if args.due:
        t.due = args.due
    if args.url:
        t.urls.append({"name": "link", "url": args.url})
    if args.urls:
        for pair in args.urls.split(","):
            if "=" in pair:
                k, v = pair.split("=", 1)
                t.urls.append({"name": k.strip(), "url": v.strip()})
            else:
                t.urls.append({"name": "link", "url": pair.strip()})
    if args.desc:
        t.description = args.desc

    p.tasks.append(t)
    p.save()
    print(f"Added to {folder}: {t.clean_title} (#{len(p.tasks)})")

def cmd_sub(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    try:
        idx = int(args.parent) - 1
        parent_task = p.tasks[idx]
    except Exception:
        print(f"Parent task #{args.parent} not found", file=sys.stderr)
        sys.exit(1)

    sub = Task(" ".join(args.text))
    parent_task.subtasks.append(sub)
    p.save()
    print(f"Added subtask {idx+1}.{len(parent_task.subtasks)} to #{idx+1}: {sub.clean_title}")

def cmd_done(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    target = args.target

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Check if subtask notation: "1.2"
    if re.match(r"^\d+\.\d+$", target):
        parts = target.split(".", 1)
        try:
            pidx, sidx = int(parts[0]) - 1, int(parts[1]) - 1
            sub = p.tasks[pidx].subtasks[sidx]
            sub.status = "done"
            sub.done_at = now_str
            p.save()
            print(f"Done: {parts[0]}.{parts[1]} ({sub.clean_title})")
            return
        except Exception:
            print(f"Subtask {target} not found", file=sys.stderr)
            sys.exit(1)

    # Top-level task by number or text
    try:
        idx = int(target) - 1
        t = p.tasks[idx]
    except ValueError:
        t = next((x for x in p.tasks if x.clean_title.lower() == target.lower()), None)
        if not t:
            print(f"No item matching \"{target}\"", file=sys.stderr)
            sys.exit(1)

    t.status = "done"
    t.done_at = now_str
    p.save()
    print(f"Done: {t.clean_title}")

def cmd_undo(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    target = args.target

    # Check if subtask notation: "1.2"
    if re.match(r"^\d+\.\d+$", target):
        parts = target.split(".", 1)
        try:
            pidx, sidx = int(parts[0]) - 1, int(parts[1]) - 1
            sub = p.tasks[pidx].subtasks[sidx]
            sub.status = "todo"
            sub.done_at = None
            p.save()
            print(f"Undone: {parts[0]}.{parts[1]} ({sub.clean_title})")
            return
        except Exception:
            print(f"Subtask {target} not found", file=sys.stderr)
            sys.exit(1)

    try:
        idx = int(target) - 1
        t = p.tasks[idx]
    except ValueError:
        t = next((x for x in p.tasks if x.clean_title.lower() == target.lower()), None)
        if not t:
            print(f"No item matching \"{target}\"", file=sys.stderr)
            sys.exit(1)

    t.status = "todo"
    t.done_at = None
    p.save()
    print(f"Undone: {t.clean_title}")

def cmd_rm(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    target = args.target

    if re.match(r"^\d+\.\d+$", target):
        parts = target.split(".", 1)
        try:
            pidx, sidx = int(parts[0]) - 1, int(parts[1]) - 1
            sub = p.tasks[pidx].subtasks.pop(sidx)
            p.save()
            print(f"Deleted subtask {parts[0]}.{parts[1]}: {sub.clean_title}")
            return
        except Exception:
            print(f"Subtask {target} not found", file=sys.stderr)
            sys.exit(1)

    try:
        idx = int(target) - 1
        t = p.tasks.pop(idx)
        p.save()
        print(f"Deleted #{target}: {t.clean_title}")
    except Exception:
        print(f"Item #{target} not found", file=sys.stderr)
        sys.exit(1)

def cmd_clear(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    before = len(p.tasks)
    p.tasks = [t for t in p.tasks if t.status != "done"]
    p.save()
    print(f"Cleared {before - len(p.tasks)} completed task(s)")

def cmd_edit(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    target = args.target
    new_text = " ".join(args.text)

    if re.match(r"^\d+\.\d+$", target):
        parts = target.split(".", 1)
        try:
            pidx, sidx = int(parts[0]) - 1, int(parts[1]) - 1
            sub = p.tasks[pidx].subtasks[sidx]
            sub.raw_text = new_text
            sub.parse_metadata()
            p.save()
            print(f"Updated subtask {parts[0]}.{parts[1]}: {sub.clean_title}")
            return
        except Exception:
            print(f"Subtask {target} not found", file=sys.stderr)
            sys.exit(1)

    try:
        idx = int(target) - 1
        t = p.tasks[idx]
    except ValueError:
        t = next((x for x in p.tasks if x.clean_title.lower() == target.lower()), None)
        if not t:
            print(f"No item matching \"{target}\"", file=sys.stderr)
            sys.exit(1)
        idx = p.tasks.index(t)

    t.raw_text = new_text
    t.parse_metadata()
    p.save()
    print(f"Updated #{idx+1}: {t.clean_title}")

def cmd_desc(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    try:
        idx = int(args.target) - 1
        t = p.tasks[idx]
    except Exception:
        print(f"Item #{args.target} not found", file=sys.stderr)
        sys.exit(1)

    t.description = " ".join(args.text)
    p.save()
    print(f"Updated description for #{idx+1}")

def cmd_json(args):
    path, folder = get_list_path(args.project)
    p = ProjectTodoList(path)
    res = {
        "folder": p.folder or folder,
        "flags": p.flags,
        "items": [t.to_dict(i+1) for i, t in enumerate(p.tasks)]
    }
    print(json.dumps(res, indent=2, ensure_ascii=False))

def get_spaces_cards_file():
    data_home = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return Path(data_home) / "herdr" / "spaces-cards.json"

def load_spaces_cards():
    p = get_spaces_cards_file()
    if not p.is_file():
        return {"spaces": {}, "folders": {}}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return {"spaces": {}, "folders": {}}
            data.setdefault("spaces", {})
            data.setdefault("folders", {})
            return data
    except Exception:
        return {"spaces": {}, "folders": {}}

def save_spaces_cards(data):
    p = get_spaces_cards_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def normalize_card(card):
    if not card:
        return ""
    c = str(card).strip().lstrip("#").strip()
    m = re.match(r"^([a-zA-Z]{2,8})[-_ ]?([0-9]{2,6})$", c, re.IGNORECASE)
    if m:
        return f"{m.group(1).upper()}-{m.group(2)}"
    return c.upper()

def cmd_space(args):
    folder = args.project or os.getcwd()
    folder = os.path.realpath(folder)
    sub = (args.action or "get").strip()
    card_arg = args.card

    if sub not in ("get", "link", "unlink", "list", "all", "json") and not card_arg:
        card_arg = sub
        sub = "link"

    data = load_spaces_cards()

    if sub in ("list", "all"):
        folders = data.get("folders", {})
        spaces = data.get("spaces", {})
        if not folders and not spaces:
            print("No linked cards found.")
            return
        if folders:
            print(f"{CLR_BOLD}Linked Folders/Worktrees:{CLR_RESET}")
            for f, c in sorted(folders.items()):
                print(f"  {CLR_CYAN}#{c}{CLR_RESET} -> {f}")
        if spaces:
            print(f"{CLR_BOLD}Linked Spaces:{CLR_RESET}")
            for s, c in sorted(spaces.items()):
                print(f"  {CLR_CYAN}#{c}{CLR_RESET} -> Space {s}")
        return

    if sub == "json":
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return

    if sub == "unlink":
        removed = False
        if folder in data.get("folders", {}):
            del data["folders"][folder]
            removed = True
        save_spaces_cards(data)
        if removed:
            print(f"{CLR_GREEN}Unlinked card from {folder}{CLR_RESET}")
        else:
            print(f"No card was linked to {folder}")
        return

    if sub == "link":
        if not card_arg:
            print("Usage: todo space link <CARD-ID> (e.g. todo space link CARD-2467)", file=sys.stderr)
            sys.exit(1)
        card = normalize_card(card_arg)
        data.setdefault("folders", {})[folder] = card
        save_spaces_cards(data)
        print(f"{CLR_GREEN}Linked {folder} -> {CLR_CYAN}#{card}{CLR_RESET}")
        return

    # sub == "get"
    card = data.get("folders", {}).get(folder)
    if not card:
        for f, c in data.get("folders", {}).items():
            if folder == f or folder.startswith(f + "/"):
                card = c
                break
    if card:
        print(f"{CLR_BOLD}Space Card:{CLR_RESET} {CLR_CYAN}#{card}{CLR_RESET} ({folder})")
    else:
        print(f"No card linked to {folder}")
        print(f"To link: {CLR_DIM}todo space link <CARD-ID>{CLR_RESET}")

def get_queue_file():
    data_home = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return Path(data_home) / "herdr" / "todos" / "queue.json"

def load_queue():
    p = get_queue_file()
    if not p.is_file():
        return {"items": []}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return {"items": []}
            data.setdefault("items", [])
            return data
    except Exception:
        return {"items": []}

def save_queue(data):
    p = get_queue_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def cmd_queue(args):
    action = (args.action or "list").strip().lower()
    target = args.target

    if action not in ("list", "ls", "add", "push", "rm", "delete", "clear", "clean", "cron", "run", "json", "pop") and not target:
        target = action
        action = "add"

    queue = load_queue()

    if action in ("list", "ls"):
        items = queue.get("items", [])
        if not items:
            print(f"{CLR_DIM}A fila de tarefas está vazia.{CLR_RESET}")
            print(f"Para enfileirar: {CLR_CYAN}todo queue add <n>{CLR_RESET} ou {CLR_CYAN}todo queue add \"Minha tarefa\"{CLR_RESET}")
            return

        print(f"{CLR_BOLD}=== Fila de Tarefas dos Agentes ({len(items)}) ==={CLR_RESET}")
        for i, it in enumerate(items, 1):
            st = it.get("status", "queued")
            if st == "queued":
                st_badge = f"{CLR_YELLOW}[NA FILA]{CLR_RESET}"
            elif st in ("running", "dispatched"):
                st_badge = f"{CLR_GREEN}[DISPARADA]{CLR_RESET}"
            elif st == "done":
                st_badge = f"{CLR_CYAN}[CONCLUÍDA]{CLR_RESET}"
            else:
                st_badge = f"{CLR_DIM}[{st.upper()}]{CLR_RESET}"

            prio = it.get("priority")
            prio_str = f" {format_priority(prio)}" if prio else ""
            repo = it.get("repo") or (it.get("folder", "").split("/")[-1] if it.get("folder") else "")
            repo_str = f" {CLR_CYAN}({repo}){CLR_RESET}" if repo else ""
            space_lbl = it.get("space_name") or (it.get("space_id")[:8] if it.get("space_id") else "")
            space_str = f" {CLR_BLUE}[{space_lbl}]{CLR_RESET}" if space_lbl else ""
            target_term = it.get("terminal") or it.get("dispatched_to")
            agent_str = f" {CLR_BOLD}@{target_term}{CLR_RESET}" if target_term else ""

            print(f"{i:2d}. {st_badge}{prio_str} {it.get('text', '')}{repo_str}{space_str}{agent_str}")
            if it.get("description"):
                lines = it["description"].strip().split("\n")
                first = lines[0][:80]
                print(f"     {CLR_DIM}Desc: {first}...{CLR_RESET}")
            if it.get("subtasks"):
                subs = it["subtasks"]
                print(f"     {CLR_DIM}Subtarefas ({len(subs)}): {', '.join(subs[:3])}{'...' if len(subs) > 3 else ''}{CLR_RESET}")
        return

    if action == "json":
        print(json.dumps(queue, indent=2, ensure_ascii=False))
        return

    if action in ("add", "push"):
        if not target:
            print("Uso: todo queue add <numero_da_task_ou_texto>", file=sys.stderr)
            sys.exit(1)

        path, folder = get_list_path(args.project)
        p = ProjectTodoList(path)
        item_text = target
        item_desc = ""
        item_subs = []
        item_group = None
        item_prio = None
        item_repo = p.folder.split("/")[-1] if p.folder else "default"

        try:
            idx = int(target) - 1
            if 0 <= idx < len(p.tasks):
                task = p.tasks[idx]
                item_text = task.clean_title
                item_desc = task.description or ""
                item_subs = [s.clean_title for s in task.subtasks if not s.done]
                item_group = task.group
                item_prio = task.priority
                item_repo = getattr(task, "repo", None) or item_repo
            else:
                print(f"Tarefa #{target} não encontrada neste projeto.", file=sys.stderr)
                sys.exit(1)
        except ValueError:
            item_text = target

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        target_space_id = getattr(args, "space", None)
        target_space_name = getattr(args, "space_name", None)
        target_terminal = getattr(args, "terminal", None)
        target_agent = getattr(args, "agent", None)

        hc_id = os.environ.get("HC_TERMINAL_ID")
        if hc_id and not (target_space_id and target_terminal):
            try:
                term_path = Path(os.path.expanduser("~/.local/state/herdr-core/default/terminals.json"))
                if term_path.is_file():
                    with open(term_path, "r", encoding="utf-8") as tf:
                        tdata = json.load(tf)
                    for _, tt in tdata.get("terminals", {}).items():
                        if tt.get("address") == hc_id:
                            if not target_terminal:
                                target_terminal = hc_id
                            if not target_space_id:
                                target_space_id = (tt.get("labels") or {}).get("herdr.space")
                            if not target_space_name:
                                where_lbl = (tt.get("labels") or {}).get("where") or ""
                                target_space_name = where_lbl.split(" / ")[0] if where_lbl else None
                            if not target_agent:
                                target_agent = (tt.get("status") or {}).get("app") or (tt.get("foreground") or {}).get("name")
                            break
            except Exception:
                pass

        q_item = {
            "id": f"q-{int(datetime.now().timestamp()*1000)}",
            "text": item_text,
            "group": item_group,
            "priority": item_prio,
            "folder": p.folder or folder,
            "repo": item_repo,
            "space_id": target_space_id,
            "space_name": target_space_name,
            "terminal": target_terminal,
            "agent": target_agent,
            "description": item_desc,
            "subtasks": item_subs,
            "status": "queued",
            "created_at": now_str,
            "dispatched_at": None,
            "dispatched_to": None,
        }
        queue.setdefault("items", []).append(q_item)
        save_queue(queue)
        print(f"{CLR_GREEN}Tarefa enfileirada com sucesso!{CLR_RESET}")
        target_info = f" -> {target_space_name or target_space_id or ''} (@{target_terminal})" if (target_space_name or target_terminal) else ""
        print(f"  {CLR_BOLD}#{len(queue['items'])}:{CLR_RESET} {item_text} ({item_repo}){target_info}")
        return

    if action in ("rm", "delete"):
        if not target:
            print("Uso: todo queue rm <indice>", file=sys.stderr)
            sys.exit(1)
        try:
            q_idx = int(target) - 1
            items = queue.get("items", [])
            if 0 <= q_idx < len(items):
                removed = items.pop(q_idx)
                save_queue(queue)
                print(f"{CLR_GREEN}Removida da fila:{CLR_RESET} {removed.get('text')}")
                return
            else:
                print(f"Índice {target} não encontrado na fila.", file=sys.stderr)
                sys.exit(1)
        except ValueError:
            print(f"Índice inválido: {target}", file=sys.stderr)
            sys.exit(1)

    if action in ("clear", "clean"):
        before = len(queue.get("items", []))
        queue["items"] = [it for it in queue.get("items", []) if it.get("status") == "queued"]
        save_queue(queue)
        cleared = before - len(queue["items"])
        print(f"{CLR_GREEN}Limpeza concluída:{CLR_RESET} {cleared} tarefa(s) finalizada(s) removida(s) da fila.")
        return

    if action in ("cron", "run"):
        items = queue.get("items", [])
        queued_items = [it for it in items if it.get("status") == "queued"]
        if not queued_items:
            return

        terminals_path = Path(os.path.expanduser("~/.local/state/herdr-core/default/terminals.json"))
        if not terminals_path.is_file():
            return

        try:
            with open(terminals_path, "r", encoding="utf-8") as fp:
                term_data = json.load(fp)
            terminals = term_data.get("terminals", {})
        except Exception as e:
            print(f"Erro lendo terminais: {e}", file=sys.stderr)
            return

        dispatched_count = 0
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        for item in queued_items:
            item_space_id = item.get("space_id")
            item_space_name = (item.get("space_name") or "").strip().upper()
            item_terminal = item.get("terminal")
            item_group = (item.get("group") or "").strip().upper()
            item_folder = (item.get("folder") or "").rstrip("/")

            # 1. Collect candidate terminals strictly for this Space / context
            space_terminals = []

            for tid, t in terminals.items():
                if not isinstance(t, dict):
                    continue
                if t.get("state") != "live":
                    continue

                t_addr = t.get("address") or f"t{tid}"
                labels = t.get("labels") or {}
                t_space = labels.get("herdr.space")
                t_where = (labels.get("where") or "").upper()
                t_cwd = (t.get("cwd") or "").rstrip("/")

                matched = False
                if item_terminal and t_addr == item_terminal:
                    matched = True
                elif item_space_id and t_space == item_space_id:
                    matched = True
                elif item_space_name and (item_space_name in t_where or t_where.startswith(item_space_name)):
                    matched = True
                elif item_group and item_group in t_where:
                    matched = True
                elif not item_space_id and not item_space_name and not item_terminal and not item_group:
                    # Strict folder match only when no space info was recorded
                    if item_folder and t_cwd == item_folder:
                        matched = True

                if matched:
                    space_terminals.append((t_addr, t))

            if not space_terminals:
                # No terminal in this space exists or is live right now - keep in queue and wait
                continue

            # 2. Check if any agent in this target space is actively WORKING
            is_space_working = False
            candidate = None

            for t_addr, t in space_terminals:
                st = t.get("status") or {}
                st_state = (st.get("state") or "").lower()
                fg = ((t.get("foreground") or {}).get("name") or "").lower()
                app = ((st.get("app") or "")).lower()

                # If Kiro/agent in this space is currently running a turn, wait!
                if st_state == "working":
                    is_space_working = True
                    break

                if st_state in ("idle", "done", "waiting"):
                    # If an exact terminal was specified, match directly:
                    if item_terminal and t_addr == item_terminal:
                        candidate = t_addr
                        break

                    # Check agent program filter if requested (case-insensitive)
                    item_ag = (item.get("agent") or "").strip().lower()
                    if item_ag:
                        match_ag = any(item_ag in val for val in (t_addr.lower(), (t.get("name") or "").lower(), app, fg) if val)
                        if not match_ag:
                            continue

                    # Prefer kiro or other autonomous agent over plain shell
                    if not candidate or "kiro" in app or "kiro" in fg or "antigravity" in app or "antigravity" in fg:
                        candidate = t_addr

            if is_space_working:
                # The agent in this space is still busy working on its current turn.
                # NEVER dispatch to another space! Wait until this agent becomes idle.
                continue

            if not candidate:
                # Target agent in this space is not idle/ready yet. Wait!
                continue

            # 3. Target is ready and in the exact current space!
            prompt_lines = [
                f"Trabalhe nesta tarefa da fila do projeto:",
                f"**{item.get('text')}**",
            ]
            if item.get("description"):
                prompt_lines.append(f"\nEspecificações / Detalhes:\n{item['description']}")
            if item.get("subtasks"):
                prompt_lines.append("\nSubtarefas:")
                for sub in item["subtasks"]:
                    prompt_lines.append(f"- [ ] {sub}")
            prompt_lines.append(f"\nAo concluir tudo, marque como finalizada executando: `todo done \"{item.get('text')}\"`")

            prompt_text = "\n".join(prompt_lines)

            import subprocess
            try:
                res = subprocess.run(
                    ["herdr-core", "send", "--if", "idle", candidate, prompt_text],
                    capture_output=True,
                    text=True,
                    timeout=15
                )
                if res.returncode == 0:
                    item["status"] = "dispatched"
                    item["dispatched_at"] = now_str
                    item["dispatched_to"] = candidate
                    dispatched_count += 1
                    print(f"[{now_str}] Disparada tarefa '{item['text']}' para terminal {candidate} no space {item.get('space_name') or item_space_id or ''}")
                else:
                    res2 = subprocess.run(
                        ["herdr-core", "send", candidate, prompt_text],
                        capture_output=True,
                        text=True,
                        timeout=15
                    )
                    if res2.returncode == 0:
                        item["status"] = "dispatched"
                        item["dispatched_at"] = now_str
                        item["dispatched_to"] = candidate
                        dispatched_count += 1
                        print(f"[{now_str}] Disparada tarefa '{item['text']}' para terminal {candidate} no space {item.get('space_name') or item_space_id or ''}")
            except Exception as e:
                print(f"Erro disparando para {candidate}: {e}", file=sys.stderr)

        if dispatched_count > 0:
            save_queue(queue)

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Herdr To-do Engine")
    parser.add_argument("-p", "--project", help="Target project/folder path")
    subparsers = parser.add_subparsers(dest="cmd")

    # list
    p_list = subparsers.add_parser("list")
    p_list.add_argument("-g", "--group", help="Filter by group (e.g. CARD-2467)")
    p_list.add_argument("-t", "--tag", help="Filter by tag")
    p_list.add_argument("--prio", "--priority", dest="priority", help="Filter by priority (p0-p3)")
    p_list.add_argument("-s", "--sub", "--show-subtasks", dest="show_subtasks", action="store_true", help="Display subtasks")
    p_list.add_argument("-v", "--verbose", action="store_true", help="Verbose list")

    # show
    p_show = subparsers.add_parser("show")
    p_show.add_argument("target", help="Task number (#1)")

    # add
    p_add = subparsers.add_parser("add")
    p_add.add_argument("text", nargs="*", help="Task text")
    p_add.add_argument("-g", "--group", help="Group/Card name")
    p_add.add_argument("--prio", "--priority", dest="priority", help="Priority (p0, p1, p2, p3)")
    p_add.add_argument("--tags", help="Comma-separated tags")
    p_add.add_argument("--assignee", help="Assignee (@agent)")
    p_add.add_argument("--due", help="Due date YYYY-MM-DD[ HH:MM]")
    p_add.add_argument("--url", help="URL link (e.g. https://gitlab.com/...)")
    p_add.add_argument("--urls", help="Key-value URLs (e.g. card=https://...,mr=https://...)")
    p_add.add_argument("--desc", help="Markdown description")

    # sub
    p_sub = subparsers.add_parser("sub")
    p_sub.add_argument("parent", help="Parent task number (e.g. 1)")
    p_sub.add_argument("text", nargs="+", help="Subtask text")

    # done
    p_done = subparsers.add_parser("done")
    p_done.add_argument("target", help="Task number or 1.2 for subtask")

    # undo
    p_undo = subparsers.add_parser("undo")
    p_undo.add_argument("target", help="Task number or 1.2 for subtask")

    # rm
    p_rm = subparsers.add_parser("rm")
    p_rm.add_argument("target", help="Task number or 1.2 for subtask")

    # clear
    subparsers.add_parser("clear")

    # edit
    p_edit = subparsers.add_parser("edit")
    p_edit.add_argument("target", help="Task number or 1.2 for subtask")
    p_edit.add_argument("text", nargs="+", help="New task or subtask text")

    # desc
    p_desc = subparsers.add_parser("desc")
    p_desc.add_argument("target", help="Task number")
    p_desc.add_argument("text", nargs="+", help="Description markdown")

    # json
    subparsers.add_parser("json")

    # space
    p_space = subparsers.add_parser("space")
    p_space.add_argument("action", nargs="?", default="get", help="Action (get, link, unlink, list, all, json) or Card ID")
    p_space.add_argument("card", nargs="?", help="Card ID when action is link")

    # queue
    p_queue = subparsers.add_parser("queue")
    p_queue.add_argument("action", nargs="?", default="list", help="Action (list, add, rm, clear, cron, json)")
    p_queue.add_argument("target", nargs="?", help="Task number, text, or queue index")
    p_queue.add_argument("--space", help="Target space ID")
    p_queue.add_argument("--space-name", help="Target space display name")
    p_queue.add_argument("--terminal", help="Target terminal address (e.g. t65)")
    p_queue.add_argument("--agent", help="Specific agent or terminal target (e.g. t15, kiro-cli)")

    args = parser.parse_args()
    if not args.cmd or args.cmd == "list":
        if not hasattr(args, "group"):
            args.group = None
            args.tag = None
            args.priority = None
            args.show_subtasks = True
            args.verbose = False
        cmd_list(args)
    elif args.cmd == "show":
        cmd_show(args)
    elif args.cmd == "add":
        cmd_add(args)
    elif args.cmd == "sub":
        cmd_sub(args)
    elif args.cmd == "done":
        cmd_done(args)
    elif args.cmd == "undo":
        cmd_undo(args)
    elif args.cmd == "rm":
        cmd_rm(args)
    elif args.cmd == "clear":
        cmd_clear(args)
    elif args.cmd == "edit":
        cmd_edit(args)
    elif args.cmd == "desc":
        cmd_desc(args)
    elif args.cmd == "json":
        cmd_json(args)
    elif args.cmd == "space":
        cmd_space(args)
    elif args.cmd == "queue":
        cmd_queue(args)

if __name__ == "__main__":
    main()
