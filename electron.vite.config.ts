import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Strict CSP for the shipped (file://) app. Injected only into the production
// build so dev keeps Vite HMR + react-refresh (which need an inline preamble).
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: tj-image:; connect-src 'self'";

function cspMeta(): Plugin {
  return {
    name: 'tj-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />\n  </head>`,
      );
    },
  };
}

// Slice 0 walking skeleton: three separate builds (main / preload / renderer).
// externalizeDepsPlugin keeps native + node deps (e.g. better-sqlite3) out of the
// main/preload bundles so they are `require`d from node_modules at runtime.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), cspMeta()],
    build: {
      rollupOptions: {
        input: { index: 'src/renderer/index.html' },
      },
    },
  },
});
