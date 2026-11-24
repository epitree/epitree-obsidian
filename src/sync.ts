/**
 * Deciding what to send, sending it in batches, and remembering what was sent.
 *
 * Plain TypeScript: Obsidian is reached only through the VaultAdapter it is
 * given, so the whole flow is tested with a fake vault.
 */
import { EpitreeClient, EpitreeError } from "./client";
import { buildNote, hashNote, noteKey, type NoteSource } from "./payload";
import { ruleFor } from "./rules";
import type {
  Allowance,
  EpitreeSettings,
  FolderRule,
  NoteIn,
  NoteStatus,
  PreviewResponse,
  SyncState,
} from "./types";

/** Most notes per request; the server refuses more. */
export const BATCH_SIZE = 50;
/** Times a request is retried after "too many requests". */
const RETRIES = 3;

/** Used by "Import this note" for a note no folder rule covers. */
export const SINGLE_NOTE_RULE: FolderRule = { folder: "", mode: "word", keepFolders: true };

export interface VaultAdapter {
  /** Every Markdown file's path. */
  markdownPaths(): string[];
  read(path: string): Promise<NoteSource | null>;
  name(): string;
}

export interface SyncDeps {
  vault: VaultAdapter;
  client: EpitreeClient;
  settings: () => EpitreeSettings;
  state: SyncState;
  saveState: () => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  /** How to wait before a retry: window.setTimeout in Obsidian. */
  sleep: (ms: number) => Promise<void>;
}

export type SyncReport = Record<NoteStatus, number> & {
  sent: number;
  message: string | null;
  upgradeUrl: string | null;
  allowance: Allowance | null;
};

function emptyReport(): SyncReport {
  return {
    added: 0, merged: 0, updated: 0, unchanged: 0, queued: 0, no_allowance: 0, skipped: 0,
    sent: 0, message: null, upgradeUrl: null, allowance: null,
  };
}

export class SyncEngine {
  private running = false;

  constructor(private readonly deps: SyncDeps) {}

  get busy(): boolean {
    return this.running;
  }

  /**
   * The notes that changed since they were last sent, ready to send.
   * *paths* limits it to those notes, and sends them even when no folder
   * rule covers them ("Import this note").
   */
  async changedNotes(paths?: string[]): Promise<NoteIn[]> {
    const settings = this.deps.settings();
    const { state } = this.deps;
    const out: NoteIn[] = [];
    for (const path of paths ?? this.deps.vault.markdownPaths()) {
      const rule = ruleFor(path, settings.rules, settings.exclude) ?? (paths ? SINGLE_NOTE_RULE : null);
      if (!rule) continue;
      const source = await this.deps.vault.read(path);
      if (!source) continue;
      const built = buildNote(source, rule, settings.vaultKey, this.deps.vault.name());
      if (!built) continue;
      const hash = await hashNote(built);
      const renamedFrom = state.renames[path];
      if (!renamedFrom && state.notes[path]?.hash === hash) continue;
      out.push(renamedFrom ? { ...built, hash, previous_key: renamedFrom } : { ...built, hash });
    }
    return out;
  }

  private async send<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (err) {
        if (err instanceof EpitreeError && err.status === 429 && attempt < RETRIES) {
          await this.deps.sleep((err.retryAfter ?? 60) * 1000);
          continue;
        }
        throw err;
      }
    }
  }

  /** What sending the changed notes would do, without sending them. */
  async preview(paths?: string[]): Promise<PreviewResponse & { toSend: number }> {
    const notes = await this.changedNotes(paths);
    const total: PreviewResponse & { toSend: number } = {
      new: 0, changed: 0, unchanged: 0, needed: 0, toSend: notes.length,
      allowance: { used: 0, limit: 0, remaining: 0, period: "month" },
    };
    if (!notes.length) {
      total.allowance = (await this.send(() => this.deps.client.status())).allowance;
      return total;
    }
    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
      const part = await this.send(() => this.deps.client.preview(notes.slice(i, i + BATCH_SIZE)));
      total.new += part.new;
      total.changed += part.changed;
      total.unchanged += part.unchanged;
      total.needed += part.needed;
      total.allowance = part.allowance;
    }
    return total;
  }

  /** Send the notes that changed, 50 at a time, and remember each one sent. */
  async sync(paths?: string[]): Promise<SyncReport> {
    if (this.running) throw new EpitreeError("A sync is already running.", 0);
    this.running = true;
    const report = emptyReport();
    try {
      const notes = await this.changedNotes(paths);
      const { state } = this.deps;
      this.deps.onProgress?.(0, notes.length);
      for (let i = 0; i < notes.length; i += BATCH_SIZE) {
        const batch = notes.slice(i, i + BATCH_SIZE);
        const response = await this.send(() => this.deps.client.importNotes(batch));
        const byKey = new Map(batch.map((n) => [n.key, n]));
        for (const result of response.results) {
          report[result.status] += 1;
          const note = byKey.get(result.key);
          // Refused notes are not remembered, so they go on the next sync.
          if (!note || result.status === "no_allowance") continue;
          state.notes[note.path] = { hash: note.hash, syncedAt: Date.now() };
          delete state.renames[note.path];
        }
        report.sent += batch.length;
        report.allowance = response.allowance;
        if (response.message) report.message = response.message;
        if (response.upgrade_url) report.upgradeUrl = response.upgrade_url;
        await this.deps.saveState();
        this.deps.onProgress?.(Math.min(i + BATCH_SIZE, notes.length), notes.length);
        // Nothing new can go in once the allowance is used up.
        if (response.allowance.remaining === 0 && report.no_allowance > 0) break;
      }
      return report;
    } finally {
      this.running = false;
    }
  }

  /** A note moved: keep what was sent, and tell Epitree once where it went. */
  renamed(oldPath: string, newPath: string): void {
    const { state } = this.deps;
    const sent = state.notes[oldPath];
    if (!sent) return;
    state.notes[newPath] = sent;
    state.renames[newPath] = state.renames[oldPath] ?? noteKey(this.deps.settings().vaultKey, oldPath);
    delete state.notes[oldPath];
    delete state.renames[oldPath];
  }

  /** A note was deleted from the vault. Its words stay in Epitree. */
  deleted(path: string): void {
    delete this.deps.state.notes[path];
    delete this.deps.state.renames[path];
  }

  /** Forget what was sent, so the next sync sends every note again. */
  forget(): void {
    this.deps.state.notes = {};
    this.deps.state.renames = {};
  }
}
