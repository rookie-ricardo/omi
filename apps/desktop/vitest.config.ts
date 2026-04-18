import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/ui/theme": resolve(__dirname, "src/renderer/ui/theme/index.ts"),
      "@/ui": resolve(__dirname, "src/renderer/ui/index.ts"),
      "@/tokens": resolve(__dirname, "src/renderer/tokens/index.ts"),
      "@omi/core": resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
