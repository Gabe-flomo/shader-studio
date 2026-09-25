import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Toaster } from './components/ui/Toaster'
import { DialogHost } from './components/ui/DialogHost'
import { useNodeGraphStore } from './store/useNodeGraphStore'
import { compileGraph } from './compiler/graphCompiler'
import { nodePreviewRenderer } from './lib/nodePreviewRenderer'
import { loadExampleGraphs } from './store/exampleIndex'
import { resolveNodeAliases } from './nodes/definitions/aliases'
import { getNodeDefinition } from './nodes/definitions'
import { watchForStaleBuild } from './lib/staleBuild'

const root = createRoot(document.getElementById('root')!)
watchForStaleBuild()

// Dev-only: the store on window, so scripted checks (and the in-app browser) can load examples and
// read state without clicking through the UI. Not bundled in production.
if (import.meta.env.DEV) {
  const w = window as unknown as { __shaderStudio?: unknown; __shaderStudioDev?: unknown }
  w.__shaderStudio = useNodeGraphStore
  w.__shaderStudioDev = { compileGraph, nodePreviewRenderer, loadExampleGraphs, resolveNodeAliases, getNodeDefinition }
}

// Dev-only component gallery for the redesign primitives: open the app with #ui.
// import.meta.env.DEV is false in production builds, so the gallery isn't bundled.
if (import.meta.env.DEV && location.hash === '#ui') {
  import('./components/ui/UiGallery').then(({ UiGallery }) => root.render(<UiGallery />))
} else {
  root.render(<><App /><Toaster /><DialogHost /></>)
  // Songs stop when the graph that owns them is closed or they're deleted.
  void import('./lib/audioSync').then(m => m.startAudioSync())
  // The backup folder (desktop app; a picked folder in Chrome/Edge) starts once the app is up.
  window.setTimeout(() => { void import('./utils/backupFolder').then(m => m.startBackups()) }, 1500)
}
