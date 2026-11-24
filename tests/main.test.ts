import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile, fake, type FakeRequest } from "./obsidian-stub";
import EpitreePlugin, { TOKEN_SECRET_ID, describeReport } from "../src/main";
import { PreviewModal } from "../src/modals";
import type { NoteIn } from "../src/types";
import { fakeApp, type FakeNote } from "./fake-app";

type Answer = { status: number; json?: unknown; headers?: Record<string, string> };

let sent: NoteIn[][];
let answer: (request: FakeRequest) => Answer;

const allowance = { used: 1, limit: 200, remaining: 199, period: "once" };

beforeEach(() => {
  Notice.shown = [];
  sent = [];
  answer = (request) => {
    if (request.method === "GET") return { status: 200, json: { notes: 0, words: 0, pending: 0, allowance } };
    const notes = (JSON.parse(request.body!) as { notes: NoteIn[] }).notes;
    if (request.url.endsWith("/preview")) {
      return { status: 200, json: { new: notes.length, changed: 0, unchanged: 0, needed: notes.length, allowance } };
    }
    sent.push(notes);
    return { status: 200, json: { results: notes.map((n) => ({ key: n.key, status: "added", word_ids: [1] })), allowance } };
  };
  fake.request = async (request) => answer(request);
});

afterEach(() => {
  fake.request = null;
  vi.restoreAllMocks();
});

async function loaded(notes: Record<string, FakeNote> = {}, data: unknown = null) {
  const env = fakeApp(notes);
  const plugin = new EpitreePlugin(env.app as never, {} as never);
  (plugin as unknown as { data: unknown }).data = data;
  await plugin.onload();
  type Saved = { settings: Record<string, unknown>; state: { renames: Record<string, string> } };
  return { plugin, env, saved: () => (plugin as unknown as { data: Saved }).data };
}

const notices = () => Notice.shown.map((n) => n.message);

describe("loading", () => {
  it("makes a vault key once and keeps it", async () => {
    const first = await loaded();
    const key = first.plugin.settings.vaultKey;
    expect(key).toMatch(/^[0-9a-f]{16}$/);

    const second = await loaded({}, first.saved());
    expect(second.plugin.settings.vaultKey).toBe(key);
  });

  it("gives each fresh install its own folder list, not the shared defaults", async () => {
    const first = await loaded();
    first.plugin.settings.rules.push({ folder: "Vocab", mode: "word", keepFolders: true });
    first.plugin.settings.exclude.push("Private/");

    const second = await loaded();

    expect(second.plugin.settings.rules).toEqual([]);
    expect(second.plugin.settings.exclude).toEqual(["Templates/", ".trash/"]);
  });

  it("keeps the token in Obsidian's secret storage, not in data.json", async () => {
    const { plugin, env, saved } = await loaded();
    plugin.setToken("  ept_secret  ");
    await plugin.saveAll();

    expect(env.secrets.get(TOKEN_SECRET_ID)).toBe("ept_secret");
    expect(plugin.token()).toBe("ept_secret");
    expect(JSON.stringify(saved())).not.toContain("ept_secret");
  });

  it("adds its commands and ribbon icon", async () => {
    const { plugin } = await loaded();
    const ids = (plugin as unknown as { commands: { id: string }[] }).commands.map((c) => c.id);
    expect(ids).toEqual(["preview-import", "sync-changed-notes", "import-current-note", "resend-all-notes"]);
    expect((plugin as unknown as { ribbon: { icon: string }[] }).ribbon[0].icon).toBe("sprout");
  });
});

