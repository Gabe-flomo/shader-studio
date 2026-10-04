# Pass node: render to texture (plan, 2026-10-03)

**Status:** phases 0 to 7 built (Pass node, Sample / Edges / Blur / Glow / Displace (texture), Previous feedback, live and offline rendering, exported web pages, inspecting a pass, Particles born from a Pass, and phase 7's Passes in plain groups, Repeat and image textures: see the "What shipped" sections below).

## What shipped (phase 7, 2026-10-04)

**In plain words.**
- **A Pass can live inside a plain group**, and texture wires can go in and out of one. A plain group is one that runs once (Iterations 1), isn't sealed, and isn't a 3D group. The group's inputs and outputs take `texture` (the group view's Add input has a texture type; an output takes whatever type is wired to it). Copy a group with a Pass in it and each copy draws a Pass of its own.
- **Repeat N times.** A Pass has a **Repeat** setting (1 to 64, default 1). With N above 1 it draws N times each frame. Each draw reads the one before through **Previous**; the first reads the frame before's last. Two new outputs help: **Step** says which repeat is drawing (0 to N−1, and 0 when Repeat is 1), and **Steps** is N as a number. This is what jump-flood distance fields, wide blurs in small steps, and simulations stepped several times a frame need. The card shows `×N a frame` and its cost as `N × one draw = total ms GPU`, and the Performance row reads "Pass · … ×N".
- **Texture Input and Video Input have a Texture output.** It is the image or video itself, ready for Sample, Edges, Blur, Glow and Displace (texture) and for Particles' Emit from, with no copy Pass in between. It covers the picture as Stretch does (Fit doesn't apply to it).
- **Jump flood (texture)** is a new sampling node: one step of a jump flood (a 3×3 read at Reach picture pixels that keeps the nearest stored seed). It is what Passes 7 runs inside a repeated Pass.

**Where a Pass still can't go, and why** (each gets an error on the group naming it):
- An iterated group (Iterations above 1, or driven by Play): the Pass would be another whole picture drawn on every repeat. Use the Pass's own Repeat instead.
- A sealed group: it stands for one closed function.
- A 3D group (Scene, March loop, GI lit march, Space warp): its nodes run as a distance function at every ray step.
- An Agents group: its nodes run once per walker.
- A bypassed group with a Pass inside.
- A published node: publishing refuses a group with a Pass, a sampling node wired to a texture, or a texture port. A published node is one GLSL function, and it can't take a texture as a wire.

**Under the hood.**
- *Groups* (`compiler/passGroups.ts`, only for graphs with a Pass inside a group). Each plain group holding a Pass is opened onto the top level before the cut. Its nodes keep their ids; a clash gets `<groupId>__` in front. Its port wires are followed to what feeds the group and to what reads it. Its overrides (`innerId::key`) are applied. Its wired param sockets (`ps_<innerId>_<key>`) drive the param through the node's `__param_<key>` input, as they do inside a group. The top-level compile now reads a `__param_` input the way the group compile always did. No top-level node had one before, which the golden snapshots confirm. After the compile, the group's id gets its outputs' variables (so its card and probes read them), and joins the program lists its nodes are in (for Show passes). Groups without a Pass compile inline exactly as before. A texture through a plain group's port was already only a sampler name passed along; a group whose texture port carries nothing compiles to the same text as one without the port (tested).
- *Repeat.* `PassProgram.repeat` is present only above 1. A repeated Pass declares `uniform vec2 u_passiter_<slug>` (x the step, y the count) and nothing else changes. Step reads `.x`; with Repeat 1, Step is `0.0` and Steps a literal. Repeat is `compileTime` (never a uniform), so a Pass saved before phase 7 compiles to the same programs as one with Repeat 1 (tested). `kit/passPlan.js ppRepeat` is the count both hosts use: `lib/passRunner.ts` and `kit/passHost.js` loop N draws. Before each draw they set the step uniform, and from the second draw on they point Previous at the draw before. The GPU timer covers all N. The bundle's pass carries `repeat` and `u.iter` only when repeated. Offline renders take the same code path, so they are deterministic. Outside the pass, a repeated pass's Previous is the draw before its last one (two buffers ping-pong), not the frame before.
- *Image textures.* The new output's variable is the node's own sampler (`u_tex_<slug>`, `u_vid_<slug>`). The sampling nodes measure offsets with `<sampler>_px`. The compiler defines it only when something reads the Texture output (`#define u_tex_<slug>_px (vec2(scale) / u_resolution)`, where scale is the pass program's Scale, so it is always one picture pixel), so no runtime change was needed in either host. Unwired, the node compiles exactly as before. Old saved nodes gain the new outputs (Texture, and the Pass's Step and Steps) on load through `syncSockets`, which only changes the card. Emit from finds a video's texture too: the app sizes it by `videoWidth`, and pages look it up among their videos.
- *Examples with a picture.* `ExampleGraph.images` now also takes a Texture Input's id (no slot), which sets its card thumbnail.

