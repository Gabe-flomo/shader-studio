# Shader Studio: Discovery Audit

Date: 2026-09-24
Branch: `claude/friendly-mendel-lqfgcj` (based on `main` at `c8fd435`)
Scope: read-only discovery. Nothing in this document has been implemented.

## How to read this

This is a map of where the app does more work than it needs to, and what to change. It is written for two readers:

- **Gabe**, to understand what is going on and decide what to do.
- **An implementing agent**, who should be able to pick any finding and start without re-investigating. Every finding says what happens today, where in the code, why it matters, what to change, and how big the change is.

Sizes: **S** is under an hour of focused work in one or two files. **M** is a few hours across several files. **L** is a day or more, or touches architecture.

Each finding has an ID like `A1` or `C3` so they can be referenced from tasks and commits.

One rule that applies everywhere: **sliders must stay live.** When a slider moves, the canvas must update on that same tick. None of the changes below add lag. Several of them remove it.

---

## 1. How the app works

Shader Studio is a node editor that turns a graph into a GLSL fragment shader and runs it on the GPU. There are five layers.

**The store** (`src/store/useNodeGraphStore.ts`, 4,148 lines). One Zustand store holds everything: the node list, connections, which group you are inside, the compiled shader text, and also fast-changing values like the current time, the pixel color under the mouse, and probe readouts. Every action that changes the graph calls `compile()` right after.

**The compiler** (`src/compiler/`). `compile()` validates the graph, sorts nodes so inputs come before outputs, walks them once, and asks each node definition to emit its GLSL. Shared helper functions are deduplicated by exact text. The output is one fragment shader string plus a map of "param uniforms": float sliders that were turned into GPU uniforms so they can change without a recompile. The JS part of this is fast: under a millisecond for every bundled example graph.

**The canvas** (`src/components/ShaderCanvas.tsx`, 1,287 lines). One Three.js renderer draws a full-screen quad with the compiled shader. It runs a `requestAnimationFrame` loop that renders two passes per frame (shader into a float buffer, then a dithering blit to screen), and every sixth frame does extra work: reads the pixel under the mouse, computes a histogram, and samples "probe" values for the selected node. When the shader string changes, it swaps the source into the material and Three.js compiles and links a new GPU program on the next frame.

**The graph editor** (`src/components/NodeGraph/`). `NodeGraph.tsx` draws the canvas, wires, and one `NodeComponent` per node. `NodeComponent.tsx` is 4,726 lines and holds every kind of node card: sliders, previews, group cards, expression editors. There is a separate mobile editor, `MobileGraphBrowser.tsx` (4,335 lines), that renders the same graph as a list.

**The node catalog** (`src/nodes/definitions/`). Around 350 node types across 33 files. Each is a `NodeDefinition` with typed inputs and outputs, parameter definitions that drive the UI, and a `generateGLSL` function.

The chain that matters most for feel: **slider moves → store writes → compile → new shader string → GPU relink → React re-renders every node card.** Most of the findings below are about breaking unnecessary links in that chain.

---

## 2. The short version

These are the findings that change how the app feels, in the order to do them.

| ID | Finding | Effect today | Size |
|----|---------|--------------|------|
| A1 | The slider "fast path" never fires because of a name mismatch. Every slider tick recompiles the shader and relinks the GPU program. | Canvas lags behind sliders. Feedback effects reset while dragging. | S |
| B1 | The canvas writes into the store every sixth frame even when nothing changed, and the root `App` component subscribes to the entire store. | The whole React tree re-renders about 10 times a second while idle. | S |
| B2 | The shader redraws every frame, two passes, even when paused or when nothing in it depends on time. | Battery and heat on phones and laptops for a static image. | M |
| C1 | Node drag, pan, and zoom write React state on every mouse move. Nothing is memoized. Wires re-measure the DOM on every render. | Every node card and wire re-renders on every mouse move, twice. Big graphs get sluggish. | M–L |
| A2 | GPU program compile is synchronous and blocks the frame. The async extension is requested but never used. | A visible hitch on every structural graph edit. | M |
| B4 | Probe readbacks stall the GPU. Scope and eye-preview probes run every frame, one readback each. | Frame drops when a scope or preview is open. | M |
| E1 | The app ships as one 2.5 MB script. 425 KB of it is the example graphs, parsed on every load. | Slow first load, especially on mobile. | M |
| E2 | Six dependencies are installed but never imported, including Monaco (76 MB on disk). | Slow installs, misleading config. | S |

A1 and B1 together are two small edits that remove most of the per-tick and idle cost. Do them first.

---

## 3. Findings

### A. From slider to canvas

#### A1. The slider fast path is dead. Every tick is a full recompile. (S, high impact)

**What happens now.** When you drag a float slider, `updateNodeParams` runs with `immediate: true`. It is supposed to check whether that param is already a GPU uniform and, if so, just push the new value without recompiling. The check builds the uniform name from the raw node id. The compiler builds the same name from the node's *slug*, a short readable name like `fbm_49`. For a node with id `node_49`:

- Store builds: `u_p_nodex49_scale` (`src/store/useNodeGraphStore.ts:3118-3121`)
- Compiler builds: `u_p_fbmx49_scale` (`src/compiler/shaderAssembler.ts:3123` swaps the id for the slug, then `src/compiler/uniformPatcher.ts:93` builds the name)

