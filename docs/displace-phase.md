# Phase and Speed on the displace nodes

Every displacement that draws a pattern (a sine, a ripple, waves, noise) has a **Phase** and a
**Speed**, so the pattern can move on its own, without a Time wire:

- **Phase** shifts the pattern along (for the sine kinds, 6.28 is one whole wave; for the noise
  kinds it slides the point through the noise).
- **Speed** is how much Phase advances each second, on the shader clock. 0 holds it still;
  negative runs it backwards.

The pattern's phase is `Phase + time × Speed`. Both are ordinary float sliders: off 0 each is a
live uniform (a drag never recompiles), a Play target (right-click → Add to Play controls) and,
through Control from outside, a socket you can wire. At exactly 0 each stays a literal
(`literalAt: 0`) and the node leaves it out of its code, so a graph saved before they existed,
or a new node at 0 / 0, compiles to exactly the GLSL it did. Moving off 0 (or back onto it)
recompiles once.

| Node | Phase moves | Notes |
|---|---|---|
| Displace 3D | the bumps through the surface (each axis's sine) | also the Scene Builder's Displace |
| Sin Warp 3D | the wave along its source axis | its unwired Time is still the clock, as before |
| Turbulence 3D | every octave's sine | added to a wired Time |
| 3D Domain Warp | the point through the noise | also the Scene Builder's Noise warp |
| Ripple / Wave | both ripples | added to a wired Time |
| Turbulence | every octave's sine | added to a wired Time |
| UV Warp (all four kinds) | Smooth / Jitter / Curl: through the noise; Swirl: turns the twist | its Speed (for the Time wire) was already taken, so the new one reads **Phase speed** |
| Domain Warp | the point through the noise (one noise unit per 1) | its Speed was already taken: **Phase speed** |
| Grid Density Warp | (it already had a Phase) | gains Speed only |

Not given one: the displacers without a pattern of their own (Displace, which pushes by a vector
you wire; Displace (texture) and Displacement Map, which push by a picture; Cell Displace, which
pulls toward an attractor). Wire a moving vector or picture into those instead.

The Scene Builder's Sine warp, Noise warp and Displace cards show Phase and Speed under their
other settings, and the recipe takes them as `phase=` and `speed=`
([scene-builder-3d.md](scene-builder-3d.md), Warps).

Code: `src/nodes/definitions/helpers.ts` (`phaseParamDefs`, `phaseOf`), the nodes in
`sdf3d.ts`, `spaces.ts`, `transforms.ts`, `noise.ts`, `grid.ts`; `src/sceneBuilder/spec.ts`
(`PHASE_PARAMS`, `quiet`). Tests: `src/nodes/__tests__/displacePhase.test.ts` runs each node's
GLSL on the CPU at two times.
