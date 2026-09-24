import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Toaster } from './components/ui/Toaster'
import { DialogHost } from './components/ui/DialogHost'
import { useNodeGraphStore } from './store/useNodeGraphStore'

const root = createRoot(document.getElementById('root')!)

// Dev-only: the store on window, so scripted checks (and the in-app browser) can load examples and
// read state without clicking through the UI. Not bundled in production.
if (import.meta.env.DEV) (window as unknown as { __shaderStudio?: unknown }).__shaderStudio = useNodeGraphStore

// Dev-only component gallery for the redesign primitives: open the app with #ui.
// import.meta.env.DEV is false in production builds, so the gallery isn't bundled.
if (import.meta.env.DEV && location.hash === '#ui') {
  import('./components/ui/UiGallery').then(({ UiGallery }) => root.render(<UiGallery />))
} else {
  root.render(<><App /><Toaster /><DialogHost /></>)
}
