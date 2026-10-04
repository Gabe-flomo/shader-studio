# Agents group: slime mold and particles built from nodes (plan, 2026-10-03)

**Status:** P0, P1 (Slime), P2 (Particles), P3 (Species, food and obstacles), P4 (Play), P5 (Websites) and P6 without 3D (Open as nodes, readings into Play, three presets) shipped 2026-10-03/04; see "What shipped" below. 3D waits. User guide: docs/agents-group.md.

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

## What shipped (P0 + P1, 2026-10-03)

The open questions in §15 were answered as recommended: the Particles node stays as it is; Boids via the trail field (P3); no 3D in v1; trail ½ picture by default with fixed rows available; 2 steps a frame; at most 4 Agents groups per graph; under load fewer steps run, never fewer agents; the name is **Agents**, in a new **Simulation** category.

**P0 guards**
- `GP_SHADERS` exports the Particles engine's GLSL chunks unchanged; `src/play/__tests__/gpEngineShaders.test.ts` snapshots every one (cyrb53 + length). The Agents draw reuses `GP_DRAW_FRAG`, `GP_DOWN`, `GP_BLUR` and `GP_COMPOSE` byte for byte (only the `#version` line is dropped at use, because three.js adds its own).
- The golden-shader filter leaves out Agents-family graphs as it does Pass graphs. `goldenShaders.test.ts.snap` is unchanged through P0 and P1 (no entry added, removed or updated).
- The side finding was a real gap: nothing caught a Particles node in a field chain (it compiled, and its GPP_PROBE copy would put `return;` / `gl_FragColor` in a float field function). `gpuParticles` is now in `FIELD_IMPURE`, with a test.
- Not done in P0: moving curl, wind, shock, plate and sound code into shared chunks. Nothing in P1 needs them; they move with P2 (forces) and P4 (sound), under the same snapshot.

**P1 Slime**
- Types `agents`, `emitter`, `deposit` (wire colours in `typeColors.ts`). Nodes in `src/nodes/definitions/agents.ts`: Agents (group), Agent Inputs / Agent Output (anchored), Sense, Steer (Jones, Smooth, Away), Move (Wrap, Bounce, Slide), By species (floats), Emit (Fill and Rate; point, ring, disc, box, whole picture; facing random / inward / outward; Life ± and Share for chained Emits), Deposit, Trail field (diffuse + half-life, ½ / ¼ / full / 512 / 1024 / 2048 rows, wrap or clamp), Draw agents (Points and Glow, colour by single / species / speed / heading). The "Slime mold (preset)" starter.
- Compile: `compileGraph` branches on `hasPassNode || hasAgentsNode`. `compilePassGraph` (passGraph.ts, helpers in `agentGraph.ts`) cuts Trail and Draw as sources (that cut is also what makes the Trail → group loop legal), compiles each group's inside plus its outer port and Emit ancestors as one update shader under the new `agentProgram` assembler option (GLSL 3, two outputs, the agent prelude; applied to the finished text so the ordinary path is untouched), and returns `agents: { groups, deposits, trails, draws }` with each engine setting as a number or the uniform its slider writes. Passes that read a trail or a drawing draw after the agents (`afterAgents`); the others before.
- State: A = (pos.xy, heading, age), B = (vel.xy, speed, life; ≤ 0 is dead), RGBA32F, MRT. State C (species, memory, per-agent deposit) is not built: species is the index mod Species, which is all P1 needs.
- Rules (`agentRules.ts`): FIELD_IMPURE (except Play Layers), programs and engines, the 3D groups, and a scan of each node's emitted GLSL for `dFdx|dFdy|fwidth|gl_FragCoord`. Inside nodes refuse to be added outside a group (and outside nodes inside one) with a toast, and the compiler reports either placement on the card.
- Engine: `src/play/kit/agentPlan.js` (pure schedule: steps, birth windows, live stepping with fall-behind and re-anchoring, the governor; its frame budget is the display's own interval, so a 30 Hz display isn't load), `src/play/kit/agentShaders.js` (deposit, trail step, draw), `src/lib/agentRunner.ts` (three.js; `AgentTargets` per live preview and per offline render). ShaderCanvas runs pre-passes → steps → draws → post-passes → picture, only when the compile has agents.
- Determinism, checked in the browser (M3 Pro): the same render twice gives a bit-identical state after 120 steps; live runs at 30, 60 and 120 Hz, and one with a 150 ms stall, reach the same bits as the offline render.
- UI: Simulation category (Start here / Outside the group / Inside an Agents group), the group card (count · steps · "running at ×…", Open rule ↗, ↺ Start over, double-click to enter, its added ports as sockets), Agent Inputs' card with + Add Input (texture allowed), the "This runs once for every agent, every step." banner, the "↺ last step" chip on the Trail → group wire (and on the texture port's wire inside), Trail card thumbnail, Performance rows `agents:<label> step / deposit / trail / draw`.
- Website export: `unsupportedFeatures` lists "Agents groups: the page draws the picture without them".
- The Slime mold example and preset: every node, inside the group too, has a plain-language note; `examples.test.ts` checks it. The preset uses a 1024-row trail (½ at 1080p packs a million walkers into thick, uniform tubes) and an ordinary Expression Block ("Crowding", r·e^(−r/60)) between Sense and Steer, standing in for Jones' one-agent-per-cell exclusion; without it the network coarsens into a few loops within a minute.
- Performance (M3 Pro, 1M agents, 2 steps a frame, network formed): 5.8 ms a frame with the trail at ½ of 1080p (960 × 540); 9.5 ms with the preset's 1024 rows at 1080p (1820 × 1024). The update shader is about 0.9 ms a step and the trail step 0.2 ms; Deposit (one point per walker per step) is the rest, and it grows when walkers crowd into the same pixels (the first second of the preset, all walkers in a small disc, runs the governor down and the simulation falls behind, then catches its stride).
- Tests: `agentGraph.test.ts` (programs, prelude, sink, uniform names, empty group, rules), `agentNodes.test.ts` (each node's emitted GLSL run on the CPU by a small evaluator, `glslEval.ts`: Sense's points and channels, Steer's four Jones branches, Move's edges, By species), `agentPlan.test.ts` (fixed steps, windows, live catch-up and fall-behind, governor), `gpEngineShaders.test.ts`, the notes check, the field-socket check. The slime sanity check ran in the browser: after 300 steps at 64k the trail's coefficient of variation is 3.6 against 0.46 for a random walk with the same deposit.

