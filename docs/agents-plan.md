# Agents group: slime mold and particles built from nodes (plan, 2026-10-03)

**Status:** plan only. Nothing here is built yet.

## In plain words

**What it is.** Slime mold (Physarum) is a million tiny walkers. Each one sniffs the trail ahead of it on the left, in the middle and on the right. It turns toward the strongest smell, takes a step and leaves a little trail behind. The trail spreads out and fades. Do that every frame and veins, networks and rivers grow by themselves.

**What the plan does.** Slime mold doesn't become one big node. It becomes a small set of nodes you can open and rewire:

- An **Agents group**. You open it like a March Loop. Inside is the rule one walker follows every step: **Sense → Steer → Move**. Any ordinary node can join in. Sniff a picture instead of the trail, avoid a shape, add noise, or make the turn depend on the sound.
- Outside the group: **Emit** (where walkers are born), **Deposit** (they leave trail), the **Trail field** (it spreads and fades, and is an ordinary texture you can colour with a Palette or make glow) and **Draw agents** (dots, streaks, ink or glow).
- Particles are built the same way, as forces: **Gravity, Wind, Curl noise, Attract/Repel, Vortex, Flow, Collide, Sound kick, Chladni**, then **Integrate** and **Age**.
- **Presets** drop in a working setup with a note on every node: Slime mold, Multi-species slime, Boids, Ants, Strands, and Particles.

**What doesn't change.** The Particles node keeps working exactly as it does. A graph without an Agents group compiles byte for byte as before, and a test enforces it.

**Speed target.** A million walkers at 60 fps on Apple silicon, with the trail at half the picture's resolution.

---

## 1. Where this sits in the code today

Read before designing. The plan reuses each of these rather than adding a parallel path.

| Piece | What it gives us | Where |
|---|---|---|
| March Loop Group | A container whose inside compiles into its own GLSL (`marchBody_<slug>`), with anchored **Group Inputs / Group Output** nodes pre-registered by the compiler and `assignOp` accumulators. This is the model for "the group's inside is the per-agent rule". | `shaderAssembler.ts` (`compileMarchLoopGroupNode`, ~l.1925+), `nodes/definitions/scene3d.ts` |
| Field sockets | A wired chain compiled again as `T fieldfn_…(vec2 g_uv, …)`. Every node that defaults to `g_uv` is then evaluated at the call's position. This is how Sense reads "any field" (noise, SDF, picture) at a sensor point. Also gives the purity rules (`FIELD_IMPURE`). | `compiler/fieldSockets.ts`, `compileFieldFunction`, `docs/field-sockets.md` |
| Pass node + multi-program compile | `compileGraph` branches **only** when `hasPassNode`, cuts the graph into programs, shares one slug map and one uniform table, and returns `passes`. `passRunner.ts` draws them with three.js materials sharing the preview's `uniforms` object. `passPlan.js` is the pure schedule both hosts will share. The `texture` DataType and sampling nodes (Sample, Blur, Edges, Glow, Displace) are there too. | `compiler/passGraph.ts`, `lib/passRunner.ts`, `play/kit/passPlan.js`, `nodes/definitions/passes.ts`, `docs/pass-node-plan.md` |
| Golden shaders | Every example's fragment shader, uniforms, bindings and Play bundle are snapshotted. Examples containing a Pass are filtered out (`hasPass`). | `compiler/__tests__/goldenShaders.test.ts` |
| GPU Particles engine | RGBA32F ping-pong state (`pos.xyz + age`, `vel.xyz + life`) with MRT update, a ring emitter, `texelFetch(gl_VertexID)` drawing, lights, ink, thread, 3D/DoF, Chladni plates, sound analysis (`gpSoundStep`), an image emitter, a probe for wired fields. | `play/kit/gpuParticles.js`, glue `play/gpuParticlesTexture.ts`, node `nodes/definitions/gpuParticles.ts` |
| ShaderCanvas | The live loop runs particles, then passes, then the picture. `renderAtTime` keeps offline targets separate from the preview's (`PassTargets`, `OfflineHistory`). | `components/ShaderCanvas.tsx` |
| Web export | `unsupportedFeatures` already warns that pages don't run Pass nodes (Pass phase 5 not built). The runtime runs GP particles through `gpHost`. | `play/exportHtml.ts`, `play/runtime/play-runtime.js` |
| Play **Agents layer** | A CPU agents simulation (5k cap, rule stack, boids, predators). It stays; this plan is the GPU, node-built counterpart in Studio. | `play/kit/agents.js`, `docs/agents-layer.md` |
| Starter nodes | `volumetricScene` is a palette entry that expands into a wired rig. Presets will be built the same way. | `useNodeGraphStore.ts` |
| Node notes | `params.__comment` on example nodes. | `exampleGraphs.ts` |

## 2. The nodes

### Three new socket types

- **`agents`**: a handle to one group's state (its state textures, count and species). It is carried only between Agents-family nodes: the group's output, Deposit and Draw agents.
- **`emitter`**: an Emit node's settings and births. It is carried only into an Agents group's **Emit** input, or into another Emit's **Also** input.
- **`deposit`**: one or more Deposits on their way into a Trail field. It is carried only into a Trail's **Deposit** input, or into another Deposit's **Also** input.

