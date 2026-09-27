import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Hand tracking (docs/hand-tracking.md) runs MediaPipe's WebAssembly, which
// lives in the npm package. Serve it at <base>mediapipe/wasm/ in dev and copy
// it there in a build, so the app (and the desktop app) tracks hands offline
// without a second copy in the repo. The model sits in public/mediapipe/.
// vision_bundle.mjs goes along for web exports that carry hand tracking.
const MEDIAPIPE_DIR = fileURLToPath(new URL('./node_modules/@mediapipe/tasks-vision/', import.meta.url))
const MEDIAPIPE_FILES: Record<string, { path: string; type: string }> = {
  'vision_wasm_module_internal.js': { path: 'wasm/vision_wasm_module_internal.js', type: 'text/javascript' },
  'vision_wasm_module_internal.wasm': { path: 'wasm/vision_wasm_module_internal.wasm', type: 'application/wasm' },
  'vision_bundle.mjs': { path: 'vision_bundle.mjs', type: 'text/javascript' },
}
function mediapipeWasm(): Plugin {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/mediapipe\/wasm\/([\w.]+)(\?.*)?$/.exec(req.url ?? '')
        const f = m && MEDIAPIPE_FILES[m[1]]
        if (!f) return next()
        res.setHeader('Content-Type', f.type)
        res.setHeader('Cache-Control', 'max-age=3600')
        res.end(readFileSync(MEDIAPIPE_DIR + f.path))
      })
    },
    generateBundle() {
      for (const [name, f] of Object.entries(MEDIAPIPE_FILES)) {
        this.emitFile({ type: 'asset', fileName: `mediapipe/wasm/${name}`, source: readFileSync(MEDIAPIPE_DIR + f.path) })
      }
    },
  }
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
  plugins: [react(), mediapipeWasm()],
  // The hand tracker's worker imports MediaPipe as an ES module.
  worker: { format: 'es' },
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
