import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Toaster } from './components/ui/Toaster'
import { DialogHost } from './components/ui/DialogHost'
import { BackgroundsHost } from './components/backgrounds/BackgroundsHost'
import { PerformanceBar } from './components/PerformanceBar'
import { useNodeGraphStore } from './store/useNodeGraphStore'
import { compileGraph } from './compiler/graphCompiler'
import { nodePreviewRenderer } from './lib/nodePreviewRenderer'
import { loadExampleGraphs } from './store/exampleIndex'
import { installCameraKeeper } from './lib/cameraKeeper'
import { resolveNodeAliases } from './nodes/definitions/aliases'
import { getNodeDefinition } from './nodes/definitions'
import { watchForStaleBuild } from './lib/staleBuild'
import { takeApplier, useTakes } from './lib/takes'
import { playOverlay } from './play/overlay'
import { playBackground } from './play/background'
import { handFeed } from './lib/handFeed'
import { playEngine } from './lib/playEngine'

// The webcam turns off as soon as no layer or hand tracking uses it.
installCameraKeeper()

const root = createRoot(document.getElementById('root')!)
watchForStaleBuild()

// Dev-only: the store on window, so scripted checks (and the in-app browser) can load examples and
// read state without clicking through the UI. Not bundled in production.
if (import.meta.env.DEV) {
  const w = window as unknown as { __shaderStudio?: unknown; __shaderStudioDev?: unknown }
  w.__shaderStudio = useNodeGraphStore
  w.__shaderStudioDev = {
    compileGraph, nodePreviewRenderer, loadExampleGraphs, resolveNodeAliases, getNodeDefinition, useTakes, takeApplier, playOverlay, playBackground, handFeed, playEngine,
    /**
     * Hand tracking without a camera (the preview browser has none): feed the real tracker a video,
     * an image or a canvas instead, then start it. A URL ending in an image type is loaded as an image.
     */
    async handTrackerFromVideo(src: string | HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) {
      let el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
      if (typeof src !== 'string') el = src
      else if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(src) || src.startsWith('data:image/')) {
        // onload, not decode(): decode() can wait forever in a hidden tab.
        const img = new Image(); img.crossOrigin = 'anonymous'
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src }); el = img
      } else {
        const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.loop = true; v.playsInline = true; v.src = src
        await v.play(); el = v
      }
      handFeed.useSource(el)
      return handFeed.start()
    },
  }
}

// Dev-only component gallery for the redesign primitives: open the app with #ui.
// import.meta.env.DEV is false in production builds, so the gallery isn't bundled.
if (import.meta.env.DEV && location.hash === '#ui') {
  import('./components/ui/UiGallery').then(({ UiGallery }) => root.render(<UiGallery />))
} else {
  root.render(<><App /><Toaster /><BackgroundsHost /><DialogHost /><PerformanceBar /></>)
  // Songs stop when the graph that owns them is closed or they're deleted.
  void import('./lib/audioSync').then(m => m.startAudioSync())
  // The backup folder (desktop app; a picked folder in Chrome/Edge) starts once the app is up.
  window.setTimeout(() => { void import('./utils/backupFolder').then(m => m.startBackups()) }, 1500)
}
