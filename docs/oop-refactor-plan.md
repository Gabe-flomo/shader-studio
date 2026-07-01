# OOP Refactor Plan

This doc is a handoff spec for an implementation-focused Claude Code session (or
any engineer) that has **not** seen the audit conversation that produced it.
It contains everything needed to execute the refactor without re-deriving the
analysis: what's wrong, why, the target design, and how to verify each step
didn't change behavior.

## Why this doc exists

`shaderAssembler.ts` (and a few other files) grew into very large, hard-to-navigate
modules. A structural audit of the codebase found:

1. A few compiler/runtime modules with heavy shared mutable state that are
   currently threaded through nested closures instead of encapsulated in a
   class — the textbook case where OOP genuinely helps.
2. A few singleton "engine"/"registry" modules that the codebase already
   half-converted to classes in some files (`VideoEngine`, `CanvasRecorder`)
   but not others (`audioEngine.ts`, `nodePreviewRenderer.ts`,
   `scopeRegistry.ts`), causing inconsistency and duplicated boilerplate.
3. A monolithic Zustand store (`useNodeGraphStore.ts`, ~3,900 lines) with
   several manager-shaped concerns (undo history, id generation, presets,
   compilation orchestration) implemented as loose module state instead of
   owned by dedicated classes.
4. A few large React components doing WebGL lifecycle management directly
   inside `useEffect`, which is a good fit for a plain class wrapped by a
   thin component, mirroring pattern #2.

**Explicitly out of scope / do not "objectify":** the node graph data model
(`GraphNode`, `NodeDefinition` in `src/types/nodeGraph.ts`) and the ~250 node
definitions in `src/nodes/definitions/*.ts`. These are intentionally plain
data + a registry of `generateGLSL` strategy functions — that's the right
shape for a domain with 250+ variants of the same shape. Do not convert node
definitions into a class hierarchy. Any duplication there (output-var naming,
input-fallback boilerplate) should be fixed with small shared helper
functions, not inheritance — and is not part of this plan.

## Ground rules (apply to every phase)

1. **Behavior-preserving only.** This is a structural refactor, not a
   rewrite. No output should change: same generated GLSL, same store
   behavior, same rendered pixels. Do not "improve" logic while moving it —
   file a separate note if you spot an actual bug, but don't fix it in the
   same commit.
2. **One phase per commit (or PR).** Each phase below is independently
   shippable and independently verifiable. Do not mix phases in one commit.
3. **Verify before moving on.** Each phase has a "Verification" section.
   Run it and confirm a clean result before starting the next phase.
4. **`npm run build`** (runs `tsc -b && vite build`) and **`npm run lint`**
   must pass after every phase. There is no automated test suite in this
   repo (check `package.json` — only `dev`, `build`, `lint`, `preview` are
   defined), so the burden of proof is on manual/scripted verification
   described per phase.
5. Line numbers below are accurate as of the audit but **will drift** as you
   edit. Relocate sections using the `// ── comment ─────` banner comments
   quoted below (grep for them) rather than trusting line numbers after the
   first edit in a file.
6. Do the phases in order. Later phases assume earlier ones are done (e.g.
   phase 4's `CompilationService` calls into whatever `compileGraph` looks
   like after phase 1, but phase 1 doesn't change `compileGraph`'s external
   signature, so this is a soft dependency, not a hard blocker).

---

## Phase 1 — `ShaderAssembler` class (`src/compiler/shaderAssembler.ts`)

### Current state

`generateFragmentShader(sortedNodes, allNodes)` (currently lines 205–3093,
~2,900 lines) is one function. Its structure, mapped by the file's own
section-banner comments (grep `^\s*// ──` to relocate these after edits):

```
generateFragmentShader(sortedNodes, allNodes)
├─ setup: nodeMap, functions Set (seeded with built-in SDF helpers),
│         mainCode[], paramUniforms{}, textureUniforms{}, audioUniforms{},
│         videoUniforms{}, nodeOutputs Map, mlgDynamicOutputs Map,
│         sceneFnExtraParams Map
├─ pre-scan: isStateful detection (loop over allNodes, checks for
│            prevFrame/blur/etc node types)
├─ usedSlugs Set, nodeSlugMap Map
└─ for (const node of sortedNodes) {                         // main dispatch loop
     ├─ skip particle-pipeline nodes (compiled separately)
     ├─ collect def.glslFunction(s) into `functions`
     ├─ inputVars = resolveInputVars(node, nodeOutputs, nodeMap)
     ├─ nodeSlug = computeNodeSlug(...)
     ├─ register texture/audio/video uniforms by type
     ├─ if (node.type === 'group')            → ~670 lines (280–950)
     ├─ else if sceneGroup                     → ~254 lines (951–1205)
     ├─ else if marchLoopGroup                 → ~778 lines (1206–1984)
     ├─ else if giLitMarchGroup                → ~822 lines (1985–2807)
     ├─ else if spaceWarpGroup                 → ~135 lines (2808–2943)
     ├─ else if node.bypassed                  → ~42 lines  (2944–2986)
     └─ else (standard node + main-graph assignOp) → ~65 lines (2987–3052)
   }
└─ assemble final fragment shader string from functions/mainCode/uniform
   decls (3054–3093)
```