**Deferred from P1** (with the phase that picks them up): Emit's picture / field shapes and Burst (P2/P3); state C, Memory, per-agent Deposit and Colour (P3); Trail Add ƒ / Block ƒ and the 5×5 kernel (P3); Draw Streaks, Ink and Lights (P2); pinned inner sliders on the group card and the live state thumbnail on it (P4); the eye preview inside the group and the Show passes tint (P3); Performance rows split per step are timed on each frame's first step only.

## What shipped (P2 Particles, 2026-10-04)

The user moved two of P4's nodes into P2: **Sound kick** and **Chladni** shipped here, each with its own Sound from (the group-level Sound from stays P4).

**Shared code (zero change for the Particles node)**
- `gpuParticles.js` exports the engine's forces, sound, plate and look as small GLSL generators (`gpCurlAt`, `gpCurlOctave2`, `gpCurlPlane`, `gpGust`, `gpSwirl`, `gpAttractPull`, `gpHandFall`, `gpHandPush`, `gpFlowPush`, `gpWavePhase`, `gpWavePush`, `gpVibrate`, `gpCrunch`, `gpShockRing`, `gpShockPush`, `gpLevelGlsl`, `gpBesselGlsl`, `gpPlateGlsl`, `gpPlateStep`, `gpPaletteGlsl`, `gpFade`, `GP_LIGHTS`). `GP_SIM` and `GP_DRAW_VERT` are now written with them; called with the engine's own names they give its text back exactly, so `gpEngineShaders.test.ts.snap` is unchanged (all 12 chunks). The Agents nodes call the same generators with their names (`agentForces.test.ts` checks both sides).
- The sound and plate state machines are the engine's own JS (`gpSoundStep`, `gpLevelsPush`, `gpRising`, `gpPlateListen`, `gpPlateTargets`, `gpPlateSmooth`, `gpPlateUniforms`, `gpBesselTable`), called by the agents runner once a step. `particleSoundOf` (Mic, the Audio engine) is shared from `gpuParticlesTexture.ts`.

**Nodes** (`src/nodes/definitions/agentForces.ts`; all inside the group)
- Forces, each with an **Also** (vec2) input they add to: **Gravity** (Angle or a Direction socket), **Wind** (gusts from the engine's noise), **Curl noise** (the engine's two-octave planar curl; Strength, Size, Evolve), **Attract / Repel** (the mouse, X/Y or a Target socket; Within Reach = the engine's hand force, Everywhere = its attractor; Swirl), **Vortex** (the engine's Swirl, strongest at Reach), **Flow** (Slope or Around a Field ƒ, read through the field function with central differences, no probe, no lag), **Sound kick** (Shockwave, Wave, Vibrate, Shake).
- **Integrate**: v += F/m·dt, v *= e^(−drag·dt), Max speed, p += v·dt; edges Free, Wrap, Bounce, Slide or Die (Alive output).
- **Age / Life**: Alive, Age, Age 0–1, the engine's Fade; Live for scales the life.
- **Collide** and **Chladni** move the walker directly after Integrate (Position, Velocity in and out), as the engine does: Collide puts it back on a Shape ƒ's surface, drops the inward velocity (Bounce, Friction) and has the engine's cushion; Chladni is the engine's sand step on a square or round plate (N and M, or the sound stepping the figure on).
- Listening nodes (Sound kick, Chladni) carry Sound from (Level and Beat / Mic / Audio engine / track), Level and **Beat**: a silent stand-in kick at a tempo, a pure function of the step's clock time (`agBeatLevel`), so a simulation driven by it is the same live and offline. Their uniforms are named by their slug (`u_agSnd_`, `u_agShk_`, `u_agLv_`, `u_agPlM_`, `u_agPlN_`, `u_agPlS_`, the shared `u_agBessel`); shared GLSL helpers take the per-node uniforms as arguments.

