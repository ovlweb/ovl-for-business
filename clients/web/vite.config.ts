import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :4000; the proxy keeps the web client same-origin.
const api = process.env.VITE_DEV_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build works inside Capacitor and Tauri shells.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 800 },
});