They never match. So `allAreUniforms` is always false, and the slow path at line 3132 runs a full `compile()` on every input event. Group-inner overrides have the same mismatch.

This was a regression. The fast path was written before slugs existed and nothing tests it.

**What each tick costs today.** A new `nodes` array (line 3037), a full compile, a second store write of 13 fields with another new `nodes` array, every `NodeComponent` re-rendering, a synchronous GPU compile and link of a 5 to 22 KB shader on the next frame, every probe program rebuilt, both feedback buffers cleared, and probe values reset.

**Why it matters.** This is the single biggest reason the canvas lags behind sliders. A uniform update is microseconds. A recompile plus relink is tens of milliseconds and sometimes more for raymarching graphs. Fixing this makes the canvas *more* in sync, not less.

**What to change.** Minimal version: in the fast path, look up the slug from `nodeSlugMap`, which the store already receives from every compile (line 3849), and build the name from that:

```ts
const slug = get().nodeSlugMap.get(nodeId) ?? nodeId;
const safe = slug.replace(/_/g, 'x');
const uniformName = `u_p_${safe}_${key}`;
```

For `inner::key` group overrides, `nodeSlugMap` already maps inner ids to their prefixed slug (`shaderAssembler.ts:742`, `:966`), so the same lookup works.

Robust version: have the compiler return an explicit map from `${nodeId}::${paramKey}` to uniform name, built in `compileStandardNode` and the group pass, store it, and look up by key. Add a test: compile a two-node graph, assert the store-derived name is a key in `result.paramUniforms`.

**Where.** `src/store/useNodeGraphStore.ts:3106-3136`, `src/compiler/shaderAssembler.ts:3113-3130`, `src/compiler/uniformPatcher.ts:62-99`, `src/compiler/nodeSlug.ts:96-135`.

**How to verify.** Add a temporary `console.count('compile')` in `compile()`. Drag a slider. Before the fix it counts once per event. After, it should not count at all for float sliders on non-skipped node types.

#### A2. GPU program link blocks the frame. The async path is never used. (M)

**What happens now.** `ShaderCanvas.tsx:246-247` requests `KHR_parallel_shader_compile` with a comment saying the previous frame keeps rendering during compile. In Three.js 0.182, that extension is only used by `renderer.compileAsync`. The app never calls it. Instead it sets `mat.needsUpdate = true` (line 1155) and the next `render()` links synchronously, stalling that frame for however long the driver takes.

**Why it matters.** After A1, this only happens on structural edits (connect, add, remove). Those are still frequent, and on raymarch graphs the stall is visible.

**What to change.** On shader change, build a fresh `ShaderMaterial` with the new source and the *same* `uniforms` object, put it on an off-screen mesh, `await renderer.compileAsync(...)`, then swap `mesh.material` and dispose the old one. Keep a compile counter so a stale async result is discarded if a newer shader arrived. Only clear feedback buffers after the swap. Keep `fragmentShaderRef` pointing at the *live* shader so probe programs are not built from source that is not active yet.

**Where.** `src/components/ShaderCanvas.tsx:1118-1173`.

#### A3. `compile()` always replaces the `nodes` array, even when nothing changed. (S)

**What happens now.** Both branches at `useNodeGraphStore.ts:3792-3838` end in `.map` that returns a new array even when every element is unchanged. The `set()` at 3840-3853 also resets `nodeProbeValues` to null every time. Every subscriber to `s.nodes` re-renders: every node card (`NodeComponent.tsx:350`), the graph, App, the palette, the mobile browser.

**What to change.** Track a `changed` flag in the map passes and only include `nodes` in the `set()` when something actually changed. Only reset `nodeProbeValues` when `fragmentShader` actually differs from before.

#### A4. Slider updates do two store writes per event. (S)

**What happens now.** `updateNodeParams` does one `set` to replace `nodes` (line 3037), then after A1 is fixed, `updateParamUniforms` does a second `set` for `paramUniforms` (line 3855). Each `set` re-renders App and everything under it. `ShaderCanvas` then loops over every uniform of every material (`ShaderCanvas.tsx:1266-1281`).

**What to change.** Merge the two writes into one `set`. Better: keep a pending `Map<uniformName, number>` at module level, write it straight into `material.uniforms[name].value` through a small imperative bridge (a `subscribe` in ShaderCanvas, or a registry like `scopeRegistry`), and flush the React-visible state once per animation frame.

**Note on liveness.** The canvas can only draw once per frame anyway. Writing the uniform immediately and flushing React state once per frame means the *canvas* sees every tick with zero added delay. Only the slider label and the node card catch up per frame, which is the same rate they paint at today.

#### A5. Every shader change rebuilds every probe program. (M)

**What happens now.** The selected-node probe, scope probes, and eye-preview probes each keep a cache of `ShaderMaterial`s. All three caches are wiped whenever `fragmentShaderRef` changes (`ShaderCanvas.tsx:660-663`, `:735-738`, `:797-800`). Each entry is a brand-new GPU program built from the whole main shader plus one line (`buildProbeShader` at `:404-415`). So a shader change costs N extra full compiles, one per probed output. Their compile errors also flow into the main error list, so a probe-only failure shows as a main shader error.