**Emit**: Births **Keep full** (everyone born at step 0 at a random age, each born again the moment it dies: the prelude's `a_born` also takes a dead texel; `a_step` is a new agent global), **Speed ±**, **Spread**, **Burst** (a trigger: everyone born again on the next step). **Draw agents**: Styles **Streaks** (two vertices an agent, gl.LINES, the engine's Thread) and **Ink** (absorbance, the engine's ink compose over Paper), the engine's **Lights** (up to 4, `gpPlace`, halos in the compose), Colour by Age, the engine's palettes, Fade with age, Brightness of The crowd (the engine's `gpUnitBrightness` / `gpUnitInk` and 720-row sizes). The Particles node's info card points at the Particles preset.

**Presets** (each also an example; every node, inside too, has a plain-language note; Expression Blocks explain each named line, which `examples.test.ts` now checks): **Particles** (ring, Keep full, Curl → Vortex → Attract (mouse) → Integrate → Agent Output with Age / Life; glow, Ember by age, 4 orbiting lights; an "Ember glow" Expression Block behind; pre-roll 4 s), **Curl smoke** (a "Rising heat" Expression Block as a force → Curl → Wind → Integrate; Ink streaks on paper; pre-roll 6 s), **Sound burst** (a "Spring back" Expression Block → Sound kick (Shockwave, Beat 120) → Curl → Integrate (bounce); Streaks by speed on Neon). All at 1M, 2 steps a frame.

**Measured** (M3 Pro, headless Chrome on ANGLE Metal, 1M particles, 2 steps a frame, the picture 1920 × 1080, each frame finished on the GPU): Particles 7.1 ms a frame (steps alone 1.6 ms, about 0.8 ms a step; the rest is the 1M-point glow draw), Curl smoke 7.1 ms, Sound burst 10.3 ms (2M-vertex streaks + glow; steps 1.5 ms), Slime mold 11.2 ms by the same method.

**Determinism** (checked in the browser for all four examples): two offline runs and live runs at 30, 60 and 120 Hz and at 60 Hz with a 150 ms stall reach bit-identical state A and B (FNV of the read-back floats), including the listener state (shock rings, level history) and the pre-roll.

