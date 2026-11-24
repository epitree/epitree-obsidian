import type { FolderRule } from "./types";

/** "Languages/German/" for "Languages/German", "" for the vault root. */
export function folderPrefix(folder: string): string {
  const trimmed = folder.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}

/**
 * The rule that decides how a note is sent: the one for the deepest folder
 * that contains it. Null when no rule covers it, or it is excluded. Nothing
 * is sent from a vault until the reader picks a folder.
 */
export function ruleFor(path: string, rules: FolderRule[], exclude: string[]): FolderRule | null {
  if (!path.toLowerCase().endsWith(".md")) return null;
  if (exclude.some((prefix) => prefix.trim() && path.startsWith(prefix.trim()))) return null;
  let best: FolderRule | null = null;
  let bestLength = -1;
  for (const rule of rules) {
    const prefix = folderPrefix(rule.folder);
    if (path.startsWith(prefix) && prefix.length > bestLength) {
      best = rule;
      bestLength = prefix.length;
    }
  }
  return best;
}
