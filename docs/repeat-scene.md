# Repeat Scene

**Repeat Scene** (3D Scene) repeats a whole Scene Group in a 3D grid. Put it between the Scene Group and the March Loop.

```
Scene Group ──▶ Repeat Scene ──▶ March Loop
(Floor) ──────▶ Repeat Scene.Not repeated
```

Repeat 3D only folds the position, so the shape is measured once, in its own cell. A copy that reaches past its cell (it moves, it's bigger, it overlaps) gets sliced flat at the cell wall, and rays tear through it. Repeat Scene can also measure the **neighbouring** copies.

| Neighbours | What it does | Cost |
|---|---|---|
| Off | Own cell only, like Repeat 3D. | 1× |
| Wall cap | Own cell, but rays never step past the cell wall. Fixes tearing when copies differ but stay inside their cell (still slices overlaps). | ~1× |
| Nearest 8 | The 8 cells round the corner the point is nearest, not all 27. Copies may reach up to half a cell into their neighbours. | 8× |
| Nearest 8, only when needed (default) | Own cell first. The other 7 only when one could be nearer: the point is closer to a wall than to its own shape, less **Overlap**. | usually ~1–2× |

- **Overlap**: how far a copy may reach past its wall. Too small and overlapping parts flicker; larger is safer and slower.
- **Cell X/Y/Z**: the spacing. Make one huge (Cell Y 50) to repeat across a floor only.
- **Copies each side**: 0 = forever, otherwise the grid stops after that many copies each side of the middle.
- **Not repeated**: another Scene Group added once (a floor, a centrepiece).

## Repeat Cell

**Repeat Cell** (3D Transforms) says which copy is being measured, so each copy can differ:

- **Cell**: whole numbers, (0, 0, 0) in the middle;
- **Random** and **Random 3**: 0–1 per copy, steady over time, with a **Seed**.

Use it inside the repeated Scene Group to vary size, offset, spin or anything else.

**After the March Loop**, wire the Repeat Scene into Repeat Cell's *Repeat Scene* and the loop's *Hit Pos* into its *Hit Pos*. It then gives the copy each ray actually hit, so a bubble is one colour even where it overlaps another's cell. Each call of the repeated scene leaves the nearest copy's cell behind for it to read.

Example: **Repeat Scene: overlapping bubbles** (3D SDF). Set Neighbours to Off to see the slicing.

## How it compiles

`compileRepeatSceneNode` in `src/compiler/shaderAssembler.ts` wraps the scene's function:

```glsl
float repScene_x(vec3 p, …) {
  id = floor(p / cell + 0.5)            // clamped by Copies each side
  g_cell3 = id; d = scene(p - cell*id)  // own copy
  [skip] if (d > nearest wall − overlap)
  [near8] for the 7 other corner cells c: g_cell3 = c; d = min(d, scene(p − cell*c))
  g_cell3 = nearest copy; d = min(d, notRepeated(p)); return d;
}
```

`g_cell3` is a global, written before each copy is measured; Repeat Cell reads it. The scene's extra arguments (Scene Group ports) pass through.
