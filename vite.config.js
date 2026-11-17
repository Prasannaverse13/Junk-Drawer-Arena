import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "client",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
    target: "es2022",
    rollupOptions: {
      input: { main: resolve("client/index.html"), play: resolve("client/play.html"), join: resolve("client/join.html") },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/files": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
  optimizeDeps: { exclude: ["@dimforge/rapier3d-compat"] },
});
