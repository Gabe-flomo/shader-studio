# GPU particles, TouchDesigner style (plan, 2026-10-03)

**Status:** P0 and P2 shipped, P1 in part (see [What shipped](#what-shipped)). The plan below is as written; the Particles node follows it except where What shipped says otherwise.

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
- The `P:` chain (pInit … pRender) is deprecated (hidden from the browser, still compiles); the Particle Galaxy example now uses the Particles node.

**Measured** (Apple silicon, 608 × 756 preview): 256k and 1M about 2 ms a frame for the engine. 4M costs ~20–30 ms standalone but dropped the preview to a few fps in the app here; it is offered as the "fast GPU" tier.

## Phases left

- **P1:** sprite shapes (ring, image), streaks, size over life, screen / soft-alpha blends, more palettes from the Palette node.
- **P3:** emit from the picture / an image / Layers / an SDF; flow and gradient fields; bounds (wrap, kill, bounce).
- **P4:** a Play particles layer on the same engine; Burst / Scatter / Reset actions; lights and attractors on nulls, hands and pose; audio to rate and force; a second `density` texture for other nodes.
- **P5:** 3D: instanced shapes, an optional camera, a presets gallery.
- **Budget:** the `gpuTimer` auto-downgrade (drop a tier when frames run long), and finding why 4M stalls in the app preview when it runs well on its own context.
- Particles inside groups compile only through a plain group's path (iterated or scene-body groups don't declare the sampler).
