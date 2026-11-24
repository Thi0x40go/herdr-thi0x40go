#!/bin/sh
# Per-project to-do lists, shared by people and agents (Herdr's To-do panel,
# mods/todos, shows and edits the same files).
#   todo                     this project's list, numbered (supports -g, -t, --prio, -s)
#   todo all                 every project's
#   todo show <n>            show details, description and subtasks
#   todo add <text…>         add to this project's (--due, -g, --prio, --tags, --desc)
#   todo sub <parent> <text> add a subtask to parent item
#   todo done|undo <n|p.s>   tick or untick item n or subtask p.s
#   todo edit <n|p.s> <new…> reword item n or subtask p.s
#   todo desc <n> <text…>    add or update markdown description
#   todo rm <n|p.s>          delete item n or subtask p.s
#   todo clear               delete the ticked ones
#   todo json                export project to-dos as JSON
#   todo space [get|link|unlink|list] manage space/worktree link to Card/Group
#   todo queue [list|add|rm|clear|cron] manage task queue and dispatch to agents
#   todo log [on|off]        this project: agents add what you ask for (default: Options › To-do)
#   todo sync [on|off]       this project: its TODO.md follows add/edit/rm (default: Options › To-do)
#   todo --rule on|off       add or remove the agents' to-do rule
# -p <folder> (first) picks the project; otherwise it's the git repo this runs in
# (its main checkout for a worktree), else this folder.
# Each list is ~/.local/share/herdr/todos/<slug>.md (DIR): a "<!-- folder: … -->"
# line, then "- [ ] text" / "- [x] text" lines (fine to edit by hand).
# Installed by Herdr's Options › To-do (or install.sh) as ~/.local/bin/todo, a
# small wrapper that runs this file.
set -e
# The agents' rule (Options › To-do turns it on and off), between markers so it
# can be taken out again exactly: in CLAUDE.md, Codex's and Pi's AGENTS.md.
if [ "${1:-}" = --rule ]; then
  for f in "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md" "$HOME/.pi/agent/AGENTS.md" "$HOME/.gemini/GEMINI.md" "$HOME/.kiro/steering/todo.md" "$HOME/.kiro/AGENTS.md"; do
    [ -d "$(dirname "$f")" ] || continue
    if [ -f "$f" ]; then
      tmp="$f.herdr.$$"
      sed '/<!-- \(over9k\|herdr\):todo -->/,/<!-- \/\(over9k\|herdr\):todo -->/d' "$f" | awk 'NF { for (; n > 0; n--) print ""; print; next } { n++ }' > "$tmp" && mv "$tmp" "$f"
      if [ "$f" = "$HOME/.kiro/steering/todo.md" ]; then
        sed -i '/---/,/---/d' "$f" 2>/dev/null || true
        sed -i '/./,$!d' "$f" 2>/dev/null || true
      fi
    fi
    [ "${2:-}" = on ] && {
      [ -s "$f" ] && printf '\n'
      if [ "$f" = "$HOME/.kiro/steering/todo.md" ]; then
        printf -- '---\ninclusion: always\nname: herdr-todos\ndescription: "Gerenciamento de tarefas do projeto sincronizado em tempo real com o Herdr"\ntools: [todo]\n---\n'
      else
        printf -- '---\nname: herdr-todos\ndescription: "Gerenciamento de tarefas do projeto sincronizado em tempo real com o Herdr"\ntools: [todo]\n---\n'
      fi
      cat <<'EOF'
<!-- herdr:todo -->
## Project to-do lists (Herdr)

Each project has a to-do list the user sees in Herdr's To-do panel and edits there
too. Use the `todo` command (it picks the project from the git repo you run it in):
- `todo` lists open & done items with indices, groups, priorities, and subtask counts
- `todo show <n>` shows full details (tags, urls, description, and subtasks)
- `todo add <text>` adds a task. Options:
  - `-g <CARD-ID>` or `[CARD-ID]`: groups task under a card (e.g. `-g CARD-2467`)
  - `--prio <p0..p3>` or `!p0`..`!p3`: priority (P0 urgent/critical, P1 high, P2 medium, P3 low)
  - `--url <url>` or `--urls "name=url,name2=url2"`: links MRs, task cards, PRDs or tickets
  - `--tags <tag1,tag2>`: categorization tags
  - `--assignee @user`: assign to an agent or user
  - `--due "YYYY-MM-DD[ HH:MM]"`: due date
  - `--desc "<markdown>"`: multi-line specification/description
- `todo sub <n> <text>`: adds a nested subtask to parent task <n>
- `todo done <n>`: marks task <n> as complete
- `todo done <p.s>`: marks subtask s of parent task p as complete (e.g. `todo done 16.2`)
- `todo undo <n|p.s>`: unticks a task or subtask
- `todo edit <n|p.s> <new text>`: rewords a task or subtask
- `todo desc <n> <text>`: updates the markdown description of task <n>
- `todo rm <n|p.s>`: deletes a task or subtask
- `todo json`: exports tasks and metadata as structured JSON
- `todo space [get|link <CARD>|unlink|list]`: views or links current space/worktree to Card/Group
- `todo queue [list|add <n>|rm <n>|clear|cron]`: manages task queue dispatched to idle agents
- `todo all`: shows every project's list

While request logging is on (`todo log` says on):
1. Add each task/feature/fix the user asks for as soon as you read it.
2. Group tasks by active Card/Issue (e.g. `-g CARD-XXXX`) and assign priority when relevant.
3. Link relevant URLs (e.g. `--url <ticket-or-MR-link>`) so they appear directly in Herdr.
4. For complex tasks, break them down into subtasks (`todo sub <n> <step>`).
5. Tick off items/subtasks (`todo done <n|p.s>`) immediately once completed and validated.
<!-- /herdr:todo -->
EOF
    } >> "$f"
  done
  exit 0
