import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

// The rules Obsidian's community review checks, so problems show up here
// before a submission rather than after.
export default defineConfig([
  globalIgnores(["node_modules", "main.js", "esbuild.config.mjs", "version-bump.mjs"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
  },
]);
