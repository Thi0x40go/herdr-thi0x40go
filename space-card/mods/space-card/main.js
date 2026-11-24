// Link Space to Card / Group modal dialog.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, shared, setShared, readTextFile, writeTextFile, home, exec } from "herdr";

const SPACES_CARDS_FILE = () => `${home()}/.local/share/herdr/spaces-cards.json`;
const TODOS_DIR = () => `${home()}/.local/share/herdr/todos`;

export function normalizeCard(str) {
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

function detectCardFromName(name) {
  if (!name) return "";
  const m = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(name);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : "";
}

export default class SpaceCardDialog extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    const p = props() ?? {};
    this.overlay = p.overlay;
    this.spaceId = p.space;
    this.folder = p.folder;
    this.space = spaces().find((s) => s.id === this.spaceId);
    if (!this.folder && this.space) {
      const tabs = new Set((this.space.tabs ?? []).map((c) => c.id));
      this.folder = panes().find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || this.space.folder;
    }

    const sc = shared("spaces.cards") ?? {};
    const explicitSpace = sc.spaces?.[this.spaceId];
    const explicitFolder = this.folder ? sc.folders?.[this.folder] : null;
    let initialCards = [];
    if (explicitSpace === "none") {
      initialCards = [];
    } else if (explicitSpace) {
      initialCards = parseCards(explicitSpace);
    } else if (explicitFolder === "none") {
      initialCards = [];
    } else if (explicitFolder) {
      initialCards = parseCards(explicitFolder);
    } else {
      const fromP = p.card ? parseCards(p.card) : [];
      const fromName = detectCardFromName(this.space?.name);
      initialCards = fromP.length ? fromP : (fromName ? [fromName] : []);
    }
    this.selectedCards = new Set(initialCards);
    this.currentCards = [...this.selectedCards];
    this.text = this.currentCards.join(", ");

    this.input = InputState.new({ value: this.text, placeholder: "e.g. EVAH-1303, CARD-2467..." });
    this.input.on("submit", (_e, cx) => this.save(cx));
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.selectedCards = new Set(parseCards(this.text));
      cx.notify();
    });
    this.inputFocused = true;
    this.input.on("focus", () => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", () => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());

    this.existingGroups = [];
    this.loadExistingCards(cx);
  }

  loadExistingCards(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", `grep -hoE '<!-- meta: .* -->|\\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?[0-9]+\\b' "${TODOS_DIR()}"/*.md 2>/dev/null`]);
        const counts = {};
        if (r.code === 0 && r.stdout) {
          const lines = r.stdout.split("\n");
          for (const l of lines) {
            let grp = null;
            const metaM = /<!-- meta: (\{.*?\}) -->/.exec(l);
            if (metaM) {
              try {
                const parsed = JSON.parse(metaM[1]);
                if (parsed.group) grp = normalizeCard(parsed.group);
              } catch {}
            }
            if (!grp) {
              const cardM = /\b(CARD|EVAH|TASK|PROJ|ISSUE)[-_ ]?([0-9]+)\b/i.exec(l);
              if (cardM) grp = `${cardM[1].toUpperCase()}-${cardM[2]}`;
            }
            if (grp) {
              grp = grp.toUpperCase();
              counts[grp] = (counts[grp] ?? 0) + 1;
            }
          }
        }
        this.existingGroups = Object.entries(counts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { numeric: true }));
        cx.notify();
      } catch {}
    });
  }

  async readCardsData() {
    let raw = await readTextFile(SPACES_CARDS_FILE()).catch(() => null);
    const inMem = shared("spaces.cards") ?? {};
    let data = {
      spaces: { ...(inMem.spaces ?? {}) },
      folders: { ...(inMem.folders ?? {}) },
    };
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          data = {
            spaces: { ...(parsed.spaces || parsed.by_id || {}), ...(inMem.spaces ?? {}) },
            folders: { ...(parsed.folders || parsed.by_folder || {}), ...(inMem.folders ?? {}) },
          };
        }
      } catch {}
    }
    return { data, raw };
  }

  async writeCardsData(data) {
    const jsonStr = JSON.stringify(data, null, 2);
    try {
      await exec("python3", [
        "-c",
        "import sys, os; p = os.path.expanduser('~/.local/share/herdr/spaces-cards.json'); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w', encoding='utf-8').write(sys.argv[1])",
        jsonStr,
      ]);
    } catch {
      await writeTextFile(SPACES_CARDS_FILE(), jsonStr, null).catch(() => null);
    }
    setShared("spaces.cards", data);
  }

  pickCard(cardName, cx) {
    const card = normalizeCard(cardName);
    if (!card) return;
    if (this.selectedCards.has(card)) {
      this.selectedCards.delete(card);
    } else {
      this.selectedCards.add(card);
    }
    const val = [...this.selectedCards].join(", ");
    this.text = val;
    this.input.set_value(val);
    this.input.focus();
    cx.notify();
  }

  removeCard(cardName, cx) {
    this.selectedCards.delete(cardName);
    const val = [...this.selectedCards].join(", ");
    this.text = val;
    this.input.set_value(val);
    this.input.focus();
    cx.notify();
  }

  save(cx) {
    const rawVal = this.text || this.input.value();
    const cards = parseCards(rawVal);
    const overlay = this.overlay || props()?.overlay;

    if (cards.length === 0) {
      this.unlink(cx);
      return;
    }

    const cardValue = cards.join(", ");

    // 1. Atualização otimista imediata na memória
    const sc = shared("spaces.cards") ?? { spaces: {}, folders: {} };
    const currentSc = {
      spaces: { ...(sc.spaces ?? {}) },
      folders: { ...(sc.folders ?? {}) },
    };
    if (this.spaceId) currentSc.spaces[this.spaceId] = cardValue;
    if (this.folder) currentSc.folders[this.folder] = cardValue;
    setShared("spaces.cards", currentSc);

    // 2. Grava no disco e SÓ DEPOIS fecha o overlay
    cx.spawn(async (cx) => {
      try {
        const { data } = await this.readCardsData();
        if (this.spaceId) data.spaces[this.spaceId] = cardValue;
        if (this.folder) data.folders[this.folder] = cardValue;
        await this.writeCardsData(data);
      } catch (err) {
        console.error("Failed to save space card:", err);
      } finally {
        if (overlay) closeOverlay(overlay);
        cx.notify();
      }
    });
  }

  unlink(cx) {
    const overlay = this.overlay || props()?.overlay;

    // 1. Atualização otimista imediata
    const sc = shared("spaces.cards") ?? { spaces: {}, folders: {} };
    const currentSc = {
      spaces: { ...(sc.spaces ?? {}) },
      folders: { ...(sc.folders ?? {}) },
    };
    if (this.spaceId) currentSc.spaces[this.spaceId] = "none";
    if (this.folder) currentSc.folders[this.folder] = "none";
    setShared("spaces.cards", currentSc);

    // 2. Grava no disco e SÓ DEPOIS fecha o overlay
    cx.spawn(async (cx) => {
      try {
        const { data } = await this.readCardsData();
        if (this.spaceId) data.spaces[this.spaceId] = "none";
        if (this.folder) data.folders[this.folder] = "none";
        await this.writeCardsData(data);
      } catch (err) {
        console.error("Failed to unlink space card:", err);
      } finally {
        if (overlay) closeOverlay(overlay);
        cx.notify();
      }
    });
  }

  render(cx) {
    const t = theme();
    const spaceName = this.space?.name || "Space";
    const shortFolder = this.folder ? this.folder.replace(new RegExp(`^${home()}`), "~") : "";
    const activeCards = [...this.selectedCards];

    const button = (id, text, primary, action, danger = false) =>
      h_flex()
        .id(id)
        .h(32)
        .px(14)
        .items_center()
        .rounded(8)
        .border_1()
        .border_color(danger ? (t.ansi1 + "55") : primary ? t.solid : t.input)
        .bg(danger ? (t.ansi1 + "22") : primary ? t.solid : t.raised)
        .text_color(danger ? t.ansi1 : primary ? t.solid_foreground : t.foreground)
        .text_size(12.5)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_click(action)
        .child(text);

    return v_flex()
      .id("space-card-dialog")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .bg(t.popover)
      .text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          const overlay = this.overlay || props()?.overlay;
          if (overlay) closeOverlay(overlay);
          cx.stop_propagation();
        }
      })
      .child(
        // Header
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(svg("mods/workspace-chrome/tag.svg").size(16).text_color(t.ansi6))
              .child(
                div()
                  .text_size(15)
                  .font_semibold()
                  .child(`Link Space #${spaceName} to Cards`),
              ),
          )
          .child(
            div()
              .id("scd-esc")
              .px(6)
              .py(2)
              .rounded(5)
              .text_size(11)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => {
                const overlay = this.overlay || props()?.overlay;
                if (overlay) closeOverlay(overlay);
              })
              .child("Esc"),
          ),
      )
      .when(Boolean(shortFolder), (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .text_size(11.5)
            .text_color(t.dim)
            .child(svg("mods/workspace-chrome/folder.svg").size(12))
            .child(div().truncate().child(shortFolder)),
        ),
      )
      // Input Section
      .child(
        v_flex()
          .pt(4)
          .gap(6)
          .child(
            h_flex()
              .justify_between()
              .items_center()
              .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Card / Group IDs"))
              .when(Boolean(this.text || this.input.value() || this.selectedCards.size > 0), (el) =>
                el.child(
                  div()
                    .text_size(11)
                    .text_color(t.dim)
                    .cursor_pointer()
                    .hover((s) => s.text_color(t.foreground))
                    .on_click((_e, cx) => {
                      this.selectedCards.clear();
                      this.text = "";
                      this.input.set_value("");
                      this.input.focus();
                      cx.notify();
                    })
                    .child("Clear"),
                ),
              ),
          )
          // Chips of selected cards
          .when(activeCards.length > 0, (el) =>
            el.child(
              h_flex()
                .flex_wrap()
                .gap(6)
                .children(
                  activeCards.map((c) =>
                    h_flex()
                      .h(24)
                      .px(8)
                      .rounded(6)
                      .gap(5)
                      .items_center()
                      .bg(t.ansi6 + "22")
                      .border_1()
                      .border_color(t.ansi6 + "66")
                      .child(div().text_size(11).font_bold().text_color(t.ansi6).child("#" + c))
                      .child(
                        div()
                          .size(14)
                          .rounded(4)
                          .flex()
                          .items_center()
                          .justify_center()
                          .cursor_pointer()
                          .hover((s) => s.bg(t.ansi6 + "44"))
                          .on_click((_e, cx) => {
                            cx.stop_propagation();
                            this.removeCard(c, cx);
                          })
                          .child(svg("mods/workspace-chrome/x.svg").size(8).text_color(t.ansi6)),
                      ),
                  ),
                ),
            ),
          )
          .child(
            h_flex()
              .h(36)
              .px(10)
              .rounded(9)
              .border_1()
              .border_color(this.inputFocused ? t.accent : t.input)
              .bg(t.background)
              .items_center()
              .gap(6)
              .child(div().text_size(13).font_semibold().text_color(t.ansi6).child("#"))
              .child(
                Input.new(this.input)
                  .flex_1()
                  .h_full()
                  .text_size(12.8)
                  .text_color(t.foreground),
              ),
          )
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child("Enter one or more cards (comma-separated, e.g. EVAH-1303, CARD-2467) or click existing cards below."),
          ),
      )
      // Existing cards section
      .child(
        v_flex()
          .pt(6)
          .gap(8)
          .flex_1()
          .min_h(0)
          .child(
            div()
              .text_size(11.5)
              .font_semibold()
              .text_color(t.muted)
              .child("Existing Project Cards:"),
          )
          .child(
            this.existingGroups.length === 0
              ? div().text_size(11.5).text_color(t.dim).child("No cards found in to-do lists.")
              : h_flex()
                  .flex_wrap()
                  .gap(7)
                  .max_h(130)
                  .overflow_hidden()
                  .children(
                    this.existingGroups.map((g) => {
                      const isPicked = this.selectedCards.has(g.name);
                      return h_flex()
                        .id(`pick-card-${g.name}`)
                        .px(8)
                        .py(5)
                        .rounded(6)
                        .items_center()
                        .gap(6)
                        .cursor_pointer()
                        .border_1()
                        .border_color(isPicked ? t.ansi6 : t.border)
                        .bg(isPicked ? (t.ansi6 + "28") : t.raised)
                        .hover((s) => s.bg(t.hover).border_color(t.ansi6))
                        .on_click((_e, cx) => this.pickCard(g.name, cx))
                        .when(isPicked, (el) =>
                          el.child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.ansi6)),
                        )
                        .child(
                          div()
                            .text_size(11.5)
                            .font_semibold()
                            .text_color(isPicked ? t.foreground : t.ansi6)
                            .child(`#${g.name}`),
                        )
                        .child(
                          div()
                            .text_size(10)
                            .text_color(t.dim)
                            .child(`(${g.count})`),
                        );
                    }),
                  ),
          ),
      )
      // Footer
      .child(
        h_flex()
          .pt(12)
          .items_center()
          .justify_between()
          .child(
            this.currentCards.length > 0
              ? button("scd-unlink", "Unlink All Cards", false, (_e, cx) => this.unlink(cx), true)
              : div(),
          )
          .child(
            h_flex()
              .gap(8)
              .child(button("scd-cancel", "Cancel", false, () => {
                const overlay = this.overlay || props()?.overlay;
                if (overlay) closeOverlay(overlay);
              }))
              .child(button("scd-save", "Save Links", true, (_e, cx) => this.save(cx))),
          ),
      );
  }
}
