import { View, div } from "gpui-kit";
import { run, nextCommand, focused, terminals } from "herdr";

export default class TerminalBrowser extends View {
  init(_props, cx) {
    cx.spawn(async cx => {
      for (;;) {
        const cmd = await nextCommand();
        if (!cmd) continue;
        if (cmd === "terminal-browser.open" || cmd === "terminal-browser") {
          this.openBrowser(cx);
        } else if (cmd === "terminal-browser.toggle") {
          this.toggleBrowser(cx);
        }
      }
    });
  }

  isBrowserTerminal(t) {
    const fg = t?.foreground?.name || "";
    const argv = (t?.foreground?.argv || []).join(" ");
    return fg.includes("terminal-browser") || argv.includes("terminal-browser") || t?.name === "Browser";
  }

  openBrowser(cx, url = null) {
    const argv = ["terminal-browser", "open"];
    if (url) argv.push(url);
    run("terminal.open", {
      argv,
      name: "Browser",
      place: "right",
    });
  }

  toggleBrowser(cx) {
    const live = terminals().filter(t => t.state === "live" && this.isBrowserTerminal(t));
    if (live.length > 0) {
      const f = focused();
      const currentIsBrowser = live.some(t => t.address === f?.terminal);
      if (currentIsBrowser) {
        run("pane.close", { terminal: f.terminal });
      } else {
        run("pane.focus", { terminal: live[0].address });
      }
    } else {
      this.openBrowser(cx);
    }
  }

  render() {
    return div();
  }
}