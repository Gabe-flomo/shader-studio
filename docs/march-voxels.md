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

## Not with

Volumetric, Space curvature and Warp safety march as before (Voxels is ignored on those loops), and the
GI-lit loop has no Voxels yet.

Code: `src/compiler/shaderAssembler.ts` (`voxelLoop` in the March Loop group), params in
`src/nodes/definitions/scene3d.ts`. Tests: `src/compiler/__tests__/marchVoxels.test.ts`.