**What to change.** Short term: compile probe variants with `compileAsync` and keep rendering the previous probe until ready. Longer term: one probe program per compile that takes `uniform int u_probeSel` and a switch over the selected node's outputs, so switching probes only changes a uniform. Tag probe materials and route their errors separately.

#### A6. Feedback buffers are cleared on every shader change. (S, correctness)

**What happens now.** `ShaderCanvas.tsx:1157-1165` clears both ping-pong render targets inside the shader-change effect. Combined with A1, dragging any slider on a stateful graph (`prevFrame`, `bloom`, blur nodes) wipes accumulated history on every tick. Users see flicker or a reset.

**What to change.** A1 fixes most of it. Additionally, only clear when the *set of stateful nodes* changes, and add an explicit "reset feedback" action so a clear is never a side effect of a recompile.

#### A7. UI-only params trigger recompiles. (S)

**What happens now.** `updateNodeParams` with a non-numeric value always compiles (line 3110). That includes params that have nothing to do with GLSL: `_thumbnailUrl`, `_imageAspect`, `_isPlaying`, `__marchSettingsHidden`, `__hiddenInputs`. Renaming a node's label changes its slug, which changes every variable name in the shader, which forces a full GPU relink for a cosmetic change.

**What to change.** Keep a `NON_GLSL_PARAM_KEYS` set and skip `compile()` when every changed key is in it. Consider making slugs independent of the label (use the label only in the code panel display) so renames do not relink.

#### A8. A debounced compile can fire after a structural compile already ran. (S)

**What happens now.** String edits schedule a compile 500 ms later. Most of the ~50 `get().compile()` call sites do not cancel that timer, and `compile()` itself does not either. So a structural edit followed by the timer firing runs two identical compiles.

**What to change.** Call `compilationService.cancelPending()` at the top of `compile()`.

#### A9. Group inliner has a few quadratic lookups. (S, low priority)

`shaderAssembler.ts:535`, `:630`, `:714` do `subgraph.nodes.find` per sub-node per pass, and `Object.entries(node.params)` is rescanned per sub-node. Measured total compile is still under a millisecond, so this only matters if subgraphs grow past ~100 nodes. Build a `slugToOrigId` map alongside `subSlugMap` and bucket override params once per group.

---

### B. The canvas render loop

#### B1. The whole React tree re-renders ~10 times a second while idle. (S, high impact)

**What happens now.** Two things combine.

First, every sixth frame `ShaderCanvas.tsx:596-624` calls `setPixelSample(null)` when the mouse is not over the canvas, unconditionally, even if it is already null. Zustand's `set` always makes a new state object, so every subscriber is notified. Same for `setNodeProbeValues` (new object each sample while a node is selected), `setCurrentTime` (when a Time node exists), and the histogram callback into App state.

Second, `App.tsx:262-271` reads the store with no selector: `const { ... } = useNodeGraphStore();`. That subscribes to the whole store, so every one of those writes re-renders App, and because nothing below is memoized, the entire graph re-renders with it. Eleven components do this (list in C7).

Also, `ShaderCanvas`'s own `subscribe` at `:1110-1115` rebuilds a `Map` of all nodes plus a filtered array and a `Set` on every store change, including these idle writes.

**Why it matters.** With 50 to 100 nodes this is a permanent 10 Hz full-tree render plus wire layout reads while nothing is happening. It competes with the shader loop for the main thread, and it multiplies every other finding.

**What to change.**

1. Guard the writes: only call `setPixelSample(null)` if the last value was not null; only call `setNodeProbeValues` when the numbers actually changed.
2. Make the hot setters no-ops on equality in the store (`useNodeGraphStore.ts:3949-3954`).
3. Replace the destructure in App with per-key selectors (`useNodeGraphStore(s => s.pixelSample)`) or `useShallow` for groups. Actions are stable references, so selecting them is free.
4. Move the status bar readouts (`pixelSample`, `nodeProbeValues`, `hoveredParamHint`) and the histogram into small leaf components that select only those keys. Better still, put the per-frame telemetry in its own tiny store so graph components never see those writes.
5. `export const NodeGraph = React.memo(...)`.
6. In the ShaderCanvas subscribe, compare `state.nodes !== prevNodes` before rebuilding the maps.

**Where.** `src/App.tsx:262-271`, `src/components/ShaderCanvas.tsx:596-624`, `:1104-1115`, `src/store/useNodeGraphStore.ts:3949-3954`.

#### B2. The shader redraws every frame even when static or paused. (M)

**What happens now.** There is no dirty flag. Pausing only stops `virtualTime` from advancing (`ShaderCanvas.tsx:521`); the two full-canvas passes still run every vsync (`:554-577`). A shader with no time, mouse, audio, video, or feedback dependence is redrawn identically 60 to 120 times a second.

**Why it matters.** On a phone this is continuous full-screen fragment work for a picture that is not changing. On a 120 Hz display it is twice as bad.

**What to change.** Add a `needsRender` flag in the boot closure. Set it on: shader or uniform change, resize, mouse move, seek, reset, step, `timePlaying` becoming true. Compute `isDynamic = timePlaying && (usesTime || audioPlaying || videoPlaying || isStateful || particles.size > 0 || scopeIds.size > 0 || previewId)`, where `usesTime` is a regex test for `u_time` in the shader string, computed once per shader change. In `animate`, if `!isDynamic && !needsRender`, skip the render block. Better: stop scheduling rAF and restart it from the same triggers, since a stopped rAF is what lets mobile GPUs clock down. Add an optional fps cap (`now - lastRender < 1000/targetFps`) so 120 Hz phones do half the work.

