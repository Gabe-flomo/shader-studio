import { createRoot } from 'react-dom/client'
// First: every Play record the app opens is turned into rules (types/play.ts parsePlayRecord).
import './play/rules'
import './index.css'
import App from './App.tsx'
import { Toaster } from './components/ui/Toaster'
import { DialogHost } from './components/ui/DialogHost'
import { NodeDragGhost } from './components/NodeGraph/NodeDragGhost'
import { ProSheetHost } from './components/account/ProSheet'
import { PlayfileHost } from './components/playfile/PlayfileHost'
import { BuilderWindowHost } from './components/nodePacks/BuilderWindowHost'
import { SignInPage } from './components/account/SignInPage'
import { GATE_USERS, OPEN_SESSION, isGateOn, rememberSignIn, restoreSignIn, sessionFor, verifyLogin } from './auth/gate'
import { usePlan } from './lib/plan'
import { BackgroundsHost } from './components/backgrounds/BackgroundsHost'
import { LinkedPickerHost } from './components/linked/LinkedPickerHost'
import { PerformanceBar } from './components/PerformanceBar'
import { FunctionCardHost } from './components/explain/functionCard/FunctionCardHost'
import { installFunctionCardTriggers } from './components/explain/functionCard/triggers'
import { useNodeGraphStore } from './store/useNodeGraphStore'
import { compileGraph } from './compiler/graphCompiler'
import { nodePreviewRenderer } from './lib/nodePreviewRenderer'
import { loadExampleGraphs } from './store/exampleIndex'
import { installCameraKeeper } from './lib/cameraKeeper'
import { installTouchGuards } from './lib/touchGuards'
import { installStorageLimit } from './files/storageLimitApp'
import { installViewportWatcher } from './lib/viewport'
import { resolveNodeAliases } from './nodes/definitions/aliases'
import { getNodeDefinition } from './nodes/definitions'
import { watchForStaleBuild } from './lib/staleBuild'
import { takeApplier, useTakes } from './lib/takes'
import { playOverlay } from './play/overlay'
import { playBackground } from './play/background'
import { handFeed, warmupTrackers } from './lib/handFeed'
import { playEngine } from './lib/playEngine'
import { midiEngine } from './lib/midiEngine'
import { midiMonitor } from './lib/midiMonitor'
import { rackKeyboard } from './lib/rackKeyboard'
import { tape, useTape } from './lib/tape'
import { audioEngine } from './lib/audioEngine'
import { padGrid } from './lib/padGrid'

// The webcam turns off as soon as no layer or hand tracking uses it.
installCameraKeeper()
// Long presses on touch screens: no browser menu over the app's own.
installTouchGuards()
installStorageLimit()
installViewportWatcher()
// Function cards: click / hover / ⌥-click a function name in any code (docs/expression-explainer.md).
// Installed before anything else listens for Esc, so Esc closes the card before a modal under it.
installFunctionCardTriggers()
// "Warm up trackers when the app opens" (App settings → Camera, MIDI, OSC and audio): loads a
// tracker's model into Cache Storage now, without opening the camera, so Enable is instant later.
void warmupTrackers()

const root = createRoot(document.getElementById('root')!)
watchForStaleBuild()

