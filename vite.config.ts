import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
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

// The image model (docs/taste.md "How things look"). ONNX Runtime's WebAssembly is an asset of the
// model's worker (src/imageModel/worker.ts imports it with ?url), so it's served by the app, never a CDN,
// and only loaded when the model is first needed. The model's own files (tools/fetch-image-model.mjs, kept in
// .cache/image-model/, not committed) are copied to <base>models/ only in a Tauri build, so the desktop
// app works offline from its first launch; the web build downloads them from Hugging Face once instead.
// In dev they're served too when present (try the desktop path with ?imageModel=local).
const MODEL_CACHE = fileURLToPath(new URL('./.cache/image-model/', import.meta.url))
function imageModelFiles(bundleModel: boolean): Plugin {
  return {
    name: 'image-model-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        const model = /\/models\/(.+)$/.exec(url)
        const file = model && !model[1].includes('..') ? MODEL_CACHE + decodeURIComponent(model[1]) : null
        if (file && existsSync(file)) {
          res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream')
          res.end(readFileSync(file))
          return
        }
        next()
      })
    },
    async buildStart() {
      if (!bundleModel) return
      const tool = await import('./tools/fetch-image-model.mjs')
      if (tool.missingFiles().length) await tool.fetchImageModel(s => this.info(s))
    },
    async generateBundle() {
      if (!bundleModel) return
      const tool = await import('./tools/fetch-image-model.mjs')
      const { repo, files } = tool.modelConfig()
      for (const f of files) this.emitFile({ type: 'asset', fileName: `models/${repo}/${f.path}`, source: readFileSync(`${tool.cacheDir(repo)}/${f.path}`) })
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

// The desktop app's version, stamped into profile ZIPs (Files page) so an install can say where one came from.
const appVersion = (JSON.parse(readFileSync(fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url)), 'utf8')) as { version?: string }).version ?? '0.0.0'

export default defineConfig({
  plugins: [react(), mediapipeWasm(), threeSlimSource(), imageModelFiles(isTauri)],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  // The hand tracker's worker imports MediaPipe as an ES module.
  worker: { format: 'es' },
  base: isTauri ? '/' : '/shader-studio/',
  server: {
    watch: usePolling ? { usePolling: true, interval: 500 } : undefined,
  },
  build: {
    rollupOptions: {
      // The output window (docs/projection.md) is a page of its own: the picture and the mapping, no app.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        output: fileURLToPath(new URL('./output.html', import.meta.url)),
      },
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
