# Pass node: render to texture (plan, 2026-10-03)

**Status:** plan only, no code yet.

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
| Pass inside any group (plain, scene, march loop, iterated, published/user node) | **Not allowed.** Error on the node: "Pass nodes go at the top level for now". A Pass inside an iterated group would mean N draws per frame. That's a separate feature ("repeat this pass N times"), wanted for wide blurs, JFA and reaction-diffusion; see later phases. |
| Sampling node inside a plain/scene/iterated/march-loop group, fed through a group port | Not in v1: `texture` sockets can't cross group ports, and the wire refuses to connect. Later phase: a texture port is just a sampler name, so plain groups can pass one through. |
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
- Until the runtime phase ships, `unsupportedFeatures` lists "Pass nodes (render to texture)", so export warns rather than silently drawing something different.
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
3. **Inspecting.** Probes, eye preview and scopes in pass programs. Per-pass Performance rows. Node-cost measurer over the program list. The Show passes toggle.
4. **More nodes.** Glow, Displace, the `previous` output (feedback). Examples: glow edges, reaction-diffusion at ½ Scale.
5. **Websites.** Runtime runs passes. Removed from `unsupportedFeatures`. Parity test plus browser sweep.
6. **Particles from a Pass.** After GPU Particles is on main: `emitFrom`, the engine's birth sampling, Example 2.
7. **Later.** Texture ports through plain groups. "Repeat N times" passes (wide separable blur, JFA, simulations). Texture Input or Video as a direct texture source, without a copy Pass.

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
5. **Should Texture Input and Video get a `texture` output, so Edges can read an image without a copy Pass?** Recommended: not in v1, because it would add an output to existing nodes. Revisit in Phase 7.
6. **Names of the new Blur and Glow nodes?** Recommended: "Blur (texture)" and "Glow (texture)". Leave the prev-frame nodes as they are, apart from a hint.
7. **Maximum number of passes?** Recommended: 8. Revisit after the Performance rows show real costs.
8. **Should particles that feed their own emitter Pass be allowed, with a one-frame lag?** Recommended: allow it, with a note on the card.
