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
    rollupOptions: {
      output: {
        // three and the R3F stack change rarely: splitting them keeps the lazy twin-screen chunk
        // small and lets the browser cache the heavy libraries across deploys. Vite 8 bundles with
        // Rolldown, whose chunking API is advancedChunks (the manualChunks function is only partly honoured).
        advancedChunks: {
          groups: [
            { name: "three", test: /node_modules[\\/]three[\\/]/ },
            { name: "r3f", test: /node_modules[\\/](@react-three|postprocessing|n8ao)[\\/]/ },
          ],
        },
      },
    },
  },
});
