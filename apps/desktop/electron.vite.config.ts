import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
    },
    resolve: {
      alias: {
        "@omi/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
    },
    resolve: {
      alias: {
        "@omi/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@/ui/theme": resolve(__dirname, "src/renderer/ui/theme/index.ts"),
        "@/ui": resolve(__dirname, "src/renderer/ui/index.ts"),
        "@/tokens": resolve(__dirname, "src/renderer/tokens/index.ts"),
        "@omi/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      },
    },
  },
});
