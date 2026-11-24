import { App, Modal, Setting } from "obsidian";
import type { PreviewResponse } from "./types";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** What a sync would do, with a button to go ahead. */
export class PreviewModal extends Modal {
  constructor(
    app: App,
    private readonly preview: PreviewResponse & { toSend: number },
    private readonly onImport: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const p = this.preview;
    const a = p.allowance;
    this.setTitle("Send notes to Epitree");

    if (!p.toSend) {
      contentEl.createEl("p", { text: "Everything in your chosen folders is already in Epitree." });
    } else {
      contentEl.createEl("p", {
        text: `${plural(p.new, "new note", "new notes")}, ${plural(p.changed, "changed note", "changed notes")}.`,
      });
      contentEl.createEl("p", {
        text:
          `This uses up to ${plural(p.needed, "note", "notes")} of your import allowance. ` +
          "Notes for words you already have, and notes that only changed, are free.",
      });
    }
    contentEl.createEl("p", {
      cls: "epitree-muted",
      text:
        a.period === "once"
          ? `${a.remaining.toLocaleString()} of the ${a.limit.toLocaleString()} notes included with the Free plan are left.`
          : `${a.remaining.toLocaleString()} of ${a.limit.toLocaleString()} notes left this month.`,
    });
    if (p.toSend && p.needed > a.remaining) {
      contentEl.createEl("p", {
        cls: "epitree-warning",
        text: "Some notes won't fit. They will be sent on a later sync, once there is room.",
      });
    }

    const buttons = new Setting(contentEl);
    if (p.toSend) {
      buttons.addButton((b) =>
        b
          .setButtonText("Send")
          .setCta()
          .onClick(() => {
            this.close();
            this.onImport();
          }),
      );
    }
    buttons.addButton((b) => b.setButtonText(p.toSend ? "Cancel" : "Close").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
