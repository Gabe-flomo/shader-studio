# Field sockets

A wire normally carries a **value**: what the sending node computed at this
pixel. A **field socket** receives the sender's **code** instead, compiled as
a GLSL function of position, so the receiving node can evaluate the shape
wherever it likes: once per grid cell, for the neighbouring cells, once per
copy in an array.

A field socket is marked with a small **ƒ** next to its name on the card.
The wire into it is an ordinary float or vec3 wire, so anything that makes a
distance (Circle SDF, Shape SDF, a union, a Custom Function) or a colour
(Palette, FBM → Palette, a texture) can go into it.

| Node | Field sockets | What it does with them |
|---|---|---|
| Grid Pattern | Shape (float), Picture (vec3) | Draws the shape and/or picture in every placed cell, in that cell's coordinates with the pattern's effects applied. Overflow evaluates the neighbouring cells too. |
| Array | Shape (float), Picture (vec3) | Draws N copies on a line, grid or ring and combines them (min, smooth min, add, max). |

The **Cell** node (Sources) is what a field chain uses to vary per cell or
copy: inside a chain it outputs the cell's ID and the affect point's
influence (Grid Pattern), the copy's index (Array) and the local position.
Outside any field chain it outputs zeros and the canvas UV.

Three levels of shape on a grid:

| Level | What you do |
|---|---|
| Dropdown | Grid Pattern's built-in shape, nothing wired. |
| One wire | Circle SDF (or anything) → Grid Pattern's **Shape**. |
| Two nodes | Grid Pattern's Cell UV → anything → **Grid Paint**. |

Examples: *Combo: Grid Pattern + Shape by wire* and *Combo: Array of stars*
in Node Combos.

## How it compiles

All in `src/compiler/shaderAssembler.ts` (`compileFieldFunction`), with the
shared bits in `src/compiler/fieldSockets.ts`.

- A definition input with `field: true` (see `InputSocket` in
  `src/types/nodeGraph.ts`) is a field socket. Its `type` is the function's
  return type, so the wire checks are the ordinary ones.
- When a node with a wired field socket compiles, the assembler collects the
  **field chain** (the wired node and everything upstream of it) and compiles
  it a second time, through the ordinary per-node path, into

  ```glsl
  float fieldfn_<slug>_<output>(vec2 g_uv, vec2 fieldCell, float fieldInfluence, float fieldIndex) {
      // the chain's nodes, exactly as they compile in main()
      return <the wired output>;
  }
  ```

  and passes the function's **name** to the node in `inputVars[key]`. The
  node calls it as `fn(position, cellID, influence, index)`.
- The parameter is named `g_uv`, the name `main()` gives the pixel position,
  so every node that falls back to `g_uv` for an unwired position (Circle
  SDF, Box SDF, Shape SDF, noise…) is evaluated at the call's position.
  The UV node and the Cell node are told they are inside a chain
  (`inputVars.__inField`) and read the parameters.
- Time, the mouse, textures and param uniforms are globals and keep
  working. The chain's nodes keep the slug of their `main()` copy, so their
  uniforms are the same `u_p_*` names the sliders already write: a slider
  inside a field chain updates live, with no recompile.
- The `main()` copies of the chain stay. Node previews, the code panel and
  wired chips read them, and the GPU compiler drops what nothing uses.
- One function per source output and return type: two sockets fed by the
  same chain share it. Nested chains (an Array wired into Grid Pattern's
  Shape) produce nested functions, inner first.
- Nodes that are not a pure function of position are rejected with a
  message on the card: anything that reads the previous frame (Echo,
  Previous Frame, the blurs, Bloom…), Play Layers, particles, and groups.
- A field socket takes no input expression (the popover does not offer
  one; a stored one is ignored), and a bypassed node ignores its field
  sockets.

Nodes read a field socket through `fieldFn(inputVars.key)` from
`src/nodes/definitions/helpers.ts`, which returns the name only when it
really is a field function. Inside a group the subgraph is compiled by the
group's own path, which does not build field functions yet; there the
socket reads as unwired and the built-in behaviour is drawn.

## Grid Pattern's Overflow

With Overflow on Neighbours (3×3) or Far (5×5) each pixel also evaluates
the shape for the surrounding cells, each in that cell's own frame (its
jitter, placement, influence, pull or spin), so a shape moved, grown or
jittered past its cell edge continues into the next cell. Distances combine
with `min` (scaled back to cell units, so cells of different scale compare).
Colours composite over in one fixed order, row by row, so where two cells'
shapes overlap the same one is on top on both sides of the border. Pull and
Push can move a shape a whole cell once Overflow is on (Clip keeps them
inside the cell). The loops have literal bounds, as GLSL ES 1.00 needs. It
costs 9× or 25× the shape evaluations.

## Differences from the plan

`docs/field-sockets-plan.md` was the brief. What changed while building it:

- The chain's `main()` copies are kept instead of skipped: previews, the
  code panel, wired chips and slider bindings all read them.
- The field function reuses the chain's `main()` slugs instead of a
  `fld_…` prefix. Locals of different functions cannot collide, and the
  uniform names must stay the same for sliders to work.
- The UV node computes its output from `vUv`, not from `g_uv`, so it is
  told when it is inside a chain. Circle, Box and Ring SDF fell back to
  `vec2(0.0)` for an unwired UV; they now fall back to the canvas UV like
  every other shape node (no bundled example relied on the old fallback).
- Overflow composites in row-major order rather than with the pixel's own
  cell last, which cut overlapping shapes along the cell edge.

## Not yet

- Field sockets inside groups (the group compile paths would need to build
  field functions from their own subgraph, including group ports).
- Iterated groups inside a field chain.