**Deferred from P2**: the group-level Sound from (P4); Gust as a Sound kick mode (Wind's Gusts covers the look); a wired Level socket on Sound kick (the level must be known to the engine for hits, so it is a slider; map audio to it in Play); the "Audio input node" part of the Particles node's Graph source; Emit's picture / field shapes (P3); Streaks of the Particles node's 3D / depth of field (P6); the eye preview inside the group (P3); website pages still don't run agents (P5, the export warns).

## What shipped (P3 Species, food and obstacles, 2026-10-04)

**Per-walker state** (state C and D, §3.3). A group gets two more MRT outputs and samplers only when it needs them (`needsStateC`: Species above 1, or Agent Output's new **Memory** / **Deposit** / **Colour** wired, or Agent Inputs' new **Memory** / **Colour** read). C = (species, memory.xy, colour packed 8 bits a channel into one float's 24 exact bits), D = the walker's own deposit (vec4, one amount per trail channel). With it the species is the one its Emit gave it (Emit's new **Species**: Each in turn, or 1–4; chained Emits give each colony its own place) and kept for life, not the index mod N. Deposit draws D × Amount; Draw agents reads the species from C and gains **Colour by Agent** (C's colour). A group without it compiles exactly as P2 (two outputs, species from the index): the P1/P2 examples' update shaders differ from main only by one unused `uniform vec2 u_trail_<slug>_px;` declaration (below). The plan's 4 × 8-bit packed deposit became a full vec4 in D, so amounts aren't quantised (16 MB more at 1M, ×2 ping-pong).

**Food and obstacles.**
- **Trail field Add / Block**: wiring either gives the trail a step program of its own (`trailStepOut` sink, compiled with the ordinary compiler over the trail's texture, so g_uv is each trail pixel's place): spread and fade as before, then `+ Add × dt`, then `× (1 − Block)`. Their chains are left out of the picture program when only the trail needs them; Passes they read are live and draw before the agents. The step program runs at the step's own clock time (determinism). **Spread: 5×5** (1-4-6-4-1, one 25-tap pass) beside the 3×3 mean, which is P1's step exactly (shared `AG_TRAIL_MEAN_GLSL`).
- **Deposit What: Velocity** writes (vel × amount, amount, 0): the trail becomes a flow field with a count in its third channel; a trail fed by one keeps negative values (`signed`).
- **Move Obstacle ƒ** (an SDF field socket; outer chains through the group's ports work): **Turn back** (stays, turns round with a little randomness) or **Slide** (pushed out along the gradient, inward velocity dropped).
- **Emit Shape Picture / Field**: rejection sampling over the whole picture, 8 hashed tries, the first taken (else the best): Picture weighs each try by a texture's brightness (above Threshold), Field takes Where ƒ above Threshold.

**Fixes found on the way** (agent programs only; picture programs untouched): nodes that read `vUv` directly (UV, Text, a Pass's colour) read the state texel inside an update shader; they now read the agent's place (`a_vUv`, set from a_pos; applied in `toAgentProgram`). The sampling nodes (Sample, Blur, Glow, Edges (texture)) need `<sampler>_px`, which Trail and Draw agents didn't declare: a Sample on a Trail failed to compile. Both now declare it and the runner sets it to one picture pixel.

**Eye preview inside a group** (§12): the eye on an inside node compiles that node and the inside nodes it depends on into the picture program (`agentEyeNodes`, marked `__agentEye`; assembler option `agentEye` declares the agent globals and sets them to an agent standing at the pixel: a_pos = g_uv, heading 0, species 0, newborn, nothing remembered). Added ports are rewired to the outer sources, so a Sense on the trail shows this frame's trail through its three sensors; the rest of the graph stays, so the simulation keeps running under the preview.

**Show passes** (the toolbar's layers button, offered when a graph compiles into more than one program): each card gets a ring and a chip in its program's colour: Pass n (cool), **Agents: <group>** (amber; the group's inside and outer port chains, Deposit, Trail and its step chain, Draw) and Picture (green); a node compiled into two programs is striped ("Runs in 2 programs"). The compile result gains `finalNodeIds`, trails `stepNodeIds` (`lib/programTints.ts`). The Pass node's own phase 3 (probes and scopes in pass programs) is still not built.

**Presets** (each also an example, every node with a note, Expression Blocks explaining each named line):
- **Multi-species slime** (`agentMultiSlime`): 1M, 3 species from three chained Emits (coral, teal, violet discs), Sense's default Channels (+1 own, −0.5 others), Crowding, **By species** speeds, one Deposit, a 3-channel Trail, a "Three colours" block. Colonies grow toward each other and carve stable, shifting territories.
- **Ants** (`agentAnts`): 256k, 3 steps a frame, Keep full (life 30 s) from a nest. "Nest and food" and "Rocks" blocks outside feed the group's Places and Rocks ports (Move's Obstacle ƒ), the Trail's Block and the picture. An "Ant rule" block sets Memory (carrying, seconds since its source), Deposit (home smell searching, food smell carrying, weaker the longer it walked), Colour and a weak homing lean; "Which smell" picks Sense's Channels. Roads form from the nest to all three food piles within ~20 s and bend round the rocks; a long loop straightens into the short path.
- **Boids** (`agentBoids`): 256k, Deposit Velocity into a ½-res 5×5 signed Trail; inside, Sample (texture) gives the flow, Sense the crowd's gradient (a "Count channel" block), a "Flock" block (align, cohere/separate past Packed, cruise; four sliders) → Curl breeze → Integrate (wrap). Streaks by heading over an evening sky: flocks gather, wheel and stream past each other.
- **Strands** (`agentStrands`): 1M slime with far, narrow sensors (0.06, 15°), Turn 12°, Crowding (Sat 20) and a slow curl-noise drift into Move's Also velocity; Ink streaks on warm paper. Without the drift and Crowding it coarsened into one rope within 20 s.
- **Grow toward a picture** (`agentGrowPicture`): 1M slime; a built-in "Moonlit picture" (moon, ridge rim, stars) or a Texture Input ("Yours" slider), Food = brightness², painted into the trail's second channel by Add, walkers born on it (Emit Field), Sense smells both channels (a "Smell both" block), the picture shows only the slime's own channel coloured by the picture. The moon fills with a labyrinth, the ridge is traced in orange, stars become nodes.

**Determinism** (browser, M3 Pro, ANGLE Metal): for all five, two offline runs and live runs at 30, 60, 120 Hz and 60 Hz with a 150 ms stall reach bit-identical state A, B, C and D and trail texture (FNV of the read-back), Ants' 20 s pre-roll and trail step program included. Slime mold re-checked unchanged.

**Measured** (M3 Pro, 1920 × 1080, each frame GPU-synced, every preset forced to 1M): Multi-species slime 11.8 ms a frame; Ants 14.2 ms (3 steps; steps alone 11.9 ms: a million ants crowd onto three roads and Deposit's overlapping points dominate); Boids 15.7 ms (steps 8.8 ms, the rest 2M-vertex streaks + glow); Strands 18.2 ms (steps 9.7 ms, the rest ink streaks); Grow toward a picture 10.3 ms; Slime mold 9.2 ms (unchanged). As shipped, Ants (256k) is 3.5 ms and Boids (256k) 3.9 ms.

**Deferred from P3**: a separable two-pass 5×5 (one 25-tap pass is cheap enough at trail sizes); Emit Picture / Field limited to a region (it samples the whole picture); Show passes for programs inside groups other than Agents and the Pass node's phase 3 inspection; per-walker colour packing beyond 8 bits; exact neighbour boids (field boids as agreed).

## What shipped (P4 Play, 2026-10-04)

**Group Sound from.** The Agents group's new Sound section: **Sound from** (*Each node's own*, the default and every group saved before; or Level and Beat / Mic / Audio engine / Engine track 1–8), **Level**, **Beat**. When set, `listenersOf` (agentGraph.ts, through `groupSound`) hands every Sound kick and Chladni inside the group's choice and the group's Level and Beat uniforms; the runner's `hear` is unchanged, so the Particles engine's `gpSoundStep` / `gpLevelsPush` run as they were (gpEngineShaders snapshot untouched). The update shader doesn't change with it (tested). Checked in the browser: the group's Beat 120 drives a kick whose own Beat is 0; Engine track 1 is what the runner asks the host for (a stand-in spectrum on `host.sound`, no audio played, gives a hit every 0.5 s).

**Inner sliders in Play.** `collectParamCandidates` and the colour walk go one level into an Agents group as into a plain group, so every live inner slider is a Play candidate (`group::inner::key`, bound by its last two parts to the update shader's uniform): Add control, Map to…, the right-click Play menu inside the group, Drive with a null. The store's override sync (`group::inner::key` written into the inner node too) now covers `agentsGroup`, so Play writes, pins and the inner card always agree.

**Pinned sliders and the live dots.** `params.pinned` (`inner::key` paths; `nodes/agentPins.ts`): the group card lists them under a thumbnail of the walkers (`agentThumbRegistry`; the runner draws at most 65,536 of them as additive points every tenth frame while the card is mounted, ~0.7 ms with its read-back). Right-click a slider inside → Pin to the group card / Unpin; right-click a pinned row for the inner slider's Play menu. The presets pin nothing (their group params change by the new defaults only).

**Hands into targets.** Attract / Repel Target, Vortex Centre at (new select, default X and Y) and Emit At (new, default X and Y) gain **A hand or null**: Hand X / Y in 0–1 across and up (`agHandPlace`, the Particles node's hand units, aspect-correct), so a position pair maps a hand, null, pose or pointer straight onto them. **Follow a hand in Play** (`play/followHand.ts`, on the right-click Play menu and the phone's slider settings) is the Particles node's "Add as position with Y" flow finished in one step: both controls, a position pair, and two pair mappings, the pointer then `hand:any:8` (the later wins once a hand has been seen). The defaults generate the same GLSL as before.

**Triggers.** The group gains **Start over** (a trigger slider: rising past 0.5 restarts the live simulation, as ↺ does; offline renders ignore it). Emit's Burst was already one. Checked on the Play page: R → Start over restarts at step 0; B → Burst.

**Motion (texture).** A new Sources node (`nodes/definitions/motionMap.ts`): Amount (0–1, × Gain) at UV and the grid as a `texture` (`u_motionMap`, with `_px` for the sampling nodes). The kit's `motionGrid(id)` exposes a Motion layer's grid; `play/motionTexture.ts` copies the first one into an 8-bit texture after each overlay frame (row-flipped so it covers the picture like a Pass), and ShaderCanvas refreshes it when the picture, a pass, an update shader or a trail step program reads it (and keeps drawing while one does). Not in FIELD_IMPURE (a texture read at a point). Web pages: `unsupportedFeatures` lists it (the page reads it as still). Checked in the browser: the texture equals the kit's grid cell for cell; an Emit with Shape Picture ← Motion (texture) gives birth along a moving dot a Motion layer watches.

**Example** (Play, *Agents in Play* → **Agents: a hand and a beat**, `agentsHandBeat`; graph in `store/agentPlayExample.ts`): a 1M "Hand swarm" (Home → Sound kick → Curl → Attract (hand) → Integrate; Age / Life; neon streaks), group Sound from Engine track 1 with the Kick rack and a two-bar clip, the Hand pair (pointer, then a hand), Fist → Hand strength −2.5, B → Burst, R → Start over, four pinned sliders. Every node, inside too, has a note; the Play notes explain every control and rule.

**Zero change.** `goldenShaders.test.ts.snap` and `gpEngineShaders.test.ts.snap` are untouched; the only snapshot change is one added Play golden-outputs entry (the new example). Every P1–P3 Agents example compiles to byte-identical programs on this branch and on main (final picture, update shaders, trail step programs, listeners, emit, deposit and draw specs); the group's spec gains a `restart` engine param and its binding, no GLSL.

**Determinism** (browser, M3 Pro): the example (silent engine) and Sound burst reach bit-identical state offline twice and live at 30, 60, 120 Hz and with a stall; so does the example with the group's own Beat 120.

**Measured** (1M, 1920 × 1080, GPU-synced, same session, alternating): Slime mold 10.0 / 9.5 ms a frame on this branch against 10.1 on main, Particles 6.7 / 6.6 against 7.5, Sound burst 8.3 / 7.9 against 8.9 / 8.4: unchanged within the machine's noise (the programs are identical). The example 12–13 ms (Sound burst's streaks plus the hand).

**Deferred from P4**: readings back into Play (alive share, centroid: P6); the Particles node's own spawn map from Motion (texture); choosing which Motion layer (it reads the first); Motion (texture) on web pages (P5 with the rest of agents); a wired Level socket on the group.

## What shipped (P5 Websites, 2026-10-04)

Built on the Pass node's phase 5 (pages run Pass programs on one uniform table, `kit/passHost.js`, shipped first in the same PR).

**Shared, so the hosts can't drift.** The per-frame logic that was inside `lib/agentRunner.ts` moved into `kit/agentPlan.js` as pure functions both hosts call: `agGroupSteps` (Burst and Start over edges, live stepping with the governor's cap and fall-behind, offline exact steps, start over), `agStepWindow` (birth windows and Burst), `agGroupState` / `agRestartGroup`, `agListenState` / `agHear` (Sound kick and Chladni: the Particles engine's `gpSoundStep`, `gpLevelsPush`, `gpPlate*` as they were), `agDrawLook` (size, brightness, The crowd, palette, colours, glow) and `agLights`. The app's runner calls them and gives bit-identical state to main (offline twice and live at 30 / 60 / 120 Hz and with a stall, for Slime mold, Ants, Multi-species slime, Particles, Sound burst and the hand-and-beat example: FNV hashes of state A, B, C, D and the trail equal to main's, checked in the browser by swapping main's runner back in). `agentPlan.js` now imports from `gpuParticles.js`; the GLSL is `kit/agentShaders.js` (and through it `GP_SHADERS`) unchanged: `gpEngineShaders.test.ts.snap` untouched.

**The page's host** (`kit/agentHost.js`, `ahCreate`, `SSKit.agents`): raw WebGL2 on the page's context. RGBA32F MRT state (A, B; C, D with per-walker state), half-float trails (wrap or clamp) and drawings, the glow targets, the Bessel table and each kick's level history (R32F). One step in Jones' order: every group's update shader (at the step's own `u_time`, its `u_agStep` as a uint, its birth window, its listeners' uniforms) → every Deposit (additive points) → every Trail's step (the fixed 3×3 / 5×5 program, or the Trail's own Add / Block program) → Draw agents (points or streaks, then the Particles engine's down / blur / compose). Each uniform is set by its declared type (as three.js does). Offline (a page's `renderAt`, its captures and Present stills): exactly the steps to each frame's time; `renderAt` starts the simulation over. Live: the governor and fall-behind of `agentPlan.js`.

**The bundle** gains `agents` (and `motionMap`) only when present (`webInput.ts webAgents`): the spec without node lists, each part with the uniform names it fills, from `nodes/definitions/agents.ts` and `agentForces.ts` (the page never builds a name). Other bundles serialize as before: the golden bundle snapshots are unchanged. `unsupportedFeatures` no longer lists Agents groups or Motion (texture).

**The runtime** draws, per frame, as ShaderCanvas does: the passes the agents read (`pre`), the agents, the passes that read trails or drawings (`post`), then the picture. Update shaders and Trail step programs read every input the picture has (one uniform table, as in the app). The graph's extra programs (passes, update shaders, Trail steps) are drawn exactly as the app draws them: three's `PlaneGeometry(2, 2)` (its diagonal and vertex order) through the compile's `VERTEX_SHADER` (vUv from the uv attribute) with three's precisions. That was needed: with the page's own quad (the other diagonal) vUv differed by an ulp on one triangle, which Grow toward a picture's Trail step (it reads the picture through vUv) turned into a different simulation within a few seconds. The picture's own program keeps its path (existing pages unchanged).
- **Sound:** Sound from Mic is the page's live input (after Listen to audio); Audio engine / Engine track is the page's Granulator racks (`gpSoundIn`, the Particles node's). The page doesn't play the tape, so a track whose sound comes from clips is silent there (the hand-and-beat example's kicks need notes on the page); its other controls work.
- **Hands:** through the page's mappings (Follow a hand's pair mappings: the pointer, then `hand:any:8` once a hand is seen), with the page's hand tracker when it carries one, else the pointer. Checked: the pointer steers the swarm on the exported example, R starts it over, B bursts.
- **Motion (texture):** the page fills `u_motionMap` (and its `_px`) from the kit's `motionGrid` of its first Motion layer, row-flipped, a frame late, as `play/motionTexture.ts`. Checked: a hidden dot swept by an LFO and watched by a Motion layer; the exported page's walkers are born where it moves.
- **Scripted checks:** the page's mount handle gains `programs()` (the context and the pass and agent hosts; the agent host's `state()`), used by the parity sweep.

**Parity** (`src/play/__tests__/webAgents.test.ts`): the app's `AgentRunner` and the page's host, each on a recording stand-in for its GPU, run the same programs in the same order with the same step numbers, birth windows, step clocks, listener values and draw counts, live at 60 Hz through a stall and the governor and offline, for Slime mold, Sound burst, Particles and Ants; plus the bundle, the names and the shared functions. In the browser (M3 Pro, headless Chrome on ANGLE Metal, 960 × 540): the app's offline render and the exported page's `renderAt` reach **bit-identical simulation state** (A, B, C, D and every trail) for all ten agents examples and a round Chladni plate (Bessel table, Beat-driven figure), frame by frame to 2 s (up to 1,560 steps with Ants' pre-roll); their pictures after 3 s differ by at most 2 levels of 255 (the app's readback dither) for every one, and for both Pass graphs.

**Measured** (same session, 1M walkers, 1920 × 1080, each frame GPU-synced): the page's engine against the app's: Slime mold 13.3 / 12.9 ms, Particles 9.8 / 9.3, Sound burst 10.7 / 10.3, Agents: a hand and a beat 9.6 / 12.2. Exported pages running live (headless Chrome, 1920 × 993 background page and 1620 × 993 player): Slime mold and Sound burst hold 60 fps with 120 steps a second (keeping up).

**Deferred from P5**: the tape (Audio engine clips) on pages; choosing which Motion layer (the first, as in the app); a Particles node reading a texture inside a pass or update program (the app doesn't either).


## What shipped (P6, no 3D, 2026-10-04)

The user decided 3D waits: everything in P6 except 3D (z in state, the Particles node's camera and depth of field in Draw, 3D Collide through the scene grid) and the Play layer hosting the same engine.

**Open as nodes** (the Particles card, under its presets; `store/particlesAsNodes.ts`, store action `openParticlesAsNodes`). One undoable change builds an Agents-group copy of the node's current settings under it and rewires what read the Particles node to the copy's Draw agents (Color → Color, Density → Density; Particles → Color when Over is unwired). The Particles node itself is left as it was (it is now wired to nothing; delete it when happy). Every node it adds has a note naming the settings it carries.
- Mapped: Count, Emitter (Point and Line facing up, Ring and Disc outward, Box random; Sphere and Ball become a Disc), Emitter size, Life (± half, the engine's), Speed (± 0.45), Spread, Burst; Gravity, Wind (its gusts from the same noise), Turbulence and Turbulence size (Curl noise, Evolve 0.15 = the engine's noise clock), Swirl (Vortex at the emitter, reach 0.5), Attract (Everywhere, at the centre or the mouse), Drag (Integrate, no speed limit), Hands (one Attract within reach per hand, at Hand X / Y or a wired position), Flow (Flow node, Slope or Around), Obstacle (Collide, SDF or Mask through a "Mask to distance" block), Pattern (Chladni with every plate setting), Wave / Vibrate / Shockwave / Crunch (a Sound kick each: Wave, Vibrate, Shockwave at 1.4, Shake), Sound from and Sound level (the group's Sound from and Level), Mouse moves Emitter (a Mouse node into Emit and the group's Emitter port) or Attractor; Look (Light → Glow, Thread → Streaks, Ink → Ink with its colour and paper), Size, Brightness (× 0.7: every walker is alive at once), Glow, Colours, Colour by, Lights (count, colour, power, reach, halo, motion, the orbit from the emitter size); pre-roll min(6, 1.5 × Life) as the engine's; Steps per frame 1 (the node's own pace).
- Wired sockets: Over → Draw agents' Over; Emitter → Emit's Position and a group port for Vortex and the Sound kicks; Hand / Hand 2, Flow, Obstacle and every wired setting a force has a socket for (Gravity, Wind, Turbulence, Swirl, Attract, Drag, Hand pull, Flow force, Wave, Vibrate, Shockwave, Crunch) → ports on Agent Inputs.
- Not carried yet, listed in the toast and kept in the group's note: 3D (Space, the camera, Drift, Focus, Blur, Camera from / ray, Depth, Scene), Sphere / Ball as 3D shapes, the Image emitter holding its picture (the copy is born on the picture's bright parts: a Texture Input with the picture copied in, Emit Field, "Not born this time"; no homes, no Release, not the picture's colours), Emit Burst mode (all together every Life), Gust, Jet, Mouse moves A light, UV, a moving emitter's plate and lights, Sound from Graph's Audio input node (map it to the group's Level), and wired settings whose node has only a slider (Emit's, Draw's, Turbulence size, Hand swirl, Chladni's; their value is set).
- To make the copy match, small additions that change no existing program: Emit's Shape **Line** and Facing **Up**; Draw agents' Colour by **Speed, fast first** and **Heading, once round** (the Particles engine's own formulas, `u_colorBy` 6 and 7 in `AG_DRAW_VERT`). Checked in the browser on eight Particles examples (Flow drift, Chladni sand, Round shape, Ink in water, Sound field, Star outline, Galaxy, Rain): the copy's frames match the node's in structure and colour (flow structures, the plate figure, the wake round the shape), 2D and silence aside.
- A compiler fix found on the way: a node left in the picture program (the original Particles node, wired to nothing) that reads a node only a group's program needs (its Emitter wire, now also the copy's Emit's) got `vec2(undefined)`. `compilePassGraph` now keeps the ancestors of every node the picture program keeps; graphs that compiled before compile the same (checked below).

**Readings back into Play** (`lib/agentReadings.ts`, `kit/agentPlan.js` `agReadPlan` / `agReadDecode`, `kit/agentShaders.js` `AG_READ_FRAG` / `AG_SUM_FRAG`). An Agents group reads like a layer on the sensor layer `ag:<group node id>`: Alive (share alive), Speed (mean, 1 at a picture height a second), Spread (0 in one place, 1 spread evenly), Centre X / Y (0–1), Group 1–4 (each species' share of the live walkers): the CPU Agents layer's names. Only what is read is computed: a Play read (a mapping source, a rule condition `read:ag:…`, a meter) marks the group wanted for 2 s, and the live runner then sums its state on the GPU (8 × 8 blocks a pass into two halves, 1M walkers: 128² → 16² → 2² → 1 texel each) and reads 2 × 1 texels back with the Particles engine's `gpReadback` (a pixel buffer and a fence, one in flight; nothing waits). The values are the live simulation's, a frame or two late; a take records what its mappings made of them. Lists: the mapping drawer's Layer sensor picker (*<group> · walkers*), the rule condition picker (*Agents groups*), labels everywhere. Web pages: the bundle marks a group `readAs` only when its Play reads it (other bundles unchanged), the page's host sums it the same way and the runtime sets the sensors.
- Checked in the browser: GPU readings against the same numbers worked out on the CPU from a read-back of the live state agree within 4 × 10⁻⁸ (Multi-species slime with per-walker species, Sound burst, Mycelium); the first reading arrives one or two frames after the first read. App and exported page: a control mapped from Sound burst's Centre X drives Draw agents' Brightness to 2 × 0.49 in both.
- Cost: within the noise at 1M (Slime mold 9.9 / 10.2 ms a frame with / without, Galaxy 7.0 / 7.0, Multi-species slime 10.7 / 11.0; same session, alternating blocks).
- Side finding, fixed: Play's record parser dropped sensor sources reading Centre X / Y or Group 1–4 (the CPU Agents layer's readings too) because they weren't in its list of known reads.

**Presets** (each also an example, every node, inside too, with a note; Expression Blocks explain each named line; `agentExamplesP6.ts`):
- **Galaxy** (`agentGalaxy`): 1M stars, each on its own circular orbit kept in Memory (the radius it was born at), with a flat rotation curve; an "Orbit and arms" block bends every orbit by a two-armed log spiral that turns slowly, so stars crowd into arms they stream through (a density wave), and lights the crowded stars blue (young stars, a few pink knots) against warm bulge stars. Two chained Emits (bulge and disc), glow by Agent colour over a faint core haze. Stable for ever (no integration drift: the orbit is exact).
- **Mycelium** (`agentMycelium`): 64k room, about a thousand growing tips at once (Rate 200, Life 5). Tips shy away from threads (Steer Away) and drift outward; new tips sprout on the young, thin threads at the colony's edge: Emit Shape Field with Where ƒ = "Young threads" (a·(1−a)·4 of the Trail's own Amount) and Emit's new **No place found: Not born this time**, chained with a tiny spore share. The colony starts slowly, then branches outward into a fuzzy mould disc over about a minute; threads last (half-life 60 s); tips glow faintly.
- **Sand on a plate** (`agentSandPlate`): 1M grains poured over a square plate (Emit Box), Chladni alone inside (Modes 3, Mode from Sound) hearing the group's Sound from Level and Beat 20: every kick steps the figure on and the sand runs to the new lines. Gold by speed (resting grains pale, running ones amber) over a brushed metal plate.
- Tried and left out: Rain on glass (the streaks read as falling rain, not drops on a pane, after four tunings).
- Emit's **No place found** (Picture / Field shapes): Born at the best try (the default; the GLSL is as before) or Not born this time (dead, so Keep full tries again the next step).

**Zero change.** `goldenShaders.test.ts.snap` and `gpEngineShaders.test.ts.snap` are untouched (no entry added, removed or updated). Every existing multi-program example (all nine Agents examples, the hand-and-beat Play example in both its forms, the Pass example) compiles to byte-identical results on this branch and on main: final picture, pass programs, update shaders, Trail step programs, the whole agents spec, uniforms and bindings (a dump of all twelve compared key by key). The engine shaders gain two branches (Draw's colour orders 6 and 7) and two new programs (readings), used only when asked for.

**Determinism** (browser, M3 Pro, ANGLE Metal): Galaxy, Mycelium and Sand on a plate reach bit-identical state A, B, C (Galaxy's memory and colour) and trail offline twice and live at 30, 60, 120 Hz and 60 Hz with a 150 ms stall (FNV of the read-back), at 2 s and again at 8 s (Mycelium, its branching births) and 7 s (Sand, two beats).

**Measured** (1920 × 1080, GPU-synced, as shipped): Galaxy 1M 6.9 ms a frame (steps 2.2 ms, the rest the 1M glow draw), Mycelium 64k 1.8 ms (steps 1.4 ms: the 1024-row trail), Sand on a plate 1M 5.6 ms (steps 1.5 ms).

**Deferred from P6**: 3D (z in the state, the camera and depth of field in Draw agents, 3D Collide through the scene grid); a Play layer hosting the engine; the Image emitter holding its picture (homes, Release); Gust and Jet as nodes; per-socket wiring for Emit's and Draw's settings; readings of a Trail (how much trail there is, where); Rain on glass.

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
- **Readings (P6, shipped).** Alive share, centre, spread, mean speed and each species' share, by a reduction to 2 × 1 texels read back with GP's `gpReadback` (a frame or two late), only while Play reads them: sensors on `ag:<group node id>` in the mapping and rule pickers.

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

- **Until P5:** `unsupportedFeatures` lists "Agents groups: the page draws the picture without them". Export warns rather than silently differing. (P5 shipped: the line is gone; see What shipped (P5).)
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

More in P6: Sand on a plate (Chladni), Sound field (Sound kick), Food from a picture (Trail Add ƒ = an image), Walls (Move Obstacle ƒ = text SDF), Hand slime. Shipped in P6: Galaxy, Mycelium and Sand on a plate (Grow toward a picture is the food-from-a-picture one, P3).

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
- **P5 Websites.** *(Built: see What shipped (P5).)*
  - Runtime runs agents (after or with Pass phase 5); removed from `unsupportedFeatures`.
  - Parity test and browser sweep.
- **P6 More.** *(Built without 3D: see What shipped (P6, no 3D).)*
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
