# Node previews: "Show as" (2026-10-05)

**Status:** built. The eye preview (the picture panel) and the node card's preview draw a node's **real computed value** for float and vec2 outputs, in a mode picked from **Show as**. Colour outputs (vec3, vec4) draw as they always have.

## In plain words

Turn on the eye on a node. If what it outputs is a number (float) or a pair of numbers (vec2), the banner above the graph and the node card both get a **Show as** picker. Both use the same choice, and the choice is remembered for that node.

**vec2 modes**
- **Grid**: a checker with thin lines, looked up at the vec2 as if it were UV. You see how the node stretches, twists, folds and repeats space. The red line is where y = 0 and the green line is where x = 0. The checker is tinted by position inside each unit square (more red to the right, more blue upward), so mirroring and rotation show too. **Detail** sets how fine the checker and lines are (see below). This is the default for 2D Space and UV-like outputs.
- **Arrows**: an arrow per cell of a grid, pointing exactly along the vec2.
  - **Length shows strength.** An arrow's strength is its vector's length divided by the **largest length anywhere in view**: one maximum for the whole picture, never per cell, and never unit length. The strongest vector gets a full arrow (90% of its cell), and one half as strong gets half the length.
  - Arrows below 3% of the maximum draw as a small dot, so very weak spots don't vanish.
  - Brightness follows the same strength.
  - The key shows a full-length reference arrow and what it stands for, e.g. `full arrow = 2.4 (strongest)`.
  - Each cell shows its strongest vector, so a sparse field (Edges' Direction, zero away from edges) still gets an arrow wherever it has one. A field that is unit length everywhere (Edges' Direction on an edge) correctly draws every arrow full length.
  - **Detail** sets how many arrows there are.
  - This is the default for directions, flows, gradients and forces: outputs named or labelled dir / direction / flow / force / velocity / gradient / curl / normal / wind / heading, and the Angle → Vec2, Normalize, Vector / Gravity / Spiral Field and Edges (texture) Direction outputs.
- **Wheel**: colour is the direction (hue around the wheel; +x is red) and brightness is the length, scaled to the longest in view. Black means zero.
- **Raw**: what it always was: red is x and green is y, clipped to 0–1.

**float modes**
- **Range** (the default): the value is auto-ranged. The lowest value in view is dark and the highest is bright. When there are negatives, a diverging map is used instead: blue below 0, mid-grey at 0, warm above. Each side is scaled to its own extreme. The key reads `−2.4 … 7.1`. A value that is the same everywhere shows **= 3.0 everywhere** instead of a flat square. NaN or ∞ pixels are magenta and counted in the key (`· 12% NaN/∞`).
- **Slice**: a line graph of the value along a horizontal line (dashed; it starts through the middle at y = 0.5). Drag on the picture to move it. Single-input transforms (Multiply, Add, Sin, Smoothstep, Pow, Remap, the Shapers, Abs, Fract…, and any node with exactly one float input wired) also draw their **input in grey** on the same axes, so you see before and after. The axis is labelled with its ends and 0.
- **Contours**: the Range picture with thin lines at regular values (1, 2 or 5 × 10ⁿ, about ten across the range). The key says how far apart they are.
- **Raw**: grey clipped to 0–1, as before.

**Detail** (on the Show as row, for Grid and Arrows): Coarse, Medium (the default), Fine or Very fine. It is remembered per node, like the mode. It only changes a uniform (Grid) or the overlay drawing (Arrows), so it never recompiles.

| Detail | Grid: checker squares / lines per unit | Arrow cell, eye / card (CSS px) |
|---|---|---|
| Coarse | 4 / 1 | 48 / 32 |
| Medium (default) | 10 / 2 | 30 / 20 |
| Fine | 16 / 4 | 22 / 15 |
| Very fine | 24 / 4 | 16 / 11 |

The first version was 8 squares and 2 lines per unit, with 36 / 22 px arrow cells. Medium is a little finer. Lines always fall on square edges.

**Which output.** A node with several outputs gets an output picker next to Show as (Edges (texture): Edges, Direction, Color). Without a pick, a colour output wins as before. Otherwise the node's **first** float or vec2 output in its own order is used, skipping a pass-through (FBM previews its noise, not its "UV (pass-through)"). Picking another output recompiles the eye preview.

**On the card.** The preview has a small header with Show as, the output picker (when there is a choice), and, on nodes that had a hand-drawn diagram (Multiply, Sin, the shapers, 2D Space nodes…), a **Diagram** toggle that brings that diagram back. The ⓘ tooltip says how to read the current mode. The key sits under the picture.

## How to read the preview (the tooltip text)

| Mode | Reading |
|---|---|
| Grid | The checker is looked up at the vec2 as if it were UV. Red line: y = 0. Green line: x = 0. |
| Arrows | An arrow points along the vec2. Length and brightness show strength: the strongest vector in view fills its cell, weaker ones are shorter, and a dot means under 3%. The key gives the full-arrow value. |
| Wheel | Hue is the direction and brightness is the length. Black is zero. |
| Range | Dark is the lowest value and bright is the highest. With negatives: blue below 0, grey at 0, warm above. |
| Slice | A graph along the dashed line. Grey is the node's input: before and after. |
| Contours | Lines at regular values over the Range picture. |
| Raw | The old clipped colours. |

## Under the hood

The previews never port a node's maths. They read the value the GPU computes, so any upstream chain works. That includes groups, Passes, Data, time and sliders. The old `vizGeneric.tsx` SpaceViz instead ran a CPU checkerboard per node type, from a hand-written table.

