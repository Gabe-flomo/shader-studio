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
| D2 | About 20 sliders on 14 node types silently do nothing because the node reads the param as a number after the compiler replaced it with a uniform name. | Broken controls. Confirmed by compiling. | S |
| D3 | Helper functions with the same name and different bodies get emitted twice when two nodes coexist. | GLSL error and black canvas for specific node pairs. Confirmed by compiling. | M |
| D1 | Dynamic sockets already work. A Constant node with a float/vec2/vec3/vec4 picker and 1 to 4 sliders is a small change that replaces six nodes. | Answers the "constant with three sliders" question. | S |
| D4 | Seventeen nodes implement six SDF-combine operations. | Bigger catalog, harder to learn. | M |

A1 and B1 together are two small edits that remove most of the per-tick and idle cost. Do them first. D2 and D3 are bugs and can go in the same pass.

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

There are 358 registered node types across 32 category strings (the palette color map only knows 14 of them). The full catalog is in Appendix A. Two of the findings below are real bugs that were confirmed by running the actual compiler on test graphs. The rest are about making the catalog smaller and easier to build with.

#### D1. Dynamic sockets already work. A "Constant with 1 to 4 sliders" is a small change. (S)

**What exists now.** A placed node carries its own copy of `inputs` and `outputs` (`src/types/nodeGraph.ts:34-77`), and almost everything reads the instance rather than the definition: the card renders `node.inputs` and `node.outputs` (`NodeComponent.tsx:3355`, `:4347`), the compiler reads the live socket type first (`shaderAssembler.ts:143-145`), and validation does too (`validate.ts:44-63`). The store has `updateNodeOutputs`, `updateNodeInputs`, and `changeNodeVectorType` (`useNodeGraphStore.ts:3139-3155`, `:3733-3768`).

Five node families already use this: the type-picker math nodes (sin, cos, pow, clamp, mix, and ten more, listed in `VECTORIZABLE_NODES` at `math.ts:1097-1111`) show float/vec2/vec3 pills and retype their output; `matConst` flips between mat2 and mat3 from a select; `audioInput` adds and removes a socket per band; groups populate sockets from their ports; the march-loop groups get `acc0..N` outputs discovered at compile time.

**The Constant node Gabe asked about.** Add `vtype: select[float, vec2, vec3, vec4]` plus `x, y, z, w` float params with `showWhen`, register it in `VECTORIZABLE_NODES` with the pill list extended to vec4, and have `generateGLSL` emit `vecN(x, y, z, w)` through `p()` so each component is a live uniform. That one node subsumes six: `constant`, `vec2Const`, `vec3Const`, `makeVec2`, `makeVec3`, and `floatToVec3` (which is already a no-op because float promotes to vec3 automatically). Today a vec3 from three sliders is `makeVec3` (36 uses in examples), or `vec3Const` (unclamped number fields, no sockets), or three `constant` nodes wired into `makeVec3`. There is no color-picker constant; `vec3color` params exist on exactly one node (`colorRamp`).

Two caveats: the input-socket render loop only shows keys present in the definition unless the definition declares none (`NodeComponent.tsx:3355`), so extra dynamic *inputs* need a custom card, but a typed *output* plus `showWhen` sliders needs no change there. And `changeNodeVectorType` only reaches nodes at top level or in the active group (`:3754-3765`).

#### D2. Bug: sliders that silently do nothing. (S, confirmed)

**What happens now.** Before every node's `generateGLSL` runs, the compiler replaces each float param's number with its uniform-name string (`shaderAssembler.ts:3124`). The `p()` helper in `helpers.ts:22-27` exists exactly for this: it passes a string through and formats a number. But some nodes read the param directly as a number:

```ts
// effects.ts:1009 (floatWarp)
const intensityParam = typeof node.params.intensity === 'number' ? node.params.intensity : 1.0;
// math.ts:867 (compare)
const soft = (node.params.smoothing as number) ?? 0.0;
```

After the swap the value is a string, so the JS default always wins. The uniform is still declared and the fast path still updates it, but nothing in the shader reads it. Dragging the slider changes nothing.

Confirmed affected (uniform declared, never referenced in the shader body): `rayMarch.maxSteps` (dead in all 25 example instances), `compare.smoothing`, `gravitationalLens` spin/strength/horizon_radius, `floatWarp.intensity`, `electronOrbital` a0/gamma, `chladni3d.steps`, `chladni3dParticles.steps`, `orbitalVolume3d` scale/steps/gamma/cam_pitch, `mandelbulb.max_steps`, `raymarch3d.max_steps`, `volumeClouds.steps`, `newtonFractal.max_iter`, `lyapunov` iterations/warmup.

**What to change.** For loop-bound params (steps, iterations), set `step: 1` so they stay compile-time constants, which GLSL ES requires anyway. For the rest (spin, smoothing, intensity, a0, gamma, scale, cam_pitch), emit through `p()` and move the JS branch into GLSL. Add a test that compiles every registry node with defaults and asserts every `u_p_*` in `paramUniforms` appears in the fragment body. That test is about 40 lines and would have caught this.

#### D3. Bug: helper functions with the same name and different bodies collide. (M, confirmed)

**What happens now.** Shared GLSL helpers are deduplicated by exact string of the *whole block* (`shaderAssembler.ts:311`, `:366-367`). Many definition files carry their own copy of the same helper under the same name inside a different block: `hash3`/`noise3`/`fbm3` in `threed.ts:9-60` and again in `sdf3d.ts:1714-1728`; `warpHash1`/`warpHash2` in `transforms.ts` used by several warp nodes; complex-number ops `cmul`/`cpow*` in mandelbrot, newtonFractal, and apollonian; `palette` in several fractal and raymarch nodes alongside the color node's own. Put two such nodes in one graph and the shader has two definitions of the same function, which is a GLSL error and a black canvas. None of the 170 bundled examples combines the affected pairs, so it has gone unnoticed. Confirmed pairs: raymarch3d or volumeClouds or mandelbulb with domainWarp3D; mandelbulb with raymarch3d (18 functions); uvWarp with smoothWarp or curlWarp; mandelbrot with newtonFractal; newtonFractal with apollonian.

There is also a lot of near-identical noise code under different names (four value-noise stacks in `noise.ts` and `physics.ts`, plus `_vfhash`/`pfbm` in particles, `truchetHash`, `ifsHash`, `curlValueNoise`) while `noiseHash1`/`noiseHash2`/`valueNoise` are already in every shader's preamble (`shaderAssembler.ts:66-77`). Helper text across all nodes totals about 220 KB.

**What to change.** Move shared helpers into named exports in one module (`src/nodes/definitions/glslLib.ts`: hash, valueNoise, fbm in 2D and 3D, complex ops, palette, smin, rot2, rot3) and reference them via `glslFunctions: [LIB.hash3, ...]`. As a safety net, have the assembler key its function set by parsed signature (`returnType name(args)`) and warn when two different bodies share a name.

#### D4. Seventeen nodes for six SDF-combine operations. (M)

Union (`min`) exists as `min`, `minMath`, and `sdfUnion`. Intersect (`max`) as `sdfMax`, `max`, and `sdfIntersect`. Smooth union as `smoothMin`, `sdf2dSmoothUnion`, and `sdfSmoothUnion`. Smooth max and subtract as `smoothMax`/`smoothSubtract` and `sdfSmoothIntersect`/`sdfSmoothSubtract`. Offset as `sdfOffset` and `sdfRound`. Onion as `sdf2dOnion` and `sdfOnion`. Every one is float in, float out; the "2D" and "3D" split is only a category label. Examples show users reach the same operation by several names.

This is one where merging is a clear win, because the operation *is* the node's identity, so nothing gets hidden. Recommend six nodes: Union, Intersect, Subtract (each with a `k` smoothness param where 0 gives the hard op), plus Offset, Onion, Sharpen. Keep every old key working through a `NODE_ALIASES` map resolved in `getNodeDefinition`, with `migrateInputKeys` for socket renames (`cut`/`base` to `a`/`b`).

#### D5. Scalar and vector arithmetic are separate nodes. (S)

`add`/`subtract`/`multiply`/`divide` share one shape. `addVec2`, `addVec3`, `multiplyVec2`, `multiplyVec3` (the 7th most-used node), `mix` vs `mixVec3` vs `blend` are the same operations retyped. Folding the four scalar ops into one "Arithmetic" node with an operator select would be a UX loss: the operator becomes invisible on the canvas and these are the most-wired nodes in the app. Instead, keep the four types and register them in `VECTORIZABLE_NODES` so the existing float/vec2/vec3 pills cover the vector variants, and alias the six `*Vec2`/`*Vec3` types plus `blend`.

#### D6. Other strict subsets to alias. (S each)