Every branch reads/writes the same setup-phase variables
(`functions`, `mainCode`, `nodeOutputs`, `paramUniforms`, `textureUniforms`,
`nodeSlugMap`, `usedSlugs`, `sceneFnExtraParams`, `mlgDynamicOutputs`). That's
the actual problem — not "one function is long," but "one function is long
*because* seven independent compilation strategies are forced to share a
closure to reach common state." Converting the closure to instance fields is
what makes the split safe and mechanical.

The `group` branch additionally defines a local closure
`compileSubgraphPass` (currently around line 303) used only within that
branch (grep confirms no other branch calls it — each of sceneGroup /
marchLoopGroup / giLitMarchGroup / spaceWarpGroup has its own separate
inline subgraph-walk implementation for compiling into a named GLSL function
body instead of `mainCode`). This means there is real duplication across
those four branches, but **do not deduplicate it in Phase 1** — that changes
behavior-adjacent code paths and multiplies risk. Note it as a candidate for
a later, separate cleanup pass once the extraction below is done and proven
safe (see "Optional follow-up" at the end of this phase).

### Target design

Convert `generateFragmentShader` into a class. Keep the exported function as
a thin wrapper so `graphCompiler.ts` (the only caller — verify with
`grep -rn "generateFragmentShader" src/`) doesn't need to change:

```ts
// shaderAssembler.ts

export class ShaderAssembler {
  private nodeMap: Map<string, GraphNode>;
  private functions = new Set<string>();
  private mainCode: string[] = [];
  private paramUniforms: Record<string, number> = {};
  private textureUniforms: Record<string, string> = {};
  private audioUniforms: Record<string, string> = {};
  private videoUniforms: Record<string, string> = {};
  private nodeOutputs = new Map<string, Record<string, string>>();
  private mlgDynamicOutputs = new Map<string, Record<string, { type: string; label: string }>>();
  private sceneFnExtraParams = new Map<string, Array<{ name: string; type: string }>>();
  private isStateful = false;
  private usedSlugs = new Set<string>();
  private nodeSlugMap = new Map<string, string>();

  constructor(private sortedNodes: GraphNode[], private allNodes: GraphNode[]) {
    this.nodeMap = new Map(sortedNodes.map(n => [n.id, n]));
    this.functions.add(GLSL_SMIN);
    this.functions.add(GLSL_SD_BOX);
    this.functions.add(GLSL_SD_SEGMENT);
    this.functions.add(GLSL_SD_ELLIPSE);
    this.functions.add(GLSL_OP_REPEAT);
    this.functions.add(GLSL_OP_REPEAT_POLAR);
  }

  assemble(): { fragmentShader: string; nodeOutputVars: Map<...>; /* same shape as today */ } {
    this.detectStateful();
    for (const node of this.sortedNodes) {
      this.compileNode(node);
    }
    return this.buildResult();
  }

  private detectStateful(): void { /* body of current pre-scan loop */ }

  private compileNode(node: GraphNode): void {
    // the current loop body's common prefix (particle skip, glslFunction
    // collection, inputVars, nodeSlug, uniform registration), then:
    if (node.type === 'group') return this.compileGroupNode(node, /* inputVars, nodeSlug, def */);
    if (node.type === 'sceneGroup') return this.compileSceneGroupNode(...);
    if (node.type === 'marchLoopGroup') return this.compileMarchLoopGroupNode(...);
    if (node.type === 'giLitMarchGroup') return this.compileGiLitMarchGroupNode(...);
    if (node.type === 'spaceWarpGroup') return this.compileSpaceWarpGroupNode(...);
    if (node.bypassed) return this.compileBypassNode(...);
    return this.compileStandardNode(...);
  }

  private compileGroupNode(...) { /* current lines ~280-950, verbatim */ }
  private compileSceneGroupNode(...) { /* current lines ~951-1205, verbatim */ }
  private compileMarchLoopGroupNode(...) { /* current lines ~1206-1984, verbatim */ }
  private compileGiLitMarchGroupNode(...) { /* current lines ~1985-2807, verbatim */ }
  private compileSpaceWarpGroupNode(...) { /* current lines ~2808-2943, verbatim */ }
  private compileBypassNode(...) { /* current lines ~2944-2986, verbatim */ }
  private compileStandardNode(...) { /* current lines ~2987-3052, verbatim */ }

  private buildResult() { /* current lines ~3054-3093, verbatim, reading this.* fields */ }
}

// Preserve the existing function signature/name for callers.
export function generateFragmentShader(
  sortedNodes: GraphNode[],
  allNodes: GraphNode[],
): /* exact same return type as today */ {
  return new ShaderAssembler(sortedNodes, allNodes).assemble();
}
```

