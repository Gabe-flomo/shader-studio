# GPU particles, TouchDesigner style (plan, 2026-10-03)

**Status:** P0 and P2 shipped, most of P1, P3, P4 and P5 in the creative-controls follow-up (see [What shipped](#what-shipped) and [creative controls](#what-shipped-creative-controls-stacked-on-the-node-above)), then Chladni plates (see [Chladni plates](#what-shipped-chladni-plates-pattern)). The plan below is as written; the Particles node follows it except where What shipped says otherwise.

## Why

Today's GPU particles (`pInit → … → pRender`, `src/nodes/definitions/pnodes.ts`, `src/compiler/particleAssembler.ts`) don't simulate:
- Each particle is a fixed start position moved by time alone (rotate and wave).
- At most 10k.
- Drawn after the picture is dithered to 8-bit, with a perspective camera that doesn't line up with the picture or Play.
- Invisible to the graph and to Finish's bloom.

The Play particles layer is a separate CPU 2D system (5k cap).

## How TouchDesigner does it

- Particle state lives in float textures (one texel per particle, 1024² ≈ 1M), updated by a GLSL pass with feedback, and drawn by instancing from those textures.
- POPs (2025) give a Particle POP (birth rate, life, drag, initial velocity, pre-roll), Force POP (radial, axial, spiral, planar, gravity, wind), Noise POP (curl noise) and Field POP (masks).
- Lights are point lights with distance falloff; the look is additive particles plus bloom.

## Design: one engine

- **Engine:** `src/play/kit/gpuParticles.js`, plain WebGL2 in the layer kit (like `jfa.js`). The app, takes, offline renders and website exports share it.
- **Context:** runs on ShaderCanvas's GL context.
- **State:** two RGBA32F ping-pong pairs (`pos.xyz + age`, `vel.xyz + life`), updated by one fullscreen pass with two render targets.
- **Drawing:** one draw call reading the state with `texelFetch(gl_VertexID)`.
- **Emission:** a ring index (texels `[head, head + n)` reborn each frame).
- **Determinism:** fixed substeps, hashed randomness on the setup's clock, pre-roll.
- **Compositing:** particles draw into a half-float HDR target, added into the picture before the dither. The graph can read them (`color` and `density` outputs).

## Phases (each ships)

- **P0 Engine and node:** a single "Particles" node.
  - Emit: point, sphere, ball, box, disk, ring and line shapes; count tier; rate or burst; life ± variance; speed and spread.
  - Forces: gravity and wind, drag, curl noise, up to 8 attractors (attract, repel, orbit), vortex.
  - Look: additive soft points in picture space.
  - The `P:` chain is deprecated and its examples migrated.
- **P1 Look:** points, sprites (soft, glow, ring, image) and streaks; colour over life (palette), by speed or by heading; size over life and by speed; add, screen or soft alpha; built-in particle glow.
- **P2 Lights:**
  - Up to 4 point lights: colour, intensity, radius, falloff.
  - Particles brighten by distance: `Σ colour · I / (1 + (d/r)²)`.
  - Scatter flares size and brightness near a light, and a light can draw a halo.
  - Lights follow nulls, hands or the mouse.
- **P3 Emitters and fields:**
  - Emit from the picture (the graph's output, an image or video, Layers), weighted by brightness and taking its colour.
  - Emit from a mesh or an SDF's surface.
  - The picture as a flow or gradient field; bounce off bright parts; bounds wrap, kill or bounce.
- **P4 Graph and Play:**
  - `color` and `density` textures as graph outputs.
  - Every number can be mapped.
  - Attractors and lights follow nulls, hands, pose or the mouse.
  - Burst, Scatter and Reset actions; audio drives rate and force.
- **P5 3D:** instanced shapes aligned to velocity, an optional 3D camera, a presets gallery.

## Presets

Ember swarm, Galaxy, Picture dust, Hand sparks, Firefly light, Smoke ribbons, Audio burst, Waterfall.

## Budget

- **Tiers:** 64k / 256k / 1M / 4M.
- **Cost:** 1M is about 1 ms to simulate and 2–4 ms to draw at 1080p on Apple silicon.
- **Fill rate** is the real limit: sprite size is clamped by count, and particles render at the preview resolution.
- **Auto-downgrade:** the `gpuTimer` drops a tier when frames run long.
- **Fallbacks:** RGBA16F state where float targets are missing; 256k and points only on phones.

## Decisions (recommended)

1. A graph node first, then a Play layer reading the same engine.
2. Picture space, 3D as an option.
3. Deprecate the `P:` chain and migrate its examples.
4. Default 256k, 1M one click away.
5. Built-in particle glow plus Finish bloom.
6. No alpha sorting.
7. Four point lights, no shadows.

## What shipped

**The Particles node** (`gpuParticles`, Particles category; `src/nodes/definitions/gpuParticles.ts`). Wire a picture into **Over** and **Color** into the output; **Particles** is the light alone and **Density** about how many cover a pixel. **UV** moves where the node reads, so a warp bends the particles too. The defaults are 256k particles from a ring, curled by turbulence and swirled, in the Ember colours, lit by four orbiting lights with a built-in glow.

Settings (few, flat, each with a hint):

- **Emit:** Count (64k / 256k / 1M / 4M), Emitter (point, line, ring, disc, sphere, ball, box), Emit (stream / burst), Emitter size, Life, Speed, Spread.
- **Motion:** Gravity, Turbulence (curl noise), Swirl, Attract (negative repels), Drag, Mouse moves (nothing / emitter / attractor / a light).
- **Look:** Size, Brightness, Colours (Ember, Ice, Aurora, Neon, Gold, Mono, Rainbow), Colour by (life, speed, heading), Glow.
- **Lights:** Lights (off, 1–4), Light colour (the others are its neighbours on the colour wheel), Light power, Light reach, Halo, Light motion (orbit / still). Hidden while Lights is off.

**Engine** (`src/play/kit/gpuParticles.js`, prefix `gp`, in the layer kit, so web exports inline it):

- State: two RGBA32F ping-pong pairs (`pos.xyz + age`, `vel.xyz + life`), one texel a particle, updated by one fullscreen pass with two render targets. RGBA16F where only `EXT_color_buffer_half_float` exists (coarser: slow particles may stall); without either, or without WebGL2, the node passes Over through and the app shows a notice once (`gpUnsupported`); the web page logs it.
- Emission: a ring window `[head, head + n)` (`gpEmit`); a stream turns the pool over once a longest life (life × 1.5), so nothing is reborn while alive; a burst rebirths the whole pool every longest life.
- Steps: a frame's dt (≤ 0.1 s) in equal substeps of ≤ 1/60 s, at most 4 (2 above 256k, 1 above 1M: a slow frame must not make the next slower). Randomness is hashed from the index and the substep count. Going back in time (↺, a seek, a new render) starts over with a pre-roll (up to 6 s), so the cloud starts full.
- Forces: gravity, curl noise (two octaves of gradient noise with analytic derivatives, curl in the picture plane), swirl round the emitter, an attractor, drag.
- Drawing: one `drawArrays(POINTS, N)` with `texelFetch(gl_VertexID)`, soft points added into an RGBA16F target. Sizes are pixels of a 720-high picture, capped at 8 above 256k and 3 above 1M; per-particle light falls as the count grows (`gpUnitBrightness`).
- Lights (P2): `Σ colour · power / (1 + (d/reach)²)` brightens each particle (ambient 0.22 while any light is on) and scatter grows it near a light; each light draws a halo. Lights orbit or stand round the emitter, or one follows the mouse.
- Glow (P1): the particles at 1/4 and 1/16 size, each blurred (9 taps across and down), added back; then the halos. The result (rgb, density) is the node's texture, read before the dither.

**Graph and hosts:**

- The node declares its sampler through a new `NodeDefinition.declarationsFor` hook (the assembler adds per-instance top-level declarations); the line carries the node's settings as JSON after `// gpu-particles `. Number settings stay uniforms (`u_p_<slug>_<key>`), so a slider, a Play control or a mapping drives the engine without a recompile; the engine reads them from the material (app) or `uniformValues` (web). A keyframed number falls back to its default.
- App: `src/play/gpuParticlesTexture.ts` runs a `gpHost` on ShaderCanvas's renderer before each drawn frame (after `renderer.resetState()`, as an `ExternalTexture`), steps only while the clock runs, starts over on ↺ and on Rebuild/context restore, and draws offline renders (Export) a frame at a time from a fresh start.
- Web runtime (`play-runtime.js`): the same host on the page's WebGL2 context, before each picture; `renderAt` starts it over.
- The `P:` chain (pInit … pRender), Particle System (vParticles) and Particle Emitter were removed in 2026.10.5, with their compiler (`particleAssembler.ts`), the preview's three.js points pass and the web runtime's particle pass. Their examples use the Particles node; a saved graph that still holds one loads and its card and compile error say "<name> was removed — use the Particles node" (`src/nodes/definitions/removedNodes.ts`).

**Measured** (Apple silicon, 608 × 756 preview): 256k and 1M about 2 ms a frame for the engine. 4M costs ~20–30 ms standalone but dropped the preview to a few fps in the app here; it is offered as the "fast GPU" tier.

## What shipped: creative controls (stacked on the node above)

The node grew from a glow emitter into a creative tool. Everything below is in the same engine (`src/play/kit/gpuParticles.js`), so the app and web exports match.

**Card.**
- **Presets** (a chip row, `ParticlePresets.tsx`, data in `GP_PRESETS`): Ink in water, Embers, Dust in air, Image dissolve, Sound field, Launch, Chladni sand, Singing plate, Cymatics bloom, Hand swirl. A preset sets every setting (defaults, then its own) and keeps the inputs (hand positions, Sound level; Sound from unless the preset picks one).
- **Sections** (`ParamDef.section`): Emit, Motion, Pattern, Look, Camera, Lights, Sound, Hands. The first is open, the rest fold to "n changed". Folding is display only (`foldState.ts`), so a folded setting stays a uniform and its Play mapping keeps working. The node no longer uses `showWhen` anywhere.
- **Help** (`ParamDef.help`): a "?" beside each setting's name shows what it does, a typical range and what it pairs with. The info card is short (`NodeDefinition.brief`): a summary, how to start, sockets by name.
- **Inputs on demand** (`NodeDefinition.socketsOnDemand`, `lib/socketsOnDemand.ts`). The card shows Over, UV, Camera from, Camera ray, Depth, Scene, Obstacle and Emitter. Every other setting gets a socket when its slider is right-clicked → **Control from outside**; Hand / Hand 2 come from Hand X / Y, and Flow from Flow force. **Back to slider** unwires it and hides it again. The list lives in `params.__sockets`, and a wired socket always shows, so saved graphs keep theirs. The Play items stay in the same menu.

**Look.**
- **Ink** (Look): particles add absorbance and a colour-weighted sum into the half-float target. Compose turns that into cover `1 − e^−Σ` and the ink's own colour; the node lays it over the paper (or Over). Glow becomes the ink bleeding.
- **Thread**: a second pass draws each particle as a 1-pixel line back along its velocity, so flows read as hair-fine threads. In 3D the sharp share of each particle goes to the lines and the blurred share to points.
- Finer sizes (0.25 px; sub-pixel points dim by their area) and `gpUnitInk` keep the ink tone the same at every count.

**3D** (Space).
- A camera orbits the emitter (angle, tilt, distance, Drift: slow orbit, bob and breathing). The fragment depth is per particle.
- **Depth of field**: a point grows to its circle of confusion and keeps its light or ink, so out of focus is haze or bokeh. Points above 7 px are thinned at random (survivors heavier), so blur costs no fill rate.
- 3D curl noise is `∇a × ∇b` (divergence-free, two noise evaluations), so continuous emission folds into sheets and threads.

**Image emitter.** The node's Image slot (`textureSlots: ['image']`).
- A home pass gives every texel a place on the picture: a jittered grid cell, or a few random retries where the picture is below Image threshold (Ink: above it). It also gives a release order: noise patches plus grain.
- A held particle springs home (critically damped) and doesn't age. **Release** lets them go patch by patch to gravity, wind and turbulence; back to 0 and they fly home.
- The picture's cover (a 64² test averaged to 1 texel) sets each particle's share, so held particles show the picture at its own brightness.
- **Burst** (a trigger: rising past 0.5) rebirths the pool, or on a picture kicks it apart.

**Air.** Wind (gusting with the noise), Turbulence size, high Drag. The Dust in air preset is 64k motes in 3D with bokeh and one still light.

**Sound** (Sound from: Graph / Mic / Audio engine master / engine track 1–8).
- `gpSoundStep` turns a spectrum (or a plain level) into level, bass, mid, treble and hits: bass or level flux above a running average, at most ~8 a second.
  - App: the mic is `liveAudio.raw()`; the engine is `engineSound.spectrum(master | rack id)`, with track N = the N-th rack.
  - Web page: the mic, and the page's granulator racks (master is their sum). Other rack kinds don't play on a web page, so they're silent there.
- **Wave**: rings travel out from the emitter at Wave speed, as loud as the sound was when they set off, through a 256-sample level history.
- **Vibrate** shivers particles where the wave is.
- **Shockwave**: a pressure pulse leaves on every hit. It pushes out as the front arrives and pulls back behind it, so the ring passes through without clearing the middle.
- **Crunch**: a jitter following level and treble.
- **Gust**: turbulence and its clock speed up with the level.
- **Jet**: a rocket exhaust down from the emitter, widening, shedding vortices side to side, entraining air. It runs a little always and roars with the bass.
- Sound level adds to all of it, and wiring an Audio input amplitude into its socket is one wire.

**Hands.** Hands (off / one / two) and Hand X/Y, Hand 2 X/Y in 0…1 of the picture.
- Each hand pulls (Hand pull, negative pushes) and stirs (Hand swirl) within Hand reach.
- One step in Play: right-click Hand X → **Add as position with Y**, then choose a hand as the source (the X/Y pair maps both). Or right-click Hand X → **Add the Hand input** and wire any vec2 (the mouse, a null, an LFO pair) in centred coordinates; a wired Hand turns Hands on.

**Interaction with other shaders: the probe.** Sockets carry values that exist only in the shader, so the node writes a probe under `#ifdef GPP_PROBE`. The hosts compile the graph a second time with it (app: a second `ShaderMaterial` on the same uniforms; web: a second program) and draw four modes:
1. The wired values, one pixel each (`gpProbeSlots`). They are read back through a pixel buffer and fence (`gpReadback`, a frame or two late). Three's `readRenderTargetPixelsAsync` is avoided: it leaves its pixel buffer bound while it waits, which zeroes the app's own `readPixels` (exports, scopes).
2. A field over the picture: Obstacle (an SDF, or a mask), Flow (its slope, or its contours), and a scene's Depth. The engine samples it on the GPU.
   - 2D: particles slide round obstacles and part before them, and follow or circle the flow.
   - 3D: a particle further than the scene's depth along its ray is discarded, so a raymarched object hides what's behind it.
3. The **scene camera**: Camera from / Camera ray (a March Camera's ro / rd), read at three points. `gpSceneCamera` rebuilds any pinhole camera from them, so the particles share the scene's camera and space.
4. The **Scene**: the wired SceneGroup's distance function evaluated on a 48³ grid round the centre (Scene size; slices side by side, 384 × 288). The simulation samples it trilinearly, so particles collide with, slide along and part round the scene's surfaces everywhere, seen or not.

**Examples.**
- Ink in Water.
- Particles round a Shape: a Circle SDF as Obstacle, an FBM as Flow (Around), the disc drawn over them with SDF Fill.
- Particles in a 3D Scene: a raymarched sphere; camera, Depth and Scene wired. Embers spiral in, wrap the sphere, pass in front of it and hide behind it.

**Measured** (Apple silicon, offline render path, whole frame including the graph, 1080 × 1350):

| Setup | ms per frame |
|---|---|
| Ink in water: 1M, 3D, DoF, threads | 5.0 |
| Particles in a 3D Scene, 256k (probe, depth field, scene grid) | 2.3 |
| Particles in a 3D Scene, 1M | 7.8 |
| Particles round a Shape, 1M (probe field) | 2.5 |
| Particle Galaxy, 256k 2D | 1.2 |
| Particle Galaxy, 1M 2D | 3.2 |

The live preview is noisier, because the GPU is shared with other previews.

## What shipped: Chladni plates (Pattern)

Sound used to move particles only in circles (rings and shockwaves from the emitter). **Pattern** makes them sand on a vibrating plate instead: the sound picks the plate's modes, and the sand gathers on the nodal lines where the plate stands still. It's in the same engine, so the app and web exports match.

**The plate.** The plate's displacement is a weighted sum of modes, `u = Σ w·φ(n, m)`, over the emitter's area (Emitter size is the plate's half size).
- **Chladni square:** `φ = cos(nπX)·cos(mπY) ∓ cos(mπX)·cos(nπY)`, with X and Y running 0…1 across the plate. Symmetry Minus is the classic figure; Plus is its twin, with lines through the corners. When n = m the terms always add.
- **Chladni round:** `φ = J_n(k·r)·cos(nθ)`, with n spokes and m still rings inside a free rim. k (`gpPlateWave`) is the first zero of J_n′ past the m-th zero of J_n, so the rim moves, as on a real disc.
  - A first version clamped the rim (k the m-th zero of J_n). The rim was then a nodal line of every mode, and it hoarded the sand.
  - M = 0 is spokes only; the lowest figure is the two-spoke cross. Symmetry Plus turns every other mode by half a lobe, so their spokes interleave into stars.
  - J_n comes from its integral, `(1/π)∫cos(nτ − x·sinτ)dτ`, using 200 midpoints (exact for n + x < 400).
  - It is tabulated once (16 orders × 1024 samples over 0…64, an R32F texture, filled the first time a round plate runs) and read with texelFetch plus a lerp.

**The sand.** Each substep, the simulation pass:
- moves a particle down |u| towards u = 0, along `−sign(u)·∇u` (a finite-difference gradient), at up to Settle speed, and never more than half the way to the line in one step;
- kicks it at random, as hard as the plate moves there (Shake × distance to the line, saturating). Sand can't rest on the moving parts, and lines stay crisp because the kicks vanish on them;
- adds a small grain (Shake × 0.03 per √s), so a line has a pixel or two of body;
- reflects the sand back in at the plate's edge, and damps its own flight fast.
In 3D the plate lies flat (x, z) at the emitter's height, the sand settles onto it, and a disc or line emitter is born lying on it.

**Picking modes** (`gpPlateTargets`, `gpPlateListen`, `gpPlateSmooth`, all tested):
- **Mode table** (`gpPlateTable`): the plate's modes ordered by pitch.
  - Square: (n, m) with n < m and n + m even, by n² + m². These are the figures symmetric across both centre lines.
  - Round: (n, m) by wave number.
- **Sound** (Mode from: Sound) is heard in 8 log-spaced bands from 80 Hz to 5 kHz.
  - Each band is measured by its loudest bin, so a single note shows as loud as it is. The bands are smoothed: quick to rise, slower to fall.
  - The loudest band picks the main mode (weight 1): higher bands pick higher modes, and Frequency spreads them further up the table.
  - The next-loudest bands each add the nearest mode that keeps the figure's symmetry, up to Modes in all. A square keeps the main mode's parity; a round plate takes spoke counts that are multiples of the figure's, or rings.
  - Their weights are Weights × (their level / the loudest)^(1 + 5·(1 − Weights)). At Weights 0 only the loudest mode shows; at 1 they mix into lace.
  - Silence holds the figure. If it's silent from the start, N and M's figure shows.
- **Where the sound comes from:** the spectrum comes from Sound from (the mic, or the Audio engine's master or a track).
  - With Sound from Graph, every band of the graph's first Audio Input is used (`audioBands` in `gpBindings`, low to high), once they're louder than 0.02.
  - With only a level (Sound level, a stand-in beat), each hit steps the figure on to a new set of bands.
- **Holding a figure** (`GP_PLATE_HOLD`, 2 s): the sand needs time to settle, so a figure holds at least this long.
  - Hits closer together than that don't step the figure on.
  - The loudest band keeps leading until another is a fifth louder.
  - Without the hold, a beat twice a second, or two near-equal bands, re-formed the figure faster than the sand could find it, and complex figures stayed in fragments.
- **Manual** (Mode from: Manual): N and M (times Frequency) pick the main mode. Equal values on a square move apart, since the minus figure would vanish. The modes after it in the table that keep its symmetry add in, each weighing Weights × 0.8^k.
- **Morphing:** each weight glides to its target with a time constant of about 0.45 s. New modes grow from 0 and old ones fade out, so one figure morphs into the next rather than flickering. Shake is boosted by the level (×0.6…1.8) and by every hit, so the sand jumps on a beat and settles again.
- **Pouring the sand:** switching the plate on, changing its shape or starting over pours all the sand on at once, as a burst on the first substep. A stream alone would take a whole Life to fill the plate.

**Settings** (section Pattern, each with a "?"):
- Pattern (Off, Chladni square, Chladni round), Mode from (Sound, Manual), Modes (1–8), N, M, Frequency, Weights, Settle speed, Shake, Symmetry (Minus, Plus).
- N, M, Frequency, Weights, Settle speed and Shake have sockets (Control from outside).
- The node is version 3: older nodes get the new settings at their defaults.

**Presets:**
- Chladni sand: square, 256k, gold.
- Singing plate: round, ice.
- Cymatics bloom: round, 1M, five modes at high Frequency and Weights, Symmetry Plus, neon.

**Also fixed:** Sound level (the slider or its socket) now counts towards hits. Before, only the graph's Audio Input could fire one, so a beat wired into Sound level never fired Shockwave. The Sound Field example's stand-in beat now fires its rings, as its description says.

**Examples** (every node has a plain-language comment; each Expression line is named and explained in the comment):
- **Particles: Chladni Sand.** A square plate.
  - An Audio Input with six bands (150 Hz to 4 kHz) is what the plate hears once a song is loaded.
  - A stand-in beat in Sound level (a hit every 1.6 s while the song is quiet) steps through figures until then.
  - A dark steel plate is drawn under the sand with an Expression into Over.
- **Particles: Cymatics in 3D.** The Singing plate lying flat in 3D (camera tilted 50°, drifting, a little blur), with the same Audio Input and stand-in beat.
- **Particles: Star Outline.** A star's Shape SDF turned into a ridge along its outline, `−3·d²`, wired into Flow (Slope). Particles born everywhere climb to the outline; Swirl runs them round it, with Thread on.
- **Particles: Currents into a Heart.** Flow is a slope into a heart's SDF plus an FBM noise that fades out at the heart's edge. Particles ride the noise's currents in, then the node's curl Turbulence stirs them inside, so they fill the heart instead of piling on the noise's peaks.

**Limits:**
- The plate is the emitter's area. Use a Box for Square and a Disc for Round; a ring or point works too, but the sand starts in the wrong place.
- The plate stays square or round in picture units, so a narrow picture crops a big plate (the examples use 0.7).
- Lines break up for a moment while a figure morphs, as real sand re-settling does.
- Obstacle and Flow still act alongside a plate, which is useful for creative mixes but can blur its lines.

## What shipped: Emit from a Pass

The **Emit from** socket takes a Pass's Texture (docs/pass-node-plan.md, phase 6): particles are born where it is bright (luma × alpha at least **Image threshold**, kept with a chance of their brightness), all over the picture; the emitter's shape still gives their speed, direction and life. Wire Edges (texture) through a Pass for sparks off outlines (Passes 2 · Particles born on edges). Unwired, the node and the engine's shaders are byte for byte as before; wired, the node adds one `// gpu-particles-from` comment and the engine links a second simulation program (`GP_SIM_FROM_SHADER`: GP_SIM with only its births changed). The passes it reads draw before the particles step, live, offline and on exported pages. A Particles node placed before a Pass (compiled into that pass's program) now works in the app and on pages, its wired settings probed from that program.

## Phases left

- **P1:** sprite shapes (ring, image), size over life, more palettes from the Palette node.
- **P3:** emit from the graph's own picture or Layers (the Image emitter takes the node's own image), emit from an SDF's surface, bounds (wrap, kill, bounce).
- **P4:**
  - A Play particles layer on the same engine.
  - Burst / Reset as Play rule actions. Rules can't target graph params today: Burst is a trigger param, so route a trigger source to it.
  - A second `density` texture for other nodes.
- **P5:** instanced shapes; lighting particles with the scene's lights and fog.
- **Probe limits:**
  - Values come a frame or two late.
  - A scene with extra (main-scope) inputs can't be called from the probe: its probe copy doesn't compile, and the particles then ignore it.
  - Obstacle and Flow act in the picture plane (x, y); in 3D use Scene.
- **Budget:** the `gpuTimer` auto-downgrade, and why 4M stalls in the app preview.
- Particles inside groups compile only through a plain group's path.
