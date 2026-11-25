import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { obsidian: resolve(__dirname, "test/mocks/obsidian.ts") } },
  test: { include: ["test/**/*.test.ts"] },
});