fi
# Where the lists live (the panel, main.js, uses the same folder).
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/herdr/todos"
[ -d "$DIR" ] || [ ! -d "${XDG_DATA_HOME:-$HOME/.local/share}/over9k/todos" ] || DIR="${XDG_DATA_HOME:-$HOME/.local/share}/over9k/todos"
# This script's own folder, through a symlink (todo-cross.py lives there).
SELF=$(readlink -f "$0" 2>/dev/null || printf %s "$0")
HERE=$(dirname "$SELF")
ENGINE="$HERE/todo_engine.py"
# Python 3 for todo-cross.py and todo_engine.py: python3, else python (as on Windows).
PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)
dir=$DIR
mkdir -p "$dir"
folder=""
if [ "$1" = "-p" ]; then folder=$(cd "$2" && pwd); shift 2; fi
if [ -z "$folder" ]; then
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  case "$common" in */.git) folder=${common%/.git} ;; *) folder=$(git rev-parse --show-toplevel 2>/dev/null || pwd) ;; esac
fi
folder=${folder%/}
# A project's Log or Sync: its own "<!-- log|sync: on|off -->" line, else the
# default todo-defaults ("log on", "sync off").
DEFAULTS="${XDG_DATA_HOME:-$HOME/.local/share}/herdr/todo-defaults"
[ -f "$DEFAULTS" ] || [ ! -f "${XDG_DATA_HOME:-$HOME/.local/share}/over9k/todo-defaults" ] || DEFAULTS="${XDG_DATA_HOME:-$HOME/.local/share}/over9k/todo-defaults"
opt() {
  v=$(sed -n "s/^<!-- $1: \(on\|off\) -->\$/\1/p" "$file" 2>/dev/null | head -n 1)
  [ -n "$v" ] || v=$(sed -n "s/^$1 \(on\|off\)\$/\1/p" "$DEFAULTS" 2>/dev/null | head -n 1)
  [ -n "$v" ] || { [ "$1" = log ] && v=on || v=off; }
  [ "$v" = on ]
}
# Sync on (`todo sync on`): the project's TODO.md follows add, edit and rm.
md() { [ -n "$PY" ] && opt sync && "$PY" -I "$HERE/todo-cross.py" "$folder" "$@" 2>/dev/null || true; }
slug=$(printf %s "$folder" | sed 's/[^A-Za-z0-9][^A-Za-z0-9]*/-/g; s/^-//; s/-$//')
file="$dir/$slug.md"

items() { [ -f "$1" ] && grep -E '^- \[( |x)\] ' "$1" || true; }
show() {
  f=$1; n=0
  items "$f" | while IFS= read -r l; do n=$((n + 1))
    due=$(printf %s "$l" | sed -n 's/.*<!-- due: \([^>]*\) -->.*/\1/p')
    on=$(printf %s "$l" | sed -n 's/.*<!-- done: \([^>]*\) -->.*/\1/p')
    text=$(printf %s "$l" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    case "$l" in "- [x] "*) box=x ;; *) box=" " ;; esac
    printf '%3d. [%s] %s%s\n' "$n" "$box" "$text" "${due:+  (due $due)}${on:+  (done $on)}"
  done
}
# Rewrites item $1 of this list with sed expression $2 (on that line only).
edit() {
  [ -f "$file" ] || { echo "No to-dos for $folder" >&2; exit 1; }
  line=$(grep -n -E '^- \[( |x)\] ' "$file" | sed -n "${1}p" | cut -d: -f1)
  [ -n "$line" ] || { echo "No item $1" >&2; exit 1; }
  sed "${line}$2" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
}

