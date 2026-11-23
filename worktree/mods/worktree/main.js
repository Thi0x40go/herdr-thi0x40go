// Orchestrator Worktree Manager & Live Sync
// Visualizador rápido de worktrees (Orchestrator + Herdr HC), alterações de agentes (LLM) e criação rápida.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  run,
  props,
  closeOverlay,
  theme,
  spaces,
  panes,
  agents,
  exec,
  home,
  notify,
} from "herdr";
import CONFIG from "./config.js";

function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

function tilde(path, userHome) {
  if (!path) return "";
  const h = (userHome || home() || "").replace(/\\/g, "/");
  const p = path.replace(/\\/g, "/");
  return p.startsWith(h) ? `~${p.slice(h.length)}` : p;
}

const slug = (branch) =>
  branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

function launchDetached(cmd, args = []) {
  const fullCmd = [cmd, ...args]
    .map((a) => `'${String(a).replace(/'/g, "'\\''")}'`)
    .join(" ");
  exec("sh", ["-c", `nohup ${fullCmd} </dev/null >/dev/null 2>&1 &`]);
}

export default class OrchestratorWt extends View {
  getSuggestions() {
    const list = [];
    const activePaneCwd = panes().find((p) => p.focused)?.cwd;
    const curSpace = spaces().find((s) => s.id === props()?.space) || spaces().find((s) => s.active);
    const activeSpaceCwd = place(curSpace, panes());
    const curDir = activePaneCwd || activeSpaceCwd;
    if (curDir) {
      list.push({ path: curDir, label: "Aba atual" });
    }
    list.push({ path: `${this.userHome}/orchestrator`, label: "Orchestrator padrão" });
    list.push({ path: `${this.userHome}/orchestrator/repos`, label: "Pasta repos/" });
    list.push({ path: `${this.userHome}/.herdr/worktrees`, label: "Worktrees do Herdr" });
    return list;
  }

  resolvePaths(inputPath) {
    let raw = (inputPath || "").trim();
    if (!raw) raw = `${this.userHome}/orchestrator`;
    if (raw.startsWith("~/")) {
      raw = `${this.userHome}/${raw.slice(2)}`;
    } else if (!raw.startsWith("/")) {
      raw = `${this.userHome}/${raw}`;
    }
    raw = raw.replace(/\/+$/, "");

    let orchRoot = raw;
    let reposRoot = raw;

    if (raw.endsWith("/repos")) {
      orchRoot = raw.slice(0, -6);
      reposRoot = raw;
    } else {
      orchRoot = raw;
      reposRoot = `${raw}/repos`;
    }

    return { orchRoot, reposRoot, rawTarget: raw };
  }

