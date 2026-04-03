import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@omi/agent/logger": resolve(__dirname, "../../packages/agent/src/logger.ts"),
      "@omi/agent": resolve(__dirname, "../../packages/agent/src/index.ts"),
      "@omi/store": resolve(__dirname, "../../packages/store/src/index.ts"),
      "@omi/protocol": resolve(__dirname, "../../packages/protocol/src/index.ts"),
      "@omi/core": resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
