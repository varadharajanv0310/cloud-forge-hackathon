import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Must match server/index.js. NOT 5000 — macOS ControlCenter squats on
      // that port and answers 403, which looks like a running API.
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:5050',
        changeOrigin: true,
      },
    },
  },
});