  init(_props, cx) {
    this.userHome = home();
    const resolved = this.resolvePaths(CONFIG?.orchestratorHome);
    this.orchHome = resolved.orchRoot;
    this.filter = "";
    this.repos = [];
    this.loading = true;
    this.error = "";
    this.stats = {}; // path -> { dirty, count, ahead, behind, files: [] }
    this.syncState = {}; // path -> { busy, error, ok }
    this.selectedWt = null; // wt selecionado para ver diff
    this.diffFiles = [];
    this.diffText = "";
    this.diffLoading = false;
    this.expandedRepos = new Set();
    this.editors = { zed: false, intellij: false, nvim: false };
    this.firstRun = CONFIG?.configured === false;
    this.configuring = this.firstRun;

    // Detecta editores instalados no sistema
    cx.spawn(async (cx) => {
      try {
        const [zedRes, ideaRes, nvimRes] = await Promise.all([
          exec("sh", ["-c", "which zed >/dev/null 2>&1 || which zeditor >/dev/null 2>&1"]),
          exec("sh", ["-c", "which idea >/dev/null 2>&1 || which intellij-idea-ultimate-edition >/dev/null 2>&1 || which intellij-idea-community-edition >/dev/null 2>&1"]),
          exec("sh", ["-c", "which nvim >/dev/null 2>&1"]),
        ]);
        this.editors = {
          zed: zedRes.code === 0,
          intellij: ideaRes.code === 0,
          nvim: nvimRes.code === 0,
        };
        cx.notify();
      } catch {}
    });

    // Estado da criação de nova worktree
    this.creating = false;
    this.newRepo = "apphealth-back";
    this.newLocation = "orchestrator"; // "orchestrator" | "herdr"
    this.newBranch = "";
    this.createError = "";
    this.createBusy = false;

    this.configPathValue = tilde(CONFIG?.orchestratorHome || `${this.userHome}/orchestrator`, this.userHome);
    this.configPathSaved = false;
    this.orchPathInput = InputState.new({
      value: this.configPathValue,
      placeholder: "Caminho do Orchestrator ou repos (ex: ~/orchestrator ou ~/orchestrator/repos)",
    });
    this.orchPathInput.on("change", (_e, cx) => {
      this.configPathValue = this.orchPathInput.value().trim();
      this.configPathSaved = false;
      cx.notify();
    });
    this.orchPathInput.on("submit", (_e, cx) => this.saveOrchPath(cx));

    this.branchInput = InputState.new({
      placeholder: "Nome da branch (ex: feat/CARD-1234-descricao)",
    });
    this.branchInput.on("change", (_e, cx) => {
      this.newBranch = this.branchInput.value().trim();
      this.createError = "";
      cx.notify();
    });
    this.branchInput.on("submit", (_e, cx) => this.submitCreate(cx));

    this.input = InputState.new({
      placeholder: "Buscar por repositório, branch ou pasta... (Esc fecha)",
    });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value().toLowerCase().trim();
      cx.notify();
    });
    this.input.focus();
    cx.timer.after(500, () => this.input.focus());

    this.handle = cx.focus_handle();

    // Carga inicial
    this.loadRepos(cx);

    // Refresh periódico a cada 10 segundos
    cx.timer.every(10000, (cx) => this.refreshStats(cx));
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  loadRepos(cx) {
    this.loading = true;
    this.error = "";
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const { orchRoot, reposRoot, rawTarget } = this.resolvePaths(this.orchHome);
        this.orchHome = orchRoot;

        // 1. Tenta carregar via worktree_tool.py se o script existir
        let repos = [];
        try {
          const scriptPath = `${orchRoot}/scripts/worktree_tool.py`;
          const hasScript = (await exec("test", ["-f", scriptPath])).code === 0;
          if (hasScript) {
            const cmd = await exec(
              "python3",
              [scriptPath, "list"],
              { timeout: 15000, cwd: orchRoot }
            );
            if (cmd.code === 0) {
              const parsed = JSON.parse(cmd.stdout);
              if (parsed.status === "success") {
                repos = parsed.data?.repos ?? [];
              }
            }
          }
        } catch {}

        // 2. Fallback Universal: se repos estiver vazio (ex: apontou direto para repos/ ou pasta sem scripts)
        if (repos.length === 0) {
          const scanDirs = [reposRoot, rawTarget];
          for (const sDir of scanDirs) {
            try {
              const scanCmd = await exec(
                "sh",
                [
                  "-c",
                  `for d in "${sDir}"/*; do if [ -e "$d/.git" ]; then echo "REPO:$(basename "$d")"; git -C "$d" worktree list --porcelain; fi; done`,
                ],
                { timeout: 10000 }
              );
              if (scanCmd.code === 0 && scanCmd.stdout.trim()) {
                let currentRepo = null;
                for (const line of scanCmd.stdout.split("\n")) {
                  if (line.startsWith("REPO:")) {
                    const rId = line.slice(5).trim();
                    currentRepo = { repo_id: rId, worktrees: [] };
                    repos.push(currentRepo);
                  } else if (currentRepo && line.startsWith("worktree ")) {
                    const wtPath = line.slice(9).trim();
                    currentRepo.worktrees.push({ path: wtPath, branch: "HEAD" });
                  } else if (currentRepo && line.startsWith("branch ") && currentRepo.worktrees.length > 0) {
                    const b = line.slice(7).trim().replace(/^refs\/heads\//, "");
                    currentRepo.worktrees[currentRepo.worktrees.length - 1].branch = b;
                  }
                }
                if (repos.length > 0) break;
              }
            } catch {}
          }
        }

        // 2. Busca adicional por worktrees criadas sob ~/.herdr/worktrees
        try {
          const herdrFind = await exec(
            "sh",
            ["-c", "find ~/.herdr/worktrees -mindepth 2 -maxdepth 2 -type d 2>/dev/null || true"],
            { timeout: 5000 }
          );
          const herdrPaths = (herdrFind.stdout || "").split("\n").filter(Boolean);
          for (const hPath of herdrPaths) {
            // Só considera se for uma worktree git real (.git é arquivo de apontamento)
            const checkGit = await exec("test", ["-f", `${hPath}/.git`]);
            if (checkGit.code !== 0) continue;

            const commonRes = await exec(
              "git",
              ["rev-parse", "--path-format=absolute", "--git-common-dir"],
              { cwd: hPath, timeout: 3000 }
            );
            if (commonRes.code === 0) {
              const commonDir = commonRes.stdout.trim();
              const repoName = commonDir.endsWith("/.git")
                ? commonDir.slice(0, -5).split("/").pop()
                : commonDir.split("/").pop();

              if (!repoName || repoName === "orchestrator" || repoName === "worktrees") continue;

              const branchRes = await exec(
                "git",
                ["branch", "--show-current"],
                { cwd: hPath, timeout: 3000 }
              );
              const branchName = branchRes.stdout.trim() || hPath.split("/").pop();

              let targetRepo = repos.find((r) => r.repo_id === repoName);
              if (!targetRepo) {
                targetRepo = { repo_id: repoName, worktrees: [] };
                repos.push(targetRepo);
              }
              const alreadyExists = (targetRepo.worktrees ?? []).some(
                (w) => w.path === hPath
              );
              if (!alreadyExists) {
                targetRepo.worktrees.push({
                  path: hPath,
                  branch: branchName,
                });
              }
            }
          }
        } catch {}

        // 3. Auto-detecta repositório do Space atual (se for um dos repositórios)
        if (CONFIG?.autoDetectCurrentRepo !== false) {
          try {
            const curSpace = spaces().find((s) => s.id === props()?.space) || spaces()[0];
            const curFolder = props()?.folder || place(curSpace, panes());
            if (curFolder) {
              const topRes = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: curFolder, timeout: 3000 });
              if (topRes.code === 0 && topRes.stdout.trim()) {
                const topDir = topRes.stdout.trim();
                const curRepoName = topDir.split("/").pop();

                if (curRepoName && curRepoName !== "orchestrator" && curRepoName !== "worktrees") {
                  const existing = repos.find((r) => r.repo_id === curRepoName);
                  if (existing) {
                    existing.isCurrent = true;
                    repos = [existing, ...repos.filter((r) => r.repo_id !== curRepoName)];
                    this.expandedRepos.add(curRepoName);
                  }
                }
              }
            }
          } catch {}
        }

        // Marca a origem de cada worktree
        for (const r of repos) {
          for (const w of r.worktrees ?? []) {
            if (w.path.includes("/.herdr/worktrees/")) {
              w.origin = "herdr";
            } else if (w.path.includes("/orchestrator/worktrees/")) {
              w.origin = "orchestrator";
            } else {
              w.origin = "repo";
            }
          }
        }

        this.repos = repos;

        // Se o repo selecionado para nova worktree não existe mais, pega o primeiro
        if (!this.repos.some((r) => r.repo_id === this.newRepo) && this.repos.length > 0) {
          this.newRepo = this.repos[0].repo_id;
        }

        // Expandir por padrão todos que possuem worktrees ativas
        for (const r of this.repos) {
          const hasFeatures = (r.worktrees ?? []).some(
            (w) => w.origin === "orchestrator" || w.origin === "herdr"
          );
          if (hasFeatures) {
            this.expandedRepos.add(r.repo_id);
          }
        }

        // Se nenhum repositório foi detectado e não foi configurado ou pasta não existe, oferece configuração inicial
        if (this.repos.length === 0) {
          try {
            const checkDir = await exec("test", ["-d", this.orchHome]);
            if (checkDir.code !== 0 || CONFIG?.configured === false) {
              this.configuring = true;
              this.firstRun = true;
            }
          } catch {}
        }

        this.loading = false;
        cx.notify();
        await this.refreshStats(cx);
      } catch (err) {
        this.loading = false;
        this.error = String(err.message || err);
        cx.notify();
      }
    });
  }

  async refreshStats(cx) {
    const allWts = [];
    for (const r of this.repos) {
      for (const wt of r.worktrees ?? []) {
        if (wt.origin === "orchestrator" || wt.origin === "herdr") {
          allWts.push({ ...wt, repo_id: r.repo_id });
        }
      }
    }

    // Processa os status em lotes para performance
    for (const wt of allWts) {
      try {
        const statusRes = await exec(
          "git",
          [
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "status",
            "--porcelain=v1",
            "-z",
          ],
          { cwd: wt.path, timeout: 5000 }
        );
        if (statusRes.code === 0) {
          const entries = (statusRes.stdout || "")
            .split("\0")
            .filter(Boolean);
          const dirtyFiles = entries.map((e) => ({
            status: e.slice(0, 2).trim(),
            path: e.slice(3),
          }));
          const dirty = dirtyFiles.length > 0;

          // Ahead/behind relativo a origin/devop ou develop
          let ahead = 0;
          let behind = 0;
          const abRes = await exec(
            "git",
            ["rev-list", "--left-right", "--count", "HEAD...origin/HEAD"],
            { cwd: wt.path, timeout: 4000 }
          );
          if (abRes.code === 0 && abRes.stdout.trim()) {
            const parts = abRes.stdout.trim().split(/\s+/);
            ahead = parseInt(parts[0], 10) || 0;
            behind = parseInt(parts[1], 10) || 0;
          }

          this.stats[wt.path] = {
            dirty,
            count: dirtyFiles.length,
            files: dirtyFiles,
            ahead,
            behind,
          };
        }
      } catch {}
    }
    cx.notify();
  }

  openSpace(wt) {
    this.close();
    const existing = spaces().find(
      (s) =>
        s.folder === wt.path ||
        (s.tabs ?? []).some((t) =>
          panes().some((p) => p.tab === t.id && p.cwd === wt.path)
        )
    );
    if (existing) {
      run("space.select", { id: existing.id });
    } else {
      run("space.new", { folder: wt.path });
    }
  }

  openZed(wt) {
    this.close();
    launchDetached("zed", [wt.path]);
  }

  openIntelliJ(wt) {
    this.close();
    exec("sh", [
      "-c",
      `nohup sh -c 'idea "$1" || intellij-idea-ultimate-edition "$1" || intellij-idea-community-edition "$1"' _ "${wt.path}" </dev/null >/dev/null 2>&1 &`,
    ]);
  }

  openNvim(wt) {
    this.close();
    const term = CONFIG?.terminal || "kitty";
    if (term === "ghostty") {
      launchDetached("ghostty", [`--working-directory=${wt.path}`, "-e", "nvim", "."]);
    } else if (term === "alacritty") {
      launchDetached("alacritty", ["--working-directory", wt.path, "-e", "nvim", "."]);
    } else {
      // Kitty por padrão (usa fontes, temas e configurações do sistema)
      launchDetached("kitty", ["--directory", wt.path, "nvim", "."]);
    }
  }

  showDiff(wt, cx) {
    this.selectedWt = wt;
    this.diffLoading = true;
    this.diffFiles = [];
    this.diffText = "";
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const statRes = await exec(
          "git",
          ["status", "--porcelain=v1"],
          { cwd: wt.path, timeout: 8000 }
        );
        const diffRes = await exec(
          "git",
          ["diff", "HEAD"],
          { cwd: wt.path, timeout: 10000 }
        );
        this.diffFiles = (statRes.stdout || "")
          .split("\n")
          .filter(Boolean)
          .map((line) => line.trim());
        this.diffText = diffRes.stdout || "Nenhuma diferença em relação a HEAD.";
      } catch (err) {
        this.diffText = `Erro ao ler diff: ${err.message || err}`;
      }
      this.diffLoading = false;
      cx.notify();
    });
  }

  syncBase(wt, cx) {
    if (this.syncState[wt.path]?.busy) return;
    this.syncState[wt.path] = { busy: true, error: null, ok: false };
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const r = await exec(
          "python3",
          [
            `${this.orchHome}/scripts/worktree_tool.py`,
            "sync",
            "--repo",
            wt.repo_id,
            "--branch",
            wt.branch,
          ],
          { timeout: 60000 }
        );
        const parsed = JSON.parse(r.stdout || "{}");
        if (r.code === 0 && parsed.status === "success") {
          this.syncState[wt.path] = { busy: false, ok: true, error: null };
          notify({
            title: "Sync Concluído",
            body: `${wt.repo_id} (${wt.branch}) sincronizado com a base remota.`,
            level: "success",
            timeout: 5000,
          });
          await this.refreshStats(cx);
        } else {
          const errMsg = parsed.message || r.stderr || "Falha na sincronização";
          this.syncState[wt.path] = { busy: false, ok: false, error: errMsg };
          notify({
            title: "Erro no Sync",
            body: errMsg,
            level: "error",
            timeout: 8000,
          });
        }
      } catch (err) {
        this.syncState[wt.path] = {
          busy: false,
          ok: false,
          error: String(err.message || err),
        };
        notify({
          title: "Erro no Sync",
          body: String(err.message || err),
          level: "error",
          timeout: 8000,
        });
      }
      cx.notify();
    });
  }

  submitCreate(cx) {
    if (this.createBusy) return;
    const repo = this.newRepo;
    const branch = this.newBranch;
    const location = this.newLocation;

    if (!repo) {
      this.createError = "Selecione um repositório.";
      cx.notify();
      return;
    }
    if (!branch) {
      this.createError = "Digite o nome da branch.";
      cx.notify();
      return;
    }

    this.createBusy = true;
    this.createError = "";
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        if (location === "orchestrator") {
          // Criação via Orchestrator CLI
          const r = await exec(
            "python3",
            [
              `${this.orchHome}/scripts/worktree_tool.py`,
              "create",
              "--repo",
              repo,
              "--branch",
              branch,
            ],
            { timeout: 60000 }
          );
          const parsed = JSON.parse(r.stdout || "{}");
          if (r.code !== 0 || parsed.status !== "success") {
            throw new Error(parsed.message || r.stderr || "Falha ao criar worktree");
          }
          const wtPath = parsed.data?.worktree_path;
          notify({
            title: "Worktree Criada (Orchestrator)",
            body: `${repo} (${branch}) criado em ~/orchestrator/worktrees.`,
            level: "success",
            timeout: 5000,
          });
          this.createBusy = false;
          this.creating = false;
          this.branchInput.set_value("");
          this.newBranch = "";
          this.close();
          if (wtPath) {
            run("space.new", { folder: wtPath });
          }
        } else {
          // Criação via Herdr (~/.herdr/worktrees)
          const targetDir = `${this.userHome}/.herdr/worktrees/${repo}/${slug(branch)}`;
          const mainRepoDir = `${this.orchHome}/repos/${repo}`;
          await exec("mkdir", ["-p", `${this.userHome}/.herdr/worktrees/${repo}`]);

          // Verifica se branch existe
          const exists = (
            await exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
              cwd: mainRepoDir,
            })
          ).code === 0;

          const addArgs = exists
            ? ["worktree", "add", targetDir, branch]
            : ["worktree", "add", "-b", branch, targetDir, "HEAD"];

          const addRes = await exec("git", addArgs, { cwd: mainRepoDir, timeout: 60000 });
          if (addRes.code !== 0) {
            throw new Error(addRes.stderr || addRes.stdout || "Erro no git worktree add");
          }

          notify({
            title: "Worktree Criada (Herdr HC)",
            body: `${repo} (${branch}) criado em ~/.herdr/worktrees.`,
            level: "success",
            timeout: 5000,
          });
          this.createBusy = false;
          this.creating = false;
          this.branchInput.set_value("");
          this.newBranch = "";
          this.close();
          run("space.new", { folder: targetDir });
        }
      } catch (err) {
        this.createBusy = false;
        this.createError = String(err.message || err);
        cx.notify();
      }
    });
  }

  saveOrchPath(cx) {
    let newPath = (this.configPathValue || this.orchPathInput.value()).trim();
    if (!newPath) return;
    let expanded = newPath;
    if (expanded.startsWith("~/")) {
      expanded = `${this.userHome}/${expanded.slice(2)}`;
    }
    this.orchHome = expanded;
    this.configPathSaved = true;
    this.saveConfig({ orchestratorHome: tilde(newPath, this.userHome), configured: true }, cx);
    this.configuring = false;
    this.firstRun = false;
    this.loadRepos(cx);
  }

  saveConfig(newConfig, cx) {
    Object.assign(CONFIG, newConfig);
    const content = `// Configurações do Mod Worktrees
export default ${JSON.stringify(CONFIG, null, 2)};
`;
    cx.spawn(async (cx) => {
      try {
        const targetPaths = [
          `${this.userHome}/.config/herdr-app/mods/worktrees/config.js`,
          `${this.userHome}/.config/herdr-app/mods/orchestrator-wt/config.js`,
          `${this.userHome}/Projects/herdr-thi0x40go/worktree/mods/worktree/config.js`,
        ];
        for (const p of targetPaths) {
          await exec("sh", ["-c", `test -e "$(dirname "${p}")" && cat << 'EOF' > "${p}"\n${content}\nEOF`]);
        }
      } catch {}
      cx.notify();
    });
  }

  key(e, cx) {
    if (e.key === "escape") {
      if (this.selectedWt) {
        this.selectedWt = null;
        cx.notify();
        return;
      }
      if (this.configuring) {
        this.configuring = false;
        cx.notify();
        return;
      }
      if (this.creating) {
        this.creating = false;
        this.createError = "";
        cx.notify();
        return;
      }
      return this.close();
    }
  }

  toggleRepo(repoId, cx) {
    if (this.expandedRepos.has(repoId)) {
      this.expandedRepos.delete(repoId);
    } else {
      this.expandedRepos.add(repoId);
    }
    cx.notify();
  }

  getAgentInWt(wtPath) {
    const allPanes = panes();
    const activePanes = allPanes.filter((p) => p.cwd === wtPath);
    if (!activePanes.length) return null;

    const agentList = agents();
    for (const p of activePanes) {
      const ag = agentList.find((a) => a.address === p.terminal);
      if (ag) return { name: ag.app || "Agente", status: ag.status || "idle" };
      if (p.status === "working")
        return { name: p.program?.name || "Agente", status: "working" };
    }
    return null;
  }

  render(cx) {
    const t = theme();

    // 0. Tela de Configuração interna
    if (this.configuring) {
      return this.renderConfigView(t, cx);
    }

    // 1. Tela de Diff
    if (this.selectedWt) {
      return this.renderDiffView(t, cx);
    }

    // 2. Tela de Criação de Worktree
    if (this.creating) {
      return this.renderCreateView(t, cx);
    }

    // 3. Tela Principal de Listagem
    const filterTerm = this.filter;
    const filteredRepos = this.repos
      .map((r) => {
        const repoMatches = r.repo_id.toLowerCase().includes(filterTerm);
        const wts = (r.worktrees ?? []).filter(
          (w) =>
            (w.origin === "orchestrator" || w.origin === "herdr") &&
            (repoMatches ||
              (w.branch && w.branch.toLowerCase().includes(filterTerm)) ||
              w.path.toLowerCase().includes(filterTerm))
        );
        return { ...r, worktrees: wts, matches: repoMatches || wts.length > 0 };
      })
      .filter((r) => r.matches && r.worktrees.length > 0);

    const totalFeatures = this.repos.reduce(
      (acc, r) =>
        acc +
        (r.worktrees ?? []).filter(
          (w) => w.origin === "orchestrator" || w.origin === "herdr"
        ).length,
      0
    );

    let dirtyCount = 0;
    for (const k in this.stats) {
      if (this.stats[k]?.dirty) dirtyCount++;
    }

    return v_flex()
      .id("worktree-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .child(
        // Header
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(10)
              .items_center()
              .child(
                div()
                  .font_bold()
                  .text_size(15)
                  .text_color(t.foreground)
                  .child("Orchestrator Worktrees")
              )
              .child(
                div()
                  .text_size(11)
                  .px(6)
                  .py(2)
                  .rounded(4)
                  .bg(t.raised)
                  .text_color(t.muted)
                  .child(`${totalFeatures} ativas`)
              )
              .when(dirtyCount > 0, (el) =>
                el.child(
                  div()
                    .text_size(11)
                    .px(6)
                    .py(2)
                    .rounded(4)
                    .bg(t.accent)
                    .text_color(t.accent_foreground)
                    .child(`${dirtyCount} com alterações (LLM/WIP)`)
                )
              )
          )
          .child(
            h_flex()
              .gap(8)
              .items_center()
              // Botão Nova Worktree
              .child(
                h_flex()
                  .id("btn-new-wt")
                  .cursor_pointer()
                  .px(8)
                  .py(4)
                  .gap(5)
                  .items_center()
                  .rounded(5)
                  .bg(t.solid)
                  .text_size(12)
                  .text_color(t.solid_foreground)
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => {
                    this.creating = true;
                    this.createError = "";
                    cx.notify();
                    cx.timer.after(200, () => this.branchInput.focus());
                  })
                  .child(
                    svg("mods/worktree/add.svg")
                      .size(13)
                      .flex_none()
                  )
                  .child(div().child("Nova Worktree"))
              )
              // Botão Atualizar
              .child(
                h_flex()
                  .id("btn-refresh-all")
                  .cursor_pointer()
                  .px(8)
                  .py(4)
                  .gap(5)
                  .items_center()
                  .rounded(5)
                  .bg(t.raised)
                  .text_size(12)
                  .text_color(t.foreground)
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => this.loadRepos(cx))
                  .child(
                    svg("mods/worktree/sync.svg")
                      .size(13)
                      .flex_none()
                      .when(this.loading, (el) => el.spin(900))
                  )
                  .child(div().child("Atualizar"))
              )
              // Botão Config
              .child(
                h_flex()
                  .id("btn-config")
                  .cursor_pointer()
                  .px(8)
                  .py(4)
                  .gap(4)
                  .items_center()
                  .rounded(5)
                  .bg(t.raised)
                  .text_size(12)
                  .text_color(t.foreground)
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => {
                    this.configuring = true;
                    cx.notify();
                  })
                  .child(div().child("⚙️ Config"))
              )
              // Botão Fechar
              .child(
                div()
                  .id("btn-close")
                  .cursor_pointer()
                  .px(8)
                  .py(4)
                  .rounded(5)
                  .text_size(12)
                  .text_color(t.muted)
                  .hover((s) => s.text_color(t.foreground).bg(t.hover))
                  .on_click(() => this.close())
                  .child("✕ Fechar")
              )
          )
      )
      .child(
        // Search Input
        Input.new(this.input)
          .h(34)
          .px(10)
          .items_center()
          .rounded(6)
          .border(1)
          .border_color(t.input)
          .bg(t.background)
          .text_color(t.foreground)
      )
      .when(this.loading, (el) =>
        el
          .flex_1()
          .items_center()
          .justify_center()
          .child(
            div()
              .text_color(t.muted)
              .child("Carregando worktrees (Orchestrator e Herdr)...")
          )
      )
      .when(Boolean(this.error), (el) =>
        el
          .flex_1()
          .items_center()
          .justify_center()
          .child(div().text_color(t.blocked).child(`Erro: ${this.error}`))
      )
      .when(!this.loading && !this.error, (el) =>
        el
          .flex_1()
          .min_h(0)
          .child(
            v_flex()
              .id("wt-scroll-list")
              .size_full()
              .overflow_y_scroll()
              .gap(10)
              .children(
                filteredRepos.map((repo) =>
                  this.renderRepoGroup(repo, t, cx)
                )
              )
              .when(filteredRepos.length === 0, (el) =>
                el
                  .p(20)
                  .items_center()
                  .justify_center()
                  .child(
                    div()
                      .text_color(t.muted)
                      .child("Nenhum worktree encontrado para este filtro.")
                  )
              )
          )
      );
  }

  renderRepoGroup(repo, t, cx) {
    const isExpanded =
      this.expandedRepos.has(repo.repo_id) || Boolean(this.filter);
    const wts = repo.worktrees ?? [];

    return v_flex()
      .id(`repo-group-${repo.repo_id}`)
      .rounded(8)
      .border(1)
      .border_color(t.border)
      .bg(t.surface)
      .child(
        // Header do Repositório
        h_flex()
          .id(`repo-head-${repo.repo_id}`)
          .px(12)
          .py(8)
          .items_center()
          .justify_between()
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.toggleRepo(repo.repo_id, cx))
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                div()
                  .text_color(t.dim)
                  .child(isExpanded ? "▼" : "▶")
              )
              .child(
                div()
                  .font_semibold()
                  .text_color(t.foreground)
                  .child(repo.repo_id)
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child(`(${wts.length} worktrees)`)
              )
          )
      )
      .when(isExpanded, (el) =>
        el.child(
          v_flex()
            .p(6)
            .gap(6)
            .children(
              wts.map((wt) =>
                this.renderWorktreeRow(wt, repo.repo_id, t, cx)
              )
            )
        )
      );
  }

  renderWorktreeRow(wt, repoId, t, cx) {
    const stat = this.stats[wt.path] || {};
    const sync = this.syncState[wt.path] || {};
    const agent = this.getAgentInWt(wt.path);

    const hasDirty = Boolean(stat.dirty);
    const ahead = stat.ahead || 0;
    const behind = stat.behind || 0;
    const isHerdr = wt.origin === "herdr";

    return h_flex()
      .id(`wt-row-${wt.path}`)
      .px(10)
      .py(8)
      .rounded(6)
      .items_center()
      .justify_between()
      .bg(t.background)
      .hover((s) => s.bg(t.raised))
      .child(
        // Lado Esquerdo: Branch e Detalhes
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(3)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                svg("mods/worktree/git-branch.svg")
                  .size(13)
                  .flex_none()
                  .text_color(t.dim)
              )
              .child(
                div()
                  .truncate()
                  .font_semibold()
                  .text_color(t.foreground)
                  .child(wt.branch || "detached")
              )
              // Badge de Origem: [repo base] | [orchestrator] | [herdr hc]
              .child(
                div()
                  .px(5)
                  .py(1)
                  .rounded(3)
                  .text_size(10)
                  .bg(wt.origin === "repo" ? (t.subtle ?? t.raised) : isHerdr ? t.accent : t.raised)
                  .text_color(wt.origin === "repo" ? t.dim : isHerdr ? t.accent_foreground : t.muted)
                  .child(
                    wt.origin === "repo"
                      ? "repo base"
                      : isHerdr
                        ? "herdr hc"
                        : "orchestrator"
                  )
              )
              // Badge de Agente / LLM ativo
              .when(Boolean(agent), (el) =>
                el.child(
                  div()
                    .px(6)
                    .py(1)
                    .rounded(4)
                    .text_size(10.5)
                    .bg(agent.status === "working" ? t.working : t.raised)
                    .text_color(t.foreground)
                    .child(
                      agent.status === "working"
                        ? `🤖 ${agent.name} (ativo)`
                        : `🤖 ${agent.name}`
                    )
                )
              )
              // Badge de alterações locais (LLM ou Humano)
              .when(hasDirty, (el) =>
                el.child(
                  div()
                    .px(6)
                    .py(1)
                    .rounded(4)
                    .text_size(10.5)
                    .bg(t.accent)
                    .text_color(t.accent_foreground)
                    .child(`● ${stat.count} arqs alterados`)
                )
              )
              // Ahead / Behind
              .when(ahead > 0 || behind > 0, (el) =>
                el.child(
                  div()
                    .text_size(11)
                    .text_color(behind > 0 ? t.ansi3 || t.muted : t.dim)
                    .child(`↑${ahead} ↓${behind}`)
                )
              )
          )
          .child(
            div()
              .truncate()
              .text_size(11)
              .text_color(t.dim)
              .child(tilde(wt.path, this.userHome))
          )
      )
      .child(
        // Lado Direito: Ações
        h_flex()
          .gap(6)
          .items_center()
          // Botão Diff
          .when(hasDirty, (el) =>
            el.child(
              h_flex()
                .id(`btn-diff-${wt.path}`)
                .cursor_pointer()
                .px(7)
                .py(3)
                .gap(5)
                .items_center()
                .rounded(4)
                .bg(t.raised)
                .text_size(11.5)
                .text_color(t.foreground)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) =>
                  this.showDiff({ ...wt, repo_id: repoId }, cx)
                )
                .child(svg("mods/worktree/eye.svg").size(13).flex_none())
                .child(div().child("Diff"))
            )
          )
          // Botão Sync
          .child(
            h_flex()
              .id(`btn-sync-${wt.path}`)
              .cursor_pointer()
              .px(7)
              .py(3)
              .gap(5)
              .items_center()
              .rounded(4)
              .bg(t.raised)
              .text_size(11.5)
              .text_color(sync.busy ? t.muted : t.foreground)
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) =>
                this.syncBase({ ...wt, repo_id: repoId }, cx)
              )
              .child(
                svg("mods/worktree/sync.svg")
                  .size(13)
                  .flex_none()
                  .when(sync.busy, (el) => el.spin(900))
              )
              .child(div().child(sync.busy ? "Sincronizando..." : "Sync"))
          )
          // Botão Zed (só se instalado)
          .when(Boolean(this.editors?.zed), (el) =>
            el.child(
              div()
                .id(`btn-zed-${wt.path}`)
                .cursor_pointer()
                .px(7)
                .py(3)
                .rounded(4)
                .bg(t.raised)
                .text_size(11)
                .text_color(t.foreground)
                .hover((s) => s.bg(t.hover))
                .on_click(() => this.openZed(wt))
                .child("Zed")
            )
          )
          // Botão IntelliJ (só se instalado)
          .when(Boolean(this.editors?.intellij), (el) =>
            el.child(
              div()
                .id(`btn-idea-${wt.path}`)
                .cursor_pointer()
                .px(7)
                .py(3)
                .rounded(4)
                .bg(t.raised)
                .text_size(11)
                .text_color(t.foreground)
                .hover((s) => s.bg(t.hover))
                .on_click(() => this.openIntelliJ(wt))
                .child("IntelliJ")
            )
          )
          // Botão Neovim (só se instalado)
          .when(Boolean(this.editors?.nvim), (el) =>
            el.child(
              div()
                .id(`btn-nvim-${wt.path}`)
                .cursor_pointer()
                .px(7)
                .py(3)
                .rounded(4)
                .bg(t.raised)
                .text_size(11)
                .text_color(t.foreground)
                .hover((s) => s.bg(t.hover))
                .on_click(() => this.openNvim(wt))
                .child("Neovim")
            )
          )
          // Botão Abrir Space
          .child(
            div()
              .id(`btn-open-${wt.path}`)
              .cursor_pointer()
              .px(8)
              .py(3)
              .rounded(4)
              .bg(t.solid)
              .text_size(11.5)
              .text_color(t.solid_foreground)
              .hover((s) => s.bg(t.hover))
              .on_click(() => this.openSpace(wt))
              .child("Space")
          )
      );
  }

  renderConfigView(t, cx) {
    const curTerm = CONFIG?.terminal || "kitty";
    const terms = [
      { id: "kitty", label: "Kitty", desc: "Terminal padrão do sistema (recomendado, mantém fontes e temas do Omarchy)" },
      { id: "ghostty", label: "Ghostty", desc: "Abre Neovim em nova janela do Ghostty" },
      { id: "alacritty", label: "Alacritty", desc: "Abre Neovim em nova janela do Alacritty" },
    ];

    return v_flex()
      .id("orchestrator-config-view")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(16)
      .bg(t.popover)
      .child(
        // Header
        h_flex()
          .items_center()
          .justify_between()
          .child(
            div()
              .font_bold()
              .text_size(15)
              .text_color(t.foreground)
              .child(this.firstRun ? "🎉 Configuração Inicial do Worktrees" : "Configurações do Mod")
          )
          .child(
            div()
              .id("btn-cancel-config")
              .cursor_pointer()
              .px(10)
              .py(4)
              .rounded(5)
              .bg(t.raised)
              .text_size(12)
              .text_color(t.foreground)
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => {
                this.configuring = false;
                this.firstRun = false;
                cx.notify();
              })
              .child(this.firstRun ? "Pular / Fechar (Esc)" : "← Voltar (Esc)")
          )
      )
      // Card de boas-vindas na primeira inicialização com sugestões rápidas
      .when(Boolean(this.firstRun), (el) =>
        el.child(
          v_flex()
            .p(14)
            .rounded(8)
            .bg(t.surface)
            .border(1)
            .border_color(t.accent)
            .gap(8)
            .child(
              div()
                .font_semibold()
                .text_size(13)
                .text_color(t.accent)
                .child("Nenhum repositório foi detectado no caminho padrão.")
            )
            .child(
              div()
                .text_size(12)
                .text_color(t.foreground)
                .child(
                  "Escolha uma das sugestões detectadas abaixo ou informe onde ficam seus projetos git/orchestrator:"
                )
            )
            .child(
              h_flex()
                .gap(8)
                .pt(4)
                .wrap()
                .children(
                  this.getSuggestions().map((sug) =>
                    div()
                      .id(`btn-sug-${slug(sug.label)}`)
                      .cursor_pointer()
                      .px(10)
                      .py(6)
                      .rounded(6)
                      .bg(t.raised)
                      .border(1)
                      .border_color(t.border)
                      .hover((s) => s.bg(t.hover).border_color(t.accent))
                      .child(
                        v_flex()
                          .gap(2)
                          .child(
                            div()
                              .font_medium()
                              .text_size(11.5)
                              .text_color(t.accent)
                              .child(`📁 ${tilde(sug.path, this.userHome)}`)
                          )
                          .child(
                            div()
                              .text_size(10.5)
                              .text_color(t.dim)
                              .child(sug.label)
                          )
                      )
                      .on_click((_e, cx) => {
                        const val = tilde(sug.path, this.userHome);
                        this.orchPathInput.set_value(val, cx);
                        this.configPathValue = val;
                        this.configPathSaved = false;
                        cx.notify();
                      })
                  )
                )
            )
        )
      )
      // 1. Pasta do Orchestrator / Repositórios
      .child(
        v_flex()
          .gap(6)
          .child(
            div()
              .font_semibold()
              .text_size(12.5)
              .text_color(t.foreground)
              .child("Pasta do Orchestrator (Repositórios & Scripts)")
          )
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child("Diretório raiz onde ficam as pastas repos/ e scripts/ (ex: ~/orchestrator).")
          )
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                Input.new(this.orchPathInput)
                  .flex_1()
                  .h(32)
                  .px(10)
                  .items_center()
                  .rounded(6)
                  .border(1)
                  .border_color(t.input)
                  .bg(t.background)
                  .text_color(t.foreground)
                  .text_size(12)
              )
              .child(
                div()
                  .id("btn-save-orch-path")
                  .cursor_pointer()
                  .px(12)
                  .py(6)
                  .rounded(5)
                  .bg(this.configPathSaved ? t.solid : t.raised)
                  .text_size(11.5)
                  .font_medium()
                  .text_color(this.configPathSaved ? t.solid_foreground : t.foreground)
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => this.saveOrchPath(cx))
                  .child(this.configPathSaved ? "✓ Salvo!" : "Salvar Pasta")
              )
          )
      )
      // 2. Terminal para Neovim
      .child(
        v_flex()
          .gap(8)
          .child(
            div()
              .font_semibold()
              .text_size(12.5)
              .text_color(t.foreground)
              .child("Terminal para abrir o Neovim em tela separada")
          )
          .child(
            v_flex()
              .gap(6)
              .children(
                terms.map((item) => {
                  const active = curTerm === item.id;
                  return h_flex()
                    .id(`opt-term-${item.id}`)
                    .cursor_pointer()
                    .p(10)
                    .rounded(6)
                    .border(1)
                    .border_color(active ? t.accent : t.border)
                    .bg(active ? (t.active ?? t.raised) : t.surface)
                    .items_center()
                    .justify_between()
                    .hover((s) => (!active ? s.bg(t.raised) : null))
                    .on_click((_e, cx) => {
                      this.saveConfig({ terminal: item.id }, cx);
                    })
                    .child(
                      v_flex()
                        .gap(2)
                        .child(
                          div()
                            .font_semibold()
                            .text_size(12)
                            .text_color(active ? t.accent : t.foreground)
                            .child(item.label)
                        )
                        .child(
                          div()
                            .text_size(11)
                            .text_color(t.dim)
                            .child(item.desc)
                        )
                    )
                    .child(
                      div()
                        .text_size(12)
                        .text_color(active ? t.accent : t.muted)
                        .child(active ? "● Ativo" : "Selecionar")
                    );
                })
              )
          )
      )
      // 2. Auto-detecção de repositório atual
      .child(
        v_flex()
          .gap(8)
          .child(
            div()
              .font_semibold()
              .text_size(12.5)
              .text_color(t.foreground)
              .child("Comportamento")
          )
          .child(
            h_flex()
              .p(10)
              .rounded(6)
              .border(1)
              .border_color(t.border)
              .bg(t.surface)
              .items_center()
              .justify_between()
              .child(
                v_flex()
                  .gap(2)
                  .child(
                    div()
                      .font_semibold()
                      .text_size(12)
                      .text_color(t.foreground)
                      .child("Auto-detectar repositório do Space atual")
                  )
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.dim)
                      .child("Destaca no topo da lista o repositório aberto no terminal atual.")
                  )
              )
              .child(
                div()
                  .id("toggle-autodetect")
                  .cursor_pointer()
                  .px(10)
                  .py(4)
                  .rounded(5)
                  .bg(CONFIG?.autoDetectCurrentRepo !== false ? t.accent : t.raised)
                  .text_color(CONFIG?.autoDetectCurrentRepo !== false ? t.accent_foreground : t.muted)
                  .text_size(11)
                  .on_click((_e, cx) => {
                    const next = CONFIG?.autoDetectCurrentRepo === false;
                    this.saveConfig({ autoDetectCurrentRepo: next }, cx);
                  })
                  .child(CONFIG?.autoDetectCurrentRepo !== false ? "Ativado ✓" : "Desativado")
              )
          )
      )
      // 3. Atalho para editar config.js externamente
      .child(
        h_flex()
          .pt(8)
          .items_center()
          .justify_between()
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child("Arquivo de configuração: ~/.config/herdr-app/mods/worktrees/config.js")
          )
          .child(
            div()
              .id("btn-open-file-config")
              .cursor_pointer()
              .px(10)
              .py(4)
              .rounded(5)
              .bg(t.raised)
              .text_size(11)
              .text_color(t.accent)
              .hover((s) => s.bg(t.hover))
              .on_click(() => {
                exec("xdg-open", [`${this.userHome}/.config/herdr-app/mods/worktrees/config.js`]);
              })
              .child("✏️ Editar arquivo completo")
          )
      );
  }

  renderCreateView(t, cx) {
    const repoList = this.repos.map((r) => r.repo_id);

    return v_flex()
      .id("orchestrator-create-view")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(14)
      .bg(t.popover)
      .child(
        // Header
        h_flex()
          .items_center()
          .justify_between()
          .child(
            div()
              .font_bold()
              .text_size(15)
              .text_color(t.foreground)
              .child("Nova Worktree")
          )
          .child(
            div()
              .id("btn-cancel-create")
              .cursor_pointer()
              .px(10)
              .py(4)
              .rounded(5)
              .bg(t.raised)
              .text_size(12)
              .text_color(t.foreground)
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => {
                this.creating = false;
                this.createError = "";
                cx.notify();
              })
              .child("← Voltar (Esc)")
          )
      )
      .child(
        // 1. Escolha de Repositório
        v_flex()
          .gap(6)
          .child(
            div()
              .font_semibold()
              .text_size(12)
              .text_color(t.muted)
              .child("1. Selecione o Repositório")
          )
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .children(
                repoList.slice(0, 8).map((rId) => {
                  const isSel = this.newRepo === rId;
                  return div()
                    .id(`chip-repo-${rId}`)
                    .cursor_pointer()
                    .px(8)
                    .py(4)
                    .rounded(5)
                    .text_size(11.5)
                    .bg(isSel ? t.accent : t.surface)
                    .text_color(isSel ? t.accent_foreground : t.foreground)
                    .border(1)
                    .border_color(isSel ? t.accent : t.border)
                    .hover((s) => (!isSel ? s.bg(t.raised) : null))
                    .on_click((_e, cx) => {
                      this.newRepo = rId;
                      cx.notify();
                    })
                    .child(rId);
                })
              )
          )
      )
      .child(
        // 2. Nome da Branch
        v_flex()
          .gap(6)
          .child(
            div()
              .font_semibold()
              .text_size(12)
              .text_color(t.muted)
              .child("2. Nome da Branch")
          )
          .child(
            Input.new(this.branchInput)
              .h(34)
              .px(10)
              .items_center()
              .rounded(6)
              .border(1)
              .border_color(t.input)
              .bg(t.background)
              .text_color(t.foreground)
          )
      )
      .child(
        // 3. Localização da Pasta (Orchestrator vs Herdr)
        v_flex()
          .gap(6)
          .child(
            div()
              .font_semibold()
              .text_size(12)
              .text_color(t.muted)
              .child("3. Onde criar o diretório?")
          )
          .child(
            h_flex()
              .gap(10)
              .child(
                h_flex()
                  .id("btn-opt-orch")
                  .cursor_pointer()
                  .p(10)
                  .flex_1()
                  .rounded(6)
                  .border(1)
                  .border_color(
                    this.newLocation === "orchestrator" ? t.accent : t.border
                  )
                  .bg(
                    this.newLocation === "orchestrator" ? t.raised : t.surface
                  )
                  .on_click((_e, cx) => {
                    this.newLocation = "orchestrator";
                    cx.notify();
                  })
                  .child(
                    v_flex()
                      .gap(2)
                      .child(
                        div()
                          .font_semibold()
                          .text_color(t.foreground)
                          .child("Orchestrator (Recomendado)")
                      )
                      .child(
                        div()
                          .text_size(11)
                          .text_color(t.dim)
                          .child("~/orchestrator/worktrees (compatível com Docker/k3s)")
                      )
                  )
              )
              .child(
                h_flex()
                  .id("btn-opt-herdr")
                  .cursor_pointer()
                  .p(10)
                  .flex_1()
                  .rounded(6)
                  .border(1)
                  .border_color(
                    this.newLocation === "herdr" ? t.accent : t.border
                  )
                  .bg(this.newLocation === "herdr" ? t.raised : t.surface)
                  .on_click((_e, cx) => {
                    this.newLocation = "herdr";
                    cx.notify();
                  })
                  .child(
                    v_flex()
                      .gap(2)
                      .child(
                        div()
                          .font_semibold()
                          .text_color(t.foreground)
                          .child("Herdr HC Global")
                      )
                      .child(
                        div()
                          .text_size(11)
                          .text_color(t.dim)
                          .child("~/.herdr/worktrees (padrão dos menus nativos do Herdr)")
                      )
                  )
              )
          )
      )
      .when(Boolean(this.createError), (el) =>
        el.child(
          div()
            .p(8)
            .rounded(5)
            .bg(t.surface)
            .text_color(t.blocked)
            .child(`Erro: ${this.createError}`)
        )
      )
      .child(
        // Botão de Submit
        h_flex()
          .gap(10)
          .items_center()
          .child(
            div()
              .id("btn-submit-create")
              .cursor_pointer()
              .px(14)
              .py(8)
              .rounded(6)
              .bg(t.solid)
              .font_semibold()
              .text_size(12.5)
              .text_color(t.solid_foreground)
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.submitCreate(cx))
              .child(
                this.createBusy
                  ? "Criando Worktree..."
                  : "Criar e Abrir Space no Herdr"
              )
          )
      );
  }

  renderDiffView(t, cx) {
    const wt = this.selectedWt;
    const diffLines = (this.diffText || "").split("\n");

    return v_flex()
      .id("orchestrator-diff-view")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .child(
        // Header do Diff
        h_flex()
          .items_center()
          .justify_between()
          .child(
            v_flex()
              .child(
                div()
                  .font_bold()
                  .text_size(14)
                  .text_color(t.foreground)
                  .child(`Alterações em ${wt.repo_id} (${wt.branch})`)
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child(tilde(wt.path, this.userHome))
              )
          )
          .child(
            div()
              .id("btn-back-from-diff")
              .cursor_pointer()
              .px(10)
              .py(4)
              .rounded(5)
              .bg(t.raised)
              .text_size(12)
              .text_color(t.foreground)
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => {
                this.selectedWt = null;
                cx.notify();
              })
              .child("← Voltar para lista (Esc)")
          )
      )
      // Lista de arquivos alterados
      .when(this.diffFiles.length > 0, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .p(8)
            .rounded(6)
            .bg(t.background)
            .overflow_x_scroll()
            .children(
              this.diffFiles.map((f, i) =>
                div()
                  .id(`file-${i}`)
                  .px(6)
                  .py(2)
                  .rounded(4)
                  .bg(t.surface)
                  .text_size(11)
                  .text_color(t.foreground)
                  .child(f)
              )
            )
        )
      )
      // Corpo do Diff
      .when(this.diffLoading, (el) =>
        el
          .flex_1()
          .items_center()
          .justify_center()
          .child(div().text_color(t.muted).child("Carregando diff..."))
      )
      .when(!this.diffLoading, (el) =>
        el
          .flex_1()
          .min_h(0)
          .rounded(6)
          .p(10)
          .bg(t.background)
          .border(1)
          .border_color(t.border)
          .child(
            v_flex()
              .id("diff-text-scroll")
              .size_full()
              .overflow_y_scroll()
              .children(
                diffLines.map((line, idx) => {
                  let textColor = t.foreground;
                  let lineBg = null;
                  if (line.startsWith("+")) {
                    textColor = t.ansi2 || "#3fae6a";
                    lineBg = t.hover;
                  } else if (line.startsWith("-")) {
                    textColor = t.ansi1 || "#d9649a";
                    lineBg = t.hover;
                  } else if (line.startsWith("@")) {
                    textColor = t.ansi4 || "#5b8def";
                  }
                  return div()
                    .id(`diff-line-${idx}`)
                    .when(Boolean(lineBg), (el) => el.bg(lineBg))
                    .text_color(textColor)
                    .text_size(12)
                    .child(line || " ");
                })
              )
          )
      );
  }
}
