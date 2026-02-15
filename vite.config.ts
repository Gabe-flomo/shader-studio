import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base is set to '/shader-studio/' for GitHub Pages hosting.
// If you're hosting at a custom domain root, change base to '/'.
export default defineConfig({
  plugins: [react()],
  base: '/shader-studio/',
})
