import { describe, expect, it } from "vitest";
import { buildNote, hashNote, type NoteSource } from "../src/payload";
import { ruleFor } from "../src/rules";
import type { FolderRule } from "../src/types";

const WORD: FolderRule = { folder: "Vocabulary", mode: "word", keepFolders: true };
const TERMS: FolderRule = { folder: "Lectures", mode: "terms", keepFolders: false };

function source(path: string, content: string, extra: Partial<NoteSource> = {}): NoteSource {
  const fm = content.startsWith("---\n") ? content.indexOf("\n---", 4) + 4 : 0;
  return {
    path,
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
    content,
    frontmatter: null,
    bodyStart: fm,
    linkedPaths: [],
    tags: [],
    ...extra,
  };
}

describe("buildNote", () => {
  it("takes the definition and sentence out of an Epitree export, and keeps the rest as notes", () => {
    const note = buildNote(
      source(
        "Vocabulary/German/ameliorate.md",
        "# ameliorate\n\n**Definition**: To make something better.\n**Context**: Steps to ameliorate the crisis.\n" +
          "**Related**: [[improve]]\n**Retention**: 92%\n\n## Notes\nHeard it on the radio.\n",
      ),
      WORD,
      "v1",
      "My Vault",
    )!;

    expect(note).toMatchObject({
      key: "v1/Vocabulary/German/ameliorate.md",
      title: "ameliorate",
      mode: "word",
      definition: "To make something better.",
      context: "Steps to ameliorate the crisis.",
      notes: "Heard it on the radio.",
      folder: "Vocabulary/German",
      vault: "My Vault",
    });
    expect(note.body).toBeUndefined();
  });

  it("prefers frontmatter, and sends links and tags as Obsidian resolved them", () => {
    const note = buildNote(
      source("Vocabulary/Tisch.md", "---\nterm: der Tisch\ndefinition: A table.\nlanguage: German\n---\nDefinition: ignored\n", {
        frontmatter: { term: "der Tisch", definition: "A table.", language: "German" },
        linkedPaths: ["Vocabulary/Stuhl.md", "attachments/photo.png", "Vocabulary/Tisch.md"],
        tags: ["#furniture", "furniture", "#nouns"],
      }),
      WORD,
      "v1",
      "Vault",
    )!;

    expect(note.term).toBe("der Tisch");
    expect(note.definition).toBe("A table.");
    expect(note.language).toBe("German");
    expect(note.links).toEqual(["v1/Vocabulary/Stuhl.md"]);
    expect(note.tags).toEqual(["furniture", "nouns"]);
    // The "Definition:" line under the frontmatter one is just text now.
    expect(note.notes).toBe("Definition: ignored");
  });

  it("sends the whole text in terms mode, and no folder when folders are off", () => {
    const note = buildNote(source("Lectures/Raft.md", "Raft elects a leader.\n\nEach term begins with an election."), TERMS, "v1", "V")!;
    expect(note.body).toBe("Raft elects a leader.\n\nEach term begins with an election.");
    expect(note.folder).toBe("");
  });

  it("leaves out a note that says epitree: false", () => {
    const note = buildNote(
      source("Vocabulary/Private.md", "---\nepitree: false\n---\nsecret", { frontmatter: { epitree: false } }),
      WORD,
      "v1",
      "V",
    );
    expect(note).toBeNull();
  });
});

describe("hashNote", () => {
  it("is the same for the same note and changes when the note does", async () => {
    const a = buildNote(source("Vocabulary/A.md", "Definition: one"), WORD, "v1", "V")!;
    const b = buildNote(source("Vocabulary/A.md", "Definition: one"), WORD, "v1", "V")!;
    const c = buildNote(source("Vocabulary/A.md", "Definition: two"), WORD, "v1", "V")!;
    expect(await hashNote(a)).toBe(await hashNote(b));
    expect(await hashNote(a)).not.toBe(await hashNote(c));
    expect(await hashNote(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ruleFor", () => {
  const rules: FolderRule[] = [
    { folder: "", mode: "word", keepFolders: true },
    { folder: "Lectures", mode: "terms", keepFolders: true },
  ];

  it("picks the deepest folder that holds the note", () => {
    expect(ruleFor("Lectures/Week 1/Raft.md", rules, [])?.mode).toBe("terms");
    expect(ruleFor("Inbox/Tisch.md", rules, [])?.mode).toBe("word");
  });

  it("sends nothing that is excluded, not Markdown, or outside every rule", () => {
    expect(ruleFor("Templates/Daily.md", rules, ["Templates/"])).toBeNull();
    expect(ruleFor("photo.png", rules, [])).toBeNull();
    expect(ruleFor("Inbox/Tisch.md", [rules[1]], [])).toBeNull();
    expect(ruleFor("LecturesOld/x.md", [rules[1]], [])).toBeNull();
  });
});