The existing **`texture`** type (from Pass) carries the Trail field into anything that samples textures.

Like `texture` today, neither new type can cross a plain group's port, and the wire refuses to connect.

### Chains, and "this agent" defaults

Two conventions keep the inside graph short:

1. **Unwired means this agent.** Inside an Agents group, the compiler defines globals for the current agent: `a_pos`, `a_vel`, `a_heading`, `a_age`, `a_life`, `a_species`, `a_index`, `a_seed`, `a_mem` and the step's `a_dt`. Every Sense/Steer/Move/force socket that is left unwired reads them. `g_uv` is set to `a_pos`, so every ordinary node that defaults to `g_uv` (noise, SDFs, Texture Input, Vector Field, Gravity Field…) is evaluated **where the agent is**. This is the trick field sockets already use. The card shows the default as a faint "this agent" chip on the socket.
2. **Chains add up.** Force nodes, Sense nodes, Emit and Deposit each have an **Also** input of their own type and add their contribution to it. You build "gravity + curl + attract" by wiring them in a row, the way the Finish stack reads. Ordinary Add/Mix nodes also work on the same wires (vec2/vec3), for anyone who prefers them.

### Inside the group (the per-agent, per-step rule)

| Node | Inputs | Outputs | Settings / notes |
|---|---|---|---|
| **Agent Inputs** (anchored, like March Loop's Group Inputs) | — | Position vec2, Velocity vec2, Heading float (radians), Direction vec2, Speed, Age, Life, Species float (0–3), Index, Random float (a fresh 0–1 hash per agent per step), Memory vec2, plus any ports added to the group | What this agent is at the start of the step. |
| **Agent Output** (anchored) | Position, Velocity (or Heading + Speed), Alive (float, < 0.5 kills), Memory vec2, Deposit vec4 (per-channel amount, default `(1,0,0,0)` by species), Colour vec3 (optional, used by Draw "by agent") | — | What the agent is at the end of the step. An unwired input keeps the agent's value, so an empty group is "stand still". |
| **Sense** | Field ƒ (float field socket), Texture (`texture`: a Trail or Pass), Channels vec4 (weights per trail channel; default: own species +1), Angle, Distance, Position, Heading, Also vec3 | Readings vec3 (left, centre, right), Here float, Gradient vec2 | Reads the field and/or texture at three points: the sensor Distance ahead, at ±Angle. The Field ƒ is evaluated through `fieldfn_` at each point, so any chain works: noise, an SDF (negate it to avoid the shape), Texture Input, the Layers node. Also adds a previous Sense's readings, times Weight. Settings: Angle (22.5°–90°, default 45°), Distance, Weight, Sensor width (1 tap or 5-tap cross). |
| **Steer** | Readings vec3, Heading, Random, Turn, Jitter | Heading float, Direction vec2 | Mode **Jones** (the paper's rule: straight if centre wins, a random side if both sides beat the centre, else toward the stronger side by Turn), **Smooth** (turn ∝ right − left), **Away** (Jones toward the weakest). Turn (default 45°), Jitter (random turn, 0–1 of Turn). |
| **Move** | Heading or Direction, Speed, Position, Obstacle ƒ (float SDF field), Also-velocity vec2 | Position, Velocity, Hit float | Step = Speed × dt. Edges: **Wrap** (default for slime), **Bounce**, **Slide**, **Respawn**. Obstacle: an SDF field; on contact Slide along its gradient, Bounce, Turn back (slime) or Die. |
| **By species** | Value 1–4 (any one type) | Value | Picks the input for this agent's species. This makes multi-species rules: four Turn values, four Channel weights… A small ordinary node: `a_species` selects. |
| **Gravity** | Strength, Direction vec2, Also | Force vec2 | Constant pull. |
| **Wind** | Strength, Direction, Gust, Also | Force | Wind with gusts from noise (GP's wind). |
| **Curl noise** | Strength, Size, Evolve, Position, Also | Force | GP's two-octave analytic curl, moved into a shared GLSL chunk. |
| **Attract / Repel** | Target vec2 (default: the mouse), Strength (negative repels), Reach, Swirl, Also | Force | Points, hands, nulls or the mouse go into Target. |
| **Vortex** | Centre, Strength, Reach, Also | Force | Swirl round a point. |
| **Flow** | Field ƒ (float), Mode (**Slope**: down the gradient / **Around**: along contours), Strength, Also | Force | GP's Flow, but evaluated in-shader through the field socket, with no probe and no frame of lag. |
| **Collide** | Shape ƒ (SDF field), Bounce, Friction, Also | Force, Hit | Pushes out and kills the inward velocity. Particles slide round any 2D SDF. |
| **Sound kick** | Level, Strength, Wave speed, Mode (**Shockwave / Shake / Vibrate / Gust**), Centre, Also | Force | Uses the engine's sound state (below); GP's shock rings and level history. |
| **Chladni** | Mode from (Sound / Manual), N, M, Shake, Settle, Also | Force | GP's plate: sand runs down the gradient of `u²` towards the nodal lines. Mode tracking stays in JS (`gpPlateListen`, shared). |
| **Integrate** | Force (total), Velocity, Position, Drag, Max speed, Mass | Position, Velocity | Semi-implicit Euler: `v += F·dt; v *= exp(−drag·dt); clamp; p += v·dt`. Edges as Move. |
| **Age / Life** | Age, Life, Fade | Alive, Age, Age 0–1 | `age += dt`, dead past `life`. Emit reuses dead agents. |

**Any ordinary node is allowed inside where it makes sense** (section 4). For example: Noise → Multiply → Steer's Jitter, Compare → Select, Expression Block, Palette → Agent Output's Colour, Time, Audio Input amplitude, MIDI values.

### Outside the group

| Node | Inputs | Outputs | Settings / notes |
|---|---|---|---|
| **Agents** (the group) | Emit (`emitter`), plus any ports the user adds (float, vec2, vec3, `texture`) | Agents (`agents`) | Count tier **64k / 256k (default) / 1M / 4M**, Steps per frame (1–8, default 2), Seed, Species (1–4), Pre-roll (s), **Start over**. Double-click to open. |
| **Emit** | Where ƒ (float field: born where > threshold), Picture (`texture`: a Pass or Trail, born where bright), Position vec2, Burst (trigger), Also | Emitter | Shape (point, line, ring, disc, box, **picture**, **field**), Size, Rate (per second) or **Fill** (everyone at once, for slime), Burst, Life ± variance, Speed, Spread, Initial heading (outward / random / along), Species (one, or a share across 1–4). The ring window (`gpEmit`) and rejection sampling (8 hashed tries, as the Pass plan's `emitFrom`). Chained Emits = several sources, such as one per species. |
| **Deposit** | Agents, Also (`deposit`) | Deposit | Amount, Size (1 px point / 2×2 / soft disc up to 4 px), What (**Amount** per channel from Agent Output's Deposit, or **Velocity**: writes `vel·amount, count` for field boids). Several Deposits chain into one Trail. |
| **Trail field** | Deposit, Add ƒ (vec4 field painted in each step: food, a Motion layer, a picture), Block ƒ (float mask: trail is zeroed there, so walls) | Texture (`texture`), Amount float (at this pixel, channel select), Channels vec4 | Resolution (**½ picture, default** / ¼ / full / fixed 512, 1024, 2048), Diffuse (0–1 mix toward a 3×3 mean), Decay (half-life in s), Edges (Wrap / Clamp), Channels (1–4), Kernel (3×3 / 5×5 separable). Read by the group, it is the trail **as of the step before** (the loop's one legal cycle, as a Pass's Previous). Read anywhere else, it is this frame's. |
| **Draw agents** | Agents, Over vec3, Colour ƒ (vec3 field) | Color vec3, Alpha, Texture (`texture`), Density | Style: **Points, Streaks (thread), Ink, Glow**, with the Particles node's **Lights** (up to 4). Colour by species / speed / heading / age / agent (Agent Output's Colour) / field. Size, Brightness. Reuses GP's draw, glow, ink and light shaders. |

## 3. Compile model

### 3.1 Entry point (the zero-change gate)

```ts
// compileGraph
if (hasPassNode(graph.nodes) || hasAgentsNode(graph.nodes)) return compilePassGraph(graph);
```

- `hasAgentsNode` finds `agentsGroup`, `trailField`, `drawAgents`, `deposit` or `emit` at any depth.
- Everything after that line stays today's code.
- `compilePassGraph` grows new program kinds. It does not get a second cutter, so slug sharing, the shared uniform table, sampler counting and cycle detection are written once.

### 3.2 Programs a graph with agents becomes

| Kind | Made from | Runs | Output |
|---|---|---|---|
| `pass` (exists) | Pass inputs | once a frame | its texture |
| **`agentStep`** (one per group) | The group's inside graph, **plus** outer ancestors wired into its ports and its Emit chain, stopping at Pass/Trail/Draw (which join as sources) | once per step, a full-screen quad over the **state texture** (side 256…2048), one fragment per agent | MRT: state A, B, C |
| **`deposit`** | Fixed engine shader (vertex shader reads state with `texelFetch(gl_VertexID)`) | once per step per Deposit | additive points into the trail |
| **`trail`** | Fixed engine shader, plus the compiled Add ƒ / Block ƒ chains as an optional small program | once per step per Trail | diffuse + decay, ping-pong |
| **`draw`** | GP's draw shaders | once a frame | half-float RGBA, like GP's |
| final (exists) | the rest; Trail and Draw replaced by sources reading `u_trail_<slug>` / `u_agentsdraw_<slug>` | once a frame | the picture |

The result gains one optional field, next to `passes`:

```ts
agents?: {
  groups:   Array<{ nodeId; slug; fragmentShader; tier; side; species; stateC: boolean;
                    steps; seed; preroll; reads: string[]; emit: EmitSpec[]; sound?: SoundSpec;
                    nodeIds: string[] }>;
  deposits: Array<{ nodeId; slug; group: string; trail: string; size; what; amount: string /* uniform */ }>;
  trails:   Array<{ nodeId; slug; scale | fixed; channels; edges; kernel; addShader?: string; reads: string[] }>;
  draws:    Array<{ nodeId; slug; group: string; style; lights; … }>;
}
```

The schedule (below) is worked out by a pure `src/play/kit/agentPlan.js`, extending `passPlan.js`. The app and the web runtime both use it.

### 3.3 The agent step shader

The group's inside is compiled through **today's** `topologicalSort → generateFragmentShader`, with one new optional assembler option, `agentProgram`. The Pass path added `slugs` the same way. When the option is absent, the emitted text is unchanged, and the golden test proves it.

With `agentProgram` set, the assembler:

- Emits a GLSL3 header: `#version 300 es`, `#define texture2D texture`, and three `layout(location = n) out vec4 o_a/o_b/o_c`. The program runs as a three.js `RawShaderMaterial` with `glslVersion: GLSL3`, sharing the preview's `uniforms` object as Pass programs do.
- Replaces the pixel prelude with the agent prelude:
  ```glsl
  ivec2 a_tex = ivec2(gl_FragCoord.xy);
  vec4 sA = texelFetch(u_agA_<slug>, a_tex, 0);   // pos.xy, heading, age
  vec4 sB = texelFetch(u_agB_<slug>, a_tex, 0);   // vel.xy, speed, life
  vec4 sC = texelFetch(u_agC_<slug>, a_tex, 0);   // species, mem.x, mem.y, packed deposit (only if used)
  vec2 g_uv = sA.xy; … a_* globals …
  float a_index = float(a_tex.y * side + a_tex.x);
  uint  a_hash  = pcg(uint(a_index) ^ (u_step * 0x9E3779B9u) ^ u_seed);
  ```
- Puts the **birth block** first: a texel inside this step's emit window (`gpInWindow`) is reborn from the Emit chain's code, and skips the rule. Dead texels outside the window write "dead" and return early, so dead agents cost almost nothing.
- Compiles the Agent Output node to write `o_a/o_b/o_c`.

**State layout.** It matches GP's, so the Draw code is reused as is:

| Texture | Format | x | y | z | w |
|---|---|---|---|---|---|
| A | RGBA32F | pos.x | pos.y | heading | age |
| B | RGBA32F | vel.x | vel.y | speed | life (< 0 = dead) |
| C (only when species > 1, Memory or per-agent Deposit is wired) | RGBA32F | species | mem.x | mem.y | deposit (four 8-bit amounts packed) |

Positions are in the picture's centred coordinates (`g_uv` space: y in −1…1, x scaled by the aspect), so a field node reads the same place the picture shows. 1M agents use 32 MB of state, ×2 for ping-pong; C adds 16 MB.

**Sense in GLSL.** For each of the three sensor points `q = pos + dist·dir(heading ± angle)`:

- the field socket calls `fieldfn_<slug>(q, …)`;
- a wired texture does `texture(u_trail_<slug>, uvOf(q))`, linear-filtered, `dot`-ed with Channels.

A Trail read inside the group binds that Trail's **previous** ping-pong texture.

**Purity and cost.** Three calls to a field chain cost three times the chain. The card's GPU ms shows it, and the cost hint flags field chains of more than about 40 instructions.

### 3.4 Deposit, trail and drawing

- **Deposit** draws `gl.POINTS` (`drawArrays(POINTS, N)`), one per agent, with `texelFetch` on state A/C and dead agents culled to clip-space w = 0. It adds with `blendFunc(ONE, ONE)` into the Trail's **current** RGBA16F target. RGBA16F blending is available wherever `EXT_color_buffer_float` / `_half_float` is, which GP already requires. Point size is in trail pixels. Velocity mode writes `(vel·amount, count)` into the channels.
- **Trail step**, one pass:
  ```
  t' = mix(t, mean3x3(t), diffuse) · 2^(−dt / halfLife)  (+ Add ƒ · dt) · (1 − Block ƒ)
  ```
  Ping-pong. Edges Wrap use `REPEAT` sampling. A 5×5 kernel is separable (two passes).
- **Order of one step** (Jones' order): every group's agentStep (reading trail(t−1)) → every Deposit into its trail → every trail's diffuse/decay → swap.
- **Order of a frame:**
  1. Passes that agents read.
  2. K steps of the above.
  3. Draw agents.
  4. Passes that read trails or agent drawings.
  5. Final.

  A Pass that reads a trail and also feeds a group's Sense gives a one-frame lag. The card notes it, as the Pass plan does for particles that feed their own emitter.
- **Draw agents** calls GP's `GP_DRAW_VERT/FRAG`, glow and compose shaders with this group's state textures and count. These shaders are moved into exported chunks of `gpuParticles.js` without changing a byte (P0 snapshots them).

### 3.5 Multi-species

- Species (1–4) is a group setting. Emit assigns species by share.
- Each species deposits into its own trail channel by default (Agent Output's Deposit defaults to `a_species`).
- Sense's Channels default to `+1` for its own species and `−0.5` for the others. That gives the classic attract-own, repel-others look.
- **By species** makes any number per species, without four copies of the rule.
- Two separate groups can also share one Trail: two Deposits chain into it, each into its own channel.

### 3.6 Sound, hands and the mouse inside the rule

- **Numbers.** Every slider is a uniform `u_p_<slug>_<key>`, so Play controls, mappings, takes and MIDI already work, with no recompile.
- **The mouse and time** are globals.
- **Hands, nulls and the pose** come in as vec2 values through Play mappings onto a Target socket's slider pair. GP's "Add as position with Y" flow is reused.
- **Sound.** A group whose inside has a Sound kick or Chladni node gets a `sound` spec (Sound from: Graph / Mic / engine master / track). The runner runs `gpSoundStep` and `gpLevelsPush`, moved to a shared module and kept unchanged for GP. It supplies `u_agSound_<slug>` (level, bass, mid, treble) and the level-history texture, as GP does.

## 4. What may go inside the group, and why

The inside runs **once per agent**, not once per pixel. That decides it:

| Allowed | Why |
|---|---|
| Math, vectors, shapers, conditionals, constants, matrices, Expression Blocks, Custom Functions, published nodes | Pure functions. |
| Noise, SDFs, patterns, Texture Input, Video, Data, Palette, Vector Field, Gravity Field | Pure functions of position, evaluated at the agent (`g_uv = a_pos`). |
| Time, Mouse, Audio Input, MIDI, LFOs | Uniforms. |
| Pass sampling nodes (Sample, Edges) on a `texture` port; the **Layers** node | A texture read at a point. Layers is a frame late, which is fine for food and walls. |
| Plain and iterated groups (nesting cap 2) | Inlined as today. |

| Rejected (validation error on the card) | Why |
|---|---|
| Everything in `FIELD_IMPURE` except `playLayers`: Echo, Previous Frame, the u_prevFrame blurs, Bloom… | They read the previous **picture** at this pixel, and an agent's texel isn't a pixel. |
| Pass, another Agents group, Trail, Deposit, Emit, Draw agents, the Particles node, Output | Programs or engines of their own. They go outside. |
| Scene Group, March Loop, GI March, Space Warp | A ray march per agent: too costly in v1. Later, a 3D Collide reads a Scene through GP's 48³ grid. |
| Any node whose emitted GLSL uses `dFdx`, `dFdy`, `fwidth` or `gl_FragCoord` (SDF Fill's pixel AA, some effects) | Neighbouring texels are unrelated agents, so derivatives are noise. Detected by scanning the node's emitted code, not with a hand-kept list, so new nodes are covered. |

The rule lives in `compiler/agentRules.ts`, next to `fieldSockets.ts`. Its messages read like field sockets' ("Echo can't go inside an Agents group: it reads the previous frame").

## 5. How it plugs into Studio

- **Trail is a texture.**
  - Its **Amount** and **Channels** outputs read this pixel, so Trail → Palette → Output is one wire each.
  - Its **Texture** goes into Glow (texture), Blur (texture), Edges, Displace, Sample.
  - It can go into a Pass, for example a reaction–diffusion Pass seeded by the trail.
  - It can go into Emit's Picture, so particles are born on the veins.
- **Draw agents** behaves like the Particles node: Color into the Output, Over for a background. Texture and Density go into the rest of the texture world.
- **Finish bloom**, takes and recordings all see the final picture as today.
- **Show passes** tints agent programs too, with a new "agents" colour.
- The **Performance panel** gets rows `agents:<label> step / deposit / trail / draw`.

## 6. Play

- **Controls and mappings.** Any slider inside or outside the group can be a Play control or a mapping target, because they are uniforms. The group card can **pin** inner sliders (as Scene Group's `innerNodeId::paramKey` overrides) so Sense angle, Turn and Speed sit on the group's card. Right-click keeps the Play / knob menu, and typing past the max extends the range (slider conventions).
- **Triggers.** **Start over** and Emit's **Burst** are trigger params: rules and trigger sources route to them, as with GP's Burst.
- **Sound.** Sound kick and Chladni nodes inside, Sound from on the group (above). Audio Input amplitude into any socket is one wire.
- **Hands, pose, nulls and the mouse** go into Attract/Repel, Vortex and Emit Position.
- **Motion layer as food and as an emitter (P4).** Expose a Motion layer's grid as a texture: a **Motion (texture)** source node, the follow-up `docs/motion-layer.md` already names. It goes into the Trail's Add ƒ (food: slime grows toward where people move), Emit's Picture (born where it moves) or a Sense. Until then, the Layers node gives a frame-late version.
- **Readings (P6).** Alive share and centroid, by a 1-texel reduction read back with GP's `gpReadback` (a frame or two late), listed as layer sensors.

## 7. Performance budget and limits

**Target:** Slime mold, 1M agents, 2 steps a frame, trail ½ of a 1080p picture (960 × 540), at 60 fps on an M-series GPU.

| Stage (1M agents, per step) | Estimate |
|---|---|
| Agent step: 3 trail taps + Jones steer + move | 0.4–0.8 ms |
| Deposit: 1M 1-px additive points | 0.4–0.6 ms |
| Trail diffuse + decay: 960 × 540, 9 taps | ~0.1 ms |
| **Per step** | **~1–1.5 ms** |
| × 2 steps + Draw (points, glow) 2–3 ms | **≈ 4–6 ms a frame** |

This is consistent with GP's measured 2 ms for 1M (engine) and 5 ms for 1M with 3D, DoF and threads.

- **Tiers.** 64k / 256k / 1M / 4M, as GP. Default 256k; slime presets use 1M. 4M is the "fast GPU" tier.
- **Steps.** At most 8 a frame. When frames run long, the `gpuTimer` lowers the **steps actually run** (never the count), and the card says "running at ×0.5". See determinism for what that means.
- **Trail size.** ½ by default. A fixed 1024 or 2048 gives a picture-independent look. Memory: RGBA16F 960 × 540 ≈ 4 MB ×2.
- **Limits** (errors past them):
  - 4 Agents groups and 4 Trails per graph;
  - 4 species per group;
  - 8 programs of each kind;
  - the existing 16 samplers per program: an agent program counts its 2–3 state samplers, Trails, Passes, images, video and Data.
- **Phones.** 256k and points only (GP's rule). No float targets: the card says so once, Draw passes Over through, Trail reads 0.
- **Cost of rules.** A field chain in Sense runs three times per agent per step. The card's GPU ms and a hint make that visible.
- **Not exact.** Jones' "one agent per cell" exclusion isn't modelled (it needs a scatter with conflict resolution). The look is the same at these densities. Boids are **field boids** (below), not neighbour lists.

## 8. Determinism (offline renders, takes)

- **Fixed steps.** One step is 1/60 s of simulated time. The simulation is defined by its **step number**: at clock time t it has run `floor(t · 60 · Speed)` steps (+ pre-roll). Randomness is `pcg(index, step, seed)`. Nothing reads the frame's dt.
- **Live.** It catches up to the step count, at most 8 steps a frame. If it can't, it falls behind (sim time lags the clock) rather than dropping steps, so step n is always the same state.
- **Offline** (`renderAtTime`, takes, video export): `first` starts over (state cleared, pre-roll run). Then each frame runs exactly the steps up to its time, with no cap, on its own `AgentTargets` set, so the preview's state is untouched (the `PassTargets` / `OfflineHistory` rule).
- **Same machine:** bit-exact run to run. Additive blending is applied in primitive order within one draw, and the hash is integer.
- **Across GPUs:** the same picture up to float rounding, which a chaotic system amplifies over minutes. That is acceptable and stated in the docs, as for GP.
- **Seek backwards.** ↺, a seek or a new render starts over and re-simulates. Long seeks show a "simulating…" progress for more than about 2 s of sim.

## 9. Website export

- **Until P5:** `unsupportedFeatures` lists "Agents groups: the page draws the picture without them". Export warns rather than silently differing.
- **P5:**
  - The runtime runs agent programs through the shared `agentPlan.js` schedule and the shared GLSL chunks.
  - The Pass node's phase 5 (the runtime compiling N programs on one uniform table) is a prerequisite and ships first, or in the same PR.
  - The bundle gains `agents` **only when present**. The conditional spread keeps other bundles byte-identical (golden bundle snapshots).
  - Parity test: the same small graph's schedule in both hosts. Browser sweep: app vs. exported page, pixel-compared after N steps on the same machine.

## 10. Zero-change guarantee

- `compileGraph` branches only on `hasAgentsNode || hasPassNode`.
- `agentProgram` is an assembler option that's absent on every existing path.
- New DataTypes and node definitions don't change any existing shader.
- **Golden snapshots must pass with no updates in every phase after P0.** The filter in `goldenShaders.test.ts` grows from `hasPass` to "has a Pass or an Agents-family node", exactly as Pass examples are excluded, so new examples don't add snapshot entries.
- **GP engine shaders.** P0 adds snapshots of the GP engine's shader strings (`GP_SIM`, `GP_DRAW_*`, glow, compose), so moving their GLSL into shared chunks is proven byte-identical. The `GP_MARK` comment and Particles node output are covered by the existing goldens.
- **Render path.** ShaderCanvas gets one `if (agentRunner)` beside `if (passRunner)`. A graph without agents never constructs it. The browser render-path sweep (play first, no file edits mid-sweep) compares `renderAtTime` hashes of every example before and after each phase.
- **Check before merging.** The vitest exit code is checked before any merge.

## 11. The Particles node: coexistence and migration

**Recommendation: the Particles node stays exactly as it is. It does not become a sealed group.**

- Its engine does a lot outside a per-particle shader: sound analysis and hit detection, Chladni mode tracking with hold and morph, the image home pass, the probe (wired values, scene camera and 48³ scene grid), the 3D camera and DoF, lights and halos. A group would either lose these or hide them in a sealed box that compiles the same way, which is a monolith with extra steps.
- Changing saved graphs is risk with no gain. Today `sealed` only blocks entering a group; it doesn't make a function.

Instead:

1. **Shared code, one engine family.**
   - Draw agents reuses GP's draw, glow, ink and light shaders.
   - The force nodes reuse GP's GLSL: curl, wind, shock, Chladni plate and Bessel table.
   - The group's sound uses `gpSoundStep`.
   - All of it is moved into exported chunks with P0's byte-identical snapshots, so the two never drift.
2. **A "Particles" preset** of the Agents group (P2) reproduces the node's default: ring emitter, curl + swirl + drag, Ember colours, 4 lights, glow.
3. **"Open as nodes"** on the Particles card (P6) builds the equivalent group next to it as a copy, leaving the original alone. It lists anything it can't carry yet ("Image emitter, 3D camera: not yet as nodes").
4. The Particles node's info card gets one line: "Want to change the rules themselves? Try the Particles preset of the Agents group."

## 12. UI

- **Adding.** Node browser, new category **Simulation**: Agents (empty group), the inside nodes (only offered while inside a group; elsewhere they show "goes inside an Agents group"), Emit, Deposit, Trail field, Draw agents, and the **presets** as starter entries (like Volumetric Scene). A preset expands into wired nodes next to the Output, with the picture already showing.
- **Group card** (folded by default, primary section open, summaries on the folded ones):
  - **Agents:** count tier, species, Start over.
  - **Steps:** steps per frame, seed, pre-roll.
  - **Pinned:** inner sliders the preset pins.

  It also shows a live state thumbnail (the agents as dots), "1,048,576 agents · 2 steps · 1.9 ms", and an "Open rule ↗" button. Double-click opens it too.
- **Inside.** A banner: "This runs once for every agent, every step." Agent Inputs sits left and Agent Output right, anchored, both with hints on every socket. Unwired agent-default sockets show the faint "this agent" chip. Wires carrying `agents`, `emitter` and `deposit` get their own colours. The Trail-into-group wire gets a small "↺ last step" chip.
- **Eye preview inside the group.** A per-agent value has no picture of its own. The eye shows **what an agent standing at each pixel would see**: the inside chain compiled as an ordinary picture, with `a_pos = g_uv`, heading 0 and species 0. That makes Sense, Flow and Collide fields visible. Out of P1 scope; P3.
- **Comments on every preset node.** Every node a preset or example adds carries a plain-language `__comment` saying what it does in this setup and what to try ("Sense: each walker sniffs the trail 9 px ahead, 45° left and right. Wider angles make rounder, blobbier networks."). `examples.test.ts` gets a check: every node in an Agents example or preset has a non-empty `__comment`.

### Presets

| Preset | Inside | Outside |
|---|---|---|
| **Slime mold** | Sense (trail) → Steer (Jones, 45°, jitter 0.1) → Move (wrap) | Emit Fill (disc, inward headings), Deposit 1 px, Trail ½ (diffuse 0.5, half-life 0.3 s), Trail → Palette → Output; 1M |
| **Multi-species slime** | Sense (trail, Channels by species) → By species (Turn, Speed) → Steer → Move | 3 species, chained Deposits, Trail 3 channels → per-channel colours added |
| **Boids (field)** | Sense ×2: velocity channel (align), density gradient (cohere), fine density (separate, negative) → Integrate (max speed, min speed) | Deposit **Velocity** into Trail (5×5 blur), Draw Streaks by heading |
| **Ants** | Memory.x = carrying food. Sense home or food pheromone by Memory; Food ƒ (SDF circles) and Nest point flip Memory; Deposit channel by Memory | Trail 2 channels (fast decay), Draw Points coloured by Memory |
| **Strands** | Slime with Distance 30 px, Turn 12°, low jitter | Trail with fast decay, Draw Streaks Ink on paper |
| **Particles** | Curl noise → Vortex → Attract (mouse) → Integrate (drag) → Age/Life | Emit ring, rate; Draw Glow + 4 lights |

More in P6: Sand on a plate (Chladni), Sound field (Sound kick), Food from a picture (Trail Add ƒ = an image), Walls (Move Obstacle ƒ = text SDF), Hand slime.

## 13. Phases (each ships on its own PR against main, with What's new entries)

- **P0 Guards.**
  - Golden filter extended to Agents-family nodes (no new snapshot entries).
  - Snapshots of GP engine shader strings.
  - Move GP's curl, wind, shock, plate, draw, glow, compose and sound code into exported chunks, byte-identical.
  - No user-visible change.
- **P1 Slime.**
  - The `agents` and `deposit` types, Agents group with Agent Inputs/Output, Sense, Steer, Move, By species.
  - Emit (Fill and Rate: point, ring, disc, box), Deposit, Trail field, Draw agents (Points, Glow).
  - `agentProgram` assembler option, `compilePassGraph` program kinds, `agentPlan.js`, `agentRunner.ts`.
  - Live + `renderAtTime`, purity rules, the Slime mold preset with comments.
  - The export warning.
- **P2 Particles.**
  - Force nodes (Gravity, Wind, Curl, Attract/Repel, Vortex, Flow, Collide), Integrate, Age/Life.
  - Emit Speed/Spread/Life/Burst; Draw Streaks, Ink and Lights.
  - The Particles preset and the Particles card line.
- **P3 Species, food and obstacles.**
  - Multi-species, Trail Add ƒ / Block ƒ, Move Obstacle ƒ, Emit from a picture or field, Memory.
  - Multi-species slime, Ants, Boids (field) and Strands presets.
  - The "what an agent here would see" eye preview; Show passes tint.
- **P4 Play.**
  - Sound kick and Chladni nodes plus group Sound from.
  - The pinned-slider overrides on the group card.
  - Motion (texture) source, hands/pose/null targets, Burst / Start over as rule targets.
- **P5 Websites.**
  - Runtime runs agents (after or with Pass phase 5); removed from `unsupportedFeatures`.
  - Parity test and browser sweep.
- **P6 More.**
  - More presets, "Open as nodes" on the Particles card, readings back into Play.
  - 3D (z in state, GP's camera and DoF in Draw, 3D Collide through the scene grid).
  - A Play layer hosting the same engine.

## 14. Tests

- **Zero-change (every phase):** golden shader, bundle and GP-engine-shader snapshots pass with **no** updates (P0 is the only phase that adds to them). Render-path sweep in the browser before and after. Vitest exit code checked before merging.
- **Compiler (`agentGraph.test.ts`):**
  - Program lists and order (pass → step → deposit → trail → draw → pass → final).
  - The Trail→group cycle is allowed and reads previous; any other cycle is an error.
  - Slugs are stable across programs.
  - The `agentProgram` prelude: `g_uv = a_pos`, unwired defaults bind `a_*`.
  - The birth block comes first; the sampler count includes state.
  - Every purity rejection, including the derivative/`gl_FragCoord` scan.
  - An empty group compiles to "keep state".
- **Nodes:** Sense's three sample points and Channels dot; Steer's Jones cases (all four branches) against a JS reference; Move's edges; Integrate against an analytic fall; By species selection. Each checked by a CPU mirror of the GLSL math (as GP's tests do).
- **Engine (`agentPlan` + runner):**
  - Fixed-step counting: live with stalls catches up to the same step n as offline.
  - Same seed gives an identical state readback after 120 steps, twice.
  - Offline matches live after 60 steps at 30/60/120 Hz frame rates.
  - `first` starts over; resize clears trails; dead texels stay dead outside the emit window.
- **Slime sanity:** after 300 steps at 64k, the trail's variance is far above that of a random walk with the same deposit (networks formed), as a smoke test that the rule is wired right.
- **Examples:** every Agents example and preset compiles; every node has a `__comment`; the vec-type check (`outputType`) passes.
- **Web (P5):** schedule parity; the exported page matches the app pixel-for-pixel after N steps on the same machine.

## 15. Open questions (recommended defaults)

1. **The group's name.** Play already has an **Agents** layer (CPU). *Recommend:* still call this the **Agents** group, in a **Simulation** category of the Studio node browser, and cross-link both docs ("for a million agents, use the Studio Agents group"). Users say "agents"; the places don't overlap.
2. **Particles node: keep, or convert to a sealed group?** *Recommend:* keep it as is, share its engine code, add a Particles preset and later "Open as nodes" (section 11).
3. **Units for Sense distance and Move speed.** *Recommend:* picture units (resolution-independent), with the card showing the equivalent in trail pixels. Presets are converted from Jones' pixel values at a 1024-row trail.
4. **Trail read inside the group: implicit "last step", or an explicit Previous output like Pass?** *Recommend:* implicit. It's the only meaning that works, and a "↺ last step" chip on the wire says so.
5. **Default steps per frame.** *Recommend:* 2 (slime grows at a watchable speed; 1M stays within budget).
6. **Default trail resolution.** *Recommend:* ½ of the picture, with a fixed 1024 available for picture-independent looks.
7. **Where Emit and Deposit live.** *Recommend:* outside, as chains, as specified. A per-agent deposit amount comes from Agent Output's Deposit socket, so rules like "ants only mark when carrying food" stay inside.
8. **Exact neighbour boids (spatial hash) or field boids?** *Recommend:* field boids in v1 (cheap, scales to 1M, looks right). The CPU Agents layer covers exact small flocks. Revisit a GPU sort-based hash after P6.
9. **When the GPU can't keep up: fewer steps (sim slows) or fewer agents?** *Recommend:* fewer steps run and the sim falls behind, keeping determinism. The count only changes by the user's hand.
10. **3D in v1?** *Recommend:* no. In 2D, state A's z slot holds the heading. P6 moves the heading into C (or derives it from velocity) and puts z back, the same layout as GP.
11. **Allow the March Loop / Scene inside a group?** *Recommend:* no in v1. 3D Collide later reads a Scene through GP's existing 48³ grid, outside the rule.
12. **Max groups per graph.** *Recommend:* 4. Revisit with the Performance rows.

## Side finding

`FIELD_IMPURE` in `compiler/fieldSockets.ts` does not list `gpuParticles`, although `docs/field-sockets.md` says particles are rejected from field chains. Check whether a Particles node upstream of a field socket is caught some other way. The agents purity rule (section 4) lists it explicitly either way.
