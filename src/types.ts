/**
 * What the plugin sends to Epitree and gets back. Mirrors the backend's
 * app/schemas/integrations.py; keep the two in step.
 */

export type NoteMode = "word" | "terms";

/** One note, already taken apart by the plugin. */
export interface NoteIn {
  /** Stable name for the note: "<vault key>/<path>". */
  key: string;
  /** Sent once, right after a rename: the key the note had before. */
  previous_key?: string;
  path: string;
  title: string;
  mode: NoteMode;
  /** SHA-256 of everything else sent, so an unchanged note is skipped. */
  hash: string;
  term?: string;
  definition?: string;
  context?: string;
  language?: string;
  /** The rest of the note, kept on the word as the reader's own notes. */
  notes?: string;
  /** The whole text, only in "terms" mode. */
  body?: string;
  /** Keys of the notes this one links to. */
  links: string[];
  tags: string[];
  /** "Languages/German": becomes a branch of topics. Empty: no branch. */
  folder: string;
  vault: string;
}

export type NoteStatus =
  | "added"
  | "merged"
  | "updated"
  | "unchanged"
  | "queued"
  | "no_allowance"
  | "skipped";

export interface NoteResult {
  key: string;
  status: NoteStatus;
  word_ids: number[];
}

export interface Allowance {
  used: number;
  limit: number;
  remaining: number;
  period: "month" | "once";
}

export interface ImportResponse {
  results: NoteResult[];
  allowance: Allowance;
  message?: string | null;
  upgrade_url?: string | null;
}

export interface PreviewResponse {
  new: number;
  changed: number;
  unchanged: number;
  needed: number;
  allowance: Allowance;
}

export interface StatusResponse {
  notes: number;
  words: number;
  pending: number;
  allowance: Allowance;
}

/** Which notes to send, and how. */
export interface FolderRule {
  /** Vault folder, "" for the whole vault. */
  folder: string;
  mode: NoteMode;
  /** Turn the note's folders into a branch of topics in Epitree. */
  keepFolders: boolean;
}

export interface EpitreeSettings {
  serverUrl: string;
  /** Random, made on first run: tells this vault's notes apart from another's. */
  vaultKey: string;
  rules: FolderRule[];
  /** Paths starting with any of these are never sent. */
  exclude: string[];
  autoSync: boolean;
  autoSyncMinutes: number;
}

/** What was sent last, per note path. */
export interface SyncedNote {
  hash: string;
  syncedAt: number;
}

export interface SyncState {
  notes: Record<string, SyncedNote>;
  /** New path → key it had before, until the rename has been sent. */
  renames: Record<string, string>;
}

export const DEFAULT_SERVER_URL = "https://epitree.com";

export const DEFAULT_SETTINGS: EpitreeSettings = {
  serverUrl: DEFAULT_SERVER_URL,
  vaultKey: "",
  rules: [],
  exclude: ["Templates/", ".trash/"],
  autoSync: false,
  autoSyncMinutes: 30,
};
