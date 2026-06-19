import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(async () => ({
  clearScreen: false,
  resolve: {
    // ../shared/sidecarCore (imported via the app/prep modules) can't resolve
    // @tauri-apps/* on its own — point them at the shell's deps.
    alias: [
      {
        find: /^@tauri-apps\//,
        replacement: fileURLToPath(new URL("./node_modules/@tauri-apps/", import.meta.url)),
      },
    ],
  },
  server: {
    port: 1422,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Vitest: happy-dom for DOM helpers (styleRegistry render-smoke). T-03 / T-05.
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
}));
