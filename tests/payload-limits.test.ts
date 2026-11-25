/**
 * Note reading beyond the basics in payload.test.ts: other ways people write
 * definitions, and the server's limits. One field over a limit would make the
 * server refuse the whole batch of 50, so the plugin must never send one.
 */
import { describe, expect, it } from "vitest";
import { LIMITS, buildNote, hashNote, plainLinks, type NoteSource } from "../src/payload";
import type { FolderRule } from "../src/types";

const WORD: FolderRule = { folder: "", mode: "word", keepFolders: true };
const TERMS: FolderRule = { folder: "", mode: "terms", keepFolders: true };

function source(path: string, content: string, extra: Partial<NoteSource> = {}): NoteSource {
  return {
    path,
    basename: path.split("/").pop()!.replace(/\.md$/i, ""),
    content,
    frontmatter: null,
    bodyStart: 0,
    linkedPaths: [],
    tags: [],
    ...extra,
  };
}

const build = (s: NoteSource, rule = WORD) => buildNote(s, rule, "v1", "Vault")!;

describe("other ways of writing a definition", () => {
  it("reads Windows line endings", () => {
    const note = build(source("Tisch.md", "Definition: a table\r\nContext: Der Tisch.\r\nMore.\r\n"));
    expect([note.definition, note.context, note.notes]).toEqual(["a table", "Der Tisch.", "More."]);
  });

  it("reads Meaning and Example, in a list and in bold", () => {
    const note = build(source("Tisch.md", "- **Meaning:** a table\n* Example: \"Der Tisch ist neu.\"\n"));
    expect(note.definition).toBe("a table");
    expect(note.context).toBe("Der Tisch ist neu.");
  });

  it("keeps a first heading that isn't the note's title", () => {
    const note = build(source("Tisch.md", "# Furniture\nDefinition: a table"));
    expect(note.notes).toBe("# Furniture");
  });

  it("joins a definition written as a frontmatter list", () => {
    const note = build(source("Tisch.md", "", { frontmatter: { definition: ["a table", "a desk"] } }));
    expect(note.definition).toBe("a table, a desk");
  });

  it("reads frontmatter keys whatever their case", () => {
    const note = build(source("Tisch.md", "", { frontmatter: { Definition: "a table", Language: "German" } }));
    expect([note.definition, note.language]).toEqual(["a table", "German"]);
  });

  it('leaves out a note that says epitree: "false" as text', () => {
    expect(buildNote(source("A.md", "x", { frontmatter: { epitree: "false" } }), WORD, "v1", "V")).toBeNull();
  });

  it("starts the note after its frontmatter", () => {
    const content = "---\nterm: der Tisch\n---\nBought at IKEA.";
    const note = build(source("Tisch.md", content, { frontmatter: { term: "der Tisch" }, bodyStart: content.indexOf("Bought") }));
    expect(note.notes).toBe("Bought at IKEA.");
  });

  it("puts a note at the top of the vault in no folder", () => {
    expect(build(source("Tisch.md", "x")).folder).toBe("");
  });
});

describe("the server's limits", () => {
  const long = (n: number) => "x".repeat(n);

  it("trims every text field to fit", () => {
    const note = build(
      source(`${long(600)}.md`, `Context: ${long(3000)}\n${long(3000)}`, {
        frontmatter: { term: long(700), definition: long(5000), language: long(80) },
      }),
    );
    expect(note.title.length).toBe(LIMITS.title);
    expect(note.term!.length).toBe(LIMITS.term);
    expect(note.definition!.length).toBe(LIMITS.definition);
    expect(note.context!.length).toBe(LIMITS.context);
    expect(note.language!.length).toBe(LIMITS.language);
    expect(note.notes!.length).toBe(LIMITS.notes);
  });

  it("sends up to 40,000 characters for the AI to read in parts", () => {
    expect(LIMITS.body).toBe(40000);
    expect(build(source("Raft.md", long(50000)), TERMS).body!.length).toBe(40000);
    expect(build(source("Raft.md", long(9000)), TERMS).body!.length).toBe(9000);
  });

  it("keeps the first 200 links and 50 tags, always the same ones", () => {
    const linkedPaths = Array.from({ length: 250 }, (_, i) => `n${String(i).padStart(3, "0")}.md`).reverse();
    const tags = Array.from({ length: 70 }, (_, i) => `#t${String(i).padStart(2, "0")}`);
    const note = build(source("Index.md", "", { linkedPaths, tags }));
    expect(note.links.length).toBe(LIMITS.links);
    expect(note.links[0]).toBe("v1/n000.md");
    expect(note.tags.length).toBe(LIMITS.tags);
    expect(note.tags[0]).toBe("t00");
  });

  it("keeps a deep folder whole, so it still names a real folder", () => {
    const note = build(source(`${"a/".repeat(300)}Tisch.md`, "x"));
    expect(note.folder).toBe("a/".repeat(300).slice(0, -1));
  });

  it("doesn't send a note whose path is too long to name it", () => {
    expect(buildNote(source(`${long(1020)}.md`, "x"), WORD, "v1", "V")).toBeNull();
  });

  it("shortens a vault name that is too long", () => {
    expect(buildNote(source("A.md", "x"), WORD, "v1", long(300))!.vault.length).toBe(LIMITS.vault);
  });
});

describe("hashNote", () => {
  it("doesn't change with a pending rename, but does when the mode changes", async () => {
    const note = build(source("Raft.md", "Raft elects a leader."));
    const renamed = { ...note, previous_key: "v1/Old.md" };
    const asTerms = build(source("Raft.md", "Raft elects a leader."), TERMS);
    expect(await hashNote(renamed)).toBe(await hashNote(note));
    expect(await hashNote(asTerms)).not.toBe(await hashNote(note));
  });
});

describe("links in the text", () => {
  it("are sent as the words a reader sees", () => {
    expect(plainLinks("Not to be confused with [[Tisch|a table]].")).toBe("Not to be confused with a table.");
    expect(plainLinks("Needs [[Idempotency key#Retries|keys]] and [[Idempotency key#Retries]].")).toBe(
      "Needs keys and Idempotency key.",
    );
    expect(plainLinks("See [[Vocab/German/Stuhl]] and [[#Retries]].")).toBe("See Stuhl and Retries.");
    expect(plainLinks("A photo: ![[desk.png]] here.")).toBe("A photo:  here.");
  });

  it("are cleaned in notes, definitions and sentences, but still sent as links", () => {
    const note = build(
      source("Fahrrad.md", "Context: I ride my [[Fahrrad]] daily.\nNot to be confused with [[Tisch|a table]].", {
        frontmatter: { definition: "A [[bicycle]]." },
        linkedPaths: ["Tisch.md", "Fahrrad.md"],
      }),
    );
    expect(note.definition).toBe("A bicycle.");
    expect(note.context).toBe("I ride my Fahrrad daily.");
    expect(note.notes).toBe("Not to be confused with a table.");
    expect(note.links).toEqual(["v1/Tisch.md"]);
  });
});
