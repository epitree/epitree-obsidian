/**
 * A small Obsidian App for tests: a vault, its metadata cache, the secret
 * storage, and the events the plugin listens to.
 */
import { TFile } from "./obsidian-stub";

export interface FakeNote {
  content: string;
  frontmatter?: Record<string, unknown>;
  /** Where the frontmatter ends, as Obsidian reports it. */
  bodyStart?: number;
  links?: string[];
  tags?: string[];
}

export function fakeApp(notes: Record<string, FakeNote>, folders: string[] = []) {
  const files = new Map(Object.keys(notes).map((path) => [path, new TFile(path)]));
  const secrets = new Map<string, string>();
  const events: Record<string, (...args: unknown[]) => unknown> = {};
  const onReady: (() => void)[] = [];
  const workspace = { active: null as TFile | null };

  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()].filter((f) => f.extension === "md"),
      getName: () => "My Vault",
      getFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => notes[file.path].content,
      on: (name: string, cb: (...args: unknown[]) => unknown) => {
        events[name] = cb;
        return {};
      },
      getAllFolders: () => [
        { path: "/", isRoot: () => true },
        ...folders.map((path) => ({ path, isRoot: () => false })),
      ],
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const note = notes[file.path];
        if (!note) return null;
        return {
          frontmatter: note.frontmatter,
          frontmatterPosition: note.bodyStart ? { end: { offset: note.bodyStart } } : undefined,
          tags: (note.tags ?? []).map((tag) => ({ tag })),
        };
      },
      get resolvedLinks() {
        return Object.fromEntries(
          Object.entries(notes).map(([path, n]) => [path, Object.fromEntries((n.links ?? []).map((l) => [l, 1]))]),
        );
      },
    },
    workspace: {
      onLayoutReady: (cb: () => void) => onReady.push(cb),
      getActiveFile: () => workspace.active,
    },
    secretStorage: {
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => secrets.set(id, value),
    },
  };

  return {
    app,
    files,
    secrets,
    workspace,
    /** Run what the plugin waits on until the workspace is ready. */
    ready: () => onReady.forEach((cb) => cb()),
    /** Fire a vault event the plugin registered for. */
    emit: (name: string, ...args: unknown[]) => events[name]?.(...args),
  };
}