**Examples (the Passes folder).** Every node has a plain-language note; Expression Blocks explain each named line.
- **Passes 7 · Jump-flood distance field**: shapes become seeds, and a ½ Pass (Nearest, half float, Repeat 10) floods them with Jump flood (texture) at a reach that halves each Step. A full-size read gives the distance, drawn as glowing contour rings.
- **Passes 8 · Edges straight from a picture**: a Texture Input (ridges at dusk, bundled) wired straight into Edges and Blur (texture). It is one program with no Pass.
- **Passes 9 · A reusable blur group**: a "Soft glow" group (a Pass and a Blur (texture)) used twice on a neon sign. The first copy is a ½ tight halo; the second, fed by the first, is a ⅛ wide bloom.

**Zero-change.** The golden shader snapshots have no updates. The golden test now leaves out the whole Passes folder, because Passes 8 has no Pass node but uses the new output. The Pass examples 1 to 6 compile to the same programs; the tests compare a Pass without `repeat` to one with Repeat 1. The play-outputs golden (`src/play/__tests__/golden`) gained entries for the three new examples only.

**Checked.** All 319 examples load and compile on the GPU (headless Chrome, ANGLE Metal, M3 Pro) with no GLSL errors. The three new examples were screenshotted in the app and as exported pages (a repeated pass, a Pass in a group and an image texture on a page). The eye preview of a node inside a group that holds a Pass draws that node.

**Not done.** A Pass inside a nested plain group opens too, but only plain groups can hold one. Repeat's Step isn't drivable from Play (Repeat is compile-time). A Texture Input's Texture ignores Fit.

## What shipped (phase 6, particles from a Pass, 2026-10-04)

**In plain words.** The Particles node has a new socket, **Emit from**. Wire a Pass's Texture into it and the particles are born where that texture is bright, all over the picture: wire Edges (texture) through a Pass and sparks come off the outlines of whatever moves. **Image threshold** sets how bright a place must be (brighter places get more births). The emitter's own shape still gives each particle its speed, direction and life; only where it is born changes. A particle that finds nowhere bright enough waits for its next turn, so a sparse texture has fewer particles alive (raise Brightness). Obstacle and Flow already read any chain, so a Sample (texture) of a Pass wired into Flow or Obstacle steers the particles with a pass; those passes now draw before the particles too.

