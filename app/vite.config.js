import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// webOS apps load over file://, which has a null origin. Vite tags the module
// script + modulepreload with `crossorigin`, and older webOS WebViews (webOS 6
// / Chromium 79) then run a CORS check on the file:// module that fails — the
// script silently never executes → blank screen with zero console output
// (issue #10, LG C1/NanoCell on webOS 6.5). Stripping `crossorigin` from the
// generated tags makes the modules load on those engines.
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), stripCrossorigin()],
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
        // NOTE: do not force shaka-player into a manualChunk. Doing so made
        // Rollup hoist a shared helper into the shaka chunk that the entry
        // statically imported, pulling the whole 769 KB player engine into the
        // startup graph — which crashed app boot on webOS 6 / Chromium 79
        // (issue #10). Letting the dynamic import('shaka-player') in PlayerPage
        // split naturally keeps it a lazy, on-demand chunk.
        manualChunks: {
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
