# March Loop: Voxels

Turn **Voxels** on on a March Loop and the scene is drawn as cubes on a grid: any Scene Group, any
shapes, combines and warps. **Voxel size** (a live slider) sets the cube size in scene units.

## How it marches

The ray walks the grid cell by cell (Amanatides & Woo traversal). At each cell it measures the scene at
the cell's **centre**: inside (distance below 0), the cell is solid and the ray stops. The normal is the
face the ray came in through, so each cube is lit flat, face by face.

Empty space is skipped like an ordinary march: when the centre is more than 2.5 voxels from anything,
every cell within `d − 1.75` voxels of it is empty (the scene's distance can't change faster than the
distance moved), so the ray jumps that far and picks up the grid again. Open space costs a few steps;
only the cells near a surface are walked one by one.

- The loop runs up to twice Max Steps. Small voxels on a big scene may need Max Steps raised.
- Warps (a Space Warp group in the body) bend where each cell centre is measured.
- Iter, Hit, Distance, Depth, Normal and Position work as usual; Position is where the ray enters the cube.

## A colour per cube

Hit Pos is on the cube's face, so step half a cube back along the Normal to land inside it:
`cell = floor((pos - normal * 0.5 * size) / size)`. A Random (from ID) or a Palette on that cell gives every cube
its own colour (3D: Voxel Terrain does this in an Expression Block).

## The GI Lit March Group

The GI loop has the same Voxels and Voxel size. Its camera ray walks the grid as above; so do its shadow ray, its
bounce ray and its reflection ray, so shadows are cube-shaped and reflections show cubes. AO counts the solid
cells round each face, weighted by how close the point is to each (the block-game corner shading), instead of
marching out along the normal. AO Steps is unused with Voxels; Shadow / GI / Spec Steps set the walks' lengths.

## Other scene types

- **Repeat Scene** is a scene like any other: wired into a voxel loop, every copy is cubes.
- **Space Warp groups** and warps in the loop body bend where each cell centre is measured.
- **3D Scene Builder**: `quality voxel=0.08` turns Voxels on its loop.
- The **Voxelize** node is retired (docs/node-retirements.md): this setting is the one voxel system.

## Not with

Volumetric, Space curvature and Warp safety march as before (Voxels is ignored on those loops).

Code: `src/compiler/voxelMarch.ts` (the walk and the corner AO, shared by both loops), called from
`src/compiler/shaderAssembler.ts`; params in `src/nodes/definitions/scene3d.ts`.
Tests: `src/compiler/__tests__/marchVoxels.test.ts`.
