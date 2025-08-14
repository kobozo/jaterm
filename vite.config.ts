import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Minimal Vite config (no React plugin) to keep things light for Tauri.
export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    target: 'es2020',
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
});
