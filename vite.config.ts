import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [react()],
  base: isTauri ? '/' : '/shader-studio/',
  server: {
    watch: usePolling ? { usePolling: true, interval: 500 } : undefined,
  },
})
