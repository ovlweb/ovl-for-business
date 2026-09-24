import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.VITE_DEV_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5174,
    proxy: { '/api': { target: api, changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 800 },
});
