import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Compatibility shims for older webOS WebViews, applied to the built index.html
// (issue #10). Two fixes:
//  1. Strip `crossorigin`: webOS apps load over file:// (null origin). Vite tags
//     the module script + modulepreload with `crossorigin`, and webOS 6 /
//     Chromium 79 then runs a CORS check on the file:// module that fails — the
//     script silently never executes → blank screen, zero console output.
//  2. Polyfill `globalThis`: webOS 5.5 is Chromium 68, but `globalThis` only
//     landed in Chromium 71. react-dom references it at startup, throwing a
//     ReferenceError before React can mount → blank screen (no crash). An inline
//     classic <script> runs before the deferred module bundle and defines it.
function webosCompat() {
  const polyfill = `<script>if(typeof globalThis==='undefined'&&typeof window!=='undefined'){window.globalThis=window;}</script>`;
  return {
    name: 'webos-compat',
    transformIndexHtml(html) {
      html = html.replace(/\s+crossorigin/g, '');
      html = html.replace(/<head>/i, `<head>\n    ${polyfill}`);
      return html;
    },
  };
}

export default defineConfig({
  plugins: [react(), webosCompat()],
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
