# Noise

One node for the classic noises, in the spirit of Blender's Noise Texture. Source:
`src/nodes/definitions/noiseNode.ts`. In the library under **Noise**, next to Fractal Noise, Voronoi and Noise Float.

## Settings

- **Kind**: which noise.
  - **Perlin (gradient)**: smooth and natural, the default.
  - **Simplex**: like Perlin with fewer grid-aligned streaks; its features come out a little smaller at the same Scale.
  - **Value**: a random number at each grid point, blended. Softer and blobbier.
  - **Worley (cells)**: the distance to the nearest of many random points: dark spots with bright borders. For the
    full set of cell outputs (borders, cell colours, cell centres) use **Voronoi**, below.
- **Dimensions**: what the extra axes are for.
  - **2D**: the picture only. Speed slides the pattern across.
  - **3D**: Time × Speed is the third axis, so the noise **changes in place** instead of sliding.
  - **4D**: Time × Speed goes round a circle in the third and fourth axes, so it changes in place and **repeats
    exactly every 6.28 ÷ Speed seconds**: good for a video that loops. Costs the most.
- **Scale**: how many features fit across the picture.
- **Detail**: layers of finer noise on top (0 is one layer, 8 adds eight). Fractions blend the last layer in, so
  Detail can move smoothly. Each layer costs GPU time.
- **Roughness**: how strong each finer layer is (0.5 is natural, 1 is grainy).
- **Lacunarity**: how much finer each layer is than the last (2 is standard).
- **Distortion**: pushes the pattern around by a broader noise of the same kind (a domain warp), for marble and smoke.
  At 0 the warp is left out of the shader altogether.
- **Speed**: how fast it changes over time; 0 holds it still. Time is the shader clock unless something is wired
  into the Time socket.
- **Offset X / Y**: slides the pattern, in picture units.

Every slider except Kind and Dimensions is a live uniform (dragging it never recompiles) and a socket you can wire
(right-click the slider, **Control from outside**; Scale shows its socket from the start). Kind and Dimensions pick
the code, so changing them recompiles once.

## Outputs

- **Value (0–1)**: the noise.
- **Signed (−1–1)**: the same, centred on 0, for offsets and displacement.
- **Colour**: three unrelated noises (Value in red, two more in green and blue), like Blender's Color output.
- **Slope**: which way Value rises across the picture, and how steeply (in UV units). Turn it a quarter turn
  (Split Vec2 → Make Vec2 of −y, x) for a flow that swirls round the hills (a curl flow); wire it into Displace to
  push things along it.

Colour and Slope each run the noise twice more. They are ordinary variables in the shader, so the GPU's compiler
drops them when nothing reads them.

## How it compiles

The node adds the helper functions for its Kind and Dimensions only (`nzPerlin3`, `nzSimplex4`… and the layered
`nzNoisePerlin3` that runs Detail's loop, or `nzNoisePerlin3D` with Distortion). Two Noise nodes of the same Kind and
Dimensions share one copy. The Detail loop has a fixed bound (9 layers) and stops early, as GLSL ES requires.

The noises are the standard ones: Perlin 2D and 3D and Simplex 2D, 3D and 4D from Stefan Gustavson and Ian McEwan's
webgl-noise (MIT), Perlin 4D the same gradient idea over the 16 corners, Value noise and Worley F1 on Dave Hoskins'
sine-free hashes. 4D Worley searches 81 cells per layer: keep its Detail low.

## Voronoi's cell outputs

The **Voronoi** node (`src/nodes/definitions/noise.ts`) has more outputs besides Distance:

- **F2 distance**: the distance to the second-nearest cell centre.
- **Edge (F2 − F1)**: 0 on every border, growing into each cell: soft, rounded cells.
- **Distance to edge**: the exact distance to the nearest border (Inigo Quilez's two-pass method), so a threshold
  draws lines and cracks of an even width.
- **Cell ID**: the cell's whole-number coordinates, the same for every pixel in a cell.
- **Cell colour**: a steady random colour per cell.
- **Cell position**: the nearest cell centre, in UV, so a shape centred there sits on it. Keep such shapes smaller
  than the cells: each pixel only knows its own cell's centre.

**Metric** (Euclidean, Manhattan, Chebyshev) changes how distance is measured, and so the shape of the cells: round,
diamond-like or square-ish. Distance to edge is always measured in straight lines.

Each of these outputs adds its code only while something is wired to it, and a Voronoi that only uses Distance and UV
compiles to exactly the shader it did before they existed.

## Examples

In the **Noise** folder: *Marble from Distortion*, *Clouds that change in place* (4D Simplex), *Terrain with contour
lines*, *Flow from the Slope output*, *Worley × Perlin*. In **Noise: cells**: *Cracked earth* (Distance to edge),
*Stained glass* (Cell colour and Distance to edge), *Living cells* (F2 − F1), *A dot at every cell center* (Cell
position) and *Square tiles from the Metric*. Source: `src/store/noiseExamples.ts`.
