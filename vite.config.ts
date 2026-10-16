import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
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
});