**Slider note.** A slider change sets `needsRender`, so the canvas still updates on every tick.

#### B3. The loop keeps rendering into a hidden canvas on other pages. (S)

**What happens now.** On desktop the studio container is hidden with `display: none` when you switch to the Function Builder or shortcuts page (`App.tsx:1223`), but `ShaderCanvas` stays mounted and `document.hidden` is false, so both passes keep running at the last size. Meanwhile the Function Builder mounts its own 60 fps loop. Two full loops for one visible canvas.

**What to change.** In the boot effect, add an `IntersectionObserver` on the container (or check `container.offsetParent === null`) into a `visibleRef`, and treat not-visible the same as `document.hidden` at line 505.

#### B4. Synchronous pixel readbacks stall the GPU, some every frame. (M–L)

**What happens now.** Every readback is `renderer.readRenderTargetPixels`, which forces the GPU to finish everything queued and waits.

- Mouse sample: re-renders the *entire scene at full resolution* into a second target just to read one pixel (`:609-622`), every sixth frame while hovering. Allocates a new `Uint8Array` each time.
- Histogram: another full scene render at 64×36 plus a 9 KB readback and four new `Float32Array`s per sample (`:626-647`), then React state in App at 10 Hz.
- Selected-node probe: one 1×1 render plus readback *per output var* (`:687-706`) at 10 Hz.
- Scope/LFO nodes: one 1×1 render plus readback *per scope node, every frame* (`:727-782`), plus a full uniform copy per node per frame.
- Eye preview: per frame, 2 readbacks for the float output, plus 1 per connected input, plus 1 per vec output (`:785-985`). A node with 4 inputs is ~7 GPU stalls per frame.

**What to change.**

1. Throttle scope and preview probes to `frameCount % SAMPLE_EVERY` like the others. The scope buffer holds 200 samples, so 10 to 20 Hz is fine.
2. Batch all probes into one render: one probe shader that writes each probed var into a different pixel of an N×1 target, then one readback per sample.
3. Use `renderer.readRenderTargetPixelsAsync` (present in Three 0.182) and consume the *previous* sample's promise, so the CPU never waits on the GPU.
4. Mouse sample: use a scissor rect of 1×1 before the render, or read from the already-rendered frame.
5. Histogram: allocate the buffers once and `.fill(0)`; downsample the existing float target instead of re-running the shader.

#### B5. Per-frame allocations in the hot loop. (S)

`flushGlErrors` copies an (almost always empty) array every frame (`:154-158`). `audioEngine.tick()` allocates a new `Map` every frame even with no audio nodes (`src/lib/audioEngine.ts:151`). `nodesRef.current.filter(n => n.type === 'audioInput')` runs every frame (`:538`). A `CustomEvent` is built every sixth frame even when nothing listens (`:603`). Fix: return a shared empty array, reuse the Map, keep an `audioIdsRef` updated in `syncNodes`, dispatch the event only when a listener has registered.

#### B6. No WebGL context-loss handling. (M)

There is no `webglcontextlost` or `webglcontextrestored` listener anywhere. Mobile Safari and Chrome reclaim contexts under memory pressure, and the app has three contexts (main, preview renderer, Function Builder). When one is lost, the loop keeps calling `render()` on a dead context and the app goes black permanently. Fix: on lost, `preventDefault` and cancel the rAF; on restored, re-run the boot (a `bootKey` state in the effect deps is the simplest way). Same for `nodePreviewRenderer`.

#### B7. Mobile power settings. (S)

`powerPreference: 'high-performance'` (`:234`) picks the discrete GPU on dual-GPU laptops and hints max clocks on mobile. Use `'default'`, or `'low-power'` when `isMobile`. The canvas backing store is already CSS pixels with no device-pixel-ratio multiplier, which is the cheap choice and good for battery, but there is no quality setting. Consider a `renderScale` setting (0.5, 1, DPR) so users can trade sharpness for speed. Note the export resolution is tied to on-screen size and the "2x/4x" export option only upscales the canvas image; it does not render at a higher resolution.

#### B8. Function Builder preview loop. (S)

`src/components/FunctionBuilder/PreviewCanvas.tsx:109-142`: renders at device pixel ratio every frame, no `document.hidden` check, six `getUniformLocation` lookups per frame, and if the first rAF does not fire within 100 ms it switches permanently to `setInterval(cb, 16)`. Cache the uniform locations once per program, check `document.hidden`, drop the interval fallback.

#### B9. Export and screenshot edge cases. (S–M)

- Screenshot uses `canvas.toBlob` outside the rAF with no `preserveDrawingBuffer` (`ExportModal.tsx:244-256`), which yields a black image on some browsers. Render one frame synchronously right before, or capture from the float target.
- PNG-sequence export depends on `window.JSZip`, which is not a dependency (`fflate` is), so it falls through to "download first frame." Wire `fflate.zipSync` or remove the mode.
- The ffmpeg export path is fixed-timestep and correct. It could overlap GPU and IPC with two readback targets and the async read, but that is optional.

