import { View, div } from "gpui-kit";
import { exec, home, run, shared, setShared, nextCommand, focused, panes, spaces, terminals } from "herdr";

const HELPER = `${home()}/.config/herdr-app/mods/hibernate/helper.py`;

export default class Hibernate extends View {
  init(_props, cx) {
    this.refreshState(cx);

    // Auto-revive kept terminals on startup (initial check and follow-up once shells settle)
    cx.timer.after(1500, cx => this.autoRevive(cx));
    cx.timer.after(4500, cx => this.autoRevive(cx));

    // Periodically sync sleeping state every 10s
    cx.timer.every(10000, cx => this.refreshState(cx));

    // Handle commands
    cx.spawn(async cx => {
      for (;;) {
        const cmd = await nextCommand();
        if (!cmd) continue;
        if (cmd === "hibernate.sleep_pane") {
          await this.handleSleepPane(cx);
        } else if (cmd === "hibernate.wake_pane") {
          await this.handleWakePane(cx);
        } else if (cmd === "hibernate.toggle_pane") {
          await this.handleTogglePane(cx);
        } else if (cmd === "hibernate.sleep_space") {
          await this.handleSleepSpace(cx);
        } else if (cmd === "hibernate.wake_space") {
          await this.handleWakeSpace(cx);
        } else if (cmd === "hibernate.toggle_space") {
          await this.handleToggleSpace(cx);
        } else if (cmd === "hibernate.revive" || cmd === "hibernate.auto_revive") {
          await this.autoRevive(cx);
        } else if (cmd === "hibernate.sleep") {
          await this.handleTogglePane(cx);
        } else if (cmd === "hibernate.wake") {
          await this.handleWakePane(cx);
        }
      }
    });
  }

  async autoRevive(cx) {
    try {
      await exec("python3", [HELPER, "auto-revive"]);
      await this.refreshState(cx);
    } catch {}
  }

  async refreshState(cx) {
    try {
      const res = await exec("python3", [HELPER, "list"]);
      if (res.code === 0) {
        const data = JSON.parse(res.stdout);
        setShared("hibernate.sleeping", data);
        cx.notify();
      }
    } catch {}
  }

  targetTerminal(args) {
    if (args?.terminal) return args.terminal;
    if (args?.pane) {
      const p = panes().find(x => x.pane === args.pane);
      if (p?.terminal) return p.terminal;
    }
    const f = focused();
    if (f?.terminal) return f.terminal;
    if (f?.pane) {
      const p = panes().find(x => x.pane === f.pane);
      if (p?.terminal) return p.terminal;
    }
    return null;
  }

  async handleSleepPane(cx, args) {
    const term = this.targetTerminal(args);
    if (!term) return;
    try {
      const res = await exec("python3", [HELPER, "sleep", term]);
      if (res.code === 0) {
        await this.refreshState(cx);
      }
    } catch {}
  }

  async handleWakePane(cx, args) {
    const term = this.targetTerminal(args);
    if (!term) return;
    try {
      const res = await exec("python3", [HELPER, "wake", term]);
      if (res.code === 0) {
        await this.refreshState(cx);
      }
    } catch {}
  }

  async handleTogglePane(cx, args) {
    const term = this.targetTerminal(args);
    if (!term) return;
    const sleeping = shared("hibernate.sleeping") ?? {};
    if (sleeping[term]) {
      await this.handleWakePane(cx, { terminal: term });
    } else {
      await this.handleSleepPane(cx, { terminal: term });
    }
  }

  async handleSleepSpace(cx, args) {
    const spaceId = args?.space || spaces().find(s => s.active)?.id;
    if (!spaceId) return;
    const sp = spaces().find(s => s.id === spaceId);
    if (!sp) return;
    const tabIds = new Set((sp.tabs ?? []).map(t => t.id));
    const spacePanes = panes().filter(p => tabIds.has(p.tab) && p.terminal);
    for (const p of spacePanes) {
      try {
        await exec("python3", [HELPER, "sleep", p.terminal]);
      } catch {}
    }
    await this.refreshState(cx);
  }

  async handleWakeSpace(cx, args) {
    const spaceId = args?.space || spaces().find(s => s.active)?.id;
    if (!spaceId) return;
    const sleeping = shared("hibernate.sleeping") ?? {};
    for (const [addr, rec] of Object.entries(sleeping)) {
      if (rec.space === spaceId) {
        try {
          await exec("python3", [HELPER, "wake", addr]);
        } catch {}
      }
    }
    await this.refreshState(cx);
  }

  async handleToggleSpace(cx, args) {
    const spaceId = args?.space || spaces().find(s => s.active)?.id;
    if (!spaceId) return;
    const sleeping = shared("hibernate.sleeping") ?? {};
    const anySleeping = Object.values(sleeping).some(rec => rec.space === spaceId);
    if (anySleeping) {
      await this.handleWakeSpace(cx, { space: spaceId });
    } else {
      await this.handleSleepSpace(cx, { space: spaceId });
    }
  }

  render() {
    return div();
  }
}
