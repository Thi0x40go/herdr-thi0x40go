// Link Space to Card / Group modal dialog.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, shared, setShared, readTextFile, writeTextFile, home, exec } from "herdr";

const SPACES_CARDS_FILE = () => `${home()}/.local/share/herdr/spaces-cards.json`;
const TODOS_DIR = () => `${home()}/.local/share/herdr/todos`;

function normalizeCard(str) {
  if (!str) return "";
  const c = str.trim().replace(/^#/, "").trim();
  return /^(card|task|proj|issue)-/i.test(c) ? c.toUpperCase() : c;
}

export default class SpaceCardDialog extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    const p = props() ?? {};
    this.spaceId = p.space;
    this.folder = p.folder;
    this.space = spaces().find((s) => s.id === this.spaceId);
    if (!this.folder && this.space) {
      const tabs = new Set((this.space.tabs ?? []).map((c) => c.id));
      this.folder = panes().find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || this.space.folder;
    }

    const sc = shared("spaces.cards") ?? {};
    this.currentCard = p.card || sc.spaces?.[this.spaceId] || (this.folder ? sc.folders?.[this.folder] : "") || "";
    this.input = InputState.new({ value: this.currentCard, placeholder: "e.g. CARD-2467, TASK-101..." });
    this.input.on("submit", () => this.save(cx));
    this.input.on("change", () => cx.notify());
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
        const r = await exec("sh", ["-c", `grep -hoE '<!-- meta: .* -->|\\b(CARD-[0-9]+|TASK-[0-9]+)\\b' "${TODOS_DIR()}"/*.md 2>/dev/null`]);
        const counts = {};
        if (r.code === 0 && r.stdout) {
          const lines = r.stdout.split("\n");
          for (const l of lines) {
            let grp = null;
            const metaM = /<!-- meta: (\{.*?\}) -->/.exec(l);
            if (metaM) {
              try {
                const parsed = JSON.parse(metaM[1]);
                if (parsed.group) grp = parsed.group;
              } catch {}
            }
            if (!grp) {
              const cardM = /\b(CARD-[0-9]+|TASK-[0-9]+)\b/i.exec(l);
              if (cardM) grp = cardM[1].toUpperCase();
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
    let data = { spaces: {}, folders: {} };
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          data = {
            spaces: parsed.spaces || (parsed.by_id ?? {}),
            folders: parsed.folders || (parsed.by_folder ?? {}),
          };
        }
      } catch {}
    }
    return data;
  }

  async writeCardsData(data) {
    const jsonStr = JSON.stringify(data, null, 2);
    await writeTextFile(SPACES_CARDS_FILE(), jsonStr).catch(async () => {
      await exec("python3", ["-c", `
import json, os
p = os.path.expanduser("~/.local/share/herdr/spaces-cards.json")
os.makedirs(os.path.dirname(p), exist_ok=True)
with open(p, "w", encoding="utf-8") as f:
    json.dump(${JSON.stringify(data)}, f, indent=2)
      `]);
    });
    setShared("spaces.cards", data);
  }

  pickCard(cardName, cx) {
    this.input.set_value(cardName);
    this.input.focus();
    cx.notify();
  }

  save(cx) {
    const rawVal = this.input.value();
    const card = normalizeCard(rawVal);
    if (!card) {
      this.unlink(cx);
      return;
    }
    cx.spawn(async (cx) => {
      const data = await this.readCardsData();
      if (this.spaceId) data.spaces[this.spaceId] = card;
      if (this.folder) data.folders[this.folder] = card;
      await this.writeCardsData(data);
      closeOverlay(props()?.overlay);
      cx.notify();
    });
  }

  unlink(cx) {
    cx.spawn(async (cx) => {
      const data = await this.readCardsData();
      if (this.spaceId && data.spaces) delete data.spaces[this.spaceId];
      if (this.folder && data.folders) delete data.folders[this.folder];
      await this.writeCardsData(data);
      closeOverlay(props()?.overlay);
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const currentVal = normalizeCard(this.input.value());
    const spaceName = this.space?.name || "Space";
    const shortFolder = this.folder ? this.folder.replace(new RegExp(`^${home()}`), "~") : "";

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
          closeOverlay(props()?.overlay);
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
                  .child(`Link Space #${spaceName} to Card`),
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
              .on_click(() => closeOverlay(props()?.overlay))
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
              .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Card / Group ID"))
              .when(Boolean(this.input.value()), (el) =>
                el.child(
                  div()
                    .text_size(11)
                    .text_color(t.dim)
                    .cursor_pointer()
                    .hover((s) => s.text_color(t.foreground))
                    .on_click((_e, cx) => {
                      this.input.set_value("");
                      this.input.focus();
                      cx.notify();
                    })
                    .child("Clear"),
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
              .child("Enter a card identifier like CARD-2467, or click an existing one below."),
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
                  .wrap()
                  .gap(7)
                  .max_h(130)
                  .overflow_hidden()
                  .children(
                    this.existingGroups.map((g) => {
                      const isPicked = currentVal === g.name;
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
            this.currentCard
              ? button("scd-unlink", "Unlink Card", false, () => this.unlink(cx), true)
              : div(),
          )
          .child(
            h_flex()
              .gap(8)
              .child(button("scd-cancel", "Cancel", false, () => closeOverlay(props()?.overlay)))
              .child(button("scd-save", "Save Link", true, () => this.save(cx))),
          ),
      );
  }
}