#### B10. Node preview renderer. (S, mostly fine)

One shared off-screen renderer, on-demand only, well designed. Three small things: `preserveDrawingBuffer: true` is unnecessary and costs a copy per present; the cache is unbounded and keyed with `u_time` so it almost never hits; `toDataURL('image/jpeg')` is a synchronous encode on the main thread. Drop `preserveDrawingBuffer`, quantize or drop `u_time` from the key, cap the cache at ~100 entries, use `canvas.toBlob` for async encoding.

---

### C. The graph editor

#### C1. Node drag, pan, and zoom write React state on every mouse move. (M–L, high impact on big graphs)

**What happens now.**

- Node drag: nine copies of a mousedown handler in `NodeComponent.tsx` (lines 614, 692, 880, 1109, 1294, 1467, 1822, 2740, touch at 1258) call `updateNodePosition` on every mousemove. The store maps the whole `nodes` array to a new reference (`useNodeGraphStore.ts:2974-2979`). Every node card, every wire, App, the palette, and ShaderCanvas's subscribe all react. Then `NodeGraph.tsx:255-258` schedules a rAF `setTick` for a *second* full subtree render so wires can re-read DOM rects.
- Pan and zoom: `useState` in NodeGraph (`:282-283`); every wheel event and pan mousemove sets both. `zoom` is passed as a prop to every `NodeComponent` (`:1355`), and pan/zoom feed `getSocketPos`, so all wires recompute on pan even though their world coordinates did not change.
- Wires: computed inside NodeGraph's render (`:1239-1290`) with ~5 `getBoundingClientRect` calls and an O(N) `find` per wire per render, plus fresh closures per wire so `ConnectionLine` cannot be memoized.
- No culling: `NodeGraph.tsx:1345` renders every node in the current scope regardless of whether it is on screen.

**Why it matters.** One drag mousemove costs one full-tree render, all wire layout reads, and one extra subtree render. Wires trail one frame behind. On big graphs this is where the editor gets sluggish, and it gets worse linearly with node count.

**What to change.** In order:

1. **Data-derived wires** (M): in `socketRegistry.ts`, register each socket's center offset relative to its node card (measure once on register and on a `ResizeObserver` of the card). Wire endpoints become `node.position + offset`: pure data, no layout reads, no pan/zoom dependence. Delete the rAF `setTick` effect. Build a `byId` Map once per render. Replace per-wire closures with `data-edge` attributes and one delegated hover handler on the `<svg>`. Then `React.memo(ConnectionLine)`.
2. **Ref-based drag** (M): one `useNodeDrag(nodeId, zoom, cardRef)` hook replacing the nine handlers. On mousemove set `cardRef.current.style.transform` directly and write the live position into a module-level `Map`; dispatch a `node-drag` event that the wire layer listens to and redraws only affected wires inside rAF. On mouseup, call `updateNodePosition` once. This also gives one undo entry per drag (see E4).
3. **Imperative pan/zoom** (M): `panRef` and `zoomRef` already exist (`:286-289`). Apply `transform` on the world container and the dot-grid background directly during gestures. Commit to React state on gesture end (mouseup; wheel debounced ~80 ms) for things that genuinely need it, like the minimap. Pass `zoom` to node cards through a ref in context instead of a prop.
4. **Viewport culling** (M): with data-derived positions, skip rendering cards whose bounds are outside the visible world rect plus a margin. Keep them mounted if they are selected or being dragged.

#### C2. `NodeComponent` is not memoized, subscribes to the whole `nodes` array, and gets unstable callbacks. (M)

**What happens now.** `NodeComponent.tsx:349` is a plain function with about 40 store hooks and 38 `useState`s. Line 350 subscribes to `s.nodes` for two lookups. Selectors at `:355-361` and `:390-392` run `s.nodes.find` per node per store notification, which is O(N²) selector work per event. From NodeGraph, `handleStartConnection` (`:573`) and `handleEndConnection` (`:617`) are re-created every render, and `handleTapOutputSocket` depends on `nodes`.

**What to change.**

1. `export const NodeComponent = React.memo(function NodeComponent(...) {...})`.
2. Drop the `s.nodes` subscription. Add a derived `nodeById: Map` to the store, rebuilt in every `set` that touches `nodes`, and use `useNodeGraphStore(s => s.nodeById.get(id))` where a source node is needed.
3. Move the `activeGroupIterations` and `mlGroupHiddenOutputs` selectors into NodeGraph (computed once from `activeGroupNode`) and pass primitives down.
4. Wrap NodeGraph's connection handlers in `useCallback`, reading `nodes` and `dragConnection` from refs or `getState()`.

#### C3. `NodeComponent.tsx` is 4,726 lines and holds every card type. (L, architectural)

This is not a performance bug by itself, but it makes every other fix in this section harder and riskier. The nine duplicated drag handlers exist because the file has nine card variants that each own their header. Splitting it into a thin `NodeCard` shell (header, sockets, drag, selection) plus per-kind bodies (`SliderParams`, `GroupCardBody`, `ExprBody`, `PreviewBody`, ...) would let the shell be memoized once and the drag hook live in one place. Do this after C1 and C2 land so the split has a clear target, or do C1.2 (the drag hook) as the first extraction from it.

