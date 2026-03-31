import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@omi/core": resolve(__dirname, "../core/src/index.ts"),
      "@omi/extensions": resolve(__dirname, "../extensions/src/index.ts"),
      "@omi/memory": resolve(__dirname, "../memory/src/index.ts"),
      "@omi/prompt": resolve(__dirname, "../prompt/src/index.ts"),
      "@omi/provider": resolve(__dirname, "../provider/src/index.ts"),
      "@omi/settings": resolve(__dirname, "../settings/src/index.ts"),
      "@omi/store": resolve(__dirname, "../store/src/index.ts"),
      "@omi/tools": resolve(__dirname, "../tools/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
