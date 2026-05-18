import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createBiliDevProxyPlugin } from './src/dev/biliProxy';

export default defineConfig({
  plugins: [react(), createBiliDevProxyPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'chrome108',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/shaka-player')) {
            return 'shaka';
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