#### C4. Slider drag does two renders per event. (S)

Covered by A4. With C2's memo, only the owning card re-renders per tick.

#### C5. `registerFitView` writes the store on every `nodes` change. (S)

`NodeGraph.tsx:700-719`: `handleFitView` depends on `displayNodes`, and an effect re-registers it in the store on every change, which is another `set` and another full-tree render after every drag mousemove. Store the callback in a ref and register once, or keep `_fitViewCallback` outside Zustand entirely.

#### C6. Minimap and box-select redraw per mouse move. (S)

`Minimap.tsx:22-83` redraws on every pan and drag event and receives an inline `onPanTo` closure. Box-select `setBoxSelect` per mousemove re-renders NodeGraph. After C1, update the minimap viewport rect and the selection rectangle imperatively, `useCallback` the handlers, and `React.memo(Minimap)`.

#### C7. Eleven components subscribe to the entire store. (S)

No selector: `App.tsx:262`, `NodePalette.tsx:181-185` (`ContentPane`) and `:576`, `NodeSearchPalette.tsx:102`, and while open: `LoopModal.tsx:43`, `ExprBlockModal.tsx:99`, `CustomFnModal.tsx:80`, `ExprModal.tsx:147`, `AudioInputModal.tsx:27`, `VideoInputModal.tsx:18`, `ImportGlslModal.tsx:21`. Replace each with per-key selectors or `useShallow`. Add a lint rule or grep check that forbids `useNodeGraphStore()` with no argument.

#### C8. Inline visualizations redraw every frame unconditionally. (S)

About 17 viz components in `NodeInlineViz.tsx` run their own rAF loop while mounted and redraw every frame regardless of whether the value changed, the app is paused, or the tab is hidden (for example `AddColorsViz` at `:1506-1529`, `ShaperCurveViz` at `:1821-1834`). They read registries, not React state, so they do not cause React renders, but they burn CPU. Compare the registry value to the last drawn value and skip when unchanged; early-return on `document.hidden`; consider one shared ticker instead of one rAF per component.

#### C9. Code panel re-tokenizes the whole shader on every render. (S)

`CodePanel.tsx:366-368` tokenizes every line inside render, no memo, index keys. With B1 it re-tokenizes the full shader 10 times a second while open. `useMemo` the tokens on `code` and `React.memo(CodePanel)`. Same for `MobileCodeView` in `App.tsx`.

---

### D. The node system

*Pending. A survey of all ~350 node definitions is in progress: redundant or near-duplicate nodes, common multi-node patterns that could be one node, whether dynamic socket lists are already supported (for a "constant node with N sliders and a vecN output"), params baked into GLSL that force recompiles, and duplicated helper functions across definition files. This section and the catalog appendix will be filled in when it completes.*

---

### E. Loading, saving, undo, and the bundle

#### E1. One 2.5 MB script; example graphs parsed on every load. (M)

**What happens now.** Production build measured: one chunk, 2,548,684 bytes (579 KB gzipped), loaded by `dist/index.html`. No `React.lazy` or dynamic `import()` for any UI. `App.tsx:2-22` statically imports every page and modal. `exampleGraphs.ts` is a single static object with 170 graphs and 1,740 node objects (681 KB source, ~425 KB minified, ~17% of the chunk), imported eagerly by the store, and evaluated at module load even though only the names are needed until you pick one.

Rough composition: React ~0.2 MB, Three.js ~0.5 MB, node definitions and app code ~0.6 MB, example graphs ~0.43 MB, remaining UI ~0.8 MB.

**What to change.**

1. Split examples: a small `exampleIndex.ts` with `{ key: { label, folder } }` plus the `blank` graph inline. Make `loadExampleGraph` async with `await import('./exampleGraphs')`. Update `NodePalette.tsx:294-313` and `App.tsx:975-1008` to read labels from the index.
2. `React.lazy` + `Suspense` for `ExportModal`, `GLSLPage`, `FunctionBuilder`, `ShortcutsPage`, `KeyboardShortcutsModal`, and the mobile/desktop editor pair gated on `useBreakpoint()`.
3. `vite.config.ts`: `build.rollupOptions.output.manualChunks: { three: ['three'], react: ['react', 'react-dom'] }` so a code change does not make returning users re-download Three.js.

#### E2. Six unused dependencies. (S)

`leva`, `@react-three/fiber`, `@react-three/drei`, `@monaco-editor/react`, `@ffmpeg/ffmpeg`, `@ffmpeg/util` have zero imports in `src/`. Monaco alone is 76 MB on disk. Video export uses a Tauri FFmpeg sidecar, not ffmpeg.wasm. The Vite dev-server COOP/COEP headers (`vite.config.ts:12-22`) and `optimizeDeps.exclude` exist only for the unused wasm path, and `require-corp` blocks cross-origin images and fonts in dev but not in production, which is a dev/prod difference waiting to bite.

Run `npm uninstall` on all six and delete the header plugin and `optimizeDeps` block.

#### E3. Vite watcher polls the filesystem. (S)

`vite.config.ts:26-33` sets `usePolling: true` at 500 ms plus `awaitWriteFinish` 500 ms, unconditionally. That adds up to a second to every hot reload and stats every file in `src/` twice a second. Polling is only needed on Docker bind mounts, WSL2 on `/mnt/c`, or network drives. Gate it on an env var: `usePolling: process.env.VITE_USE_POLLING === '1'`, and drop `awaitWriteFinish`.