**Zero-change.** Unwired, the node compiles exactly as before: its declaration line (`GP_MARK`, the engine's settings comment) is the same text, nothing else is added, and no pass is reordered. Wired, it writes one more comment into its code, `// gpu-particles-from <its sampler> <the pass's sampler>` (`GP_FROM_MARK`), which `gpBindings` reads into the binding's `from`. The engine's shaders (`GP_SHADERS`, the gpEngineShaders snapshot) are unchanged: births from a texture use `GP_SIM_FROM_SHADER`, built from `GP_SIM` with only `gpSpawn` changed (the shape's birth becomes `gpSpawnShape`, and the new `gpSpawn` keeps its speed and life and moves the place onto the texture), linked the first time a node needs it. `gpFromBirth` is the same search in JS for the tests: up to 16 random points of the texture, each kept with a chance of its luma × alpha when that is at least the threshold; none kept, not born this time. Seeded from the particle and the substep, so a render is the same every time.

**Frame order.** A pass a Particles node reads (anything wired into it but Over and UV, through other passes) is marked `beforeParticles` by the compiler (only when true; a pass with a Particles node in it, or one drawn after the agents, can't be, and the particles then read its previous frame). `kit/passPlan.js` gains `ppFrameSteps`: the passes the particles read, the particles, the passes the agents read, the agents, the passes after them; the app's live loop and exported pages both run it (`ppStaged` takes a `part`, 'particles' or 'rest'). An offline render draws the `beforeParticles` passes at its own time and size before stepping the particles. `ppPrevBound` fixes a pass drawn in an earlier call of the frame (the 'pre' stage with agents, or before the particles): its Previous sampler keeps the frame before instead of being pointed at the picture it just drew.

**Websites.** The bundle's passes carry `beforeParticles` when set; the page's particles engine looks for Particles nodes in every pass program, binds their textures as shared samplers, samples Emit from through the pass textures, and runs the same `ppFrameSteps`.

**The Agents group** already took a Pass: Emit's **Picture** (shape Picture) accepts a Pass's Texture (verified: the group's update shader samples it and the pass draws in the 'pre' stage, before the agents), and a Trail's **Add** or Emit's **Where ƒ** can read a chain through Edges (texture) of a Pass (Passes 6 · Slime along edges).

**Examples (the Passes folder).** Every node has a plain-language note; Expression Blocks explain each named line (the examples test checks it).
- **Passes 2 · Particles born on edges**: drifting metaballs → Pass A → Edges (texture) → Pass B (½) → Particles' Emit from; a rim glow (Blur (texture) of Pass B) and the blobs laid over the sparks.
- **Passes 3 · Feedback trails**: three lights; Sample (texture) reads the Trails pass's Previous, zoomed and turned (Swirl), faded (Decay) and cooled; Play controls Decay and Swirl.
- **Passes 4 · Reaction-diffusion**: Gray-Scott in a ½ Pass, the neighbours from Blur (texture) of its Previous, a wandering seed; Feed and Kill in Play.
- **Passes 5 · Glow only the bright parts**: a neon sign; a threshold keeps the tubes, Pass B (½) and Pass C (⅛) give a tight halo and a wide bloom, added over Pass A. Its notes are the "how to inspect a pass" guide.
- **Passes 6 · Slime along edges**: the Grow toward a picture slime fed by Edges (texture) of a Pass: walkers are born on the outlines and smell them through the trail.
- Passes 1 · Edge glow gained notes on its UV, Time and Output cards (comment lines only).

**Checked.** All 308 examples load and compile on the GPU (ANGLE Metal, M3 Pro) with no GLSL errors. Offline sequences of Passes 2 at 640 × 360 hash the same whatever the live preview is doing; the exported page of Passes 2 runs the sparks off the outlines.

**Not done (phase 7 and later).** Emit from samples the whole picture (the emitter's shape isn't a mask over it, as the plan first said). Births in 3D land on the picture's plane (z = 0). Emit from reads a texture only (a Trail's texture works too, a frame late). Offline renders of agents that read a Pass still step the agents before drawing those passes: that fix is a separate change (renderAtTime is left as it was for agents).

## What shipped (phase 3, inspecting, 2026-10-04)

**How to inspect a pass.** Everything that reads a node's value now reads it from the program the node runs in, so the tools you use on any node work on the nodes inside a Pass too:

- **The eye** on any card, inside a pass or after it, shows that node alone over the picture (the preview compiles the node's ancestors, Pass nodes and their programs included). The eye on a node before a Pass shows the picture that Pass will store.
- **Select a card** and its outputs' values at the picture's centre show on it (the node probe). For a node only a Pass draws, the probe is a copy of that pass's program with the node's value written out, drawn with the pass's own `u_resolution` and every shared uniform (its sliders, the pass textures it reads).
- **Scopes and the eye's waveform** (and the eye's upstream readouts) do the same: a variable the picture's program doesn't declare is read from the pass program that does.
- **The Pass card** shows its texture live (as before) and now its size in pixels and its GPU time, or "not drawn: nothing reads it".
- **Performance panel**: one row per pass under *Where the frame goes*, named after the Pass with its Scale ("Pass B · edges (½)"), in its Show passes colour, from the `pass:<slug>` GPU timers; the picture's row is "Picture". **Cost by node** times the whole program list for every variant (each pass at its size, then the picture), so a node inside a pass costs what that pass saves. Pass nodes aren't bypassed (a texture can't pass through); their rows above are their cost.
- **Show passes** stays the whole graph's view while the eye previews part of it (the store keeps `programMap`, from a second compile of the whole graph only while previewing a graph with Pass or Agents nodes), so the toolbar button doesn't vanish and the tints don't change under the eye.

**The limit lifted: things before a Pass.** A Data node or a Particles node placed before a Pass is compiled into that pass's program. They used to be found only in the picture's program (so a Particles node feeding a Pass drew nothing in it). Now the app and exported pages look for them in every pass program: Data textures are bound from all programs' sources; the Particles engine finds the node in a pass program, steps it before the passes draw, and its texture is a shared sampler every program reads; a Particles node with wired settings is probed from the program it is in. Graphs without Pass nodes bind exactly as before (the same single source).

**Under the hood.** `compilePassGraph` merges each pass program's node variables into `nodeOutputVars` (the picture's win; slugs are shared so the names agree). ShaderCanvas's probes pick their program with `probeSrc` (the picture's when it declares the variable, else the pass whose `nodeIds` hold the node) and key their caches by it. The cost measurer (`ShaderCostMeasurer`) takes an optional pass list.

**Not done.** The plain node probe of a node in the picture's own program still carries only time, resolution, the mouse, Data and pass textures (a node whose sliders are uniforms reads them as 0 there, as before this phase); scopes and pass-program probes take every uniform. Trail-step programs (Agents) aren't probed.

## What shipped (phase 5, websites, 2026-10-04)

- **The bundle** gains `graphPasses` only when the graph has a Pass node (`webInput.ts webPasses`): each pass's program, scale, format, filter, wrap, Previous, live and `afterAgents`, plus the sampler names it fills (`u: { tex, prev }`, from `nodes/definitions/passes.ts`, so the page never builds a uniform name of its own). Node lists stay in the app. Every other bundle serializes as before: the golden bundle snapshots are unchanged. `unsupportedFeatures` no longer lists Pass nodes.
- **The page's host** is `play/kit/passHost.js` (`phCreate`, inlined into every page with the kit as `SSKit.passes`): raw WebGL2 on the page's own context, no three.js. Its schedule is `kit/passPlan.js`, the same module the app's `lib/passRunner.ts` runs: which passes draw (`ppDrawn`), in what order and stage (`ppStaged`, new, now used by the app too), their sizes (`ppSize`), `_px` (`ppPixel`) and when targets are made again (`ppTargetKey`: a resize or a settings change makes them again, black). Previous ping-pongs as in the app, and a new render (`renderAt`) clears it (`clearPrevious`), as an offline render does in the app.
- **One uniform table, as in the app.** Each pass program is compiled as three.js compiles a ShaderMaterial (the GLSL 1 → 3 defines and its precisions) with the compile's vertex shader, drawn on the quad the app draws (three's `PlaneGeometry(2, 2)`: its diagonal and vertex order, so vUv interpolates exactly as in the app; Agents P5 needed it bit for bit), and with every input the picture has (`bindPictureInputs`: Time, the mouse, the uniforms Play drives, images, videos, Data textures, feedback, echo, the pad grid), `u_resolution` set to the pass's own size. The pass samplers and their `_px` are two small maps the runtime binds in every program it draws (empty, and so no work, without Pass nodes). Samplers nothing feeds read blank, as the app's empty texture. Data nodes, Text and the Pad Grid in a pass program are found by scanning every program's source, not only the picture's.
- **Page behaviour.** A page with Pass nodes draws at one device pixel per CSS pixel, as feedback pages do and as the app does. A pass with Previous keeps the page drawing like feedback (paused, it redraws only when something changes), and reduced motion's still frame warms it up like feedback. Without WebGL2 the page draws the picture with the pass samplers blank (and says so in the console).
- **Parity** (`src/play/__tests__/webPasses.test.ts`): the app's `PassRunner` and the page's host, each on a recording stand-in for its GPU, draw the same passes into the same textures at the same sizes with the same `u_resolution` and Previous, frame after frame, through a resize, a cleared render and the two agents stages, for Passes 1 · Edge glow and a feedback graph (Previous at ½, an 8-bit nearest/repeat ¼ pass as a map, Displace and Glow). In the browser (M3 Pro, headless Chrome on ANGLE Metal): the app's offline render and the exported page's `renderAt` after 2 s at 960 × 540 differ by at most 2 levels of 255 (the app's readback dither; mean 0.26 for Edge glow, 0.18 for the feedback graph), and the page running live shows the same picture.
- **Not in pages yet:** phase 3's inspection is app-only by nature. (A Particles node inside a pass program, and Emit from, came in phases 3 and 6.)


## In plain words

Today a Studio graph becomes **one** fragment shader. Each pixel runs the whole graph on its own, so no node can look at the pixel next door in something the graph has just made. That's why "find the edges of this image, then blur the edges, then glow them" can't be built. The existing Gaussian Blur, Bloom and similar nodes get around it by reading **last frame's** finished picture (`u_prevFrame`), one frame late.

A **Pass** node fixes this when you ask for it. Everything wired into a Pass is drawn first into a texture of its own. Nodes after the Pass can then sample that texture anywhere: at an offset, as a blur, as edges, or as a displacement map. You can chain them like TouchDesigner TOPs: Image → Pass → Edges → Pass → Blur → Glow → composite over the image. The GPU Particles node can also use a Pass as its emitter, so particles are born on the edges.

**What doesn't change:** if a graph has no Pass node, nothing about it changes. It compiles to the same shader byte for byte, takes the same code paths in the live preview, offline renders, probes, node cost and website export, and every existing node behaves as it does today. A test enforces this (below). The Pass node and the texture-sampling nodes are new nodes you add yourself. The default Studio flow stays one graph, one shader.

**Verdict on the zero-change guarantee:** it can be met, and for the shader text and export bundle it can be proven by test. The design never changes the existing compile. A graph with Pass nodes is cut into smaller graphs, and each one goes through today's compiler unchanged. The render loop can't be unit-tested to byte level. There the guarantee comes from structure: every new code path sits behind `result.passes` being present. A pixel-hash sweep of all examples before and after each phase backs it up. Two places need care, and both are covered below: the GPU Particles marker comment, and keeping node slugs the same across the cut.

## What the user sees

**Pass node** (category *Passes*, aliases: Render to texture, Buffer, TOP, Cache, FBO, Feedback buffer)

| | | |
|---|---|---|
| In | `color` vec3, `alpha` float (default 1) | what to draw into the texture |
| Out | `texture` (new **texture** socket type) | for the sampling nodes |
| Out | `color` vec3, `alpha` float | the texture at this pixel, so a Pass can sit in an ordinary chain |
| Out | `previous` texture | this Pass's own result from the frame before (feedback); only allocated when wired |
| Param | Scale: 1, ½, ¼, ⅛ (default 1) | size relative to the picture; ½ or ¼ makes wide blurs and glows cheap |
| Param | Format: Half float (default) / 8-bit | half float keeps brightness above 1, so glows don't clip; falls back to 8-bit (with one notice) where float targets aren't supported |
| Param | Filter: Linear (default) / Nearest; Edges: Clamp (default) / Repeat / Mirror | |

The card shows a small live thumbnail of the texture (updated every few frames, like the eye preview), its size in pixels and its GPU time. Scale, format and filter are engine settings, so changing them never recompiles.

**Sampling nodes** (each takes a `texture` input; unwired, it reads transparent black and shows a "Wire a Pass here" hint):

- **Sample**: texture, UV, offset in picture pixels → color, alpha. Also the building block for *Displace by texture*: warp the UV with another Pass's colour.
- **Blur (texture)**: radius in picture pixels and quality (taps). Uses a Vogel-disc kernel like the existing blurs. For wide blurs, use a lower-Scale Pass upstream.
- **Edges (Sobel)**: 3×3 Sobel on luma → edge strength, direction vec2, an edge-tinted colour.
- **Glow (texture)**: threshold, then blur, then intensity → glow colour to add.
- **Displace**: texture A sampled at UV + (texture B's rg − 0.5) × amount.
- **Composite** needs no new node: wire Pass/Blur/Glow colour outputs into the existing Blend / Mix / Add nodes.
- **Feedback** needs no new node: wire a Pass's `previous` output into Sample (with a warped UV) and mix it into the Pass's own input. This is reaction-diffusion, trails and smoke, but per Pass, at its own Scale, and in the same frame as everything else.

The new Blur and Glow sit next to the existing prev-frame Gaussian Blur and Bloom. They get distinct names ("Blur (texture)") so search shows both and nobody's graph changes meaning.

**Wires and the boundary.** Texture wires get their own colour (typeColors) and a dashed style. Wires leaving a Pass get a small "pass" chip at the Pass end. A **Show passes** toggle in the graph toolbar tints each node by the program it runs in (first Pass, second Pass, final picture). A node needed by two programs gets a striped tint and a tooltip saying it runs twice.

**Discovery:** the node browser category *Passes*. Two examples (below), the Performance panel's per-pass rows, and the hint on the old Gaussian Blur / Bloom ("reads last frame; for the same frame use a Pass and Blur (texture)").

## Worked examples

### 1. Edges → blur → glow → over the original

```
Texture Input ─┬──────────────────────────────────────────────┐
               └─► Pass A (¹) ─texture─► Edges ─► Pass B (½) ─texture─► Glow ─► Add ◄─┘ ─► Output
```

The cut makes three programs:

1. **Pass A** (full size): `Texture Input → out = image`. Ancestors of Pass A's input.
2. **Pass B** (½ size): `Edges` sampling `u_pass_A` 9 times → `out = edges`.
3. **Final**: `Glow` samples `u_pass_B` (≈25 taps, cheap at ½ size). `Add` adds the image: Texture Input is compiled again here, because Add reads it directly. Then Output.

At 1080p: Pass A ≈ 1 draw, Pass B ≈ 9 taps at a quarter of the pixels, Final ≈ 25 taps at full size. That's well under 2 ms on an M-series GPU. A Pass B at Scale ½ also makes the glow softer for free.

### 2. Edges → particles

```
Video ─► Pass A ─texture─► Edges ─► Pass B ─texture─► Particles.emitFrom
Video ─────────────────────────────────────────────────► Particles.over ─► Output
```

The particles engine runs after Pass B and before the final program. Births pick random points and keep those where Pass B is bright (see Particles below), so sparks come off the outlines of whatever is moving in the video.

## Technical design

### Compiling: cut the graph at Pass nodes

`compileGraph` gets one new line at the top:

```ts
if (hasPassNode(graph.nodes)) return compilePassGraph(graph);   // new file: compiler/passGraph.ts
```

`hasPassNode` scans top-level nodes and group subgraphs. A Pass found inside a group returns a validation error (below). Everything after that line is today's code, untouched.

`compilePassGraph`:

1. **Slugs first.** Run `computeNodeSlug` over the whole top-level graph once, in today's sort order, and keep the map. Each program is compiled with that map, through a new optional `ShaderAssemblerOptions.slugs`. Only the pass path passes it. This way a node's uniforms (`u_p_<slug>_…`), keyframes and Play targets have the same names in every program it lands in. One uniform table drives them all, and sliders never recompile.
2. **Pass order.** Build the dependency graph between Pass nodes by walking input wires back. A walk stops at a Pass node and does not follow `previous` wires. Sort it topologically. A cycle that doesn't go through `previous` is an error: "this loop needs a Pass's Previous output".
3. **One node list per program.**
   - *Pass P's program*: P's input ancestors, stopping at Pass nodes. A synthetic `output` node is wired to P's `color` and `alpha`.
   - *Final program*: every top-level node except those reached only through Pass inputs. Dangling nodes stay, as today.
   - In every list, an upstream Pass node is replaced by a stripped clone with no inputs. Compiled as a source, its `generateGLSL` emits `texture2D(u_pass_<slug>, …)`, and its `declarationsFor` declares the sampler. `previous` wires become reads of `u_passprev_<slug>`. That removes the only legal cycle before `topologicalSort` sees the list, so topoSort and validate stay as they are.
4. **Compile each list** with today's `topologicalSort` → `generateFragmentShader`. Merge `paramUniforms`, `paramBindings`, `textureUniforms`, `videoUniforms`, `audioUniforms` and `liveUniforms` (same names, same values), and OR `isStateful` and `echo`.
5. **Return** a normal `CompilationResult`. Its `fragmentShader` is the final program, so everything that only knows one shader keeps working. It has one new optional field:

```ts
passes?: Array<{ nodeId: string; slug: string; fragmentShader: string;
                 reads: string[];                 // pass slugs it samples (incl. its own previous)
                 scale: number; format: 'half' | 'byte'; filter; wrap; previous: boolean;
                 nodeIds: string[] }>             // for probes, node cost, Show passes
```

Sampling nodes are ordinary `NodeDefinition`s whose `texture` input resolves to a sampler name. Their helper functions go through the same `glslFunctions` and prune path. `time`, `u_mouse`, `u_resolution`, keyframes, audio, MIDI, video and Data textures are uniforms, so every program shares them for free.

**`u_resolution` in a pass program** is that pass's own size. That keeps `gl_FragCoord / u_resolution` consistent for pixel-UV nodes. `g_uv` is the same at any Scale, because the aspect ratio doesn't change. Sampling nodes measure offsets in *picture* pixels through a `u_pass_<slug>_px` texel-size uniform, so a 4-pixel blur looks the same at any Scale.

### Groups

| Where | v1 |
|---|---|
| Pass inside any group (plain, scene, march loop, iterated, published/user node) | v1: **not allowed** ("Pass nodes go at the top level for now"). **Phase 7:** allowed in a plain group (opened for the cut); the other kinds get an error saying why. Repeat N is the Pass's own setting. |
| Sampling node inside a plain/scene/iterated/march-loop group, fed through a group port | v1: not offered. **Phase 7:** a plain group's ports take `texture` (a sampler name passed through). |
| Group (any kind, no Pass inside) upstream or downstream of a Pass | Fine: it's a node in whichever program needs it. |
| Publishing a group that contains a Pass or sampling node | Blocked with a message (flattenSubgraph bakes one function, and can't hold a sampler parameter). |

### Rendering in the app (ShaderCanvas)

On compile, when `result.passes` exists:

- Build one `THREE.ShaderMaterial` per pass program. Each one's `uniforms` object **is** the main material's `uniforms` object, shared by reference. Sliders, Play mappings, takes, time, video, Data textures, `u_prevFrame` and echo then reach every program with no extra code.
- Add `u_pass_<slug>`, `u_passprev_<slug>` and `u_pass_<slug>_px` to that shared table, only for these graphs.
- Create targets per pass with `type = RT_TYPE` (half float, or 8-bit where unsupported), `scale × floatRt` size, and the pass's filter and wrap. A second target for ping-pong only when `previous` is wired. Resize re-allocates them and clears Previous.
- **Frame:** for each pass in order (skipping passes nothing reads): set `u_resolution` to its size → render into its target, inside `gpuTimer.begin('pass:<label>')` → swap ping-pong. Then the GPU Particles step if it emits from a pass. Then today's main draw, unchanged.
- `shaderMoving` adds one clause: any pass with `previous` keeps the clock drawing, as stateful graphs do.

A graph without passes never reaches any of this. The new code lives in its own module (`src/lib/passRunner.ts`) and is called from a single `if (passRunner)` in the draw path.

**Offline (`renderAtTime`, takes, video export):** a second `PassRunner` instance with its own targets, sized to the export RT. The live preview's Previous buffers stay untouched, the same rule `OfflineHistory` follows. It runs inside `OfflineHistory`'s `draw` callback before the final draw, and `first` clears its Previous buffers. `dt` and `time` come from the offline clock, so a render matches the preview frame for frame.

**Probes / eye preview / scopes:** `buildProbeShader(fs, varName, …)` takes the shader that declares the variable. For a node in a pass program, that's the pass's `fragmentShader` (looked up through `passes[i].nodeIds`). Pass textures are already bound in the shared uniform table. No probe code changes beyond choosing the source string.

**Node cost (Performance panel):** variants still bypass one node and recompile. The measurer is extended to take the whole program list and time the sum, so cost-by-absence stays correct across passes. Pass nodes themselves aren't bypassed, because a texture can't pass through. Instead the panel shows one row per pass from the live `pass:<label>` GPU timers: "Pass B (½) 0.3 ms".

### GPU Particles: emit from a Pass

This depends on the GPU Particles node (on `claude/release-oct-particles`, not on main yet).

- New optional input `emitFrom` (texture) and param `emitThreshold` (0.2).
- When it's wired, the node's marker comment (`GP_MARK`) carries `emitFrom: "u_pass_<slug>"`. **When it's unwired, the comment is identical to today's.** That means writing the new keys only when they're set or non-default. Old node instances that are missing the key must emit exactly what they emit now (golden test covers it).
- In the engine (`play/kit/gpuParticles.js`), the birth shader samples the bound texture at hashed random points and tries up to 8 candidates. It takes the first whose luma × alpha is over the threshold; if none qualifies, the particle stays dead this frame. Emitter shape and size then act as a mask over the texture.
- **Order:** passes the emitter reads → particle step → passes that read the particles → final. If particles feed a Pass that feeds their own emitter, that's a one-frame lag, and the card notes it.

### Website runtime (exportHtml + play-runtime.js)

- The bundle gains `passes.graphPasses` **only when present**. The existing conditional spread stays as is, so bundles without passes serialize the same (golden test).
- The schedule logic is pure JS in `src/play/kit/passPlan.js`: pass order, sizes from scale, which passes are live, ping-pong and Previous reset rules. The app's `passRunner.ts` and `play-runtime.js` both import it, the way Finish and JFA share code between hosts. The runtime already compiles one graph program and binds its uniform table. It compiles N programs and binds the same table to each.
- Until the runtime phase ships, `unsupportedFeatures` lists "Pass nodes (render to texture)", so export warns rather than silently drawing something different. (Phase 5 shipped: the line is gone.)
- A parity test runs the same small pass graph through `passPlan.js` in both hosts' wrappers and compares the schedule. A pixel test in the browser sweep compares app and exported page.

### Performance budget

- **Memory:** half-float RGBA is 8 bytes per pixel. At 1080p that's ≈16.6 MB per full-size pass, ×2 with Previous. At ½ Scale it's ¼ of that.
- **Draws:** each pass is one full-screen draw at scale² of the pixels. Taps dominate: Sobel 9, Blur 13–37, Glow ≈25.
- **Limits:**
  - Up to **8 passes** per graph (error past that).
  - Each program is checked against WebGL2's guaranteed 16 texture units: font, video, images, Data, echo up to 6, `u_prevFrame`, passes and particles together. Over the limit is a compile error naming the program and listing what it samples.
- **Guidance:** a Blur or Glow card set more than about 12 px with no lower-Scale Pass upstream shows a "set the Pass to ½ for speed" tip. The Performance panel's per-pass rows make cost visible.
- **Unread passes:** a pass nothing reads (directly or through other passes or particles) isn't drawn.

### Failure modes

| Case | What happens |
|---|---|
| Pass in a group | Validation error on the node |
| Cycle without `previous` | Error naming the loop's nodes |
| Sampling node with nothing wired to `texture` | Reads transparent black; node shows "Wire a Pass here" |
| Too many samplers in one program | Compile error with the list |
| A pass program fails to compile | Usual GLSL error panel, mapped to the node via that program's slug map; graph shows the error state as any compile failure does today |
| No float render targets | 8-bit targets, one notice; glows clip at 1 |
| Context lost / resize | Targets rebuilt, Previous cleared (same as ping-pong today) |
| Pass with Scale < 1 into Edges | Edges are coarser; expected, and the thumbnail shows it |

## Phases (each one shippable)

0. **Golden shaders (no Pass code).** Add `src/compiler/__tests__/goldenShaders.test.ts`: for every `EXAMPLE_GRAPHS` entry, the learn examples and the compiler fixtures, snapshot `compileGraph`'s `fragmentShader` (full text, or sha256 plus length for large ones), the uniform name sets, `isStateful`, `echo` and `particleSystems`. Also snapshot `buildPlayHtml`'s bundle JSON for the Play examples. Merge on main first.
1. **Compiler cut.** Add the Pass node, the `texture` socket type, `passGraph.ts` and the `slugs` option. Pass stays hidden from the node browser. Unit tests: program lists, order, slug stability, the `previous` cycle cut, the group errors, sampler-count errors. Golden snapshots unchanged.
2. **Live + offline rendering.** `passRunner.ts` and `passPlan.js`. Pass visible, plus Sample, Edges and Blur (texture), the card thumbnail, texture wires and the boundary chip. `renderAtTime` support. Export warns via `unsupportedFeatures`. Example 1 added.
3. **Inspecting.** Probes, eye preview and scopes in pass programs. Per-pass Performance rows. Node-cost measurer over the program list. The Show passes toggle. *(Built: see What shipped (phase 3).)*
4. **More nodes.** Glow, Displace, the `previous` output (feedback). Examples: glow edges, reaction-diffusion at ½ Scale.
5. **Websites.** Runtime runs passes. Removed from `unsupportedFeatures`. Parity test plus browser sweep. *(Built: see What shipped.)*
6. **Particles from a Pass.** After GPU Particles is on main: `emitFrom`, the engine's birth sampling, Example 2. *(Built: see What shipped (phase 6).)*
7. **Later.** Texture ports through plain groups. "Repeat N times" passes (wide separable blur, JFA, simulations). Texture Input or Video as a direct texture source, without a copy Pass. *(Built: see What shipped (phase 7).)*

## Tests

- **Zero-change (every phase):** golden shader and bundle snapshots must pass with **no** snapshot updates. A PR that touches `__snapshots__/goldenShaders*` is rejected unless it's Phase 0. Check the vitest exit code before merging.
- **Render-path sweep (phases 2–6):** in the browser pane (play, then don't edit files mid-sweep), `renderAtTime(t)` plus `readPixels` hashes of every example at three times, before and after. They must match exactly. Graphs without passes take no new branch, so they should match bit for bit on the same machine.
- **Pass compiler:** the unit tests listed in Phase 1, plus:
  - a pass graph's final program is the same as compiling the equivalent graph with the Pass replaced by a direct wire, modulo the sampler read;
  - the same uniform names appear across programs.
- **Engine:** pass order, unread-pass skipping, Previous reset on `first` and on resize, and offline-matches-live for a feedback pass over 60 frames.
- **Particles:** the `GP_MARK` comment is unchanged when `emitFrom` is unwired, and births land only where the texture is bright (CPU-side check of the sampling math).

## Open questions (recommended defaults)

1. **Is `u_resolution` in a pass its own size or the picture's?** Recommended: its own size, with picture-pixel offsets through `u_pass_<slug>_px`.
2. **Should a node needed by two programs be recomputed, or should the user be warned to add a Pass?** Recommended: recompute silently, and mark it striped in Show passes.
3. **Pass default Scale?** Recommended: 1. Blur and Glow cards suggest ½.
4. **Default format?** Recommended: half float, so values above 1 survive for glow.
5. **Should Texture Input and Video get a `texture` output, so Edges can read an image without a copy Pass?** Recommended: not in v1, because it would add an output to existing nodes. Revisit in Phase 7. *(Phase 7: added; it compiles to nothing new until wired.)*
6. **Names of the new Blur and Glow nodes?** Recommended: "Blur (texture)" and "Glow (texture)". Leave the prev-frame nodes as they are, apart from a hint.
7. **Maximum number of passes?** Recommended: 8. Revisit after the Performance rows show real costs.
8. **Should particles that feed their own emitter Pass be allowed, with a one-frame lag?** Recommended: allow it, with a note on the card.