describe("syncing from Obsidian", () => {
  const vocab: Record<string, FakeNote> = {
    "Vocab/Tisch.md": {
      content: "---\ndefinition: a table\n---\nBought at IKEA.",
      frontmatter: { definition: "a table" },
      bodyStart: "---\ndefinition: a table\n---\n".length,
      links: ["Vocab/Stuhl.md"],
      tags: ["#nouns"],
    },
    "Vocab/Stuhl.md": { content: "Definition: a chair" },
    "Diary/Monday.md": { content: "private" },
  };

  async function ready() {
    const env = await loaded(vocab);
    env.plugin.setToken("ept_x");
    env.plugin.settings.rules = [{ folder: "Vocab", mode: "word", keepFolders: true }];
    return env;
  }

  it("sends what Obsidian parsed: frontmatter, body, links and tags", async () => {
    const { plugin } = await ready();

    await plugin.runSync();

    const tisch = sent[0].find((n) => n.path === "Vocab/Tisch.md")!;
    expect(tisch).toMatchObject({
      definition: "a table",
      notes: "Bought at IKEA.",
      links: [`${plugin.settings.vaultKey}/Vocab/Stuhl.md`],
      tags: ["nouns"],
      folder: "Vocab",
      vault: "My Vault",
    });
    expect(sent.flat().map((n) => n.path)).not.toContain("Diary/Monday.md");
    expect(notices()).toEqual(["Epitree: 2 new."]);
  });

  it("asks for a token before anything else", async () => {
    const { plugin } = await loaded(vocab);
    plugin.settings.rules = [{ folder: "Vocab", mode: "word", keepFolders: true }];

    await plugin.runSync();
    await plugin.runSync(undefined, true);

    expect(notices()).toEqual(["Epitree: add your access token in Settings → Epitree first."]);
    expect(sent).toEqual([]);
  });

  it("asks for folders before a full sync, but sends one chosen note without any", async () => {
    const { plugin } = await loaded(vocab);
    plugin.setToken("ept_x");

    await plugin.runSync();
    await plugin.runSync(["Diary/Monday.md"]);

    expect(notices()[0]).toBe("Epitree: choose which folders to send in Settings → Epitree first.");
    expect(sent.flat().map((n) => n.path)).toEqual(["Diary/Monday.md"]);
  });

  it("stays quiet on an automatic sync with nothing new", async () => {
    const { plugin } = await ready();
    await plugin.runSync();
    Notice.shown = [];

    await plugin.runSync(undefined, true);

    expect(notices()).toEqual([]);
  });

  it("explains a refused token, and clears the status bar", async () => {
    const { plugin } = await ready();
    answer = () => ({ status: 401, json: { detail: "no" } });

    await plugin.runSync();

    expect(notices()[0]).toMatch(/^Epitree: Epitree didn't accept the access token/);
    expect(Notice.shown[0].timeout).toBe(10_000);
    expect((plugin as unknown as { statusBar: { text: string } }).statusBar.text).toBe("");
  });

  it("shows Epitree's message when the allowance runs out", async () => {
    const { plugin } = await ready();
    answer = (request) => {
      const notes = (JSON.parse(request.body!) as { notes: NoteIn[] }).notes;
      return {
        status: 200,
        json: {
          results: notes.map((n) => ({ key: n.key, status: "no_allowance", word_ids: [] })),
          allowance: { ...allowance, remaining: 0 },
          message: "You've imported the 200 notes the Free plan includes.",
        },
      };
    };

    await plugin.runSync(undefined, true);

    expect(notices()).toEqual(["Epitree: 2 not imported.\nYou've imported the 200 notes the Free plan includes."]);
  });

  it("follows a rename and tells Epitree the old key on the next sync", async () => {
    const { plugin, env, saved } = await ready();
    await plugin.runSync();

    env.files.set("Vocab/German/Tisch.md", new TFile("Vocab/German/Tisch.md"));
    vocab["Vocab/German/Tisch.md"] = vocab["Vocab/Tisch.md"];
    env.files.delete("Vocab/Tisch.md");
    env.emit("rename", env.files.get("Vocab/German/Tisch.md"), "Vocab/Tisch.md");
    await plugin.saveAll();

    expect(saved().state.renames).toEqual({ "Vocab/German/Tisch.md": `${plugin.settings.vaultKey}/Vocab/Tisch.md` });
    await plugin.runSync();
    expect(sent[1][0].previous_key).toBe(`${plugin.settings.vaultKey}/Vocab/Tisch.md`);
    delete vocab["Vocab/German/Tisch.md"];
  });

  it("forgets a deleted note", async () => {
    const { plugin, env } = await ready();
    await plugin.runSync();
    env.emit("delete", env.files.get("Vocab/Stuhl.md"));
    expect(Object.keys(plugin.state.notes)).toEqual(["Vocab/Tisch.md"]);
  });

  it("offers 'Send this note' only for an open Markdown note", async () => {
    const { plugin, env } = await ready();
    const command = (plugin as unknown as { commands: { id: string; checkCallback: (c: boolean) => boolean }[] }).commands.find(
      (c) => c.id === "import-current-note",
    )!;

    expect(command.checkCallback(true)).toBe(false);
    env.workspace.active = new TFile("picture.png");
    expect(command.checkCallback(true)).toBe(false);
    env.workspace.active = env.files.get("Vocab/Stuhl.md")!;
    expect(command.checkCallback(true)).toBe(true);

    command.checkCallback(false);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].map((n) => n.path)).toEqual(["Vocab/Stuhl.md"]);
  });

  it("opens the preview without sending anything", async () => {
    const { plugin } = await ready();
    const open = vi.spyOn(PreviewModal.prototype, "open").mockImplementation(() => {});

    await plugin.openPreview();

    expect(open).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
  });

  it("syncs when Obsidian starts and then on a timer of at least 5 minutes", async () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const { plugin, env } = await loaded(vocab, {
      settings: { autoSync: true, autoSyncMinutes: 1, rules: [{ folder: "Vocab", mode: "word", keepFolders: true }] },
    });
    plugin.setToken("ept_x");

    env.ready();
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000);
    plugin.onunload();
  });
});

describe("describeReport", () => {
  const empty = { added: 0, merged: 0, updated: 0, unchanged: 0, queued: 0, no_allowance: 0, skipped: 0, sent: 0, message: null, upgradeUrl: null, allowance: null };

  it("says when there was nothing to do", () => {
    expect(describeReport(empty)).toBe("Epitree: everything is up to date.");
  });

  it("names each kind of result", () => {
    expect(describeReport({ ...empty, added: 3, merged: 1, updated: 2, queued: 1, no_allowance: 4 })).toBe(
      "Epitree: 3 new, 1 joined words you had, 2 updated, 1 sent to the AI to find terms, 4 not imported.",
    );
  });
});
