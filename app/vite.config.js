import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Target older Chromium so 2020+ webOS TVs (webOS 5 = Chromium 68,
    // webOS 6 = Chromium 79) can parse the bundle. The app's own code uses
    // modern syntax (optional chaining ×180) that Chromium <80 can't parse,
    // which showed as a blank/black screen on older TVs (issue #10). esbuild
    // lowers the syntax; the code uses no modern runtime APIs needing polyfills.
    target: 'chrome68',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          'shaka': ['shaka-player'],
          'react-vendor': ['react', 'react-dom'],
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  }
});
