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

Examples: *Combo: Grid Pattern + Shape by wire*, *Combo: Array of stars*,
*Combo: Grid Pattern + grouped flower* (a Group as the shape) and *Combo:
Array of grouped moons* (a chain crossing into a group through a port) in
Node Combos.

## How it compiles

All in `src/compiler/shaderAssembler.ts` (`compileFieldFunction`), with the
shared bits in `src/compiler/fieldSockets.ts`.

- A definition input with `field: true` (see `InputSocket` in
  `src/types/nodeGraph.ts`) is a field socket. Its `type` is the function's
  return type, so the wire checks are the ordinary ones.
- When a node with a wired field socket compiles, the assembler collects the
  **field chain** (the wired node and everything upstream of it) and compiles
  it a second time, through the same per-node paths as `main()`, into

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
  Previous Frame, the blurs, Bloom…), Play Layers, particles, and the 3D
  groups (Scene, March Loop, GI, Space Warp). A Group is allowed when
  nothing inside it is rejected; otherwise the message is on the group
  ("it contains Echo, which reads the previous frame").
- A field socket takes no input expression (the popover does not offer
  one; a stored one is ignored), and a bypassed node ignores its field
  sockets.

Nodes read a field socket through `fieldFn(inputVars.key)` from
`src/nodes/definitions/helpers.ts`, which returns the name only when it
really is a field function.

## Groups

Field sockets work across groups. Every node compiled into `main()`
registers a **unit** (`FieldUnit` in `shaderAssembler.ts`): top-level nodes
under their own id, nodes inside a group under the prefixed id the group
compiler gave them (`grid_0_g_circ_0`). A unit records which units its code
reads, with group input ports already followed out to whatever is wired
into them, and how to re-emit itself. A field chain is collected over those
units and re-emitted in `main()` order. Group slugs are computed once per
group and reused, so a re-emitted node declares the same variable names and
reads the same `u_p_*` uniforms as its `main()` copy (sliders stay live).

- **A Group as the shape.** A Group wired into a field socket (or anywhere
  in a chain) is compiled whole inside the function, through the ordinary
  group path. A single-pass group compiles only the nodes that feed the
  outputs the chain reads, so a group with Distance and Colour outputs
  wired into Shape and Picture gives two functions, each with only its
  half.
- **A field socket inside a group.** Grid Pattern or Array inside a group
  builds its function from the group's own nodes.
- **Across the boundary.** A chain wired in through a group input port
  (any port type: float, vec2, vec3) is followed out of the group, through
  nested groups too, so the function contains the outside nodes.
- **Iterated groups.** An iterated group in a chain is compiled with its
  loop inside the function. A field socket inside an iterated group works
  when its chain doesn't read the loop; a chain that reads Loop Index, a
  carried port, a carry-mode or accumulating node is rejected on that node
  ("it reads a value carried round an iterated group's loop"): the function
  is defined once, outside the loop, and can't see the loop's variables.
- **Nested groups** work at the two levels the group compiler inlines.
- **Loose groups** are visual only and don't reach the compiler.
- Inside a chain the UV node and the Cell node are told they are in a field
  function on every path, including inside groups (the UV node used to read
  `vUv` there).

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

- A chain that reads an iterated group's loop from inside that group (see
  Groups above). Build the loop-dependent part outside the chain, or set
  the group's iterations to 1.
- A field socket inside a group that is published as a node, whose shape
  comes in through the published node's input: that input is a function
  argument, which the field function can't see. It is reported on the
  card.
