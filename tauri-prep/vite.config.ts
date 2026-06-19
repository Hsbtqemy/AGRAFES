import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(async () => ({
  clearScreen: false,
  resolve: {
    // The shared connection core (../shared) lives outside this app's tree and
    // can't resolve @tauri-apps/* on its own — point them at this app's deps.
    alias: [
      {
        find: /^@tauri-apps\//,
        replacement: fileURLToPath(new URL("./node_modules/@tauri-apps/", import.meta.url)),
      },
    ],
  },
  server: {
    port: 1421,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/screens/**"],
      exclude: ["src/**/__tests__/**"],
    },
  },
}));
