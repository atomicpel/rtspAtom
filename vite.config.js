import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// При разработке API и видео проксируются на локальный сервер панели (npm run server).
const backend = process.env.RTSPATOM_BACKEND || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    hmr: {
      port: 3000,
    },
    proxy: {
      "/api": backend,
      "/hls": backend,
    },
  },
});
