import { beforeEach, describe, expect, it } from "vitest";
import { EpitreeClient, EpitreeError, type HttpRequest, type HttpResponse } from "../src/client";
import type { NoteSource } from "../src/payload";
import { SyncEngine, type VaultAdapter } from "../src/sync";
import { DEFAULT_SETTINGS, type EpitreeSettings, type NoteIn, type SyncState } from "../src/types";

class FakeVault implements VaultAdapter {
  files = new Map<string, string>();
  markdownPaths() {
    return [...this.files.keys()];
  }
  async read(path: string): Promise<NoteSource | null> {
    const content = this.files.get(path);
    if (content === undefined) return null;
    return {
      path, basename: path.split("/").pop()!.replace(/\.md$/, ""), content,
      frontmatter: null, bodyStart: 0, linkedPaths: [], tags: [],
    };
  }
  name() {
    return "Vault";
  }
}

/** A stand-in for Epitree's API: records what was sent, answers like the server. */
class FakeServer {
  sent: NoteIn[][] = [];
  remaining = 200;
  failNext: HttpResponse | null = null;

  http = async (request: HttpRequest): Promise<HttpResponse> => {
    if (this.failNext) {
      const failure = this.failNext;
      this.failNext = null;
      return failure;
    }
    const allowance = () => ({ used: 200 - this.remaining, limit: 200, remaining: this.remaining, period: "once" });
    if (request.url.endsWith("/status")) {
      return { status: 200, headers: {}, json: { notes: 0, words: 0, pending: 0, allowance: allowance() } };
    }
    const notes = (JSON.parse(request.body!) as { notes: NoteIn[] }).notes;
    if (request.url.endsWith("/preview")) {
      return { status: 200, headers: {}, json: { new: notes.length, changed: 0, unchanged: 0, needed: notes.length, allowance: allowance() } };
    }
    this.sent.push(notes);
    const results = notes.map((n) => {
      if (this.remaining === 0) return { key: n.key, status: "no_allowance", word_ids: [] };
      this.remaining -= 1;
      return { key: n.key, status: "added", word_ids: [1] };
    });
    const refused = results.some((r) => r.status === "no_allowance");
    return {
      status: 200,
      headers: {},
      json: { results, allowance: allowance(), message: refused ? "You've imported the 200 notes." : null },
    };
  };
}

let vault: FakeVault;
let server: FakeServer;
let state: SyncState;
let settings: EpitreeSettings;
let engine: SyncEngine;
const slept: number[] = [];

beforeEach(() => {
  vault = new FakeVault();
  server = new FakeServer();
  state = { notes: {}, renames: {} };
  settings = { ...DEFAULT_SETTINGS, vaultKey: "v1", rules: [{ folder: "Vocab", mode: "word", keepFolders: true }] };
  slept.length = 0;
  engine = new SyncEngine({
    vault,
    client: new EpitreeClient(server.http, () => "https://epitree.test", () => "ept_x"),
    settings: () => settings,
    state,
    saveState: async () => {},
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
});

describe("SyncEngine", () => {
  it("sends only the chosen folders, and nothing the second time", async () => {
    vault.files.set("Vocab/Tisch.md", "Definition: a table");
    vault.files.set("Diary/Monday.md", "private");

    const first = await engine.sync();
    const second = await engine.sync();

    expect(first.added).toBe(1);
    expect(server.sent.flat().map((n) => n.path)).toEqual(["Vocab/Tisch.md"]);
    expect(second.sent).toBe(0);
  });

  it("sends a note again once it changes", async () => {
    vault.files.set("Vocab/Tisch.md", "Definition: a table");
    await engine.sync();
    vault.files.set("Vocab/Tisch.md", "Definition: a desk");

    await engine.sync();

    expect(server.sent.length).toBe(2);
    expect(server.sent[1][0].definition).toBe("a desk");
  });

  it("sends in batches of 50", async () => {
    for (let i = 0; i < 120; i++) vault.files.set(`Vocab/w${i}.md`, `Definition: ${i}`);
    await engine.sync();
    expect(server.sent.map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it("tells Epitree about a rename once", async () => {
    vault.files.set("Vocab/Tisch.md", "Definition: a table");
    await engine.sync();
    vault.files.delete("Vocab/Tisch.md");
    vault.files.set("Vocab/German/Tisch.md", "Definition: a table");
    engine.renamed("Vocab/Tisch.md", "Vocab/German/Tisch.md");

    await engine.sync();
    await engine.sync();

    expect(server.sent.length).toBe(2);
    expect(server.sent[1][0].previous_key).toBe("v1/Vocab/Tisch.md");
    expect(state.renames).toEqual({});
  });

  it("keeps refused notes for a later sync, and stops once nothing fits", async () => {
    server.remaining = 30;
    for (let i = 0; i < 120; i++) vault.files.set(`Vocab/w${i}.md`, `Definition: ${i}`);

    const report = await engine.sync();

    expect(report.added).toBe(30);
    expect(report.no_allowance).toBe(20);
    expect(report.message).toContain("200 notes");
    expect(server.sent.length).toBe(1);
    expect(Object.keys(state.notes).length).toBe(30);
  });

  it("waits and retries when Epitree says too many requests", async () => {
    vault.files.set("Vocab/Tisch.md", "Definition: a table");
    server.failNext = { status: 429, headers: { "retry-after": "12" }, json: { detail: "Too many requests." } };

    const report = await engine.sync();

    expect(slept).toEqual([12_000]);
    expect(report.added).toBe(1);
  });

  it("explains a token Epitree doesn't accept", async () => {
    vault.files.set("Vocab/Tisch.md", "Definition: a table");
    server.failNext = { status: 401, headers: {}, json: { detail: "nope" } };

    await expect(engine.sync()).rejects.toThrow(/Connected apps/);
    expect(engine.busy).toBe(false);
  });

  it("sends one note on request even outside the chosen folders", async () => {
    vault.files.set("Inbox/Stuhl.md", "Definition: a chair");
    await engine.sync(["Inbox/Stuhl.md"]);
    expect(server.sent[0][0]).toMatchObject({ path: "Inbox/Stuhl.md", mode: "word", folder: "Inbox" });
  });

  it("previews without sending", async () => {
    vault.files.set("Vocab/Tisch.md", "Definition: a table");
    const preview = await engine.preview();
    expect(preview).toMatchObject({ new: 1, needed: 1, toSend: 1 });
    expect(server.sent).toEqual([]);
  });
});

describe("EpitreeClient", () => {
  it("refuses to call without a token", async () => {
    const client = new EpitreeClient(async () => ({ status: 200, headers: {}, json: {} }), () => "x", () => null);
    await expect(client.status()).rejects.toBeInstanceOf(EpitreeError);
  });
});
