# GPU particles, TouchDesigner style (plan, 2026-10-03)

**Status:** P0 and P2 shipped, most of P1, P3, P4 and P5 in the creative-controls follow-up (see [What shipped](#what-shipped) and [creative controls](#what-shipped-creative-controls-stacked-on-the-node-above)). The plan below is as written; the Particles node follows it except where What shipped says otherwise.

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
- **Presets** (a chip row, `ParticlePresets.tsx`, data in `GP_PRESETS`): Ink in water, Embers, Dust in air, Image dissolve, Sound field, Launch, Hand swirl. A preset sets every setting (defaults, then its own) and keeps the inputs (hand positions, Sound level; Sound from unless the preset picks one).
- **Sections** (`ParamDef.section`): Emit, Motion, Look, Camera, Lights, Sound, Hands. The first is open, the rest fold to "n changed". Folding is display only (`foldState.ts`), so a folded setting stays a uniform and its Play mapping keeps working. The node no longer uses `showWhen` anywhere.
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