// Dev-only: the store on window, so scripted checks (and the in-app browser) can load examples and
// read state without clicking through the UI. Not bundled in production.
if (import.meta.env.DEV) {
  const w = window as unknown as { __shaderStudio?: unknown; __shaderStudioDev?: unknown }
  w.__shaderStudio = useNodeGraphStore
  w.__shaderStudioDev = {
    compileGraph, nodePreviewRenderer, loadExampleGraphs, resolveNodeAliases, getNodeDefinition, useTakes, takeApplier, playOverlay, playBackground, handFeed, playEngine,
    /** MIDI without a controller: `midiEngine.handleBytes(0xb0, 21, 64, 'Launch Control')` is a knob on channel 1 of that device. */
    midiEngine, padGrid,
    /** "Show as" previews (docs/node-previews.md): per-node choices, and the readback/paint timings. */
    nodePreviewPrefs: () => import('./lib/nodePreview/showAs').then(m => m.useNodePreviewPrefs),
    previewPerf: () => import('./lib/nodePreview/previewBus').then(m => m.previewPerf),
    perfSnapshot: () => import('./lib/perfStats').then(m => m.getPerfSnapshot()),
    /** Every registered node type, for registry-wide checks (the node-preview audit). */
    nodeTypes: () => import('./nodes/definitions').then(m => Object.values(m.NODE_REGISTRY).filter(d => !d.deprecated).map(d => ({ type: d.type, label: d.label, category: d.category, outputs: Object.fromEntries(Object.entries(d.outputs).map(([k, o]) => [k, o.type])) }))),
    /** The MIDI monitor's log (`midiMonitor.text()`), and the rack keyboard (`rackKeyboard.active()`). */
    midiMonitor, rackKeyboard,
    /** Linked folders without a folder picker: `(await linked()).devLinkOpfs('Samples', { 'kick.wav': blob })` links a folder in the browser's private file system. */
    linked: () => import('./files/linkedFolders'),
    /** The Layers node's distance field (docs/layers-node.md): `(await layersField()).layersFieldMode()` is 'gpu' | 'cpu' | 'off'; `.setLayersFieldForceCpu(true)` compares with the old CPU field. */
    layersField: () => import('./play/layersTexture'),
    /** The 3D Scene Builder (docs/scene-builder.md): `(await sceneBuilder()).useSceneBuilder.getState().openWith(…)`, recipes, templates, describe. */
    sceneBuilder: async () => ({ ...(await import('./sceneBuilder/store')), ...(await import('./sceneBuilder/recipe')), ...(await import('./sceneBuilder/templates')), ...(await import('./sceneBuilder/actions')), ...(await import('./sceneBuilder/recognize')) }),
    /** Narrow-width layout check (dev/overflowCheck.ts): `(await overflow()).sweepOverflow('[data-column=sources]', [280, 320])` lists what runs past its card. */
    overflow: () => import('./dev/overflowCheck'),
    /** The Audio engine's tape (docs/arrangement.md): `tape.record()`, `tape.play()`, `useTape.getState()`; `audioEngine.setMasterVolume(0)` for silent checks. */
    tape, useTape, audioEngine,
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
function startApp() {
  root.render(<><App /><Toaster /><BackgroundsHost /><LinkedPickerHost /><DialogHost /><NodeDragGhost /><ProSheetHost /><PlayfileHost /><BuilderWindowHost /><PerformanceBar /><FunctionCardHost /></>)
  // Songs stop when the graph that owns them is closed or they're deleted.
  void import('./lib/audioSync').then(m => m.startAudioSync())
  // Text layers' fonts from linked folders (docs/linked-folders.md) are read from disk.
  void Promise.all([import('./play/kit/layers.js'), import('./files/linkedFolders')]).then(([k, l]) => k.klSetLinkedFontReader(async ref => { const r = await l.resolveLinked(ref); return r.ok ? r.blob.arrayBuffer() : null }))
  // The workspace folder (desktop app; a picked folder in Chrome/Edge) starts once the app is up;
  // without one, the old backup folder keeps its copy.
  window.setTimeout(() => { void import('./workspace/workspace').then(m => m.startWorkspace()) }, 1500)
  // Crash recovery (docs/crash-recovery.md): after the blank graph is up, offer to recover a crashed
  // session's unsaved work, then autosave the open project on the setting's cadence.
  window.setTimeout(() => { void import('./files/recovery').then(m => m.startRecovery()) }, 1000)
}

if (import.meta.env.DEV && location.hash === '#ui') {
  import('./components/ui/UiGallery').then(({ UiGallery }) => root.render(<UiGallery />))
} else if (!isGateOn()) {
  // No sign-in gate (no users in src/auth/gateUsers.json, or VITE_GATE=off): everyone is Pro.
  usePlan.getState().setSession(OPEN_SESSION)
  startApp()
} else {
  // The sign-in gate (docs/sign-in-gate.md): nothing of the app mounts until someone signs in.
  const remembered = restoreSignIn(GATE_USERS)
  if (remembered) {
    usePlan.getState().setSession(sessionFor(remembered))
    startApp()
  } else {
    usePlan.getState().setSession({ status: 'signed-out' })
    root.render(<SignInPage onSignIn={async (username, password, stay) => {
      const user = await verifyLogin(GATE_USERS, username, password)
      if (!user) return null
      rememberSignIn(user, stay)
      usePlan.getState().setSession(sessionFor(user))
      startApp()
      return user
    }} />)
  }
}
