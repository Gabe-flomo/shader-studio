import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base switches automatically: '/' for Tauri desktop, '/shader-studio/' for GitHub Pages.
// TAURI_ENV_DEBUG is set automatically by the Tauri CLI during tauri dev / tauri build.
const isTauri = process.env.TAURI_ENV_DEBUG !== undefined;

export default defineConfig({
  plugins: [
    react(),
    // Add Cross-Origin-Isolation headers in dev so ffmpeg.wasm works locally
    {
      name: 'configure-response-headers',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      },
    },
  ],
  base: isTauri ? '/' : '/shader-studio/',
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
