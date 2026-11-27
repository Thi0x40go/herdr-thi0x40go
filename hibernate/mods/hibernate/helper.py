#!/usr/bin/env python3
import json
import os
import glob
import sys
import time
import subprocess
import shlex
import re
from pathlib import Path

HOME = Path.home()
DATA_DIR = HOME / ".config" / "herdr-app" / "data" / "hibernate"
STATE_FILE = DATA_DIR / "state.json"
ROLLING_FILE = DATA_DIR / "rolling.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)

def load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_json(path: Path, data: dict):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    tmp.replace(path)

def get_pids_tree(pid: int) -> set[int]:
    pids = {int(pid)}
    try:
        out = subprocess.check_output(["pgrep", "-P", str(pid)]).decode().split()
        for p in out:
            pids.add(int(p))
            try:
                for p2 in subprocess.check_output(["pgrep", "-P", str(p)]).decode().split():
                    pids.add(int(p2))
            except Exception:
                pass
    except Exception:
        pass
    return pids

def find_kiro_session(pid: int | None, cwd: str, argv: list[str] | None = None) -> str | None:
    # 1. Direct from argv
    if argv:
        for i, a in enumerate(argv):
            if a == "--resume-id" and i + 1 < len(argv):
                return argv[i + 1]
    # 2. From leases
    if pid:
        pids = get_pids_tree(pid)
        for f in glob.glob(str(HOME / ".kiro" / "session-leases" / "*.lease")):
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                if data.get("pid") in pids or data.get("parentPid") in pids:
                    return Path(f).stem
            except Exception:
                pass
    # 3. From workspace paths in session.json
    if cwd:
        cand = []
        for sjson in glob.glob(str(HOME / ".kiro" / "sessions" / "*" / "sess_*" / "session.json")):
            try:
                with open(sjson, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                paths = data.get("workspacePaths") or data.get("rootPaths") or []
                if cwd in paths:
                    cand.append((os.path.getmtime(sjson), Path(sjson).parent.name))
            except Exception:
                pass
        if cand:
            cand.sort(reverse=True)
            return cand[0][1]
    return None

def detect_agent(address: str) -> dict:
    try:
        raw = subprocess.check_output(["hc", "get", address, "--json"]).decode()
        data = json.loads(raw)
    except Exception as e:
        return {"address": address, "agent": None, "error": str(e)}

    fg = data.get("foreground") or {}
    fg_name = (fg.get("name") or data.get("agent") or "").lower()
    fg_pid = fg.get("pid")
    fg_argv = fg.get("argv") or []
    cwd = fg.get("cwd") or data.get("cwd") or str(HOME)
    labels = data.get("labels") or {}
    title = data.get("title") or ""

    # 1. Kiro CLI
    if "kiro" in fg_name or data.get("agent") == "kiro-cli" or "kiro.cmd" in labels:
        sess_id = find_kiro_session(fg_pid, cwd, fg_argv)
        if not sess_id and "kiro.cmd" in labels:
            m = re.search(r"--resume-id\s+([^\s]+)", labels["kiro.cmd"])
            if m:
                sess_id = m.group(1)
        if not sess_id and "kiro.session" in labels:
            sess_id = labels["kiro.session"]

        agent_mode = ""
        if "kiro.cmd" in labels:
            m = re.search(r"--agent\s+([^\s]+)", labels["kiro.cmd"])
            if m:
                agent_mode = f"--agent {m.group(1)} "

        resume_cmd = (
            f"kiro-cli chat --trust-all-tools --trust-workspace --v3 {agent_mode}--resume-id {sess_id}".strip()
            if sess_id
            else f"kiro-cli chat --trust-all-tools --trust-workspace --v3 {agent_mode}-r".strip()
        )
        return {
            "address": address,
            "agent": "kiro",
            "name": "Kiro",
            "pid": fg_pid,
            "cwd": cwd,
            "sessionId": sess_id,
            "stopCmd": "/quit",
            "resumeCmd": f"cd {shlex.quote(cwd)} && {resume_cmd}",
            "title": title,
            "space": labels.get("herdr.space"),
            "tab": labels.get("herdr.tab")
        }

    # 2. Claude Code
    if "claude" in fg_name:
        resume_cmd = "claude --permission-mode bypassPermissions --resume"
        return {
            "address": address,
            "agent": "claude",
            "name": "Claude Code",
            "pid": fg_pid,
            "cwd": cwd,
            "sessionId": None,
            "stopCmd": "/exit",
            "resumeCmd": f"cd {shlex.quote(cwd)} && {resume_cmd}",
            "title": title,
            "space": labels.get("herdr.space"),
            "tab": labels.get("herdr.tab")
        }

    # 3. Codex
    if "codex" in fg_name:
        resume_cmd = "codex resume --no-daemon"
        return {
            "address": address,
            "agent": "codex",
            "name": "Codex",
            "pid": fg_pid,
            "cwd": cwd,
            "sessionId": None,
            "stopCmd": "/quit",
            "resumeCmd": f"cd {shlex.quote(cwd)} && {resume_cmd}",
            "title": title,
            "space": labels.get("herdr.space"),
            "tab": labels.get("herdr.tab")
        }

    # 4. Antigravity
    if "antigravity" in fg_name or "agy" in fg_name or data.get("agent") == "antigravity":
        conv_id = None
        if fg_argv:
            for i, a in enumerate(fg_argv):
                if a in ("--conversation", "-c") and i + 1 < len(fg_argv):
                    conv_id = fg_argv[i + 1]
                    break
        if not conv_id and fg_pid:
            try:
                out = subprocess.check_output(f"ls -l /proc/{fg_pid}/fd 2>/dev/null", shell=True).decode()
                m = re.search(r"/conversations/([0-9a-f-]{36})\.db", out) or re.search(r"/presence/([0-9a-f-]{36})\.lock", out)
                if m:
                    conv_id = m.group(1)
            except Exception:
                pass
        if not conv_id:
            locks = glob.glob(str(HOME / ".gemini" / "antigravity-cli" / "presence" / "*.lock"))
            if locks:
                locks.sort(key=os.path.getmtime, reverse=True)
                conv_id = Path(locks[0]).stem

        resume_cmd = f"agy --conversation {conv_id}" if conv_id else "agy"
        return {
            "address": address,
            "agent": "antigravity",
            "name": "Antigravity",
            "pid": fg_pid,
            "cwd": cwd,
            "sessionId": conv_id,
            "stopCmd": "/exit",
            "resumeCmd": f"cd {shlex.quote(cwd)} && {resume_cmd}",
            "title": title,
            "space": labels.get("herdr.space"),
            "tab": labels.get("herdr.tab")
        }

    return {"address": address, "agent": None, "cwd": cwd}

def cmd_detect(address: str):
    info = detect_agent(address)
    print(json.dumps(info))

def cmd_sleep(address: str):
    state = load_json(STATE_FILE)
    info = detect_agent(address)
    if not info.get("agent"):
        if address in state:
            print(json.dumps({"ok": True, "alreadySleeping": True, "record": state[address]}))
            return
        print(json.dumps({"ok": False, "error": "No recognized agent running in this terminal"}))
        return

    record = {
        "address": address,
        "agent": info["agent"],
        "name": info["name"],
        "sessionId": info["sessionId"],
        "cwd": info["cwd"],
        "resumeCmd": info["resumeCmd"],
        "title": info["title"],
        "space": info.get("space"),
        "tab": info.get("tab"),
        "at": int(os.times().elapsed * 1000)
    }
    state[address] = record
    save_json(STATE_FILE, state)

    stop_cmd = info.get("stopCmd", "/quit")
    try:
        subprocess.run(["hc", "send", address, stop_cmd], check=True)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Failed to send stop command: {e}"}))
        return

    print(json.dumps({"ok": True, "action": "slept", "record": record}))

def cmd_wake(address: str):
    state = load_json(STATE_FILE)
    record = state.get(address)
    if not record:
        print(json.dumps({"ok": False, "error": f"Terminal {address} is not recorded as sleeping"}))
        return

    resume_cmd = record.get("resumeCmd")
    if not resume_cmd:
        print(json.dumps({"ok": False, "error": "Missing resume command in state"}))
        return

    try:
        subprocess.run(["hc", "send", address, resume_cmd], check=True)
        # Update label directly so Herdr reflects it
        if record.get("sessionId"):
            subprocess.run(["hc", "label", address, f"kiro.active=1", f"kiro.session={record['sessionId']}", f"kiro.cwd={record['cwd']}"], check=False)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Failed to send resume command: {e}"}))
        return

    state.pop(address, None)
    save_json(STATE_FILE, state)

    print(json.dumps({"ok": True, "action": "woken", "record": record}))

def cmd_auto_revive():
    """Checks kept terminals that fell back to idle shell after a restart/crash and revives them."""
    try:
        raw = subprocess.check_output(["hc", "ls", "--json"]).decode()
        ls_data = json.loads(raw)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return

    state = load_json(STATE_FILE)
    revived = []
    used_kiro_sessions = set()

    for t in ls_data.get("terminals", []):
        addr = t.get("address")
        if not addr or addr in state:
            continue  # Intentionally sleeping

        # Get full terminal info
        try:
            raw_t = subprocess.check_output(["hc", "get", addr, "--json"]).decode()
            info = json.loads(raw_t)
        except Exception:
            continue

        fg = info.get("foreground") or {}
        fg_name = fg.get("name") or ""
        labels = info.get("labels") or {}
        cwd = fg.get("cwd") or info.get("cwd") or str(HOME)

        # Terminal is alive but idle shell (e.g. zsh/bash/fish/sh/nu)
        if fg_name in ("zsh", "bash", "sh", "fish", "nu") and not info.get("agent"):
            # Check if it was previously running kiro
            if "kiro.cmd" in labels or "kiro.session" in labels:
                sess_id = labels.get("kiro.session")
                if not sess_id and "kiro.cmd" in labels:
                    m = re.search(r"--resume-id\s+([^\s]+)", labels["kiro.cmd"])
                    if m:
                        sess_id = m.group(1)
                if not sess_id or sess_id in used_kiro_sessions:
                    cand_id = find_kiro_session(None, cwd, None)
                    if cand_id and cand_id not in used_kiro_sessions:
                        sess_id = cand_id

                if sess_id:
                    used_kiro_sessions.add(sess_id)

                agent_mode = ""
                if "kiro.cmd" in labels:
                    m = re.search(r"--agent\s+([^\s]+)", labels["kiro.cmd"])
                    if m:
                        agent_mode = f"--agent {m.group(1)} "

                resume_cmd = (
                    f"kiro-cli chat --trust-all-tools --trust-workspace --v3 {agent_mode}--resume-id {sess_id}".strip()
                    if sess_id
                    else f"kiro-cli chat --trust-all-tools --trust-workspace --v3 {agent_mode}-r".strip()
                )
                full_cmd = f"cd {shlex.quote(cwd)} && {resume_cmd}"

                try:
                    # Clean line from any stray draft or incomplete typing
                    subprocess.run(["hc", "keys", addr, "ctrl+u"], check=False)
                    subprocess.run(["hc", "send", "--force", addr, full_cmd], check=True)
                    if sess_id:
                        subprocess.run(["hc", "label", addr, "kiro.active=1", f"kiro.session={sess_id}", f"kiro.cwd={cwd}"], check=False)
                    revived.append({"address": addr, "agent": "kiro", "cmd": full_cmd})
                    time.sleep(0.3)
                except Exception:
                    pass

            # Check if it was previously running antigravity
            elif labels.get("agent-sleep.agent") == "antigravity" or "antigravity" in str(labels) or "agy.cmd" in labels or "agy.active" in labels:
                conv_id = labels.get("agent-sleep") or labels.get("antigravity.session") or labels.get("agy.session")
                if not conv_id and "agy.cmd" in labels:
                    m = re.search(r"--conversation[=\s]+([^\s]+)", labels["agy.cmd"])
                    if m:
                        conv_id = m.group(1)
                if not conv_id:
                    locks = glob.glob(str(HOME / ".gemini" / "antigravity-cli" / "presence" / "*.lock"))
                    if locks:
                        locks.sort(key=os.path.getmtime, reverse=True)
                        conv_id = Path(locks[0]).stem

                cmd_to_run = labels.get("agy.cmd")
                if not cmd_to_run:
                    cmd_to_run = f"agy --conversation {conv_id}" if conv_id else "agy"

                full_cmd = f"cd {shlex.quote(cwd)} && {cmd_to_run}"
                try:
                    subprocess.run(["hc", "keys", addr, "ctrl+u"], check=False)
                    subprocess.run(["hc", "send", "--force", addr, full_cmd], check=True)
                    revived.append({"address": addr, "agent": "antigravity", "cmd": full_cmd})
                    time.sleep(0.3)
                except Exception:
                    pass

    print(json.dumps({"ok": True, "revived": revived}))

def cmd_list():
    state = load_json(STATE_FILE)
    print(json.dumps(state))

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: helper.py <detect|sleep|wake|list|auto-revive> [address]"}))
        return 1

    action = sys.argv[1]
    if action == "list":
        cmd_list()
    elif action == "auto-revive":
        cmd_auto_revive()
    elif action == "detect" and len(sys.argv) >= 3:
        cmd_detect(sys.argv[2])
    elif action == "sleep" and len(sys.argv) >= 3:
        cmd_sleep(sys.argv[2])
    elif action == "wake" and len(sys.argv) >= 3:
        cmd_wake(sys.argv[2])
    else:
        print(json.dumps({"error": f"Unknown or invalid command: {action}"}))
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
