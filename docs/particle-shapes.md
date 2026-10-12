# Particle shapes (Draw agents in 3D)

A 3D Agents group's walkers can be drawn as **solid shapes** instead of soft dots: cubes, spheres,
rods (long boxes), tiles (flat squares) and voxels (cubes snapped to a grid). Shapes have a depth
buffer, so near ones hide far ones, and a ray-marched scene wired into Draw agents (Camera from,
Camera ray, Depth) hides them too.

Code: `src/lib/agentShapes.ts` (settings, maths, GLSL), `src/lib/agentShapeRenderer.ts` (the THREE
side), `AgentRunner.drawShapes` in `src/lib/agentRunner.ts`, the settings on `DrawAgentsNode`
(`src/nodes/definitions/agents.ts`), the cost note (`src/components/NodeGraph/ShapeCostNote.tsx`),
the Agent Builder's Look (`src/components/agentBuilder/LookSection.tsx`), the benchmark
(`src/dev/shapesBench.ts`) and the tests (`src/lib/__tests__/agentShapes.test.ts`).

## The settings

**Shape** (Look section, 3D only): Dot (today's look, unchanged), Cube, Sphere, Rod, Tile, Voxel.
A note under it says roughly how many shapes a frame draws, what they cost, and turns amber when that
is a lot (see "Cost").

The **Shape** section (shown when Shape isn't Dot; each control only for the shapes it changes):

| Setting | What it does |
|---|---|
| Shading | Flat (the palette colour), Faces (a fixed brightness per face: top 1.0, sides 0.8 / 0.64, bottom 0.45), Faces + edges, Lit (a key light from above left of the camera, Ambient, Rim), Lit + edges |
| Size, Size by | Half width in picture units; Size by Fixed, Speed, Age (shrinks to 15 % over its life) or a More memory number (× Size) |
| Facing | Along motion, Tumble (random axis per walker, Spin speed), Aligned (square to the box), Face camera (Cube, Rod, Tile) |
| Rod length, Stretch with speed | Rod: length ÷ thickness, and longer the faster it goes |
| Voxel grid, One per cell | Voxel: the cell size, and the dedupe (one cube per filled cell) |
| Sphere detail | Impostor (default), Low (48-triangle half ball), Smooth (192 triangles) |
| Ambient, Rim, Edge width | Lit's and + edges' amounts |
| Draw every, Max shapes | Draw every Nth walker; at most this many (spread over all of them, not the first ones) |
| Distant as dots | Farther than this from the camera: a flat square of its size |
| Half resolution | Shapes drawn at half the picture's size and scaled up |

Colour is Colour by and the palette, as for dots; **Brightness 0.5 is the palette's own colour** (a
solid shape isn't a sum of light). Fade with age shrinks shapes in and out instead of fading them.
Glow and Streaks styles still glow round the shapes (the Particles node's glow over them); the other
styles draw them plain. Depth of field and the point lights don't apply to shapes.

Every number is a live uniform (the runner reads the slider each frame); the selects recompile the
spec as any select does. Shapes are 3D only: a 2D group's Draw agents ignores Shape.

## How it draws

**Vertex pulling over the existing empty geometry**, the Splats look's way: one draw call of
`V × shapes` vertices with no attributes; the vertex shader takes `gl_VertexID / V` as the shape (times
the Draw every / Max shapes stride) and `gl_VertexID % V` as the corner, reads the walker with
`texelFetch` from the state texture, and builds the corner. That is instancing without the
`InstancedBufferGeometry` plumbing: the runner already draws points, streaks and splats over one empty
`BufferGeometry`, so each shape kind is just another shader variant over it (one per geometry ×
shading, made on first use). A non-indexed instanced draw would shade the same number of vertices.

Fewest vertices:

- **Boxes (Cube, Rod, Voxel): 18.** Only the three faces turned toward the camera (a convex box never
  shows more), so no back face is shaded or rasterised. 36 would draw the hidden half; a 14-vertex strip
  can't be split per face (each face needs its own normal and face coordinates for Faces and edges).
- **Tile: 6** (one quad, both sides). **Sphere, Impostor: 6** (a camera-facing quad; the fragment shader
  shades the disc as a ball and writes `gl_FragDepth`). **Low / Smooth: 144 / 576** (a UV hemisphere
  turned toward the camera, 8 × 3 or 16 × 6 quads: the half that can be seen, with no index buffer).

**Depth**: the target has a depth buffer; depth is the view depth over 128 picture units, linear, with
the true perspective w, so near shapes hide far ones whatever order they are drawn in. Under a scene's
Depth (the probe at half size) a fragment farther than the scene's surface along its ray is discarded,
as Splats do. The picture then covers what is under the shapes (`Over × (1 − cover) + colour`).

**Shading is per vertex** for boxes, tiles and mesh spheres: a box face is flat, so its shade is
exact at the vertices and the pixels only pass the colour on. That made Faces and Lit cost the same as
Flat (measured before the change: 1M Lit cubes 28 ms, Faces 14 ms, Flat 10 ms; after, all three
10.3 ms). Edges (`fwidth` of the distance to the face's edge, from the face coordinates) and the
impostor's disc stay per pixel.

**Voxels** snap to a grid anchored at the box's corner (−aspect, −1, −1): cell
`floor((p + boxHalf) / g)`, centre `(cell + ½) g − boxHalf`. **One per cell**: a claim pass draws
every walker as one point into its cell of a grid atlas (z-slices side by side, at most 4096 wide;
cells no smaller than 0.01), no blending, so the highest index in a cell stays (GL keeps primitive
order). A voxel draws only if it owns its cell. The atlas is cleared every frame. Walkers outside the
box are always drawn.

**Reset**: shapes keep nothing between frames (the dedupe grid is cleared before every claim), so the
true reset of the walkers (`lib/runtimeReset.ts`) is a reset of what they draw.

**Web pages** (exported): Shapes are app-only, as Splats are; a page draws each walker as its Style's
dot. **GPU particles** (the Particles node, `kit/gpuParticles.js`) have their own draw path and are
not covered yet.

## Cost

Measured on an M3 Pro (Chrome, ANGLE / Metal), GPU ms a frame for the shapes alone at 1920 × 1080,
walkers spread through the box at Size 0.008 (heavy overlap), median of 30 frames with timer queries
(`(await __shaderStudioDev.shapes()).shapesTable()` in the dev build):

| Shape · Shading | 50k | 200k | 500k | 1M |
|---|---|---|---|---|
| Cube · Flat | ~1 | 2.4 | 5.5 | 10.2 |
| Cube · Faces | ~1 | 2.5 | 5.5 | 10.3 |
| Cube · Faces + edges | 1.1 | 3.3 | 7.6 | 14.6 |
| Cube · Lit | ~1 | 2.5 | 5.5 | 10.4 |
| Cube · Lit + edges | 1.1 | 3.4 | 7.4 | 14.5 |
| Sphere (Impostor) · Flat | 1.2 | 2.1 | 5.2 | 10.1 |
| Sphere (Impostor) · Lit | 1.3 | 2.3 | 5.8 | 11.4 |
| Sphere (Low) · Lit | 2.6 | 9.2 | 21.9 | 42.2 |
| Sphere (Smooth) · Lit | 7.4 | 28.1 | 69.0 | 139.5 |
| Tile · Faces | 0.4 | 1.4 | 3.1 | 5.8 |
| Rod · Lit | ~1 | 2.6 | 6.0 | 11.4 |
| Voxel · Faces + edges (One per cell) | 1.1 | 3.4 | 6.9 | 11.8 |
| Voxel · Faces + edges (overlapping) | 1.1 | 3.6 | 8.4 | 16.5 |
| Cube · Lit, Half resolution | 0.6 | 2.1 | 4.9 | 8.9 |
| Cube · Lit, Distant as dots (3) | 0.8 | 2.1 | 4.7 | 8.4 |

Below about 1 ms the readings are noisy (± 0.5 ms). A slime-like layout (262k walkers on a gyroid
sheet through the box, Voxel grid 0.03, One per cell) draws in 2.3–2.7 ms. For comparison the slime's
own step, deposit and trail take about 5 ms at 256k.

So: **the count matters most**, then edges (+40 %) and sphere meshes (Low ×4, Smooth ×14); Flat,
Faces and Lit cost the same on boxes. The note under Shape estimates `drawn × ms-per-million` from this
table (`SHAPE_MS_PER_M`) and turns amber past 8 ms (about half a 60 fps frame): roughly 800k boxes,
550k with edges, 190k Low or 57k Smooth spheres. Its tip: "Flat or Faces shading (no edges) and a Max
shapes cap keep it fast."

## Examples (Agents in 3D)

- **Voxel slime**: the 3D slime mold as voxels, Faces + edges, grid 0.03, One per cell, one clay colour.
- **Rod swarm**: the 3D flock as rods along their flight, Lit with a rim, Max shapes 40,960 so each rod
  reads on its own.
- **Cube storm**: 64k cubes in a swirl and curl noise, each tumbling, Flat, coloured and sized by speed.

## Next (Phase 2, not built)

**Splat Scene as cubes or spheres** (voxelise a scan): Splat Scene draws its splats with its own
renderer (`splatScene.ts`, `lib/splats/`). The same `AgentShapeRenderer` can draw them if it is fed a
state-like texture: a pass that writes each splat's centre into A (xyz) and its colour into the Agent
colour channel (C.w packed RGB) with B.w > 0 (alive), side = ⌈√count⌉. Then Shape Voxel with One per cell
voxelises the scan (the grid size is the voxel size, the colour the highest-index splat's, or an
average with an additive claim pass), and Cube / Sphere draw a splat per shape sized by its scale
(Size by memory w). Open questions: the scan's own camera and depth merge (Splat Scene composites by
distance with ray-marched scenes: shapes would write that distance too), and whether to average colours
per voxel (a second, additive pass into the grid).

Also later: Shapes for the Particles node (`gpuParticles.js` shares the state layout, so the same
renderer fits), DOF for shapes (a blur pass over the depth), and shapes in exported web pages
(`kit/agentHost.js` would need the renderer in plain WebGL2).