#### E4. Undo gaps. (S–M)

Undo is already sane: one `structuredClone` per structural action, param edits coalesced to one snapshot per second, stacks bounded at 50. Three gaps:

- Moving a node is not undoable (`updateNodePosition` never pushes). Fix with C1.2: capture `nodes` on pointer-down and push once on mouseup.
- The 1-second coalescing flag is global, so a slider on node A followed within a second by a slider on node B collapses into one undo step. Key the coalescing on `${nodeId}:${paramKey}`.
- `undo()`/`redo()` restore `nodes` only, never `looseGroups`. Snapshot both.

Also wrap `structuredClone` in a try/catch with a `JSON` fallback: it throws if any param ever holds a function, DOM element, or texture.

#### E5. `localStorage` writes are unguarded. (S)

Writes only happen on explicit user actions, which is good. But 11 of ~17 `setItem` sites have no try/catch (`useNodeGraphStore.ts:3977`, `:4106`, `:4129`, `PresetManager.ts:37`, `:72`, `assetFolders.ts:35`, `assetTags.ts:15`, `useShortcuts.ts:78`, `CodePanel.tsx:252`, `NodePalette.tsx:593`, `GLSLPage.tsx:192`). A quota error (Safari private mode throws on any write) surfaces as an uncaught exception inside a click handler and the save silently fails. Add a `safeSetItem` helper that returns false on failure and show a message when a graph save fails.

Also, `getSavedGraphNames` and the backup exporter find graphs by `JSON.parse`-ing every `shader-studio:*` key, and `NodePalette` does this at mount. Use a dedicated key prefix for graphs so names can be listed without parsing.

#### E6. Dead code and duplicates. (S each)

- The tags system is still live in `NodeBrowser.tsx:320-326` and `assetTags.ts` even though `docs/folder-organization.md` says folders replaced tags. `getTagSuggestions` has zero references.
- `NodeComponent.tsx:2370-2385` and `:2548-2560` still hand-roll the number-input pattern that `NumberInput.tsx` was written to replace, and there are ten raw `type="number"` inputs left across `NodeComponent.tsx` and `MobileGraphBrowser.tsx`.
- Example folder list logic is duplicated between `App.tsx:975-1008` (mobile) and `NodePalette.tsx:294-313` (desktop).
- `backupExport.ts:27-28` hand-mirrors storage prefix constants from the store.
- The `counter` field on all 170 example graphs is never read.
- Unused exports: `assetFolders.getFolderForItem`, `getFolderLabel`, `useBreakpoint.isMobileOrTablet`, type `ExampleGraph`.

#### E7. Things that are already fine

Worth saying so nobody re-investigates: the topological sort is genuinely linear; JS compile is sub-millisecond; iterated groups emit one loop body, not one copy per iteration; compile failures keep the last good program; time is a pausable virtual clock with seek and step; image and video textures upload only on change; scope waveforms and audio spectra bypass React entirely; Tauri plugins are dynamically imported; thumbnails are downscaled to 96 px before being stored; ids are deterministic and collision-free.

---

### F. Set aside

The GLSL text editors (GLSL page, Function Builder, expression modals) were also audited. Per Gabe, that area is fine as-is and is out of scope for this document. The findings are kept in the session record if wanted later.

---

### G. Design note: Play mode and published parameters

Gabe proposed an "author vs. play" split: keep the full node editor, and add a separate layer that promotes chosen params to simple controls, so someone can make variations without touching the graph. This section maps that idea onto what the codebase already has, so an implementing agent knows what to reuse and what is actually new.

#### What already exists

- **The runtime interface already exists.** Every compile produces `paramUniforms`, a map from uniform name to current value, for every float slider that became a GPU uniform (`src/compiler/uniformPatcher.ts:62-99`, stored at `useNodeGraphStore.ts:3849`). `updateParamUniforms` pushes new values and `ShaderCanvas.tsx:1266-1281` copies them into the material. That is exactly the "shove a number into a uniform" path a Player needs. It is broken today by A1, so **A1 is step zero for Play mode.** The robust A1 fix (the compiler returns a map from `${nodeId}::${paramKey}` to uniform name) is also exactly the binding table the published-param schema needs.
- **An expose mechanism already exists for groups.** `SurfacedParam` in `src/types/nodeGraph.ts` is `{ innerGroupId, nodeId, paramKey, label }`, stored on an outer group as `params.surfacedParams`, with override values stored as `params["innerGroupId::nodeId::paramKey"]`. That is a published-param schema scoped to one group. Generalizing it to the top level (a `publishedParams` list on the graph instead of on a group node) is the smallest possible version of the proposal, and reuses the same override and uniform-naming path.
- **The canvas can already run without the graph.** `ShaderCanvas` reads a shader string plus uniform maps from the store, and `rawGlslShader` (`ShaderCanvas.tsx:201-202`) already overrides the compiled graph. A Player is `ShaderCanvas` plus a controls panel, without mounting `NodeGraph`. The "lightweight" part comes from not mounting the editor, not from a new renderer.
- **Keyframes already exist, with easing, loop modes, offsets, per-axis vector tracks, and saved presets** (`src/compiler/keyframes.ts`, `src/types/keyframePreset.ts`).

