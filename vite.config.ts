import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base is set to '/shader-studio/' for GitHub Pages hosting.
// If you're hosting at a custom domain root, change base to '/'.
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
  base: '/shader-studio/',
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
