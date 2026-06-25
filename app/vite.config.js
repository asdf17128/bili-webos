import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

// THE root cause of the blank screen on older webOS (issue #10): the app loads
// over file:// (no HTTP server), so every asset's MIME type is "". Chromium 79
// (webOS 6) and Chromium 68 (webOS 5) enforce *strict MIME checking* on
// `<script type="module">` and reject any module whose MIME isn't a JS type —
// so the entry module never executes and nothing renders, with this console
// error: "Failed to load module script: The server responded with a
// non-JavaScript MIME type of ''". Newer Chromium (webOS 24) maps the .js
// extension to a JS MIME even over file://, which is why the C4 always worked
// and masked the bug.
//
// Fix: @vitejs/plugin-legacy with renderModernChunks:false emits a *classic*
// SystemJS bundle (plain <script>, no type="module") for ALL browsers — classic
// scripts aren't subject to the module MIME check, so they run over file://.
// As a bonus, plugin-legacy's core-js polyfills cover the missing runtime APIs
// on Chromium 68 (globalThis, etc.), folding in the old webOS-5 fix too.
// SystemJS still handles the dynamic import() so Shaka stays lazy-loaded.

// Belt-and-suspenders shims applied to the built index.html. Strip `crossorigin`
// (file:// is a null origin; a stray crossorigin attr can fail an internal CORS
// check) and inline a globalThis polyfill before the bundle, in case anything
// runs ahead of the core-js polyfill chunk.
function webosCompat() {
  const polyfill = `<script>if(typeof globalThis==='undefined'&&typeof window!=='undefined'){window.globalThis=window;}</script>`;
  return {
    name: 'webos-compat',
    // order:'post' so this runs AFTER plugin-legacy injects its SystemJS script
    // tags — otherwise the crossorigin it stamps on them survives.
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        html = html.replace(/\s+crossorigin/g, '');
        // Drop modulepreload hints: useless for the classic SystemJS bundle and
        // they trigger a "request mode does not match" warning over file://.
        html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
        html = html.replace(/<head>/i, `<head>\n    ${polyfill}`);
        return html;
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    // Emit a classic SystemJS bundle for EVERY browser (renderModernChunks:false
    // removes the ES-module output entirely) so it runs over file:// on older
    // webOS. targets covers webOS 5 (Chromium 68) and up; core-js polyfills are
    // injected based on usage.
    legacy({
      targets: ['chrome >= 68'],
      modernPolyfills: false,
      renderModernChunks: false,
    }),
    webosCompat(),
  ],
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
