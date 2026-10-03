# GPU particles, TouchDesigner style (plan, 2026-10-03)

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