- **Programs** (`lib/nodePreview/previewGlsl.ts`). Both are the graph's own fragment shader with the last statement of `main()` replaced. This is how the probes read a variable.
  - The **value program** writes the node's raw value into a float target: R for a float (and G for its primary input), RG for a vec2.
  - The **display program** ends in `pvz_showF(value)` / `pvz_showV(value)`: the chosen mode's colour map, driven by uniforms (`u_pvMode`, `u_pvMin`, `u_pvMax`, `u_pvStep`, `u_pvMag`, `u_pvFlat`, and `u_pvGrid` = Detail's squares and lines per unit).
  - There is one display program per (shader, node, type), so **switching mode is a uniform change, not a compile**.
  - Both compile off-thread (`compileAsync`). Errors are captured quietly, so a program that fails never shows as the graph's error. A node whose variable only exists inside a block, for example, just stays Raw.
- **Drawing the eye preview** (`lib/nodePreview/valuePreviewRunner.ts`, run by `ShaderCanvas`).
  - While the eye is on a float or vec2 node in a mode other than Raw, the picture's mesh draws with the display program for that frame. **There is no extra pass**: it replaces the preview graph's own draw.
  - A feedback graph (u_prevFrame) keeps its history: there the display draws over the screen after the frame.
  - Arrows, the slice plot and the key are drawn on a 2D canvas over the picture (`components/PreviewValueOverlay.tsx`), from the readback. Arrow strength is `valueField.arrowStrength` (magnitude / the global max); `showAs.gridDensity` and `showAs.arrowCellPx` map Detail.
- **Readback** (asynchronous, a frame or two late).
  - The value program draws into a small RGBA32F target. It has about 36.9k texels (256 × 144 at 16:9) and follows the picture's aspect.
  - The target is read with `readRenderTargetPixelsAsync` (PIXEL_PACK_BUFFER + fence: no stall). There is one readback in flight at a time, and at most one every 150 ms while the picture animates. A still picture samples each frame it draws, and redraws once more if the range moved.
  - `fieldStats` gives the range, the constant check (equal within 1e-5 relative), the longest vec2 and the input's range. Those go into the display uniforms.
  - The field is published on `previewBus`.
- **The card** (`components/NodeGraph/ValuePreview.tsx`).
  - It paints from the same field on the CPU (`valueField.paintField`), with formulas that mirror the GLSL.
  - The field is resampled bilinearly to the card. Grid keeps the nearest texel across a jump (a fract or repeat seam) so seams stay sharp.
  - Painting is capped at about 90k pixels per readback. Nothing extra renders on the GPU for the card.
  - The old 200 × 200 thumbnail render (a second WebGL context) is skipped for these nodes.
- **Choices** (`lib/nodePreview/showAs.ts`).
  - `useNodePreviewPrefs` keeps `{ output, vec2, float, sliceY, diagram, detail }` per node, keyed `nodeId|type`. Ids restart in every graph, and a different node type under a reused id starts from its own default.
  - Choices are stored in localStorage (`playfield.nodePreviewPrefs.v1`, the newest 400), not in the graph. Picking a mode never recompiles, never lands on the undo stack, and never marks the graph dirty.
  - `pickPreviewOutput` is shared by the store's `buildPreviewGraph`, `compileNodePreviewShader`, the runner and the UI, so they agree on the output.
- **Removed from the eye's per-frame work.** The card's float waveform scope (a synchronous 1-pixel `readPixels` every third frame) now runs only while that waveform canvas is actually shown.

## Cost (measured)

These numbers come from headless Chrome (Metal), on a 608 × 860 picture with animated FBM (6 octaves) → Multiply, the clock running, at 60 fps throughout:

| | CPU per frame (avg / p95) | GPU per frame | sync readbacks / frame |
|---|---|---|---|
| Eye off | 0.7 / 1.3 ms | 0.68 ms | 0 |
| Eye on, Raw | 2.0 / 5.7 ms | 0.67 ms | 0.83 (was 1.17) |
| Eye on, Range | 1.7 / 5.3 ms | 1.00 ms | 0.83 |
| Eye on, Slice | 1.7 / 5.7 ms | 0.96 ms | 0.83 |
| Eye on, Contours | 1.8 / 5.5 ms | 1.01 ms | 0.83 |

- The jump from "off" to "Raw" is the eye's existing probes: the upstream and precise-value 1-pixel reads that card readouts use. The new work doesn't add to it.
- The new work, per readback (about 6 a second):
  - value draw submit: about 0.1 ms CPU
  - async readback: 6–8 ms from request to data, off the main thread's critical path
  - stats: 0.1–0.5 ms
  - card paint: 1–3 ms (contours 5 ms)
  - overlay: about 0.1 ms
- The display colour map adds about 0.3 ms GPU on that picture.
- No program compiles when you switch mode.

## Limits

- The value target is small (about 37k texels), so the card's picture and the arrows come from a coarse field. The eye's colour maps are full resolution because they run per pixel on the GPU. Nodes that use `u_resolution` or pixel-sized widths see the small target's size in the readback.
- Precision: the readback is float32. The preview graph is the node and its ancestors, as the eye has always compiled it. A node only a Pass draws (not the picture) falls back to Raw: its variable isn't in the picture's program.
- Slice compares against one input. Multi-input nodes outside the transform list show only the output.
- vec3 colours are unchanged. HDR auto-range for colours isn't built.
- The mobile graph browser's static thumbnails are unchanged.
- Choices live in this browser's storage, not in the saved graph. They don't travel with a shared file.
