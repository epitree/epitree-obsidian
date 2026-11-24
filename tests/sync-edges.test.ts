/**
 * The sync engine's harder cases: renames before a sync, deletions, retries
 * that run out, two syncs at once, and what is remembered after each answer.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EpitreeClient, EpitreeError, type HttpRequest, type HttpResponse } from "../src/client";
import type { NoteSource } from "../src/payload";
import { SyncEngine, type VaultAdapter } from "../src/sync";
import { DEFAULT_SETTINGS, type EpitreeSettings, type NoteIn, type NoteStatus, type SyncState } from "../src/types";

type FakeFile = { content: string; frontmatter?: Record<string, unknown>; links?: string[] };

class FakeVault implements VaultAdapter {
  files = new Map<string, FakeFile>();
  set(path: string, file: FakeFile | string) {
    this.files.set(path, typeof file === "string" ? { content: file } : file);
  }
  move(from: string, to: string) {
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
  }
  markdownPaths() {
    return [...this.files.keys()];
  }
  async read(path: string): Promise<NoteSource | null> {
    const f = this.files.get(path);
    if (!f) return null;
    return {
      path, basename: path.split("/").pop()!.replace(/\.md$/, ""), content: f.content,
      frontmatter: f.frontmatter ?? null, bodyStart: 0, linkedPaths: f.links ?? [], tags: [],
    };
  }
  name() {
    return "Vault";
  }
}

/** Answers like Epitree. `answer` picks each note's status; `failures` fail the next calls. */
class FakeServer {
  batches: NoteIn[][] = [];
  calls = 0;
  failures: HttpResponse[] = [];
  answer: (note: NoteIn) => NoteStatus = () => "added";
  gate: Promise<void> | null = null;

  http = async (request: HttpRequest): Promise<HttpResponse> => {
    this.calls += 1;
    if (this.gate) await this.gate;
    const failure = this.failures.shift();
    if (failure) return failure;
    const allowance = { used: 0, limit: 200, remaining: 200, period: "once" };
    if (request.method === "GET") return { status: 200, headers: {}, json: { notes: 0, words: 0, pending: 0, allowance } };
    const notes = (JSON.parse(request.body!) as { notes: NoteIn[] }).notes;
    if (request.url.endsWith("/preview")) {
      return { status: 200, headers: {}, json: { new: notes.length, changed: 0, unchanged: 0, needed: notes.length, allowance } };
    }
    this.batches.push(notes);
    const results = notes.map((n) => ({ key: n.key, status: this.answer(n), word_ids: [] }));
    return { status: 200, headers: {}, json: { results, allowance } };
  };
}

let vault: FakeVault;
let server: FakeServer;
let state: SyncState;
let settings: EpitreeSettings;
let engine: SyncEngine;
let saves: number;
let progress: [number, number][];

beforeEach(() => {
  vault = new FakeVault();
  server = new FakeServer();
  state = { notes: {}, renames: {} };
  settings = { ...DEFAULT_SETTINGS, vaultKey: "v1", rules: [{ folder: "", mode: "word", keepFolders: true }] };
  saves = 0;
  progress = [];
  engine = new SyncEngine({
    vault,
    client: new EpitreeClient(server.http, () => "https://epitree.test", () => "ept_x"),
    settings: () => settings,
    state,
    saveState: async () => {
      saves += 1;
    },
    onProgress: (done, total) => progress.push([done, total]),
    sleep: async () => {},
  });
});

const sentPaths = () => server.batches.flat().map((n) => n.path);

describe("renames", () => {
  it("keeps the first key through two renames before the next sync", async () => {
    vault.set("A.md", "Definition: a");
    await engine.sync();
    vault.move("A.md", "B.md");
    engine.renamed("A.md", "B.md");
    vault.move("B.md", "Folder/C.md");
    engine.renamed("B.md", "Folder/C.md");

    await engine.sync();

    expect(server.batches[1]).toHaveLength(1);
    expect(server.batches[1][0]).toMatchObject({ path: "Folder/C.md", previous_key: "v1/A.md" });
    expect(Object.keys(state.notes)).toEqual(["Folder/C.md"]);
  });

  it("does nothing special for a note that was never sent", async () => {
    vault.set("B.md", "Definition: b");
    engine.renamed("A.md", "B.md");
    expect(state.renames).toEqual({});
    await engine.sync();
    expect(server.batches[0][0].previous_key).toBeUndefined();
  });

  it("sends a renamed note again even if nothing else changed", async () => {
    vault.set("A.md", "Definition: a");
    await engine.sync();
    const hashBefore = state.notes["A.md"].hash;
    vault.move("A.md", "B.md");
    engine.renamed("A.md", "B.md");
    state.notes["B.md"].hash = hashBefore;

    await engine.sync();

    expect(sentPaths()).toEqual(["A.md", "B.md"]);
  });
});

