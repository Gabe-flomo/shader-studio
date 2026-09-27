import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * `virtual:three-slim-source`: the three.js a 3D Script layer uses
 * (src/play/kit/three-slim.js), bundled into one minified script that defines
 * the `SSThree` global, as a string. Exported web pages with a 3D Script layer
 * inline it; the app loads it with import() only when it exports one.
 */
function threeSlimSource(): Plugin {
  const id = 'virtual:three-slim-source';
  const entry = fileURLToPath(new URL('./src/play/kit/three-slim.js', import.meta.url));
  return {
    name: 'three-slim-source',
    resolveId: s => (s === id ? `\0${id}` : null),
    async load(s) {
      if (s !== `\0${id}`) return null;
      const { build } = await import('esbuild');
      const out = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'iife', globalName: 'SSThree', legalComments: 'none', write: false, target: 'es2020', logLevel: 'silent' });
      this.addWatchFile(entry);
      return `export default ${JSON.stringify(out.outputFiles[0].text)};`;
    },
  };
}

// https://vite.dev/config/
// base switches automatically: '/' for Tauri desktop, '/shader-studio/' for GitHub Pages.
// TAURI_ENV_PLATFORM is set by the Tauri CLI during both `tauri dev` and `tauri build`.
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;

// Filesystem polling is only needed where native file events don't reach the
// dev server (Docker bind mounts, WSL2 on /mnt/c, network drives). It stats
// every file in src/ twice a second and adds up to ~1 s to each hot reload,
// so it is opt-in: VITE_USE_POLLING=1 npm run dev
const usePolling = process.env.VITE_USE_POLLING === '1';

export default defineConfig({
  plugins: [react(), threeSlimSource()],
  base: isTauri ? '/' : '/shader-studio/',
  server: {
    watch: usePolling ? { usePolling: true, interval: 500 } : undefined,
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code in its own chunks so an app change doesn't make returning
        // users re-download Three.js and React; example graphs and the
        // secondary pages split off through dynamic import() in the app.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (/node_modules\/(react|react-dom|scheduler|zustand)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
})
