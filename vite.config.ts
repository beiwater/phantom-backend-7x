import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        secure: false
      },
      '/ws': {
        target: 'ws://127.0.0.1:3100',
        ws: true
      },
      '/images': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        secure: false
      },
      '/static': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
