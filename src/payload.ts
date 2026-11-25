/**
 * Turning one Obsidian note into what Epitree is sent.
 *
 * Pure: it is given what Obsidian already parsed (frontmatter, resolved
 * links, tags) and the note's text, so it runs in tests without Obsidian.
 */
import type { FolderRule, NoteIn } from "./types";

/** What the plugin reads from Obsidian for one note. */
export interface NoteSource {
  path: string;
  /** The file name without ".md". */
  basename: string;
  /** The whole file, frontmatter included. */
  content: string;
  frontmatter: Record<string, unknown> | null;
  /** Where the frontmatter ends, as a character offset; 0 when there is none. */
  bodyStart: number;
  /** Paths of the notes it links to, as Obsidian resolved them. */
  linkedPaths: string[];
  /** "#spanish" and "spanish" both work. */
  tags: string[];
}

/**
 * The server's limits (epitree-backend app/schemas/integrations.py). One
 * field over its limit makes the server refuse the whole batch of 50 notes,
 * so every field is trimmed to fit here. Keep the two in step.
 */
export const LIMITS = {
  key: 1024,
  path: 1024,
  title: 500,
  term: 500,
  definition: 4000,
  context: 2000,
  language: 50,
  /** The note's own text kept on the word. */
  notes: 2000,
  /**
   * What the AI reads in "terms" mode: up to 5 parts of 8,000 characters
   * (about 15 pages), each read on its own (server: app/services/note_parts.py).
   */
  body: 40000,
  links: 200,
  tags: 50,
  folder: 1024,
  vault: 200,
} as const;
/** Most characters of the note's own text kept on the word. */
export const MAX_NOTES = LIMITS.notes;
/** Most characters the AI reads in "terms" mode. */
export const MAX_BODY = LIMITS.body;

const DEFINITION_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(definition|meaning)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+)$/i;
const CONTEXT_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(context|example|sentence)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+)$/i;
/** Lines from an Epitree export that are about Epitree, not the term. */
const EPITREE_LINE = /^\s*(?:\*\*)?(related|source|retention)(?:\*\*)?\s*:/i;

export function noteKey(vaultKey: string, path: string): string {
  return `${vaultKey}/${path}`;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length && typeof value[0] === "string") return value.join(", ");
  return undefined;
}

/** A frontmatter value by any of *names*, ignoring case. */
function field(frontmatter: Record<string, unknown> | null, ...names: string[]): string | undefined {
  if (!frontmatter) return undefined;
  for (const [key, value] of Object.entries(frontmatter)) {
    if (names.includes(key.toLowerCase())) {
      const found = text(value);
      if (found) return found;
    }
  }
  return undefined;
}

function optionalPlain(value: string | undefined): string | undefined {
  return value === undefined ? undefined : plainLinks(value);
}

function unquote(value: string): string {
  return value.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
}

/**
 * Wikilinks as the words a reader sees: "[[Tisch|a table]]" is "a table",
 * "[[Idempotency key#Retries]]" is "Idempotency key", "[[#Retries]]" is
 * "Retries", and embeds ("![[photo.png]]") are dropped. The text is read on
 * review cards, outside Obsidian, where link syntax is noise. The links
 * themselves are still sent, resolved, in `links`.
 */
export function plainLinks(text: string): string {
  return text.replace(/(!?)\[\[([^\]]+)\]\]/g, (_match, embed: string, inner: string) => {
    if (embed) return "";
    const [target, alias] = inner.split("|");
    if (alias !== undefined) return alias.trim();
    const [path, heading] = target.split("#");
    const name = path.split("/").pop()!.replace(/\.md$/i, "").trim();
    return name || (heading ?? "").trim();
  });
}

/** The parent folder of *path*, "" at the vault root. */
export function parentFolder(path: string): string {
  const at = path.lastIndexOf("/");
  return at > 0 ? path.slice(0, at) : "";
}

/**
 * Everything about the note except its hash. The note opts out with
 * `epitree: false` in its frontmatter (returns null).
 */
export function buildNote(
  source: NoteSource,
  rule: FolderRule,
  vaultKey: string,
  vaultName: string,
): Omit<NoteIn, "hash"> | null {
  const fm = source.frontmatter;
  if (fm && (fm.epitree === false || fm.epitree === "false")) return null;
  // A path this long can't be shortened without losing which note it is.
  const key = noteKey(vaultKey, source.path);
  if (source.path.length > LIMITS.path || key.length > LIMITS.key) return null;

  const body = plainLinks(source.content.slice(source.bodyStart)).replace(/^\s+/, "");
  let definition = optionalPlain(field(fm, "definition", "meaning"));
  let context = optionalPlain(field(fm, "context", "example", "sentence"));
  const kept: string[] = [];
  let firstHeading = true;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (firstHeading && /^#\s+/.test(trimmed)) {
      // The note's title as a heading says nothing more.
      firstHeading = false;
      const heading = trimmed.replace(/^#\s+/, "");
      if (heading.toLowerCase() === source.basename.toLowerCase()) continue;
    }
    if (trimmed) firstHeading = false;
    const def = trimmed.match(DEFINITION_LINE);
    if (def && !definition) {
      definition = unquote(def[2]);
      continue;
    }
    const ctx = trimmed.match(CONTEXT_LINE);
    if (ctx && !context) {
      context = unquote(ctx[2]);
      continue;
    }
    if (EPITREE_LINE.test(trimmed) || /^##\s+notes\s*$/i.test(trimmed)) continue;
    kept.push(line);
  }
  const notes = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_NOTES);

  const tags = [...new Set(source.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean))]
    .sort()
    .slice(0, LIMITS.tags);
  const links = [...new Set(source.linkedPaths.filter((p) => p.toLowerCase().endsWith(".md") && p !== source.path))]
    .sort()
    .map((p) => noteKey(vaultKey, p))
    .filter((k) => k.length <= LIMITS.key)
    .slice(0, LIMITS.links);

  const note: Omit<NoteIn, "hash"> = {
    key,
    path: source.path,
    title: source.basename.slice(0, LIMITS.title),
    mode: rule.mode,
    links,
    tags,
    // Shorter than the path, so within the folder limit too.
    folder: rule.keepFolders ? parentFolder(source.path) : "",
    vault: vaultName.slice(0, LIMITS.vault),
  };
  const term = field(fm, "term", "word");
  const language = field(fm, "language", "lang");
  if (term) note.term = term.slice(0, LIMITS.term);
  if (definition) note.definition = definition.slice(0, LIMITS.definition);
  if (context) note.context = context.slice(0, LIMITS.context);
  if (language) note.language = language.slice(0, LIMITS.language);
  if (notes) note.notes = notes;
  if (rule.mode === "terms") note.body = body.trim().slice(0, MAX_BODY);
  return note;
}

/** SHA-256 of what is sent, hex. The same note always gives the same hash. */
export async function hashNote(note: Omit<NoteIn, "hash">): Promise<string> {
  // The key and a pending rename say where the note is, not what it says.
  const fields: Record<string, unknown> = { ...note };
  delete fields.key;
  delete fields.previous_key;
  const ordered = Object.keys(fields)
    .sort()
    .map((k) => [k, fields[k]]);
  const bytes = new TextEncoder().encode(JSON.stringify(ordered));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