cmd=${1:-list}; [ $# -gt 0 ] && shift

# Handle filter flags passed directly as `todo -g ...`
case "$cmd" in
  -g|--group|-t|--tag|--prio|--priority|-s|--sub|-v|--verbose)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" list "$cmd" "$@"
    fi
    cmd=list
    ;;
esac

case "$cmd" in
  list|ls)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" list "$@"
    fi
    [ -n "$(items "$file")" ] && show "$file" || echo "No to-dos for $folder"
    ;;
  show)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" show "$@"
    else
      echo "todo show requires Python 3" >&2
      exit 1
    fi
    ;;
  sub)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" sub "$@"
    else
      echo "todo sub requires Python 3" >&2
      exit 1
    fi
    ;;
  desc)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" desc "$@"
    else
      echo "todo desc requires Python 3" >&2
      exit 1
    fi
    ;;
  json)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" json "$@"
    else
      echo "todo json requires Python 3" >&2
      exit 1
    fi
    ;;
  space)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" space "$@"
    else
      echo "todo space requires Python 3" >&2
      exit 1
    fi
    ;;
  queue|q)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" queue "$@"
    else
      echo "todo queue requires Python 3" >&2
      exit 1
    fi
    ;;
  all)
    for f in "$dir"/*.md; do
      [ -f "$f" ] && [ -n "$(items "$f")" ] || continue
      proj=$(sed -n 's/^<!-- folder: \(.*\) -->$/\1/p' "$f" | head -n 1)
      printf '%s\n' "$(printf '%s' "$proj" | sed "s#^$HOME#~#")"
      if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
        "$PY" "$ENGINE" -p "$proj" list
      else
        show "$f"
      fi
    done
    ;;
  add)
    # Check if extended options are used or route through engine
    has_ext=0
    for arg in "$@"; do
      case "$arg" in
        -g|--group|--prio|--priority|--tags|--assignee|--desc|--url|--urls) has_ext=1; break ;;
      esac
    done
    if [ "$has_ext" = 1 ] && [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" add "$@"
    fi
    due=""; if [ "$1" = "--due" ]; then due=$2; shift 2; fi
    text=$(printf '%s' "$*" | tr '\n' ' ' | sed 's/  *$//')
    [ -n "$text" ] || { echo "usage: todo add <text>" >&2; exit 2; }
    [ -f "$file" ] || printf '<!-- folder: %s -->\n' "$folder" > "$file"
    printf -- '- [ ] %s%s\n' "$text" "${due:+ <!-- due: $due -->}" >> "$file"
    md add "$text"
    echo "Added to $(printf %s "$folder" | sed "s#^$HOME#~#"): $text"
    ;;
  done|check)
    n=${1:?item number or text}
    case "$n" in
      [0-9]*.[0-9]*)
        if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
          exec "$PY" "$ENGINE" -p "$folder" done "$@"
        fi
        ;;
    esac
    case "$n" in *[!0-9]*) m=$(grep -E '^- \[( |x)\] ' "$file" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
      if [ -z "$m" ]; then
        for other in "$dir"/*.md; do
          [ -f "$other" ] || continue
          other_m=$(grep -E '^- \[( |x)\] ' "$other" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
          if [ -n "$other_m" ]; then
            other_folder=$(sed -n 's/^<!-- folder: \(.*\) -->$/\1/p' "$other" | head -n 1)
            [ -z "$other_folder" ] && other_folder=$(sed -n 's/^folder: \(.*\)$/\1/p' "$other" | head -n 1)
            if [ -n "$other_folder" ]; then
              exec "$0" -p "$other_folder" done "$@"
            fi
          fi
        done
        echo "No item \"$n\"" >&2; exit 1
      fi
      n=$m ;; esac
    text=$(grep -E '^- \[( |x)\] ' "$file" 2>/dev/null | sed -n "${n}p" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    "$0" -p "$folder" "_done" "$n"
    [ -n "$text" ] && { [ -n "$PY" ] && "$PY" -I "$HERE/todo-cross.py" "$folder" "done" "$text" 2>/dev/null; } || true
    ;;
  undo|uncheck)
    n=${1:?item number or text}
    case "$n" in
      [0-9]*.[0-9]*)
        if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
          exec "$PY" "$ENGINE" -p "$folder" undo "$@"
        fi
        ;;
    esac
    case "$n" in *[!0-9]*) m=$(grep -E '^- \[( |x)\] ' "$file" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
      if [ -z "$m" ]; then
        for other in "$dir"/*.md; do
          [ -f "$other" ] || continue
          other_m=$(grep -E '^- \[( |x)\] ' "$other" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
          if [ -n "$other_m" ]; then
            other_folder=$(sed -n 's/^<!-- folder: \(.*\) -->$/\1/p' "$other" | head -n 1)
            [ -z "$other_folder" ] && other_folder=$(sed -n 's/^folder: \(.*\)$/\1/p' "$other" | head -n 1)
            if [ -n "$other_folder" ]; then
              exec "$0" -p "$other_folder" undo "$@"
            fi
          fi
        done
        echo "No item \"$n\"" >&2; exit 1
      fi
      n=$m ;; esac
    text=$(grep -E '^- \[( |x)\] ' "$file" 2>/dev/null | sed -n "${n}p" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    "$0" -p "$folder" "_undo" "$n"
    [ -n "$text" ] && { [ -n "$PY" ] && "$PY" -I "$HERE/todo-cross.py" "$folder" "undo" "$text" 2>/dev/null; } || true
    ;;
  _done) edit "${1:?item number}" "s/^- \\[ \\] \\(.*\\)\$/- [x] \\1 <!-- done: $(date '+%F %H:%M') -->/" ;;
  _undo) edit "${1:?item number}" 's/^- \[x\] /- [ ] /; s/ *<!-- done: [^>]* -->//' ;;
  edit|reword)
    n=${1:?item number or text}; shift
    case "$n" in
      [0-9]*.[0-9]*)
        if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
          exec "$PY" "$ENGINE" -p "$folder" edit "$n" "$@"
        fi
        ;;
    esac
    new=$(printf '%s' "$*" | tr '\n' ' ' | sed 's/  *$//')
    [ -n "$new" ] || { echo "usage: todo edit <n|text> <new text>" >&2; exit 2; }
    case "$n" in *[!0-9]*) m=$(grep -E '^- \[( |x)\] ' "$file" 2>/dev/null | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g' | grep -n -x -F -- "$n" | head -n 1 | cut -d: -f1)
      [ -n "$m" ] || { echo "No item \"$n\"" >&2; exit 1; }; n=$m ;; esac
    old=$(grep -E '^- \[( |x)\] ' "$file" 2>/dev/null | sed -n "${n}p" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    [ -n "$old" ] || { echo "No item $n" >&2; exit 1; }
    esc=$(printf '%s' "$new" | sed 's/[\\&|]/\\&/g')
    edit "$n" "s|^\(- \[.\] \)[^<]*\(<!--.*\)\{0,1\}\$|\1$esc \2|; s| *\$||"
    md rename "$old" "$new"
    echo "Now: $new"
    ;;
  log|sync)
    case "${1:-}" in on|off) want="<!-- $cmd: $1 -->" ;; "") want=keep ;; *) echo "usage: todo $cmd [on|off]" >&2; exit 2 ;; esac
    if [ "$want" != keep ]; then
      [ -f "$file" ] || printf '<!-- folder: %s -->\n' "$folder" > "$file"
      grep -v "^<!-- $cmd: [a-z]* -->\$" "$file" | awk -v w="$want" '{ print } NR == 1 && w != "" { print w }' > "$file.tmp" && mv "$file.tmp" "$file"
    fi
    if [ "$cmd" = log ]; then opt log && echo "Request logging: on" || echo "Request logging: off"
    else opt sync && echo "TODO.md sync: on" || echo "TODO.md sync: off"; fi
    ;;
  rm|delete)
    n=${1:?item number}
    case "$n" in
      [0-9]*.[0-9]*)
        if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
          exec "$PY" "$ENGINE" -p "$folder" rm "$@"
        fi
        ;;
    esac
    text=$(grep -E '^- \[( |x)\] ' "$file" 2>/dev/null | sed -n "${n}p" | sed 's/^- \[.\] //; s/ *<!--[^>]*-->//g')
    edit "$n" 'd'
    [ -n "$text" ] && md rm "$text"
    ;;
  clear)
    if [ -n "$PY" ] && [ -f "$ENGINE" ]; then
      exec "$PY" "$ENGINE" -p "$folder" clear
    fi
    [ -f "$file" ] && { grep -v -E '^- \[x\] ' "$file" > "$file.tmp"; mv "$file.tmp" "$file"; }
    ;;
  *) sed -n '2,17s/^# \{0,1\}//p' "$SELF"; exit 2 ;;
esac
