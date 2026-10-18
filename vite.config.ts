import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ isSsrBuild }) => ({
  // Server modules locate sibling worker directories relative to import.meta.url.
  // Keep SSR chunks beside their entry so those trusted paths remain stable.
  ...(isSsrBuild
    ? {
        build: {
          rollupOptions: { output: { chunkFileNames: "[name]-[hash].js" } },
        },
      }
    : {}),
  plugins: [react()],
  server: {
    port: 5173,
    watch: { ignored: ["**/outputs/**", "**/work/**", "**/data/**"] },
    proxy: {
      "/api": { target: "http://127.0.0.1:4310", changeOrigin: false },
      "/evidence": { target: "http://127.0.0.1:4310", changeOrigin: false },
      "/reports": { target: "http://127.0.0.1:4310", changeOrigin: false },
    },
  },
}));