Notes on exact mechanics:

- Anything that's currently a `const` declared once at the top of
  `generateFragmentShader` and mutated by reference (`Set`, `Map`, array)
  becomes a `private` field initialized in the constructor or as a field
  initializer — behaviorally identical, since JS `Map`/`Set`/`Array` are
  reference types either way.
- Anything computed **per node inside the loop** (`inputVars`, `nodeSlug`,
  `def`) should stay as local variables inside `compileNode`/passed as method
  params to the `compileXNode` methods — do not hoist these to fields, they
  don't need to survive across nodes.
- `compileSubgraphPass` (the closure inside the `group` branch) becomes a
  **private method** `compileSubgraphPass(iterPrefix, portInputOverrides,
  carryModeNaturalVars?, exprBlockCarryVars?)` on the class instead of a
  closure recreated per-node. Same for any other nested closures you find
  inside the other five branches (e.g. the warp-body compilation logic
  inside `marchLoopGroup`/`giLitMarchGroup`) — pull each one out to its own
  private method rather than leaving it as a nested closure inside the
  branch method. Name them descriptively (e.g.
  `compileMarchWarpBody(...)`, `compileMapSceneFunction(...)`).
- Keep every private method's internals **byte-for-byte identical** to the
  current code — this should read like a big cut-and-paste with `const` →
  `this.` substitutions, not a rewrite. Resist the urge to simplify anything
  you notice while moving it.