describe("what is remembered", () => {
  it("remembers notes Epitree already had, merged, or skipped, so they aren't sent again", async () => {
    vault.set("A.md", "Definition: a");
    vault.set("B.md", "Definition: b");
    vault.set("C.md", "Definition: c");
    const statuses: Record<string, NoteStatus> = { "A.md": "unchanged", "B.md": "merged", "C.md": "skipped" };
    server.answer = (n) => statuses[n.path];

    await engine.sync();
    await engine.sync();

    expect(server.batches).toHaveLength(1);
  });

  it("forgets a deleted note, so a new note at that path is sent as new", async () => {
    vault.set("A.md", "Definition: a");
    await engine.sync();
    engine.deleted("A.md");
    expect(state.notes).toEqual({});
  });

  it("sends everything again after forget()", async () => {
    vault.set("A.md", "Definition: a");
    await engine.sync();
    engine.forget();
    await engine.sync();
    expect(sentPaths()).toEqual(["A.md", "A.md"]);
  });

  it("never sends a note that opts out", async () => {
    vault.set("Private.md", { content: "secret", frontmatter: { epitree: false } });
    vault.set("A.md", "Definition: a");
    await engine.sync();
    expect(sentPaths()).toEqual(["A.md"]);
  });

  it("sends links as the other notes' keys", async () => {
    vault.set("A.md", { content: "Definition: a", links: ["B.md", "picture.png"] });
    vault.set("B.md", "Definition: b");
    await engine.sync();
    expect(server.batches[0].find((n) => n.path === "A.md")!.links).toEqual(["v1/B.md"]);
  });
});

describe("progress and saving", () => {
  it("reports progress per batch and saves after each one", async () => {
    for (let i = 0; i < 60; i++) vault.set(`w${i}.md`, `Definition: ${i}`);
    await engine.sync();
    expect(progress).toEqual([[0, 60], [50, 60], [60, 60]]);
    expect(saves).toBe(2);
  });

  it("asks only for the allowance when there is nothing to preview", async () => {
    const preview = await engine.preview();
    expect(preview.toSend).toBe(0);
    expect(preview.allowance.limit).toBe(200);
    expect(server.batches).toEqual([]);
  });
});

describe("failures", () => {
  it("gives up after three retries of too many requests", async () => {
    vault.set("A.md", "Definition: a");
    server.failures = Array.from({ length: 4 }, () => ({ status: 429, headers: {}, json: null }));

    const err = await engine.sync().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EpitreeError);
    expect((err as EpitreeError).status).toBe(429);
    expect(server.calls).toBe(4);
    expect(state.notes).toEqual({});
  });

  it("doesn't retry other errors", async () => {
    vault.set("A.md", "Definition: a");
    server.failures = [{ status: 500, headers: {}, json: null }];
    await expect(engine.sync()).rejects.toThrow("(500)");
    expect(server.calls).toBe(1);
  });

  it("keeps what was sent before a later batch failed", async () => {
    for (let i = 0; i < 60; i++) vault.set(`w${i}.md`, `Definition: ${i}`);
    server.failures = [];
    let call = 0;
    const answer = server.http;
    server.http = async (request) => (++call === 2 ? { status: 500, headers: {}, json: null } : answer(request));
    engine = new SyncEngine({
      vault, state, settings: () => settings, saveState: async () => {}, sleep: async () => {},
      client: new EpitreeClient((r) => server.http(r), () => "https://epitree.test", () => "ept_x"),
    });

    await expect(engine.sync()).rejects.toThrow();

    expect(Object.keys(state.notes)).toHaveLength(50);
  });

  it("refuses a second sync while one runs, and frees up afterwards", async () => {
    vault.set("A.md", "Definition: a");
    let open!: () => void;
    server.gate = new Promise((resolve) => (open = resolve));

    const first = engine.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(engine.busy).toBe(true);
    await expect(engine.sync()).rejects.toThrow("already running");
    open();
    await first;

    expect(engine.busy).toBe(false);
  });
});
