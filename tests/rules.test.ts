import { describe, expect, it } from "vitest";
import { folderPrefix, ruleFor } from "../src/rules";
import type { FolderRule } from "../src/types";

const rule = (folder: string, mode: FolderRule["mode"] = "word"): FolderRule => ({ folder, mode, keepFolders: true });

describe("folderPrefix", () => {
  it("tidies slashes and spaces", () => {
    expect(folderPrefix("/Lectures/")).toBe("Lectures/");
    expect(folderPrefix(" Languages/German ")).toBe("Languages/German/");
    expect(folderPrefix("")).toBe("");
    expect(folderPrefix("/")).toBe("");
  });
});

describe("ruleFor", () => {
  it("matches a folder written with slashes around it", () => {
    expect(ruleFor("Lectures/Raft.md", [rule("/Lectures/", "terms")], [])?.mode).toBe("terms");
  });

  it("matches whole folder names, not the start of one", () => {
    expect(ruleFor("Lectures 2/Raft.md", [rule("Lectures")], [])).toBeNull();
  });

  it("accepts Markdown files whatever the case of .md", () => {
    expect(ruleFor("Vocab/Tisch.MD", [rule("Vocab")], [])).not.toBeNull();
  });

  it("ignores blank lines in the never-send list", () => {
    expect(ruleFor("Vocab/Tisch.md", [rule("")], ["", "   "])).not.toBeNull();
  });

  it("lets an exclusion win over a rule for the same folder", () => {
    expect(ruleFor("Vocab/Private/Tisch.md", [rule("Vocab"), rule("Vocab/Private")], ["Vocab/Private/"])).toBeNull();
  });
});
