import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Obsidian's API exists only inside the app: the npm package ships types and
// no code. Tests load a small stand-in instead (tests/obsidian-stub.ts).
export default defineConfig({
  resolve: {
    alias: { obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)) },
  },
  test: {
    setupFiles: ["./tests/setup.ts"],
    coverage: { include: ["src/**"] },
  },
});