#### Where the proposal diverges from the current design, and what to decide

1. **Keyframes live in the graph today, and run on the GPU.** They are stored in `node.params` under `__keyframes_<socket>` keys and compiled into GLSL functions evaluated from `u_time` (`uniformPatcher.ts:80-89`). That has real advantages: zero CPU work per frame, and exports are deterministic because the GPU evaluates the same function at the same time. The proposal moves keyframes to the published layer and evaluates them on the CPU each frame, then writes uniforms. That has different advantages: one graph can have many "performances," and a Player can animate without a recompile. Recommendation: keep both. Authored animation stays compiled. Play-mode tracks are a second, CPU-evaluated layer that writes uniforms, the same way a slider does. Note the interaction: a param with an authored keyframe track is *baked* into GLSL (`uniformPatcher.ts:81-89`), so it is not a uniform and cannot also be driven from Play mode. The UI should say so.
2. **Only scalar floats become uniforms.** `uniformPatcher.ts:78` skips anything that is not `type: 'float'`, line 79 skips integer-step params, and `SKIP_UNIFORM_TYPES` skips whole node types. A color or vec3 control needs the patcher to emit `vec3` uniforms (or three floats named per axis, matching the existing `axisParams` convention). Integer params like loop counts must stay compile-time constants. The rule for "can this be exposed live" is simply: is `${nodeId}::${paramKey}` a key in the compiler's uniform map after the latest compile. Anything else can still be exposed, but changing it means a recompile, and the UI should mark it.
3. **Binding stability.** Node ids are `node_N` and get remapped on paste and preset instantiation (`useNodeGraphStore.ts:963`, `:1914`). Slugs depend on the node label. So the schema should bind to `(nodeId, paramKey)` and resolve to a uniform name through the compiler's map on every compile, never store a uniform name. When a bound node is deleted, keep the schema entry and show it as dangling rather than silently dropping it. Group-inner params bind through the same `innerId::key` path `SurfacedParam` already uses.
4. **Linked params** (one control, N targets) fall out for free: one schema entry with a `targets` array, and one `updateParamUniforms` call with N entries.

#### Build order, adjusted for this codebase

0. A1 robust fix (compiler emits the `${nodeId}::${paramKey}` binding map). Extend `uniformPatcher` to emit `vec3` uniforms for `vec3` and `vec3color` params.
1. Generalize `SurfacedParam` into a top-level `publishedParams` list stored with the graph. Add "Expose" to the node-card param context menu. Exposed params show as a panel in the existing editor first, so the schema-authoring UX is testable before any Player exists.
2. `PlayerPage`: `ShaderCanvas` plus a controls panel that iterates the schema. No `NodeGraph` mounted. Values go through `updateParamUniforms` only, so they never touch `nodes` and never trigger a compile.
3. Linked params.
4. Play-mode keyframe tracks, CPU-evaluated in the render loop, writing uniforms, with an export path that uses the existing fixed-timestep offline renderer (`ShaderCanvas.tsx:296-372`).

---

## 4. Suggested order of work

**Phase 1: two afternoons, biggest felt improvement.**
A1 (fast path), B1 (idle re-render + App selectors + memo NodeGraph), A3 (don't replace `nodes` when unchanged), A8 (cancel pending compile), C5 (fitView ref), C7 (selectors everywhere), E2 (uninstall unused deps), E3 (watcher).

**Phase 2: the editor on big graphs.**
C1.1 (data-derived wires) → C2 (memo NodeComponent, `nodeById`) → C1.2 (ref-based drag, which also fixes the undo gap in E4) → C1.3 (imperative pan/zoom) → C6 → C1.4 (culling).

**Phase 3: the canvas on battery.**
B2 (render only when needed) → B3 (hidden page) → B4.1 and B4.3 (throttle probes, async readback) → B5 → B7 → B6 (context loss).

**Phase 4: structural.**
A2 (async compile) → A5 (single probe program) → E1 (code splitting) → C3 (split NodeComponent).

**Phase 5: node system.** Pending section D.

---

## 5. How to check the fixes worked

Keep these as before/after numbers so the implementing agent knows when it is done.

- **Compile count per slider drag.** Temporary `console.count('compile')` in `compile()`. Target after A1: zero for float sliders on standard nodes.
- **Idle React renders.** React DevTools Profiler, record 5 seconds with the mouse off the canvas and nothing selected. Target after B1: zero commits.
- **Renders per drag mousemove.** Profiler while dragging one node on a 50-node graph. Target after C1 and C2: one commit per frame at most, touching only the dragged card and its wires.
- **Frame time with a scope node open.** Chrome Performance tab, look for `readPixels` stalls. Target after B4: at most one readback per sample interval, none per frame.
- **Idle GPU work.** Chrome Performance tab with a static graph, playback paused. Target after B2: no `render` calls between user interactions.
- **Bundle.** `npm run build`, then `ls -la dist/assets`. Target after E1: main chunk under 1.2 MB, examples in their own chunk, Three.js in its own chunk.
- **Undo.** Drag a node, press Cmd+Z. Target after E4: node returns.

---

## Appendix A. Node catalog

*Pending section D.*
