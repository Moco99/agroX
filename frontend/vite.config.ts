import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the local FastAPI so the browser never needs CORS nor absolute URLs
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.AGROX_API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