- The returned object shape from `assemble()` must exactly match what
  `generateFragmentShader` returns today (check the current function's
  return type annotation, currently on the `generateFragmentShader` line
  itself — copy it to `assemble()`'s return type).

### Migration steps

1. Read the whole current `generateFragmentShader` function top to bottom
   once (yes, all ~2,900 lines) before touching anything — you need the full
   picture of what each branch reads/writes to avoid missing a shared
   variable.
2. Create the `ShaderAssembler` class skeleton with all fields listed above
   (cross-check against the current function's local `const`/`let`
   declarations to make sure you haven't missed one — search for every
   `const X = ` and `let X` at the top level of the function body, before the
   `for` loop).
3. Move the pre-scan stateful-detection loop into `detectStateful()`.
4. Move the main `for` loop's per-node common prefix + dispatch into
   `compileNode()`.
5. Move each of the seven branches into its own private method, one at a
   time, running `npm run build` after each to catch missed variable
   references (TypeScript will flag any `const` you forgot to convert to
   `this.field`).
6. Move the final shader-assembly block into `buildResult()`.
7. Replace the body of the exported `generateFragmentShader` function with
   `return new ShaderAssembler(sortedNodes, allNodes).assemble();`
8. Run the verification script below.

### Verification

Because there's no test suite, write a one-off script that snapshots
compiler output **before** and **after** the refactor and diffs them. Do
this from a clean git state:

```bash
# Before starting the refactor, on the unmodified file:
mkdir -p /tmp/shader-snapshot
node --experimental-strip-types -e "
  const { compileGraph } = require('./src/compiler/graphCompiler.ts'); // adjust import mechanics to whatever this repo's ts-node/vite-node setup supports
  const graphs = require('./src/store/exampleGraphs.ts');
  const fs = require('fs');
  let out = {};
  for (const [name, graph] of Object.entries(graphs)) {
    try { out[name] = compileGraph(graph).fragmentShader; }
    catch (e) { out[name] = 'ERROR: ' + e.message; }
  }
  fs.writeFileSync('/tmp/shader-snapshot/before.json', JSON.stringify(out, null, 2));
"
```

If wiring up a standalone Node script against this Vite/TS project is
awkward (likely, given path aliases and `.ts` extensions), the pragmatic
alternative is:

- Add a tiny temporary dev-only route/button in the running app (`npm run
  dev`) that iterates every exported graph in `exampleGraphs.ts`, calls
  `compileGraph`, and dumps `fragmentShader` strings to the console or a
  downloaded JSON file. Run it once before the refactor, once after, diff
  the two JSON files (`diff before.json after.json` should show **zero**
  differences), then delete the temporary route/button before committing.

Whichever method you use, the bar is: **every example graph in
`src/store/exampleGraphs.ts` produces byte-identical `fragmentShader`
output before and after this phase.** If anything differs, you moved
something wrong — do not "fix" the diff by adjusting the new code to match
some other expectation; find the missed variable/branch and correct the
extraction.

Also manually smoke-test in the running app (`npm run dev`): load a few
example graphs from each major category (a plain 2D graph, a group/iterated
group graph, a `marchLoopGroup` or `giLitMarchGroup` 3D scene, a
`spaceWarpGroup` graph) and confirm they still render identically.

### Optional follow-up (do not do this in Phase 1, note it for later)

Once Phase 1 is merged and stable, the four/five group-type branches each
reimplement their own "walk subgraph nodes, resolve input vars, call
`def.generateGLSL`, push code" traversal, targeting different output
buffers (`mainCode` vs. a named-function body string array). A later pass
could unify these behind one shared private method (e.g.
`compileSubgraphBody(nodes, emitInto, options)`), parameterized by where the
emitted lines go. This is a larger, riskier change (it touches five
independent code paths' actual logic, not just where it lives) and should be
its own PR with the same snapshot-diff verification, done only after Phase 1
has been in use for a while with no regressions.

---

## Phase 2 — `AudioEngine` and `NodePreviewRenderer` classes

### Current state

Two files in `src/lib/` implement the same shape of problem (per-`nodeId`
`Map` state + operations on it) but as loose exported functions closing over
module-level `let`/`const` state, then bundled into a plain object at export
time:

- `src/lib/audioEngine.ts` (243 lines): module vars `ctx`, `masterGainNode`,
  `_masterVolume`, `_masterPaused`, `_pausedNodeIds`, `nodes` (a
  `Map<string, AudioNodeState>`), plus ~15 functions
  (`loadAudio`, `startAudio`, `stopAudio`, `removeAudio`, `tick`,
  `updateFreqParams`, `setMasterVolume`, `getMasterVolume`, `pauseAll`,
  `resumeAll`, `isMasterPaused`, `isLoaded`, `isPlaying`, `getFileName`,
  `getAnalyser`), exported as `export const audioEngine = { loadAudio,
  startAudio, ... }` at the bottom.
- `src/lib/nodePreviewRenderer.ts` (151 lines): module vars `renderer`,
  `renderTarget`, `scene`, `camera`, `geometry`, `cache`, `inFlight`,
  `queue`, plus exported functions `renderNodePreview` and
  `invalidatePreview`.

Compare this to `src/lib/videoEngine.ts`, which solves the **identical**
kind of problem (per-nodeId video/texture state) but is already a proper
`class VideoEngine { ... }` instantiated once as `export const videoEngine =
new VideoEngine();`. That file is the reference pattern for this phase — do
not invent a new shape, copy that one.

### Target design

**`audioEngine.ts`:**

```ts
class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private masterVolume = 0.7;
  private masterPaused = false;
  private pausedNodeIds = new Set<string>();
  private nodes = new Map<string, AudioNodeState>();

  private getCtx(): AudioContext { /* body of current getCtx() */ }
  async loadAudio(nodeId: string, arrayBuffer: ArrayBuffer, fileName: string): Promise<void> { /* ... */ }
  startAudio(nodeId: string): void { /* ... */ }
  stopAudio(nodeId: string): void { /* ... */ }
  removeAudio(nodeId: string): void { /* ... */ }
  updateFreqParams(nodeId: string, bands: number[], range: number, mode: string): void { /* ... */ }
  private computeBandAmplitude(...): number { /* ... */ }
  tick(): Map<string, number> { /* ... */ }
  setMasterVolume(level: number): void { /* ... */ }
  getMasterVolume(): number { /* ... */ }
  pauseAll(): void { /* ... */ }
  resumeAll(): void { /* ... */ }
  isMasterPaused(): boolean { /* ... */ }
  isLoaded(nodeId: string): boolean { /* ... */ }
  isPlaying(nodeId: string): boolean { /* ... */ }
  getFileName(nodeId: string): string { /* ... */ }
  getAnalyser(nodeId: string): AnalyserNode | null { /* ... */ }
}

export const audioEngine = new AudioEngine();
```

Every method body is a direct copy of the current function body with
module-level variable references (`ctx`, `nodes`, `masterGainNode`,
`_masterVolume`, `_masterPaused`, `_pausedNodeIds`) changed to `this.ctx`,
`this.nodes`, etc. (drop the leading underscore on renamed fields for
consistency — `_masterVolume` → `this.masterVolume` — since it's now a real
private field, not a module-scope convention marker).

**`nodePreviewRenderer.ts`:** same treatment —
`renderer`/`renderTarget`/`scene`/`camera`/`geometry`/`cache`/`inFlight`/`queue`
become private fields of a `NodePreviewRenderer` class; `renderNodePreview`
and `invalidatePreview` become public methods; export a singleton instance:
`export const nodePreviewRenderer = new NodePreviewRenderer();`. Keep the
free function `djb2` and the `PREVIEW_VERTEX` constant as module-level (they
don't hold state, no reason to make them methods/fields).

### Migration steps

1. For each file: wrap all module-level mutable `let`/`const` state in a
   class, convert every exported function to a method, keep stateless
   helpers (pure functions with no reference to the module state) as
   module-level functions outside the class.
2. Export a singleton instance under the **same name** the object literal
   currently has (`audioEngine`, and add `nodePreviewRenderer` — currently
   `nodePreviewRenderer.ts` exports two standalone functions directly, not
   an object; check all call sites with `grep -rn "renderNodePreview\|invalidatePreview" src/` and update imports from `import { renderNodePreview } from '.../nodePreviewRenderer'` to `import { nodePreviewRenderer } from '.../nodePreviewRenderer'` + `nodePreviewRenderer.renderNodePreview(...)`, or alternatively keep re-exporting bound methods as standalone functions from the module — pick whichever requires touching fewer call sites, but be consistent within the phase).
3. For `audioEngine.ts`, all call sites already use `audioEngine.xxx(...)`
   (it was already exported as an object), so **no call site changes are
   needed** — only the internals move into a class. Confirm with
   `grep -rn "audioEngine\." src/` that every usage is already
   member-access style.

### Verification

No behavior changes are expected — this is a pure internal restructuring.
`npm run build` + `npm run lint` must pass. Manually smoke-test in
`npm run dev`:

- Add an `audioInput` node, load an audio file, confirm playback, band
  levels, and the shader animation driven by it still work; test
  pause/resume and master volume.
- Confirm node preview thumbnails (the small shader preview on node cards)
  still render and update when a node's shader changes.

---

## Phase 3 — `CanvasProbeRegistry` shared base

### Current state

`src/lib/scopeRegistry.ts` and `src/lib/audioSpectrumRegistry.ts` are
near-duplicate modules — `audioSpectrumRegistry.ts`'s own header comment
says "Pattern mirrors scopeRegistry.ts." Both:

- export a `Map<string, HTMLCanvasElement>` that some UI component
  registers a canvas element into on mount, and removes on unmount,
- export a `drawXCanvas(nodeId, ...)` function called once per animation
  frame from `ShaderCanvas.tsx`'s `animate()` loop, which looks up the
  registered canvas by `nodeId`, bails if none is registered, and otherwise
  draws into its 2D context.

`scopeRegistry.ts` additionally maintains `scopeBufferRegistry` (rolling
200-sample history), `scopeValueRegistry`, and `floatValueRegistry` — extra
per-key `Map`s beyond just the canvas registry.

### Target design

Extract the shared "canvas-by-key registry" mechanism into a small base
class, and have both files' registry-management (not their very different
drawing code) build on it:

```ts
// src/lib/canvasProbeRegistry.ts (new file)
export class CanvasProbeRegistry {
  private canvases = new Map<string, HTMLCanvasElement>();

  register(key: string, canvas: HTMLCanvasElement): void {
    this.canvases.set(key, canvas);
  }
  unregister(key: string): void {
    this.canvases.delete(key);
  }
  get(key: string): HTMLCanvasElement | undefined {
    return this.canvases.get(key);
  }
}
```

`scopeRegistry.ts` and `audioSpectrumRegistry.ts` keep their own
`drawXCanvas` free functions (the actual drawing code is genuinely
different between them — bar-graph FFT spectrum vs. line-graph rolling
probe value — do not try to unify the drawing logic itself, only the
registration/lookup mechanism). They instantiate their own
`CanvasProbeRegistry` and keep any extra per-key state
(`scopeBufferRegistry`, etc.) as-is alongside it.

**Important — don't change the public API shape more than necessary.**
Current call sites do things like:

```ts
scopeCanvasRegistry.set(nodeId, canvasEl);   // registration
scopeCanvasRegistry.get(nodeId);              // lookup
scopeCanvasRegistry.delete(nodeId);           // cleanup
```

directly on the exported `Map`. If you replace the exported `Map` with a
`CanvasProbeRegistry` instance, every call site using raw `Map` methods
(`.set`/`.get`/`.delete`) needs updating to the new method names
(`.register`/`.get`/`.unregister`). Find them all first:
`grep -rn "scopeCanvasRegistry\.\|audioSpectrumRegistry\." src/`. If the
number of call sites makes this risky, an alternative that requires zero
call-site changes: keep exporting a plain `Map` from each file (unchanged),
and only use `CanvasProbeRegistry` for *new* registries going forward —
i.e. skip this phase's refactor of the two existing files and just document
the pattern for future registries. Use your judgement on the tradeoff; this
phase is the lowest-value, lowest-risk item in this doc, so it's fine to
defer if the call-site count is inconveniently high.

### Verification

`npm run build` + `npm run lint`. Manually test in `npm run dev`: add a
`scope` node and an `audioInput` node, open the audio input's spectrum
view, confirm both the scope probe graph and the audio spectrum bars still
render live.

---

## Phase 4 — Extract manager classes from `useNodeGraphStore.ts`

### Current state

`src/store/useNodeGraphStore.ts` is a single Zustand `create()` call, ~3,900
lines, ~40 actions. Several concerns inside it are really standalone
stateful managers currently implemented as module-level variables or
copy-pasted blocks inside action functions:

1. **Undo history** — a module-level `_history: GraphNode[][] = []` array
   (find it near the top of the file, outside the `create()` call), pushed
   to via a `pushHistory(nodes)` helper called ad hoc from many action
   bodies, and popped by a single `undo()` action.
2. **Compilation orchestration** — the `compile()` action delegates to
   `compileGraph()` (from `src/compiler/graphCompiler.ts`) but also patches
   `mlgDynamicOutputs` onto node sockets, updates `nodeOutputVarMap`,
   `paramUniforms`, `textureUniforms`, etc., and manages a debounce timer
   (a module-level `_compileTimer` variable). Called at the end of roughly
   25 other actions.
3. **ID generation** — a module-level `nodeIdCounter` plus a
   `syncCounterFromNodes()` function that scans a loaded graph (including
   nested subgraphs) to avoid ID collisions after import/load.
4. **Group-type initialization** — `setActiveGroupId()` and `enterGroup()`
   (two large functions, ~370 and ~305 lines respectively) each contain
   near-duplicated per-group-type setup blocks (regular group / sceneGroup /
   marchLoopGroup / giLitMarchGroup), including anchor-node injection and
   legacy-schema migration for each type.
5. **Preset management** — four largely parallel implementations (Custom
   Function presets, Expression presets, Transform presets, Group presets),
   each with its own localStorage key prefix (`CFP_PREFIX`, `EP_PREFIX`,
   `TP_PREFIX`, `GP_PREFIX`) and near-identical save/load/delete/export
   logic, some also syncing to disk (Tauri) via a presets directory.

### Target design

Create a `src/store/managers/` directory with one file per manager. Each
manager is a plain class with **no Zustand/React dependency** — it takes
plain data in, returns plain data out (or mutates its own private state),
so it's independently testable and reusable. The Zustand store keeps its
action functions but each one becomes a thin wrapper: read from store state
→ call into the manager → write the manager's result back via `set()`.

```ts
// src/store/managers/UndoManager.ts
export class UndoManager {
  private history: GraphNode[][] = [];
  private readonly maxDepth = /* whatever the current limit is, if any — check current pushHistory for a cap */;

  push(nodes: GraphNode[]): void { /* current pushHistory body */ }
  pop(): GraphNode[] | undefined { /* current undo() body, minus the set() call */ }
  canUndo(): boolean { return this.history.length > 0; }
}
```

```ts
// src/store/managers/IdGenerator.ts
export class IdGenerator {
  private counter = 0;

  next(prefix: string): string { /* current node id creation logic */ }
  syncFromGraph(nodes: GraphNode[]): void { /* current syncCounterFromNodes body, including its subgraph recursion */ }
}
```

```ts
// src/store/managers/CompilationService.ts
export class CompilationService {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  compile(nodes: GraphNode[]): CompilationResult { /* wraps compileGraph(), same shape as today */ }
  compileDebounced(nodes: GraphNode[], delayMs: number, onDone: (result: CompilationResult) => void): void { /* current debounce logic */ }
}
```

```ts
// src/store/managers/PresetManager.ts
export interface PresetManagerOptions<T> {
  localStoragePrefix: string;
  diskFolder?: string; // for Tauri disk sync, if applicable to this preset type
}

export class PresetManager<T> {
  constructor(private opts: PresetManagerOptions<T>) {}

  save(name: string, data: T): void { /* generic localStorage save keyed by prefix + slug(name) */ }
  load(name: string): T | undefined { /* ... */ }
  delete(name: string): void { /* ... */ }
  list(): string[] { /* ... */ }
  export(name: string): string { /* ... */ }
  // add disk-sync methods only if the current implementation has them —
  // check each of the 4 current preset implementations for feature parity
  // before assuming they're all identical; if one has disk sync and others
  // don't, keep that as an optional method, not a required one.
}

// Instantiated once per preset type, in the store file or a small setup module:
export const customFnPresets = new PresetManager<CustomFnPresetData>({ localStoragePrefix: 'CFP_' });
export const exprPresets      = new PresetManager<ExprPresetData>({ localStoragePrefix: 'EP_' });
export const transformPresets = new PresetManager<TransformPresetData>({ localStoragePrefix: 'TP_' });
export const groupPresets     = new PresetManager<GroupPresetData>({ localStoragePrefix: 'GP_' });
```

**`GroupNodeFactory`** is the riskiest sub-item in this phase because
`setActiveGroupId()` and `enterGroup()` don't just duplicate *initialization*
— they also contain legacy-schema migration logic (upgrading old saved
graphs to new node structures) interleaved with fresh-group setup. Before
extracting, read both functions fully and separate, for each group type
(regular/scene/marchLoop/giLitMarch):

- (a) "build the default subgraph for a brand-new group of this type" —
  this part is safe to extract into `GroupNodeFactory.createDefaultSubgraph(groupType)`.
- (b) "migrate an old/legacy subgraph shape to the current shape" — this
  part is load-path-specific and riskier to move; consider leaving it where
  it is for this phase, or extracting it into a **separate**
  `GroupMigration` class only if it's cleanly separable without touching the
  migration conditionals themselves.

Do not force (a) and (b) into one method if the current code interleaves
them in a way that isn't a clean split — a partial extraction that only
pulls out (a) is a fine outcome for this phase.

### Migration steps

1. Do the managers in this order, easiest/lowest-risk first:
   `IdGenerator` → `UndoManager` → `PresetManager` (all four instances) →
   `CompilationService` → `GroupNodeFactory` (partial, per the note above).
2. For each manager: create the class in `src/store/managers/`, move the
   relevant module-level state and function bodies into it verbatim
   (`const`/`let` → fields, functions → methods), instantiate it once
   (either as a module-level singleton next to the store, or as a field
   created inside the Zustand `create()` initializer — prefer module-level
   singleton to match the existing `audioEngine`/`videoEngine` pattern
   elsewhere in the codebase, **unless** the manager needs to be
   reset/reconstructed on graph load, in which case a store-owned instance
   makes more sense).
3. Update each call site inside `useNodeGraphStore.ts` action bodies to call
   the manager instead of touching module variables/inline logic directly.
4. After each manager is extracted, run `npm run build` + `npm run lint`
   and manually exercise that specific feature before moving to the next
   manager (e.g. after `UndoManager`: create a few nodes, undo, redo if
   redo exists, confirm state matches; after `PresetManager`: save/load/
   delete a preset of each of the 4 types).

### Verification

Per-manager manual smoke tests as described above, plus:

- Full save → reload → undo cycle on a moderately complex graph (a couple
  of groups, at least one iterated group) to make sure `IdGenerator`'s
  collision-avoidance still works after load.
- Create a new group of each type (regular, scene, march loop, GI-lit
  march) and confirm the default subgraph it gets still matches what you'd
  get on the unmodified code (compare against a graph created with the
  same steps before the refactor, or diff against a saved example graph of
  that type in `exampleGraphs.ts` if one exists for that group type).

---

## Phase 5 — `ShaderRenderer` class for `src/components/ShaderCanvas.tsx`

### Current state

`ShaderCanvas.tsx` (1,243 lines) sets up and drives the entire WebGL/Three.js
pipeline inside one large `useEffect` (roughly 600+ lines): renderer
creation, shader material/program setup, ping-pong render targets for
stateful shaders (`prevFrame` support), a separate 1×1 render target + scene
for per-node value probing, particle system rendering, histogram sampling,
and the `animate()` RAF loop that updates uniforms (time, mouse, audio
spectrum) each frame. All of this state lives in React refs
(`materialRef`, etc.) with handlers closing over them directly — there's no
class or manager object, unlike `VideoEngine`/`CanvasRecorder` elsewhere in
`src/lib/`.

### Target design

Extract the non-React parts (anything that isn't "read props/state, decide
whether to re-run setup") into a plain class, and have the component be a
thin wrapper that constructs one instance in a ref and calls into it from
`useEffect`/event handlers. This mirrors the existing `CanvasRecorder`
pattern in `src/utils/CanvasRecorder.ts` — read that file first as your
template for method shape/naming conventions before starting this phase.

```ts
// src/lib/ShaderRenderer.ts (new file)
export class ShaderRenderer {
  constructor(canvas: HTMLCanvasElement, options: ShaderRendererOptions) { /* renderer + RT setup, current useEffect setup code */ }

  compile(fragmentShader: string, vertexShader: string): void { /* rebuild material/program */ }
  setUniform(name: string, value: unknown): void { /* ... */ }
  renderFrame(time: number): void { /* current animate() body, minus the requestAnimationFrame scheduling itself */ }
  probeNode(nodeId: string): number[] | null { /* current node-probe read logic */ }
  resize(width: number, height: number): void { /* ... */ }
  dispose(): void { /* cleanup renderer, RTs, materials — this repo currently may leak some of these on unmount; check and preserve whatever cleanup exists today, don't add new cleanup as part of this phase */ }
}
```

`ShaderCanvas.tsx` then becomes: create a `ShaderRenderer` in a ref on
mount, call `.dispose()` on unmount, call `.compile(...)` when the compiled
shader changes, run a `requestAnimationFrame` loop in the component that
calls `rendererRef.current.renderFrame(time)` each tick, and wire remaining
React-specific concerns (audio uniform pushing via `audioEngine.tick()`,
scope canvas drawing via `scopeRegistry`, FFmpeg export hookup via
`ffmpegRecorder`) as calls the component makes into the renderer instance
or alongside it.

**This is the largest-scope, most React-entangled phase in this doc.**
Unlike Phases 1–4, this one requires you to actually understand which parts
of the current `useEffect` are "pure rendering pipeline" (belongs in the
class) versus "reacting to React prop/state changes" (stays in the
component). Read the whole file first. If, after reading it, the split
looks messier than expected (e.g. deep interleaving that resists clean
separation), it's acceptable to do a **partial** extraction — pull out just
the renderer/material/RT setup and `renderFrame` into the class, and leave
audio/scope/particle wiring in the component calling into the class, rather
than forcing every single concern into the class in one pass. A partial,
correct extraction is better than a complete, behavior-changing one.

### Verification

This phase has the highest risk of visible regressions (anything from
"shader doesn't recompile on edit" to "stateful shaders lose their
ping-pong buffer" to "particle systems stop rendering"). Manually test,
before and after, each of:

- A plain non-stateful 2D shader graph — confirm it renders and updates
  live as you tweak sliders.
- A graph using a `prevFrame` node (stateful, ping-pong) — confirm it
  still accumulates correctly frame-over-frame (e.g. a feedback/trail
  effect looks the same).
- A graph with a `vParticles` node — confirm particles still render.
- A graph with a `scope` node and/or `audioInput` node — confirm live
  probes and audio-reactive uniforms still update.
- The histogram view (if togglable in the UI) still populates.
- Export/recording (PNG sequence or MediaRecorder via `CanvasRecorder`, and
  FFmpeg export if running in the Tauri desktop build) still produces
  correct output.
- Resize the window / preview pane and confirm the canvas resizes without
  visual glitches or a stale render target size.

`npm run build` + `npm run lint` must also pass, but for this phase they're
necessary, not sufficient — the manual checks above are the real bar.

---

## Phase 6 (lower priority, optional) — UI-layer notes

These are real structural issues but are **not** "add classes" fixes — the
idiomatic React answer is hooks and component decomposition, not
classes. Included here for completeness; treat as separate, lower-priority
follow-up work, not part of the OOP refactor proper.

- **`src/components/NodeGraph/NodeInlineViz.tsx`** (5,162 lines, the
  largest file in the repo): a single `switch (node.type)` with ~67 case
  arms, each dispatching to its own viz-renderer function, most of which
  duplicate canvas-ref + `useEffect` + draw-loop boilerplate. A
  `useCanvasViz(drawFn)` shared hook would remove the duplicated
  setup/teardown code across all 67 renderers without touching the actual
  per-type drawing logic. Separately, the 67 renderer functions could be
  split across multiple files grouped by node category (mirroring how
  `src/nodes/definitions/` is already split), registered in a small
  `Record<string, VizRenderer>` map instead of one giant `switch`.
- **`src/components/NodeGraph/NodeComponent.tsx`** (4,485 lines): 8 major
  node-type-specific UI branches (audioInput ~265 lines, videoInput ~265
  lines, marchLoopInputs ~203 lines, group/sceneGroup/marchLoopGroup/etc.
  ~1,070 lines combined) inlined via early returns. Candidate for splitting
  into per-type sub-components (`<AudioInputNodeCard>`,
  `<GroupNodeCard>`, ...) dispatched via a type→component map — same
  registry idea as node definitions, applied to UI.
- **`src/components/NodeGraph/NodeGraph.tsx`** (1,744 lines): pan/zoom,
  connection-dragging, box-select, and keyboard handling are all inlined
  (~20+ `useState`/`useRef` declarations, several large `useCallback`s).
  Candidate for extraction into custom hooks: `useCanvasPanZoom`,
  `useConnectionDrag`, `useBoxSelect`, `useNodeGraphKeyboard`.

If you pick any of these up, treat each as its own phase with the same
ground rules (behavior-preserving, verify by manually exercising the
specific interaction before/after).

---

## Suggested execution order summary

| Phase | File(s) | Risk | Payoff |
|---|---|---|---|
| 1 | `shaderAssembler.ts` | Medium (mechanical, but huge) | High — the original motivating problem |
| 2 | `audioEngine.ts`, `nodePreviewRenderer.ts` | Low | Medium — consistency with existing `VideoEngine`/`CanvasRecorder` pattern |
| 3 | `scopeRegistry.ts`, `audioSpectrumRegistry.ts` | Low | Low — small, safe, optional |
| 4 | `useNodeGraphStore.ts` | Medium–High (esp. `GroupNodeFactory`) | High — biggest file after shaderAssembler |
| 5 | `ShaderCanvas.tsx` | High (React + WebGL entangled) | Medium–High — matches existing class pattern, but riskiest to get right |
| 6 | UI components | Low risk, high effort (hooks, not classes) | Readability only — do last, if at all |

Do them in this order. Stop and report back (don't improvise scope) if any
phase's actual code doesn't match the shape described here — this doc was
written from a point-in-time audit and the code may have moved on.
