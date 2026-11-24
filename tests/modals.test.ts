import { describe, expect, it, vi } from "vitest";
import { ButtonComponent, Setting } from "./obsidian-stub";
import { PreviewModal } from "../src/modals";
import type { PreviewResponse } from "../src/types";

type Preview = PreviewResponse & { toSend: number };

function open(preview: Preview) {
  Setting.all = [];
  const onImport = vi.fn();
  const modal = new PreviewModal({} as never, preview, onImport);
  modal.open();
  const text = (modal as unknown as { contentEl: { allText(): string[] } }).contentEl.allText();
  const buttons = Setting.all.flatMap((s) => s.components.filter((c): c is ButtonComponent => c instanceof ButtonComponent));
  return { modal, text, buttons, onImport };
}

const allowance = (remaining: number, period: "once" | "month" = "once") => ({ used: 200 - remaining, limit: 200, remaining, period });

describe("PreviewModal", () => {
  it("says when there is nothing to send, with only a Close button", () => {
    const { text, buttons } = open({ new: 0, changed: 0, unchanged: 0, needed: 0, toSend: 0, allowance: allowance(150) });
    expect(text).toContain("Everything in your chosen folders is already in Epitree.");
    expect(buttons.map((b) => b.text)).toEqual(["Close"]);
  });

  it("counts the notes and what they use, and sends on Send", async () => {
    const { modal, text, buttons, onImport } = open({ new: 3, changed: 1, unchanged: 0, needed: 3, toSend: 4, allowance: allowance(150) });

    expect(text).toContain("3 new notes, 1 changed note.");
    expect(text.join(" ")).toContain("up to 3 notes of your import allowance");
    expect(text).toContain("150 of the 200 notes included with the Free plan are left.");
    expect(text.join(" ")).not.toContain("won't fit");

    await buttons.find((b) => b.text === "Send")!.click();
    expect(onImport).toHaveBeenCalledOnce();
    expect((modal as unknown as { isOpen: boolean }).isOpen).toBe(false);
  });

  it("warns when the notes won't all fit, and counts per month on a paid plan", () => {
    const { text } = open({ new: 10, changed: 0, unchanged: 0, needed: 10, toSend: 10, allowance: allowance(4, "month") });
    expect(text).toContain("4 of 200 notes left this month.");
    expect(text.join(" ")).toContain("Some notes won't fit.");
  });

  it("cancels without sending", async () => {
    const { buttons, onImport } = open({ new: 1, changed: 0, unchanged: 0, needed: 1, toSend: 1, allowance: allowance(150) });
    await buttons.find((b) => b.text === "Cancel")!.click();
    expect(onImport).not.toHaveBeenCalled();
  });
});