`extractX`/`extractY` are `splitVec2`. `opRepeat` is `infiniteRepeatSpace`. `opRepeatPolar` is `angularRepeat2D`. `makeLight` (20 uses) is `light` in Glow mode. `lumaGrain`/`temporalGrain` are `grain` and already call themselves legacy but lack the flag. `screenBlend` is `blendModes`. `desaturate(a)` is `colorSaturation(1-a)`. `vec3Const` is `makeVec3` with unclamped sliders. `sdBox` is `boxSDF`. `simpleSDF` is a strict subset of `shapeSDF`. `blendModes` and `blendMode` are two Photoshop-blend nodes in the same file (`color.ts:435` and `:742`) with different input shapes; merge into one with the union of modes and a mask input. `palette` and `palettePreset` (52 uses) call the same helper; add a preset select to `palette` and alias the other. The four LFO nodes (`sineLFO`, `squareLFO`, `sawtoothLFO`, `triangleLFO`) have identical params and differ by one waveform expression; one LFO node with a waveform select is cleaner. Keep `sin`/`cos`/`tan` separate for readability, but generate them from one factory. Rename `fract` to "Tile" since it centers the tile and `fractRaw` is the real `fract`.

#### D7. Multi-node patterns that could be one node. (S to M each)

From all 170 examples (1,740 nodes, 1,718 wires), the most repeated chains, and what to do about each:

1. **Implicit UV and Time.** `uv` and `time` are in nearly every graph (168 and 164 of 170) and account for about 90 wires. The compiler *already* falls back to the global UV for unconnected inputs named `uv`/`p`/`uv2` and to `u_time` for `time`/`t` (`shaderAssembler.ts:186-189`), so those nodes exist mostly because the UI does not show the fallback. Render a ghost "UV" or "Time" chip on those unconnected sockets. `circleSDF.position` (18 wires) misses the fallback because its key is `position`; alias it. Removes two nodes and two or three wires from most graphs.
2. **Offset on 3D primitives.** `scenePos → translate3D → primitive` appears 28 to 37 times. 2D primitives already have `offset`/posX/posY; give the shared 3D primitive base an `offset` socket plus tx/ty/tz params. Removes 41 nodes across the examples.
3. **N-ary smooth union.** `sdfSmoothUnion` is chained into itself 14 times. Add a dynamic input count (the `audioInput` add-band mechanism) or an `inputs_used` select like `weightedAverage` already has.
4. **SDF → glow → tint.** `circleSDF → makeLight → multiplyVec3` with a color source is the most common 2D chain. `glowLayer` (`combiners.ts:270-300`) already *is* this node and is nearly unused because the blank starter graph teaches the three-node version. Change the starter graph, or give `makeLight` a color param.
5. **Tone map before output.** `toneMap → output` is in 36 of 170 graphs. A tone-map select on the output node.
6. **`time × speed + phase → sin/tanh`.** `sineLFO` already computes this with implicit time. Discoverability, or `speed`/`offset` params on `time`.
7. **Select between two constant colors.** Give `select`'s ifTrue/ifFalse `vec3color` fallback params.

#### D8. Params that are baked into GLSL but could be uniforms. (M)

The uniform patcher bakes a param when the node type is in `SKIP_UNIFORM_TYPES`, when the param type is not `float`, when `step === 1`, or when it is keyframed (`uniformPatcher.ts:12-28`, `:78-80`). About 75 `step: 1` params are genuine GLSL loop bounds and must stay baked. But `step: 1` is a heuristic and several plain floats are caught by it: `gridLayout.columns` (the second most used 2D node), `kaleidoSpace.segments`, `cellFilter` x/y, `limitedRepeat2D` counts, halftone angles, `lissajous` frequencies. Every `vec3` and `vec3color` param (color ramp stops, background colors, lift/gamma/gain, gradient colors) recompiles on every color-picker drag because the patcher only handles scalars. Also `SKIP_UNIFORM_TYPES` still lists `'loop'`, a node type that no longer exists.

**What to change.** Replace the `step === 1` heuristic with an explicit `compileTime: true` on `ParamDef` (or use the already-declared but unused `type: 'int'`), and teach the patcher `vec3` uniforms. This is also a prerequisite for color controls in Play mode (section G).

#### D9. Trig of constants computed per pixel. (S to M)

The preamble `rotate(v, angle)` helper (`shaderAssembler.ts:79-82`) evaluates `cos` and `sin` of the angle four times per pixel, and the angle is usually a uniform. `rotate2d`, `uvTransform2d`, `rotate3D`, `rotateAxis3D`, `hueRotate`, `kaleidoSpace`, `polarRepeat3D`, the radial and chroma blurs, and `mandelbrot`'s `pow(2.0, zoomExp)` all do trig or pow of a param per pixel. `rotateAxis3D` also normalizes a param vector per pixel.

Minimal: rewrite `rotate()` to hoist `float s = sin(a), c = cos(a)`. The GLSL compiler cannot share the four calls because the argument is an expression. General: let a `ParamDef` declare a derived uniform (`{ expr: p => mat2(...), type: 'mat2' }`) that the patcher computes on the CPU, with the in-shader form as fallback when the socket is wired.

#### D10. The 13 KB shape library is emitted whole. (S)

`shapeSDF`, `simpleSDF`, `loopRingStep`, and `loopColorRingStep` each attach the entire 35-shape IQ library (13,047 characters) even when the chosen shape is `circle`. Split it into per-shape `glslFunctions` selected in `generateGLSL`.

#### D11. Deprecated and legacy nodes are inconsistent. (S)

Eleven types have `deprecated: true`, but that flag only draws a badge (`NodeComponent.tsx:2986`). The palette hides types via a separate `HIDDEN_TYPES` set, so the six `loopPair` nodes, `vParticles`, and `grid` are deprecated *and* still in the palette, relying on "[DEPRECATED]" in the label. `lumaGrain`, `temporalGrain`, `rayRender`, and `forwardCamera` call themselves legacy without the flag. `SubtractNode2` and `LoopNode` are defined but never registered. `src/types/nodes.ts` is an unrelated pre-graph model. Make the palette filter on `def.deprecated`, add the flag to the four self-described legacy nodes, delete the two unregistered definitions and the stale type file.

#### D12. Type promotion rules live in four places. (S)

`typesCompatible.ts:12-17`, `shaderAssembler.ts:150-163`, `validate.ts:65-69`, and the bypass path (`shaderAssembler.ts:656-665`, `:3081-3094`) each have their own copy of the float-to-vec rules. They disagree: the bypass path allows float-to-vec4 and vec3-to-vec4 but the others do not, so `vec4Output.color` cannot take a vec3 wire. One `coerce(expr, from, to)` in `typesCompatible.ts` used by all four, plus `vec3 → vec4(v, 1.0)`. Optionally hoist a promoted expression into a local when it is not a plain identifier, since some nodes substitute the same input 10 to 39 times.

#### D13. Monolithic nodes that predate groups. (L, low priority)

`raymarch3d` (27 params), `mandelbulb`, `volumeClouds`, and `rayRender` each embed a private copy of the SDF, noise, and camera library and predate the composable `sceneGroup` + `marchLoopGroup` system (used 73 and 39 times in examples). `forLoop`, `fractalLoop`, `accumulateLoop`, and `rotatingLinesLoop` predate iterated groups with `carryMode` and `assignOp`. These are really compound presets. Rebuild them as sealed group presets rather than deleting them; `fractalLoop` is the default example so it has to keep working.

#### D14. Chladni tiers and shapers are fine as they are.

`waveTerm` ⊂ `chladniField` ⊂ `chladniSuperposition` is a deliberate ladder. The 11 shaper nodes are all `x → y` with the same four params and zero example uses; one Shaper node with a curve select and the inline preview would be cleaner, but it is low priority.

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

**Phase 5: node system.**
Bugs first: D2 (dead sliders, with the registry-wide test) and D3 (helper collisions, with the signature check in the assembler). Then D1 (dynamic Constant) and D8 (explicit `compileTime` flag, `vec3` uniforms), which together unblock Play mode colors. Then the catalog cleanup: D4 (SDF combine merge), D5 (vectorizable arithmetic), D6 (aliases), D11 (deprecated flag drives the palette). Then the compound-node candidates in D7, in the order listed. D9, D10, D12 as small wins whenever convenient. D13 last.

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
- **Dead sliders.** A test that compiles every registry node with default params and asserts every `u_p_*` key in `paramUniforms` appears in the fragment body. Target after D2: passes for all 358 types.
- **Helper collisions.** A test that compiles every pair of nodes that define a helper with the same name and asserts the shader has one definition per name. Target after D3: passes. Quick manual check: put `mandelbulb` and `domainWarp3D` in one graph; today it goes black.

---

## Appendix A. Node catalog

All 358 registered node types, from `NODE_REGISTRY` in `src/nodes/definitions/index.ts`. Columns: registry key, label, category, inputs (`name:type`), outputs, number of editable params, description. Generated by reading each definition; keep this as a reference when working on section D.

