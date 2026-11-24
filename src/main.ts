import { Notice, Plugin, TFile, getAllTags, requestUrl } from "obsidian";
import { EpitreeClient, EpitreeError, type Http } from "./client";
import { PreviewModal } from "./modals";
import type { NoteSource } from "./payload";
import { EpitreeSettingTab } from "./settings";
import { SyncEngine, type SyncReport } from "./sync";
import { DEFAULT_SETTINGS, type EpitreeSettings, type SyncState } from "./types";

/** Where the access token is kept: Obsidian's secret storage, not data.json. */
export const TOKEN_SECRET_ID = "epitree-access-token";

interface StoredData {
  settings?: Partial<EpitreeSettings>;
  state?: Partial<SyncState>;
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function describeReport(report: SyncReport): string {
  const parts: string[] = [];
  if (report.added) parts.push(`${report.added} new`);
  if (report.merged) parts.push(`${report.merged} joined words you had`);
  if (report.updated) parts.push(`${report.updated} updated`);
  if (report.queued) parts.push(`${report.queued} sent to the AI to find terms`);
  if (report.no_allowance) parts.push(`${report.no_allowance} not imported`);
  const summary = parts.length ? `Epitree: ${parts.join(", ")}.` : "Epitree: everything is up to date.";
  return report.message ? `${summary}\n${report.message}` : summary;
}

export default class EpitreePlugin extends Plugin {
  settings: EpitreeSettings = { ...DEFAULT_SETTINGS };
  state: SyncState = { notes: {}, renames: {} };
  client!: EpitreeClient;
  engine!: SyncEngine;
  private statusEl: HTMLElement | null = null;
  private autoSyncTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadAll();

    const http: Http = async (request) => {
      const response = await requestUrl({ ...request, throw: false });
      let json: unknown = null;
      try {
        json = response.json;
      } catch {
        // Not JSON: the status says what went wrong.
      }
      return { status: response.status, json, headers: response.headers };
    };
    this.client = new EpitreeClient(http, () => this.settings.serverUrl, () => this.token());
    this.engine = new SyncEngine({
      vault: {
        markdownPaths: () => this.app.vault.getMarkdownFiles().map((f) => f.path),
        read: (path) => this.readNote(path),
        name: () => this.app.vault.getName(),
      },
      client: this.client,
      settings: () => this.settings,
      state: this.state,
      saveState: () => this.saveAll(),
      onProgress: (done, total) => this.setStatus(total ? `Epitree: ${done} of ${total}` : ""),
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    });

    this.statusEl = this.addStatusBarItem();
    this.addRibbonIcon("sprout", "Sync notes to Epitree", () => void this.runSync());

    this.addCommand({
      id: "preview-import",
      name: "Preview what would be sent",
      callback: () => void this.openPreview(),
    });
    this.addCommand({
      id: "sync-changed-notes",
      name: "Sync changed notes",
      callback: () => void this.runSync(),
    });
    this.addCommand({
      id: "import-current-note",
      name: "Send this note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.runSync([file.path]);
        return true;
      },
    });
    this.addCommand({
      id: "resend-all-notes",
      name: "Send every note again",
      callback: async () => {
        this.engine.forget();
        await this.saveAll();
        await this.runSync();
      },
    });

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.engine.renamed(oldPath, file.path);
          void this.saveAll();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.engine.deleted(file.path);
          void this.saveAll();
        }
      }),
    );

    this.addSettingTab(new EpitreeSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.scheduleAutoSync();
      if (this.settings.autoSync) void this.runSync(undefined, true);
    });
  }

  onunload(): void {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
  }

  token(): string | null {
    return this.app.secretStorage.getSecret(TOKEN_SECRET_ID)?.trim() || null;
  }

  setToken(value: string): void {
    this.app.secretStorage.setSecret(TOKEN_SECRET_ID, value.trim());
  }

  scheduleAutoSync(): void {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
    if (!this.settings.autoSync) return;
    const minutes = Math.max(5, this.settings.autoSyncMinutes || 30);
    this.autoSyncTimer = window.setInterval(() => void this.runSync(undefined, true), minutes * 60_000);
    this.registerInterval(this.autoSyncTimer);
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  /** Read one note the way the sync engine needs it, from Obsidian's own parse. */
  private async readNote(path: string): Promise<NoteSource | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const linked = Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {});
    return {
      path,
      basename: file.basename,
      content,
      frontmatter: cache?.frontmatter ?? null,
      bodyStart: cache?.frontmatterPosition ? cache.frontmatterPosition.end.offset : 0,
      linkedPaths: linked,
      tags: cache ? (getAllTags(cache) ?? []) : [],
    };
  }

  /** Sync, and say how it went. *quiet* (automatic syncs) only speaks up about problems. */
  async runSync(paths?: string[], quiet = false): Promise<void> {
    if (this.engine.busy) {
      if (!quiet) new Notice("Epitree: a sync is already running.");
      return;
    }
    if (!this.token()) {
      if (!quiet) new Notice("Epitree: add your access token in Settings → Epitree first.");
      return;
    }
    if (!paths && !this.settings.rules.length) {
      if (!quiet) new Notice("Epitree: choose which folders to send in Settings → Epitree first.");
      return;
    }
    try {
      const report = await this.engine.sync(paths);
      if (!quiet || report.no_allowance || report.added || report.queued) {
        new Notice(describeReport(report), report.message ? 10_000 : 5_000);
      }
    } catch (err) {
      new Notice(`Epitree: ${err instanceof EpitreeError ? err.message : "the sync failed. Try again."}`, 10_000);
    } finally {
      this.setStatus("");
    }
  }

  async openPreview(): Promise<void> {
    if (!this.settings.rules.length) {
      new Notice("Epitree: choose which folders to send in Settings → Epitree first.");
      return;
    }
    try {
      this.setStatus("Epitree: checking…");
      const preview = await this.engine.preview();
      new PreviewModal(this.app, preview, () => void this.runSync()).open();
    } catch (err) {
      new Notice(`Epitree: ${err instanceof EpitreeError ? err.message : "couldn't check. Try again."}`, 10_000);
    } finally {
      this.setStatus("");
    }
  }

  private async loadAll(): Promise<void> {
    const data = ((await this.loadData()) as StoredData | null) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
    this.state.notes = data.state?.notes ?? {};
    this.state.renames = data.state?.renames ?? {};
    if (!this.settings.vaultKey) {
      this.settings.vaultKey = randomKey();
      await this.saveAll();
    }
  }

  async saveAll(): Promise<void> {
    await this.saveData({ settings: this.settings, state: this.state } satisfies StoredData);
  }
}