| key | label | category | inputs | outputs | #params | description |
|---|---|---|---|---|---|---|
| uv | UV | Sources | - | uv:vec2 | 0 | Centered, aspect-corrected UV coordinates |
| pixelUV | Pixel UV | Sources | - | uv:vec2 | 0 | Raw screen UV: fragCoord / resolution.y. Origin at bottom-left, x reaches aspect ratio. |
| fragCoord | Frag Coord | Sources | - | coord:vec2 | 0 | Raw fragment pixel coordinates (gl_FragCoord.xy). |
| resolution | Resolution | Sources | - | res:vec2,width:float,height:float | 0 | Canvas resolution in pixels. |
| time | Time | Sources | - | time:float | 0 | Current time in seconds |
| constant | Constant | Sources | value:float | value:float | 1 | A constant float value — wire an input to override the slider |
| mouse | Mouse | Sources | - | uv:vec2,x:float,y:float | 0 | Mouse position in centered UV space. |
| textureInput | Texture Input | Sources | uv:vec2 | color:vec3,alpha:float,uv:vec2 | 1 | Samples an image texture loaded from a file. |
| prevFrame | Prev Frame | Post Processing | uv:vec2 | color:vec3,alpha:float,uv:vec2 | 0 | Samples the previous frame's rendered output. |
| loopIndex | Loop Index | Sources | - | i:float | 0 | Current iteration index inside an iterated group |
| audioInput | Audio Input | Sources | band_0_center:float (dynamic per band) | amplitude_0:float (dynamic) | 2 | Per-band audio amplitudes as floats. |
| videoInput | Video Input | Sources | uv:vec2 | color:vec3,alpha:float,uv:vec2 | 0 | Samples a video file frame-by-frame. |
| fract | Fract / Tile | Transforms | input:vec2,scale:float | output:vec2 | 1 | Tile space using fract with scale. |
| rotate2d | Rotate 2D | Transforms | input:vec2,angle:float | output:vec2 | 1 | Rotate a 2D vector by an angle (radians) |
| uvWarp | UV Warp (Jitter) | Transforms | input:vec2,time:float | output:vec2 | 3 | Hash-grid jitter warp. |
| smoothWarp | UV Warp (Smooth) | Transforms | input:vec2,time:float,strength:float | output:vec2 | 3 | Smooth bilinear value-noise warp. |
| curlWarp | UV Warp (Curl) | Transforms | input:vec2,time:float,strength:float | output:vec2 | 3 | Divergence-free curl noise warp. |
| swirlWarp | UV Warp (Swirl) | Transforms | input:vec2,time:float,strength:float | output:vec2 | 5 | Rotational twist warp. |
| displace | Displace | Transforms | input:vec2,offset:vec2,amount:float | output:vec2 | 1 | Displace UV by any vec2 input. |
| uvTransform2d | UV Transform 2D | Transforms | uv:vec2,translate:vec2,angle:float,scale:vec2 | result:vec2 | 7 | Full 2D affine transform in one mat2. |
| uvReciprocal | UV Reciprocal | Transforms | uv:vec2 | result:vec2 | 2 | N/x family transforms on UV. |
| vec2Const | Vec2 Const | Math / Vector Build/Split | - | val:vec2 | 2 | Constant vec2, typed in. |
| vec3Const | Vec3 Const | Math / Vector Build/Split | - | val:vec3 | 3 | Constant vec3, typed in. |
| matConst | Matrix Const | Matrix | - | mat:mat3 (mat2 via size) | 10 | Constant 2×2 / 3×3 matrix. |
| mat2Construct | Mat2 Construct | Matrix | v0:vec2,v1:vec2 | mat:mat2 | 1 | Assemble a mat2 from two vec2. |
| mat3Construct | Mat3 Construct | Matrix | v0:vec3,v1:vec3,v2:vec3 | mat:mat3 | 1 | Assemble a mat3 from three vec3. |
| mat2Inspect | Mat2 Inspect | Matrix | mat:mat2 | mat:mat2,vec0:vec2,vec1:vec2 | 1 | Break a mat2 into vec2s. |
| mat3Inspect | Mat3 Inspect | Matrix | mat:mat3 | mat:mat3,vec0:vec3,vec1:vec3,vec2:vec3 | 1 | Break a mat3 into vec3s. |
| mat2MulVec | Mat2 × Vec2 | Matrix | mat:mat2,vec:vec2 | output:vec2 | 0 | mat2 × vec2. |
| mat3MulVec | Mat3 × Vec3 | Matrix | mat:mat3,vec:vec3 | output:vec3 | 0 | mat3 × vec3. |
| polarSpace | Polar Space | Spaces | input:vec2,twist:float,radialScale:float | output:vec2,seamless:vec2,angle:float,radius:float | 2 | UV to polar coordinates. |
| logPolarSpace | Log-Polar Space | Spaces | input:vec2,scale:float | output:vec2,seamless:vec2,angle:float | 1 | Logarithmic polar coordinates. |
| hyperbolicSpace | Hyperbolic Space | Spaces | input:vec2,curvature:float | output:vec2 | 1 | Poincaré disk model. |
| inversionSpace | Circle Inversion | Spaces | input:vec2,radius:float | output:vec2 | 1 | Inverts space through a circle. |
| mobiusSpace | Möbius Transform | Spaces | input:vec2,poleX:float,poleY:float,angle:float | output:vec2 | 3 | Möbius transformation. |
| swirlSpace | Swirl / Vortex | Spaces | input:vec2,strength:float,falloff:float | output:vec2 | 2 | Distance-growing rotation vortex. |
| kaleidoSpace | Kaleidoscope | Spaces | input:vec2,segments:float,rotate:float | output:vec2 | 2 | Folds space into N wedge sectors. |
| sphericalSpace | Spherical / Fisheye | Spaces | input:vec2,strength:float | output:vec2 | 1 | Fisheye / barrel distortion. |
| rippleSpace | Ripple / Wave | Spaces | input:vec2,freqX:float,freqY:float,ampX:float,ampY:float,time:float | output:vec2 | 4 | Sine-wave UV displacement. |
| infiniteRepeatSpace | Infinite Repeat | Spaces | input:vec2,cellX:float,cellY:float | output:vec2,cellID:vec2 | 2 | Modulo tiling with cell ID. |
| waveTexture | Wave Texture | Spaces | uv:vec2,scale:float,speed:float,time:float | value:float | 4 | Bands / rings / directional waves. |
| magicTexture | Magic Texture | Spaces | uv:vec2,scale:float,time:float | color:vec3 | 3 | Blender-style magic texture. |
| grid | Grid [DEPRECATED] | Spaces | uv:vec2,scale:float,lineWidth:float | grid:float,checker:float,cellUV:vec2,cellID:vec2 | 2 | Grid lines + checkerboard. |
| gridLayout | Grid | Grid | uv:vec2,columns:float | cellUV:vec2,dist_to_center:float,cellID:vec2,cellCenter:vec2,grid_pos:vec2,cell_size:float,aspect_ratio:float | 1 | Aspect-corrected grid. |
| waveRadius | Wave Radius | Grid | distance:float | wave_radius:float | 4 | Time-animated radius. |
| neighborDist | Neighbor Dist | Grid | uv:vec2,cellID:vec2,displacement:vec2,dispScale:float | minDist:float | 1 | Min distance to nearest dot in 3×3. |
| cellFilter | Cell Filter | Grid | cellID:vec2,x:float,y:float | mask:float,invertedMask:float | 3 | 0/1 mask for one cell. |
| cellDisplace | Cell Displace | Grid | cellUV:vec2,cellCenter:vec2,attractorPos:vec2 | displacedUV:vec2,attractAmount:float | 2 | Displace cell UV toward attractor. |
| gridDensityWarp | Grid Density Warp | Grid | uv:vec2,time:float | warpedUV:vec2 | 5 | Wave warp before grid. |
| neighborOffset2d | Neighbor Offset 2D | Grid | idx:float | offset:vec2 | 1 | Loop index → (dx,dy). |
| animatedCellCenter | Animated Cell Center | Grid | cellID:vec2 | center:vec2 | 3 | Animated per-cell center. |
| neighborAttractCircles | Attract Circles | Grid | gridPos:vec2,cellID:vec2,attractorPos:vec2,cellSize:float | sdf:float,attractAmount:float | 3 | Min-SDF of attractor-displaced circles. |
| gaussianField | Gaussian Field | Field | pos:vec2,center:vec2 | field:float | 2 | exp(-d²·k) emission. |
| fieldAccumulate | Field Accumulate | Field | worldPos:vec2,cellID:vec2,dotOffset:vec2 | totalField:float | 3 | Sum Gaussian fields over neighborhood. |
| metaballThreshold | Metaball Threshold | Field | field:float,threshold:float | blob:float,edge:float | 2 | Field → blob fill + edge. |
| fieldToLines | Field to Lines | Field | field:float,uv:vec2,time:float,line_width:float,aa:float,brightness:float,width_jitter:float,jitter_scale:float,grain:float | density:float,color:vec3 | 6 | Zero-crossing nodal lines. |
| distanceFalloff | Distance Falloff | Field | distance:float | falloff:float | 3 | Distance → 0–1 falloff. |
| glowFalloff | Glow Falloff | Field | distance:float,brightness:float | glow:float | 3 | Bounded inverse-square glow. |
| noisyGridSDF | Noisy Grid SDF | Field | gridPos:vec2,cellID:vec2,time:float | sdf:float | 5 | Smooth-min of noise-displaced circles. |
| shear | Shear | Spaces | uv:vec2,shearX:float,shearY:float | uv:vec2 | 2 | Shear/skew UV. |
| perspective2d | Perspective 2D | Spaces | uv:vec2,ratio:float | uv:vec2,depth:float | 3 | Fake 3D perspective. |
| mirroredRepeat2D | Mirrored Repeat | Spaces | input:vec2,cellX:float,cellY:float | output:vec2,cellID:vec2 | 2 | Mirrored tiling. |
| limitedRepeat2D | Limited Repeat | Spaces | input:vec2,cellX:float,cellY:float,countX:float,countY:float | output:vec2,cellID:vec2 | 4 | Finite N×M tiling. |
| angularRepeat2D | Angular Repeat | Spaces | input:vec2,count:float | output:vec2,sectorID:float | 1 | N-fold radial repeat. |
| circleSDF | Circle SDF | 2D Primitives | position:vec2,radius:float,offset:vec2 | distance:float | 3 | Circle SDF. |
| boxSDF | Box SDF | 2D Primitives | position:vec2,dimensions:vec2,offset:vec2 | distance:float | 4 | Box SDF. |
| ringSDF | Ring SDF | 2D Primitives | position:vec2,radius:float,offset:vec2 | distance:float | 3 | Ring SDF (abs circle). |
| shapeSDF | Shape SDF | 2D Primitives | p:vec2,r:float,b:vec2,a:vec2,b2:vec2,rf:float,c:vec2,th:float,n:vec2 | distance:float | 20 | 35 IQ primitives via dropdown. |
| simpleSDF | Simple SDF | 2D Primitives | p:vec2,r:float,b:vec2 | distance:float | 4 | Circle/box/ring with 1–2 params. |
| sdBox | sdBox | 2D Primitives | p:vec2,b:vec2 | distance:float | 0 | IQ box. |
| sdSegment | sdSegment | 2D Primitives | p:vec2,a:vec2,b:vec2 | distance:float | 0 | IQ segment. |
| sdEllipse | sdEllipse | 2D Primitives | p:vec2,ab:vec2 | distance:float | 0 | IQ ellipse. |
| opRepeat | opRepeat | Spaces | p:vec2,s:float | result:vec2 | 0 | Infinite repetition. |
| opRepeatPolar | opRepeatPolar | Spaces | p:vec2,n:float | result:vec2 | 0 | Polar repetition. |
| sdfOffset | SDF Offset | SDF | sdf:float,amount:float | result:float | 1 | sdf + amount. |
| sdfSharpen | SDF Sharpen | SDF | sdf:float | result:float | 1 | Scale gradient. |
| sdf2dSmoothUnion | Smooth Union 2D | SDF | sdfA:float,sdfB:float | result:float,blend:float | 1 | smin with blend factor. |
| sdf2dOnion | SDF Onion 2D | SDF | sdf:float | result:float | 1 | abs(sdf) - thickness. |
| smoothMin | Smooth Min | Combiners | a:float,b:float,smoothness:float | result:float | 1 | Smooth minimum. |
| min | Min (Union) | Combiners | a:float,b:float | result:float | 0 | min(a,b). |
| sdfMax | Max (Intersect) | Combiners | a:float,b:float | result:float | 0 | max(a,b). |
| smoothMax | Smooth Max | Combiners | a:float,b:float,smoothness:float | result:float | 1 | Smooth intersection. |
| smoothSubtract | Smooth Subtract | Combiners | a:float,b:float,smoothness:float | result:float | 1 | Smooth subtraction. |
| blend | Blend | Combiners | a:vec3,b:vec3,factor:float | result:vec3 | 1 | mix(a,b,clamp(f)). |
| mask | Mask | Combiners | a:vec3,b:vec3,mask:float,threshold:float,edge:float | result:vec3 | 2 | Threshold cut between two colors. |
| addColor | Add Colors | Combiners | a:vec3,b:vec3,scale:float | result:vec3 | 1 | A + B·scale. |
| screenBlend | Screen Blend | Combiners | a:vec3,b:vec3 | result:vec3 | 0 | 1-(1-A)(1-B). |
| glowLayer | Glow Layer | Combiners | d:float,color:vec3,intensity:float,power:float | result:vec3 | 2 | intensity/|d| glow → color. |
| deepGlow | Deep Glow | Combiners | d:float,color:vec3,intensity:float,radius:float,saturation:float,edgeSoftness:float | result:vec3 | 4 | AE-style deep glow. |
| sdfOutline | SDF Outline | Combiners | d:float,fillColor:vec3,strokeColor:vec3,strokeWidth:float,antialias:float | result:vec3,alpha:float | 2 | Fill + outline from SDF. |
| sdfColorize | SDF Colorize | Combiners | d:float,inside:vec3,outside:vec3,edge:float | result:vec3 | 1 | Inside/outside colors. |
| alphaBlend | Alpha Blend | Combiners | bottom:vec3,top:vec3,bottom_a:float,top_a:float | color:vec3,alpha:float | 1 | Alpha compositing. |
| light2d | Point Light 2D | Effects | uv:vec2,light_pos:vec2,color:vec3,intensity:float,radius:float,sdf_dist:float | light:vec3,falloff:float,dist:float | 4 | 2D point light. |
| makeLight | Make Light | Effects | distance:float,brightness:float | glow:float | 1 | exp-falloff glow. |
| abs | Abs | Math / Arithmetic | input:float | output:float | 0 | Absolute value. |
| toneMap | Tone Map | Color Grading | color:vec3 | color:vec3 | 1 | ACES/Hable/Unreal/… |
| grain | Grain | Color Grading | color:vec3,uv:vec2,seed:float,time:float | color:vec3 | 4 | Film grain (basic/luma/temporal). |
| lumaGrain | Luma Grain | Effects | color:vec3,uv:vec2,seed:float | color:vec3 | 2 | Legacy — use Grain. |
| temporalGrain | Temporal Grain | Effects | color:vec3,uv:vec2,time:float | color:vec3 | 1 | Legacy — use Grain. |
| light | Light | Effects | distance:float,brightness:float | glow:float | 3 | Glow/Ring/Simple. |
| fractalLoop | Fractal Loop | Fractals | uv:vec2,time:float,fract_scale:float,scale_exp:float,ring_freq:float,glow:float,glow_pow:float,iter_offset:float,time_scale:float | color:vec3,uv_final:vec2,uv0:vec2 | 12 | IQ iterated fractal rings. |
| rotatingLinesLoop | Rotating Lines | Fractals | uv:vec2,time:float | color:vec4,uv:vec2 | 12 | Iterated rotating line glow. |
| accumulateLoop | Accumulate Loop | Fractals | uv:vec2,time:float,freq:float,glow:float,time_scale:float,pos_scale:float,pos_freq:float,pos_phase:float | color:vec3,uv:vec2 | 16 | General accumulation loop. |
| forLoop | For Loop | Effects | uv:vec2,time:float,iterations:float | color:vec3,uv_final:vec2 | 2 | GLSL body with @tokens. |
| exprNode | Expr Block | Functions | (dynamic) | result:float (dynamic) | 0 | Multi-statement GLSL block. |
| customFn | Custom Fn | Functions | (dynamic) | result:float (dynamic) | 0 | User GLSL function. |
| gravitationalLens | Gravitational Lens | Effects | uv:vec2,lens_center:vec2,time:float | uv_lensed:vec2,horizon_mask:float,dist:float,redshift:float,photon_ring:float | 11 | Lens warp. |
| floatWarp | Float Warp | Effects | value:float,a:float,b:float,c:float,intensity:float | result:float | 2 | One-line float expression. |
| vignette | Vignette | Post Processing | color:vec3,uv:vec2,radius:float,softness:float,strength:float | result:vec3 | 3 | Edge darkening. |
| scanlines | Scanlines | Post Processing | color:vec3,uv:vec2,count:float,intensity:float,time:float | result:vec3 | 3 | CRT scanlines. |
| sobel | Sobel Edges | Post Processing | value:float,uv:vec2,strength:float | edges:float,result:vec3 | 4 | Edge detection. |
| radianceCascadesApprox | Radiance Cascades 2D | Effects | uv:vec2,sky_color:vec3 | radiance:vec3,gi_r:float,gi_g:float,gi_b:float | 5 | 2D GI approximation. |
| gaussianBlur | Gaussian Blur | Effects | color:vec3,uv:vec2 | result:vec3 | 2 | Blur. |
| bloom | Bloom | Effects | color:vec3,uv:vec2,threshold:float,intensity:float | result:vec3 | 3 | Screen-space bloom. |
| radialBlur | Radial Blur | Effects | color:vec3,uv:vec2,center:vec2 | result:vec3 | 3 | Zoom/spin blur. |
| tiltShiftBlur | Tilt-Shift Blur | Effects | color:vec3,uv:vec2 | result:vec3,mask:float | 5 | Focus band blur. |
| lensBlur | Lens Blur | Effects | color:vec3,uv:vec2,focal_point:vec2 | result:vec3,coc:float | 5 | Lens/aperture blur. |
| motionBlur | Motion Blur | Post Processing | color:vec3,uv:vec2 | result:vec3 | 5 | Temporal EMA blur. |
| depthOfField | Depth of Field | Effects | color:vec3,uv:vec2,dist:float | result:vec3,coc:float | 4 | Post DoF. |
| chromaShift | Chroma Shift | Effects | color:vec3,uv:vec2,time:float,strength:float | result:vec3 | 6 | Color-space chromatic aberration. |
| loopCarry | Loop Carry | Loops | init:vec2,next:vec2 | value:vec2 | 1 | Carry across iterations. |
| loopRippleStep | Ripple Step [DEPRECATED] | Loops | uv:vec2,scale:float,speed:float,strength:float | uv:vec2 | 3 | One ripple iteration. |
| loopRotateStep | Rotate Step [DEPRECATED] | Loops | uv:vec2,angle:float,scale:float | uv:vec2 | 2 | Rotate per iteration. |
| loopDomainFold | Domain Fold [DEPRECATED] | Loops | uv:vec2,scale:float,offsetX:float,offsetY:float | uv:vec2 | 3 | abs fold per iteration. |
| loopFloatAccumulate | Float Accumulate [DEPRECATED] | Loops | value:float,scale:float,speed:float,amplitude:float | value:float | 3 | Float carry accumulate. |
| loopRingStep | Ring Step [DEPRECATED] | Loops | uv:vec2,color:vec3,scale:float,freq:float,glow:float,timeScale:float | uv:vec2,color:vec3 | 24 | Fractal ring iteration. |
| loopColorRingStep | Color Ring Step [DEPRECATED] | Loops | color:vec3,uv:vec2,scale:float,freq:float,glow:float,timeScale:float,phaseStep:float | color:vec3 | 25 | Ring iteration with color carry. |
| fbm | FBM | Noise | uv:vec2,time:float,scale:float,time_scale:float | value:float,uv:vec2 | 5 | Fractal Brownian motion. |
| voronoi | Voronoi | Noise | uv:vec2,time:float,scale:float,jitter:float,time_scale:float | dist:float,uv:vec2 | 3 | Worley noise. |
| domainWarp | Domain Warp | Noise | uv:vec2,time:float,strength:float,scale:float,time_scale:float | uv:vec2,offset:vec2 | 6 | Noise domain warp. |
| flowField | Flow Field | Fractals | uv:vec2,time:float | color:vec3,density:float,uv:vec2 | 14 | Hobbs-style flow field. |
| circlePack | Circle Pack | Fractals | uv:vec2,time:float | color:vec3,mask:float,centers:vec2,uv:vec2 | 12 | Brute-force circle packing. |
| noiseFloat | Noise Float | Noise | uv:vec2,time:float | value:float,signed:float | 3 | Float noise 0–1. |
| scatter | Scatter | Noise | uv:vec2,time:float,value:float,field:vec2 | value:float,field:vec2,uv:vec2 | 3 | Organic jitter. |
| mandelbrot | Mandelbrot / Julia | Fractals | uv:vec2,c_pos:vec2,time:float | color:vec3,iter:float,dist:float,trap:float | 19 | Mandelbrot/Julia. |
| ifs | IFS Fractal | Fractals | uv:vec2,time:float | color:vec3,glow:float | 10 | Chaos-game IFS. |
| newtonFractal | Newton Fractal | Fractals | uv:vec2,time:float | color:vec3,iter:float,root:float | 8 | Newton root-finding. |
| lyapunov | Lyapunov Fractal | Fractals | uv:vec2,time:float | color:vec3,stability:float | 6 | Lyapunov exponent. |
| apollonian | Apollonian Gasket | Fractals | uv:vec2,time:float | color:vec3,distance:float,orbit:float | 9 | Circle-inversion fractal. |
| sphericalFoldFractal | Spherical Fold Fractal | Fractals | uv:vec2,time:float | color:vec3 | 15 | Self-contained 3D raymarch IFS. |
| chladni | Chladni Plate | Science | uv:vec2,time:float,m:float,n:float | density:float,field:float,color:vec3,uv:vec2 | 9 | Chladni pattern. |
| chladni3d | Chladni 3D | Science | uv:vec2,time:float,m:float,n:float,l:float,orbit_angle:float | color:vec3,alpha:float,depth:float,uv:vec2 | 12 | Volumetric Chladni. |
| chladni3dParticles | Chladni 3D Particles | Science | uv:vec2,time:float,m:float,n:float,l:float,orbit_angle:float | color:vec3,density:float,uv:vec2 | 14 | Particle cloud on Chladni field. |
| electronOrbital | Electron Orbital | Science | uv:vec2,time:float | density:float,psi:float,color:vec3,uv:vec2 | 13 | Hydrogen orbital slice. |
| waveTerm | Wave Term | Science | uv:vec2,n:float,m:float,scale:float | value:float,uv:vec2 | 5 | cos(nπx)cos(mπy). |
| chladniField | Chladni Field | Science | uv:vec2,n:float,m:float,mix:float,scale:float | field:float,uv:vec2 | 7 | Two-mode Chladni. |
| chladniSuperposition | Chladni Superposition | Science | uv:vec2,n1:float,m1:float,scale:float | field:float,uv:vec2 | 22 | Multi-term Chladni. |
| chladniModeFreq | Chladni Mode Frequency | Science | frequency:float,seed:float | n:float,m:float | 2 | Frequency → (n,m). |
| particleEmitter | Particle Emitter | Effects | position:vec2,time:float,field:vec2,lifetime:float,speed:float,angle_dir:float,angle_spread:float | nearest_dist:float,nearest_uv:vec2,nearest_age:float,density:float | 16 | GPU particle emitter. |
| vectorField | Vector Field | Spaces | uv:vec2,time:float | dir:vec2,angle:float,str:float | 5 | Noise direction field. |
| gravityField | Gravity Field | Spaces | uv:vec2,attractor:vec2,strength:float | dir:vec2,dist:float,falloff:float | 4 | Point attractor field. |
| spiralField | Spiral Field | Spaces | uv:vec2,center:vec2,strength:float | dir:vec2,dist:float | 4 | Spiral force field. |
| vParticles | Particle System [DEPRECATED] | Particles | - | - | 16 | Replaced by P: pipeline. |
| pInit | P: Init | Particles | - | particles:particle | 3 | Init particle positions. |
| pRotate | P: Rotate | Particles | particles:particle | particles:particle | 4 | Rotate particles. |
| pWave | P: Wave | Particles | particles:particle | particles:particle | 4 | Oscillate particles. |
| pColorDist | P: Color by Distance | Particles | particles:particle | particles:particle | 7 | Color by distance. |
| pSize | P: Size | Particles | particles:particle | particles:particle | 3 | Point size. |
| pRender | P: Render | Particles | particles:particle | - | 2 | Render point cloud. |
| raymarch3d | Raymarch 3D | Fractals | uv:vec2,time:float,cam_dist:float,cam_height:float,cam_speed:float,shape_r:float,blend_k:float,light_pos:vec2,fog_dist:float,noise_scale:float | color:vec3,depth:float,normal:vec3,occ:float,fog:float | 27 | Self-contained raymarcher. |
| volumeClouds | Volume Clouds | Fractals | uv:vec2,time:float,cam_speed:float,coverage:float,density:float,sun_angle:float | color:vec3,cloud_mask:float,sun:float,sky:vec3 | 20 | Volumetric clouds. |
| chromaticAberration | Chromatic Aberration | Effects | uv:vec2,time:float,strength:float,contrast:float | uv_r:vec2,uv_g:vec2,uv_b:vec2,offset:vec2 | 7 | Per-channel UV offsets. |
| combineRGB | Combine RGB | Combiners | r:float,g:float,b:float | color:vec3,full_r:vec3,full_g:vec3,full_b:vec3 | 1 | Combine channels. |
| orbitalVolume3d | Orbital 3D | Science | uv:vec2,time:float,orbit_angle:float | color:vec3,alpha:float,depth:float | 18 | Volumetric orbital. |
| mandelbulb | Mandelbulb 3D | Fractals | uv:vec2,time:float,cam_dist:float,cam_height:float,cam_speed:float | color:vec3,depth:float,orbit:vec3 | 15 | Mandelbulb DE raymarch. |
| sdfAo | SDF Ambient Occlusion | 3D Lighting | scene:scene3d,pos:vec3,normal:vec3,hit:float | ao:float | 1 | SDF AO. |
| softShadow | Soft Shadow | 3D Lighting | scene:scene3d,pos:vec3,normal:vec3,hit:float,lightDir:vec3 | shadow:float | 2 | Soft shadows. |
| multiLight | Multi-Light | 3D Lighting | baseColor:vec3,normal:vec3,hit:float,ao:float,shadow:float,sunDir:vec3 | color:vec3 | 12 | IQ outdoor rig. |
| fresnel3d | Fresnel 3D | 3D Lighting | normal:vec3,viewDir:vec3 | fresnel:float | 1 | Rim term. |
| fakeSSS | Fake SSS | 3D Lighting | scene:scene3d,pos:vec3,normal:vec3,hit:float,lightDir:vec3,sssColor:vec3 | sss:vec3 | 5 | Fake subsurface. |
| volumetricFog | Volumetric Fog | 3D Lighting | color:vec3,depth:float,hit:float,fogColor:vec3 | color:vec3 | 4 | Depth fog. |
| materialSelect | Material Select | 3D Lighting | distA:float,distB:float,colorA:vec3,colorB:vec3 | color:vec3,blend:float | 0 | Color by nearest SDF. |
| glass3d | Glass 3D | 3D Lighting | rayDir:vec3,normal:vec3,hit:float,bgColor:vec3,tintColor:vec3,lightDir:vec3 | color:vec3,fresnel:float,refractedColor:vec3,reflectedColor:vec3 | 7 | Dispersive glass. |
| phaseHG | Phase (HG) | 3D Lighting | cosTheta:float | phase:float | 1 | Henyey-Greenstein. |
| fresnelSchlick | Fresnel (Schlick) | 3D Lighting | cosTheta:float | reflectW:float,refractW:float | 1 | Schlick Fresnel. |
| spectralDispersion | Spectral Dispersion | 3D Lighting | rayDir:vec3,normal:vec3,hit:float,bgColor:vec3 | color:vec3 | 7 | 6-channel dispersion. |
| blinnPhong | Blinn-Phong | 3D Lighting | normal:vec3,viewDir:vec3,lightDir:vec3 | light:float | 5 | Blinn-Phong scalar. |
| glassScene | Glass Scene | 3D Scene | ro:vec3,rd:vec3,foreground:scene3d,background:scene3d,bgAlbedo:vec3,tintColor:vec3,lightDir:vec3 | color:vec3,fresnel:float,refractedColor:vec3,reflectedColor:vec3 | 6 | Glass with scene background. |
| truchet | Truchet Tiles | 2D Primitives | uv:vec2,time:float,color_a:vec3,color_b:vec3 | color:vec3,distance:float,mask:float | 6 | Truchet tiling. |
| metaballs | Metaballs 2D | 2D Primitives | uv:vec2,time:float,pos1:vec2,pos2:vec2,pos3:vec2 | field:float,color:vec3,mask:float | 10 | Three metaballs. |
| lissajous | Lissajous Curve | 2D Primitives | uv:vec2,time:float,delta:float | distance:float,mask:float,color:vec3 | 8 | Lissajous SDF. |
| sphereSDF3D | Sphere SDF 3D | 3D Primitives | pos:vec3,radius:float | dist:float | 1 | Sphere. |
| boxSDF3D | Box SDF 3D | 3D Primitives | pos:vec3,sizeX:float,sizeY:float,sizeZ:float | dist:float | 3 | Box. |
| torusSDF3D | Torus SDF 3D | 3D Primitives | pos:vec3,majorR:float,minorR:float | dist:float | 2 | Torus. |
| capsuleSDF3D | Capsule SDF 3D | 3D Primitives | pos:vec3,height:float,radius:float | dist:float | 2 | Capsule. |
| cylinderSDF3D | Cylinder SDF 3D | 3D Primitives | pos:vec3,radius:float,height:float | dist:float | 2 | Cylinder. |
| coneSDF3D | Cone SDF 3D | 3D Primitives | pos:vec3,angle:float,height:float | dist:float | 2 | Cone. |
| octahedronSDF3D | Octahedron SDF 3D | 3D Primitives | pos:vec3,size:float | dist:float | 1 | Octahedron. |
| planeSDF3D | Plane 3D | 3D Primitives | p:vec3,height:float | dist:float | 1 | Horizontal plane. |
| roundedBoxSDF3D | Rounded Box | 3D Primitives | pos:vec3,radius:float | dist:float | 4 | Rounded box. |
| boxFrameSDF3D | Box Frame | 3D Primitives | pos:vec3 | dist:float | 4 | Wireframe box. |
| ellipsoidSDF3D | Ellipsoid | 3D Primitives | pos:vec3 | dist:float | 3 | Ellipsoid. |
| cappedTorusSDF3D | Capped Torus | 3D Primitives | pos:vec3 | dist:float | 3 | Torus arc. |
| linkSDF3D | Chain Link | 3D Primitives | pos:vec3 | dist:float | 3 | Chain link. |
| pyramidSDF3D | Pyramid | 3D Primitives | pos:vec3 | dist:float | 1 | Pyramid. |
| hexPrismSDF3D | Hex Prism | 3D Primitives | pos:vec3 | dist:float | 2 | Hex prism. |
| triPrismSDF3D | Tri Prism | 3D Primitives | pos:vec3 | dist:float | 2 | Tri prism. |
| cappedConeSDF3D | Capped Cone | 3D Primitives | pos:vec3 | dist:float | 3 | Frustum. |
| roundedCylinderSDF3D | Rounded Cylinder | 3D Primitives | pos:vec3 | dist:float | 3 | Beveled cylinder. |
| solidAngleSDF3D | Solid Angle | 3D Primitives | pos:vec3 | dist:float | 2 | Sphere wedge. |
| verticalCapsuleSDF3D | Vertical Capsule | 3D Primitives | pos:vec3 | dist:float | 2 | Y capsule. |
| sdfUnion | SDF Union | 3D Boolean Ops | a:float,b:float | dist:float | 0 | min(a,b). |
| sdfSubtract | SDF Subtract | 3D Boolean Ops | cut:float,base:float | dist:float | 0 | max(-cut,base). |
| sdfIntersect | SDF Intersect | 3D Boolean Ops | a:float,b:float | dist:float | 0 | max(a,b). |
| sdfSmoothUnion | Smooth Union | 3D Boolean Ops | a:float,b:float,k:float | dist:float | 1 | Polynomial smin. |
| sdfSmoothSubtract | Smooth Subtract | 3D Boolean Ops | cut:float,base:float,k:float | dist:float | 1 | Smooth subtraction. |
| sdfSmoothIntersect | Smooth Intersect | 3D Boolean Ops | a:float,b:float,k:float | dist:float | 1 | Smooth intersection. |
| sdfRound | SDF Round | 3D Boolean Ops | dist:float,r:float | dist:float | 1 | d - r. |
| sdfOnion | SDF Onion | 3D Boolean Ops | dist:float,r:float | dist:float | 1 | abs(d) - r. |
| translate3D | Translate 3D | 3D Transforms | pos:vec3,tx:float,ty:float,tz:float | pos:vec3 | 3 | Translate. |
| rotate3D | Rotate 3D | 3D Transforms | pos:vec3,angle:float | pos:vec3 | 2 | Rotate about X/Y/Z. |
| repeat3D | Repeat 3D | 3D Transforms | pos:vec3,cellX:float,cellY:float,cellZ:float | pos:vec3 | 3 | Infinite repeat. |
| twist3D | Twist 3D | 3D Transforms | pos:vec3,k:float,angle:float | pos:vec3 | 1 | Twist around Y. |
| fold3D | Fold 3D | 3D Transforms | pos:vec3 | pos:vec3 | 3 | abs fold per plane. |
| scale3d | Scale 3D | 3D Transforms | p:vec3,dist:float,scale:float | p:vec3,dist:float | 1 | Scale with metric fix. |
| rotateAxis3D | Rotate Axis 3D | 3D Transforms | p:vec3,axis:vec3,angle:float | p:vec3 | 4 | Rodrigues rotation. |
| sinWarp3D | Sin Warp 3D | 3D Transforms | p:vec3,time:float,frequency:float,amplitude:float | p:vec3 | 4 | Sine warp. |
| spiralWarp3D | Spiral Warp 3D | 3D Transforms | p:vec3,time:float,frequency:float,angle:float | p:vec3 | 2 | Radial spiral rotation. |
| bend3D | Bend 3D | 3D Transforms | pos:vec3,k:float | pos:vec3 | 1 | Bend along X. |
| limitedRepeat3D | Limited Repeat 3D | 3D Transforms | pos:vec3 | pos:vec3 | 6 | Finite repeat. |
| polarRepeat3D | Polar Repeat 3D | 3D Transforms | pos:vec3 | pos:vec3 | 2 | Radial repeat. |
| displace3D | Displace 3D | 3D Transforms | pos:vec3,dist:float,freq:float,amp:float | dist:float | 2 | Sine surface displacement. |
| mirroredRepeat3D | Mirrored Repeat 3D | 3D Transforms | pos:vec3,cellX:float,cellY:float,cellZ:float | pos:vec3,cellID:vec3 | 3 | Mirrored repeat. |
| sdCross3D | SD Cross 3D | 3D Primitives | pos:vec3,size:float | dist:float | 1 | Menger cross. |
| mengerSponge | Menger Sponge | 3D Fractals | pos:vec3,size:float | dist:float | 2 | Menger sponge. |
| sphereInvert3D | Sphere Invert 3D | 3D Transforms | pos:vec3,radius:float | pos:vec3 | 1 | Sphere inversion. |
| shear3D | Shear 3D | 3D Transforms | pos:vec3,sxy:float,sxz:float,syz:float | pos:vec3 | 3 | Shear. |
| kaleidoscope3D | Kaleidoscope 3D | 3D Transforms | pos:vec3 | pos:vec3 | 2 | Mirror-fold symmetry. |
| mobiusWarp3D | Möbius Warp 3D | 3D Transforms | pos:vec3,cx:float,cy:float,scale:float | pos:vec3 | 4 | Möbius on a plane. |
| logPolarWarp3D | Log-Polar Warp 3D | 3D Transforms | pos:vec3,scale:float,tile:float,spiral:float | pos:vec3 | 3 | Log-radial warp. |
| helixWarp3D | Helix Warp 3D | 3D Transforms | pos:vec3,rate:float,pitch:float | pos:vec3 | 2 | Helix symmetry. |
| gyroidField | Gyroid Field | 3D Primitives | pos:vec3,frequency:float,thickness:float | density:float,surface:float | 2 | Gyroid. |
| schwarzPField | Schwarz-P Field | 3D Primitives | pos:vec3,frequency:float,thickness:float | density:float,surface:float | 2 | Schwarz-P. |
| mirrorFold3D | Mirror Fold 3D | 3D Primitives | pos:vec3,offsetX:float,offsetY:float,offsetZ:float | pos:vec3 | 6 | abs(p)-offset per axis. |
| domainWarp3D | 3D Domain Warp | 3D Primitives | pos:vec3,strength:float,scale:float,time:float | pos:vec3 | 5 | fbm3 warp. |
| mandelboxDE | Mandelbox DE | 3D Fractals | pos:vec3 | orbit:float,distance:float | 5 | Mandelbox DE. |
| kifsTetra | KIFS Tetrahedron DE | 3D Fractals | pos:vec3 | distance:float | 5 | KIFS tetra. |
| scenePos | Scene Pos | 3D Scene | - | pos:vec3 | 0 | March position inside Scene Group. |
| sceneOutput | Scene Output | 3D Scene | dist:float | dist:float | 0 | Scene Group output marker. |
| sceneGroup | Scene Group | 3D Scene | pos:vec3 | scene:scene3d | 0 | Composable SDF scene. |
| spaceWarpGroup | Space Warp Group | 3D Scene | - | warp:spacewarp3d | 0 | Composable warp. |
| rayRender | Ray Render (Legacy) | 3D Scene | scene:scene3d,uv:vec2,time:float,camDist:float,fov:float,cam_rot_h:float,cam_rot_v:float | color:vec3,depth:float,normal:vec3,iter:float | 23 | Legacy sphere-tracer. |
| rayMarch | Ray March | 3D Scene | scene:scene3d,spacewarp:spacewarp3d,uv:vec2,time:float,camDist:float,camAngle:float,rotSpeed:float,fov:float,maxDist:float | color:vec3,dist:float,depth:float,normal:vec3,iter:float,iterCount:float,hit:float,pos:vec3 | 9 | Camera + sphere march. |
| marchCamera | March Camera | 3D Scene | uv:vec2,time:float,camDist:float,camAngle:float,camElevation:float,rotSpeed:float,fov:float,targetX:float,targetY:float,targetZ:float | ro:vec3,rd:vec3 | 11 | Ray origin/direction. |
| forwardCamera | Camera (Forward) | 3D Scene | uv:vec2,time:float | ro:vec3,rd:vec3 | 5 | Fixed forward camera (hidden). |
| marchPos | March Pos [DEPRECATED] | 3D Scene | - | pos:vec3 | 0 | Legacy MLG position. |
| marchDist | March Dist [DEPRECATED] | 3D Scene | - | dist:float | 0 | Legacy MLG distance. |
| marchOutput | Warp Output [DEPRECATED] | 3D Scene | pos:vec3 | pos:vec3 | 0 | Legacy MLG output. |
| marchLoopGroup | March Loop Group | 3D Scene | ro:vec3,rd:vec3,scene:scene3d,uv:vec2,time:float | color:vec3,dist:float,depth:float,normal:vec3,iter:float,iterCount:float,hit:float,pos:vec3 (+acc* dynamic) | 12 | Composable march loop. |
| marchLoopInputs | Group Inputs | 3D Scene | - | ro:vec3,rd:vec3,marchPos:vec3,marchDist:float | 0 | MLG inner inputs. |
| marchLoopOutput | Group Output | 3D Scene | pos:vec3 | - | 0 | MLG inner output. |
| marchSceneDist | Scene Distance | 3D Scene | pos:vec3 | dist:float,rawDist:float | 0 | Sample scene SDF. |
| giLitMarchGroup | GI Lit March Group | 3D Scene | ro:vec3,rd:vec3,scene:scene3d,uv:vec2,time:float,albedo:vec3,lightDir:vec3,lightColor:vec3,skyTop:vec3,skyBot:vec3,bg:vec3 | color:vec3,dist:float,depth:float,normal:vec3,iter:float,iterCount:float,hit:float,pos:vec3,ao:float,shadow:float,gi:vec3,diffuse:vec3,refl:vec3 (+acc*) | 15 | March loop with GI. |
| blendMode | Blend Mode | Color | colorA:vec3,colorB:vec3,mask:float | result:vec3 | 2 | Named blend + mask. |
| palette | Palette | Color | value:float,anim:float,offset_r/g/b,amplitude_r/g/b,freq_r/g/b,phase_r/g/b:float | color:vec3 | 6 | Cosine palette. |
| palettePreset | Palette Preset | Color | value:float,anim:float | color:vec3 | 1 | Cosine palette presets. |
| gradient | Gradient | Color | uv:vec2,color_a:vec3,color_b:vec3,t_offset:float | color:vec3 | 4 | Two-color gradient. |
| hsv | RGB ↔ HSV | Color | color:vec3 | color:vec3,h:float,s:float,v:float | 1 | RGB/HSV convert. |
| posterize | Posterize | Color | color:vec3,levels:float | color:vec3 | 1 | Quantize color. |
| invert | Invert | Color | color:vec3 | color:vec3 | 0 | 1 - color. |
| desaturate | Desaturate | Color | color:vec3,amount:float | color:vec3 | 1 | Toward grayscale. |
| hueRange | Hue Range | Color | color:vec3,hue_center:float,hue_width:float,boost:float | color:vec3,mask:float | 4 | Boost a hue band. |
| colorRamp | Color Ramp | Color | t:float | color:vec3 | 9 | Up to 8 stops. |
| blendModes | Blend Modes | Color | base:vec3,blend:vec3,opacity:float | result:vec3 | 2 | Photoshop blends. |
| brightnessContrast | Brightness / Contrast | Color | color:vec3,brightness:float,contrast:float | result:vec3 | 2 | Brightness/contrast. |
| blackbody | Blackbody | Color | kelvin:float | color:vec3 | 1 | Kelvin → RGB. |
| liftGammaGain | Lift / Gamma / Gain | Color Grading | color:vec3,lift:vec3,gamma:vec3,gain:vec3 | color:vec3 | 3 | 3-way color correction. |
| hueRotate | Hue Rotate | Color Grading | color:vec3,angle:float | color:vec3 | 1 | Rotate hues. |
| colorSaturation | Saturation | Color Grading | color:vec3,amount:float | color:vec3 | 1 | Scale saturation. |
| shadowsHighlights | Shadows / Highlights | Color Grading | color:vec3,shadows:float,highlights:float | color:vec3 | 3 | Shadows/highlights. |
| toneCurve | Tone Curve | Color Grading | color:vec3,strength:float | color:vec3 | 3 | Blacks/whites remap. |
| output | Output | Output | color:vec3 | - | 0 | Final color. |
| vec4Output | Output (RGBA) | Output | color:vec4 | - | 0 | Final RGBA. |
| group | Group | Utility | (dynamic ports) | (dynamic ports) | 1 | Collapsed subgraph. |
| scope | Scope | Utility | value:float | value:float | 2 | Oscilloscope passthrough. |
| printFloat | Print Float | Utility | uv:vec2,value:float,pos:vec2 | mask:float | 4 | Procedural number text. |
| printText | Print Text | Utility | uv:vec2,pos:vec2,value:float | mask:float | 5 | Bitmap text. |
| add | Add | Math / Arithmetic | a:float,b:float | result:float | 1 | a + b |
| subtract | Subtract | Math / Arithmetic | a:float,b:float | result:float | 1 | a - b |
| multiply | Multiply | Math / Arithmetic | a:float,b:float | result:float | 1 | a × b |
| divide | Divide | Math / Arithmetic | a:float,b:float | result:float | 1 | a / b |
| sin | Sin | Math / Trigonometry | input:float,freq:float,amp:float | output:float | 2 | amp·sin(x·freq) (type picker) |
| cos | Cos | Math / Trigonometry | input:float,freq:float,amp:float | output:float | 2 | amp·cos(x·freq) (type picker) |
| tan | Tan | Math / Trigonometry | input:float,freq:float,amp:float | output:float | 2 | amp·tan(x·freq) |
| exp | Exp | Math / Arithmetic | input:float,scale:float | output:float | 1 | exp(x·scale) (type picker) |
| pow | Pow | Math / Arithmetic | base:float,exponent:float | result:float | 1 | base^exp (type picker) |
| negate | Negate | Math / Arithmetic | input:float | output:float | 0 | -x (type picker) |
| length | Length | Math / Vector Ops | input:vec2,scale:float | output:float | 1 | length(v)·scale |
| multiplyVec3 | Scale Color | Math / Vector Ops | color:vec3,scale:float | result:vec3 | 1 | vec3 × float |
| addVec3 | Add Colors | Math / Vector Ops | a:vec3,b:vec3 | result:vec3 | 0 | vec3 + vec3 |
| tanh | Tanh | Math / Trigonometry | input:float | output:float | 0 | tanh |
| minMath | Min | Math / Comparison | a:float,b:float | result:float | 1 | min |
| max | Max | Math / Comparison | a:float,b:float | result:float | 1 | max |
| clamp | Clamp | Math / Comparison | input:float,lo:float,hi:float | result:float | 2 | clamp (type picker) |
| mix | Mix | Math / Interpolation | a:float,b:float,t:float | result:float | 1 | mix |
| mixVec3 | Mix (Color) | Math / Interpolation | a:vec3,b:vec3,fac:float | result:vec3 | 1 | vec3 mix |
| mod | Mod | Math / Modulo | input:float,period:float | output:float | 1 | mod (type picker) |
| modSelect | Mod Select | Math / Modulo | value:float,period:float | mask:float,modValue:float,phase:float | 3 | Periodic mask. |
| atan2 | Atan2 | Math / Trigonometry | y:float,x:float | angle:float | 0 | atan(y,x) |
| ceil | Ceil | Math / Rounding | input:float | output:float | 0 | ceil |
| floor | Floor | Math / Rounding | input:float | output:float | 0 | floor (type picker) |
| sqrt | Sqrt | Math / Arithmetic | input:float | output:float | 0 | sqrt (type picker) |
| round | Round | Math / Rounding | input:float | output:float | 0 | round (type picker) |
| dot | Dot | Math / Vector Ops | a:vec2,b:vec2 | result:float | 0 | dot |
| quantize | Quantize | Math / Rounding | input:float,step:float | output:float | 1 | Snap to step. |
| makeVec2 | Make Vec2 | Math / Vector Build/Split | x:float,y:float | xy:vec2 | 2 | Build vec2. |
| extractX | Extract X | Math / Vector Build/Split | v:vec2 | x:float | 0 | .x |
| extractY | Extract Y | Math / Vector Build/Split | v:vec2 | y:float | 0 | .y |
| splitVec2 | Split Vec2 | Math / Vector Build/Split | v:vec2 | x:float,y:float | 0 | Split vec2. |
| splitVec3 | Split Vec3 | Math / Vector Build/Split | v:vec3 | x:float,y:float,z:float | 0 | Split vec3. |
| splitVec4 | Split Vec4 | Math / Vector Build/Split | v:vec4 | x:float,y:float,z:float,w:float | 0 | Split vec4. |
| transformVec | Transform Vec | Math / Vector Build/Split | uv:vec2 (v2/v3/v4) | x,y,z,w:float,result:vec2 | 0 | Per-component expressions. |
| makeVec3 | Make Vec3 | Math / Vector Build/Split | r:float,g:float,b:float | rgb:vec3 | 3 | Build vec3 (0..1 sliders). |
| floatToVec3 | Float → Color | Math / Vector Build/Split | input:float | rgb:vec3 | 0 | vec3(x). |
| fractRaw | Fract (scalar) | Math / Rounding | input:float | output:float | 0 | fract (type picker) |
| smoothstep | Smoothstep | Math / Interpolation | value:float,edge0:float,edge1:float | result:float | 2 | smoothstep (type picker) |
| addVec2 | Add Vec2 | Math / Vector Ops | a:vec2,b:vec2 | result:vec2 | 0 | vec2 + vec2 |
| multiplyVec2 | Scale Vec2 | Math / Vector Ops | v:vec2,scale:float | result:vec2 | 1 | vec2 × float |
| normalizeVec2 | Normalize Vec2 | Math / Vector Ops | v:vec2 | result:vec2 | 0 | normalize |
| remap | Remap | Math / Interpolation | value:float,inMin:float,inMax:float,outMin:float,outMax:float | result:float | 5 | Range remap. |
| expEase | Exp Ease | Shapers | x:float | y:float | 2 | Exponential ease. |
| doubleExpSeat | Exp Seat | Shapers | x:float | y:float | 2 | Double-exp seat. |
| doubleExpSigmoid | Exp Sigmoid | Shapers | x:float | y:float | 2 | Double-exp sigmoid. |
| logisticSigmoid | Logistic Sigmoid | Shapers | x:float | y:float | 2 | Logistic. |
| circularEaseIn | Circ Ease In | Shapers | x:float | y:float | 1 | Circular ease-in. |
| circularEaseOut | Circ Ease Out | Shapers | x:float | y:float | 1 | Circular ease-out. |
| doubleCircleSeat | Circle Seat | Shapers | x:float | y:float | 2 | Double-circle seat. |
| doubleCircleSigmoid | Circle Sigmoid | Shapers | x:float | y:float | 2 | Double-circle sigmoid. |
| doubleEllipticSigmoid | Elliptic Sigmoid | Shapers | x:float | y:float | 3 | Elliptic sigmoid. |
| quadBezierShaper | Quad Bezier | Shapers | x:float | y:float | 3 | Quadratic bezier. |
| cubicBezierShaper | Cubic Bezier | Shapers | x:float | y:float | 5 | Cubic bezier. |
| crossProduct | Cross Product | Math / Vector Ops | a:vec3,b:vec3 | result:vec3 | 0 | cross |
| reflect | Reflect | Math / Vector Ops | incident:vec3,normal:vec3 | result:vec3 | 0 | reflect |
| refractDir | Refract Dir | Math / Vector Ops | incident:vec3,normal:vec3 | refracted:vec3,tir:float | 2 | refract + TIR flag |
| complexMul | Complex Mul | Math / Complex Numbers | a:vec2,b:vec2 | result:vec2 | 0 | complex multiply |
| complexPow | Complex Pow | Math / Complex Numbers | z:vec2,exponent:float | result:vec2 | 1 | complex power |
| angleToVec2 | Angle → Vec2 | Math / Angles | angle:float | result:vec2 | 1 | direction from angle |
| vec2Angle | Vec2 → Angle | Math / Angles | v:vec2 | result:float | 0 | angle of vec2 |
| luminance | Luminance | Math / Color | color:vec3 | result:float | 0 | BT.709 luma |
| sign | Sign | Math / Comparison | value:float | result:float | 0 | sign (type picker) |
| step | Step | Math / Comparison | edge:float,x:float | result:float | 1 | step |
| weightedAverage | Weighted Average | Math / Interpolation | a:float,b:float,c:float,d:float | result:float,total_weight:float | 5 | Weighted average of 2–4. |
| compare | Compare | Conditionals | a:float,b:float | mask:float | 2 | 0/1 mask with smoothing. |
| select | Select | Conditionals | mask:float,ifTrue:vec3,ifFalse:vec3 | result:vec3 | 1 | Select by mask. |
| vec2Swizzle | Vec2 Swizzle | Math / Vector Build/Split | input:vec2 | output:vec2 | 1 | Reorder channels. |
| vec3Swizzle | Vec3 Swizzle | Math / Vector Build/Split | input:vec3 | output:vec3 | 1 | Reorder channels. |
| gridUV | Grid UV | Halftone | uv:vec2,scale:float | cellUV:vec2,cellIndex:vec2 | 2 | Grid cells. |
| pixelate | Pixelate | Halftone | uv:vec2,pixelSize:float | uv:vec2 | 1 | Snap UV to grid. |
| dotMask | Dot Mask | Halftone | cellUV:vec2,radius:float,softness:float | mask:float | 2 | Dot in cell. |
| sdfMask | SDF Mask | Halftone | sdf:float,threshold:float,softness:float | mask:float | 2 | SDF → mask. |
| lumaRadius | Luma Radius | Halftone | color:vec3,baseRadius:float | radius:float,luma:float | 3 | Radius by luminance. |
| rgbToCMYK | RGB → CMYK | Halftone | color:vec3 | cmyk:vec4,c:float,m:float,y:float,k:float | 0 | CMYK split. |
| cmykHalftone | CMYK Halftone | Halftone | color:vec3,uv:vec2 | result:vec3 | 8 | Full CMYK halftone. |
| sineLFO | Sine LFO | Animation | time:float | value:float | 4 | Sine oscillator. |
| squareLFO | Square LFO | Animation | time:float | value:float | 4 | Square oscillator. |
| sawtoothLFO | Sawtooth LFO | Animation | time:float | value:float | 4 | Sawtooth oscillator. |
| triangleLFO | Triangle LFO | Animation | time:float | value:float | 4 | Triangle oscillator. |
| bpmSync | BPM Sync | Animation | time:float | phase:float | 2 | BPM-synced phase. |
