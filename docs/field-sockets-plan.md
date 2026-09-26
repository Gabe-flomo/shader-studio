# Field sockets: a shape by wire, grid overflow, and the Array node

Implementation guide. Written so a fresh session can build this without the
conversation that led to it. Status: **built**; see `docs/field-sockets.md`
for how it works and where the implementation differs from this plan. Function discovery is
being built in a separate session at the same time; see *Coordination* at
the end before touching shared files.

## 1. What we are building, and why

Today a wire carries a **value**: the number a node computed at this pixel's
position. Grid Pattern (`src/nodes/definitions/gridPattern.ts`) wants a
**shape**, which is a function of position: it must evaluate the shape once
per cell, in that cell's coordinates, and (for shapes that cross cell
borders) for the neighbouring cells too. A value cannot do that, so the
current design is two nodes with the shape chain in between:

    Grid Pattern ──Cell UV──▶ Circle SDF ──Distance──▶ Grid Paint

This works but the user wants the one-node version as well: wire Circle SDF
straight into Grid Pattern, no Grid Paint. That needs a socket that receives
the sender's **body** (its code as a function of position), not its output.
We call these **field sockets**. The same mechanism gives us:

- **Grid overflow**: shapes that slide across cell borders without clipping
  (the grid calls the shape for the 3×3 or 5×5 neighbouring cells and
  combines: `min` for distances, over-composite for colours).
- **The Array node**: N copies of a shape in a line, grid or ring, offset
  per index, combined with min / smooth-min / add. It is the same call made
  N times at N positions.

Three levels of complexity should exist afterwards:

| Level | What the user does | Exists? |
|---|---|---|
| Dropdown | Grid Pattern's built-in shape | yes |
| One wire | Circle SDF → Grid Pattern's **Shape** field socket | **build this** |
| Two nodes | Grid Pattern → anything → Grid Paint | yes |

## 2. How the compiler works today (what you can lean on)

All in `src/compiler/shaderAssembler.ts` unless noted.

- Nodes are compiled in topological order into the body of `main()`. Each
  node's `generateGLSL(node, inputVars)` returns `{ code, outputVars }`;
  `inputVars[key]` is the GLSL expression/variable of whatever is wired into
  that input, or undefined when unwired. Output variables are named
  `<slug>_<name>` (`nodeSlug.ts`).
- The pixel position is one variable, `g_uv`, declared at the top of
  `main()` (aspect-corrected, x in ±aspect, y in ±1). The `uv` node's output
  *is* `g_uv`, and many nodes fall back to `g_uv` when their position input
  is unwired (`inputVars.uv ?? 'g_uv'`). **This is the trick the whole
  feature rests on**: if a generated function's parameter is *named*
  `g_uv`, every node compiled inside that function is automatically
  evaluated at the parameter instead of the pixel.
- Numeric params become uniforms named `u_p_<slug>_<key>` in uniform mode
  (`uniformPatcher.ts`); node definitions read them through `p()` /
  `pv3()` (`definitions/helpers.ts`). Keyframes and Play controls write
  those uniforms. Uniforms are global, so code moved into a function keeps
  its sliders working with no extra plumbing.
- **Precedent for a function-typed wire: `scene3d`.** `DataType` in
  `src/types/nodeGraph.ts` already has `"scene3d"` and `"spacewarp3d"`. The
  Scene Group is compiled by `compileSceneGroupNode` (around line 1350)
  into a real GLSL function: it compiles the subgraph's nodes into
  `sceneFnLines`, treats the `scenePos` node as the function parameter,
  collects extra parameters for the group's outer ports in
  `sceneFnExtraParams`, and emits `float <fnName>(vec3 p, …)`. The March
  Loop Group then *calls* `<fnName>` as often as it likes (around line
  1635, `sceneFnName`). Field sockets are the 2D version of exactly this,
  without requiring the shape to live inside a group.
- Groups (`compileGroupNode`, line ~666) compile their subgraph inline with
  a prefix per pass (`compileSubgraphPass(prefix, portInputOverrides, …)`).
  That prefixing machinery is what you reuse to give the function's copies
  of nodes unique variable names.
- Wire validation lives in the store (`src/store/useNodeGraphStore.ts`,
  connect actions) and `src/compiler/validate.ts`.

## 3. Design

### 3.1 Declaring a field socket

Add to the input definition type (`NodeDefinition['inputs'][key]`, see
`InputSocket` in `src/types/nodeGraph.ts`):

```ts
/** This input receives the sender's code as a function of position, not its value.
 *  The socket's `type` is the function's return type (float or vec3). */
field?: boolean;
```

Keep the socket's `type` as the plain return type (`float` for a shape,
`vec3` for a picture), so existing wire-type checks still accept a Circle
SDF (float) or a Palette (vec3) into it. The compiler consults
`getNodeDefinition(node.type).inputs[key].field` to decide how to treat the
wire. No new `DataType` is needed. (If you prefer a distinct wire colour,
add it in the NodeComponent socket render by looking up the definition, not
by changing the type.)

### 3.2 Compiling a field chain

New method on the assembler, called instead of the normal value lookup when
a wired input is a field socket:

```
compileFieldFunction(consumerNode, inputKey) → fnName
```

1. **Collect the chain.** Start at the node/output the wire comes from and
   walk upstream through connections until nodes with no wired inputs. This
   is the *field chain*. Topologically sort it (there is `topoSort.ts`).
2. **Reject impure nodes.** Anything that reads the previous frame or other
   frame state (`echo`, feedback / Previous Frame nodes, particle nodes,
   Play `layers` node), and for v1 also `group` (iterated groups) and
   `sceneGroup`. Report through the normal compile-error path
   (`nodeErrors.ts`) with a message like “Echo can't be part of a shape wired
   into Grid Pattern's Shape: it reads the previous frame.” Iterated groups
   inside a field chain are a v2 item; `compileSubgraphPass` can probably
   run inside the function buffer, but do not attempt it first.
3. **Emit the function.** Compile each chain node with the existing
   per-node path, but into a separate line buffer and with a unique
   variable prefix (e.g. `fld_<consumerSlug>_<inputKey>_`), then wrap:

   ```glsl
   float fieldfn_gp_0_shape(vec2 g_uv, vec2 fieldCell, float fieldInfluence, float fieldIndex) {
       // chain nodes here, exactly as they compile in main, prefixed
       return <prefixed output var of the wired output>;
   }
   ```

   Because the parameter is named `g_uv`, every UV node and every
   `?? 'g_uv'` default inside the chain is now relative to the call. Time,
   Mouse, textures and param uniforms are global and keep working. The
   function goes into the helper section (the assembler has a `functions`
   Set for helpers; order it after any `glslFunction` helpers the chain's
   nodes declare, which are already collected globally).
4. **Hand the name to the consumer.** Set `inputVars[inputKey] = fnName` for
   the consumer's `generateGLSL`. Convention: for a field socket,
   `inputVars[key]` is a function name, and the node calls it as
   `fnName(pos, cell, influence, index)`.
5. **Do not compile the chain in `main()` unless something else reads it.**
   If a chain node also feeds a normal socket somewhere, it compiles in
   `main()` as before; the function has its own prefixed copy. Duplicate
   code is acceptable.
6. **Caching.** Two field sockets fed by the same chain should get one
   function; key by (source node id, output key, extra-param signature).

### 3.3 Per-cell information inside the chain: the `Cell` source node

A new source node `fieldCell` (label “Cell”, category Sources) with outputs
`cellID: vec2`, `influence: float`, `index: float`, `local: vec2`. Inside a
field function these compile to the extra parameters (`fieldCell`,
`fieldInfluence`, `fieldIndex`, `g_uv`); compiled in `main()` (outside any
field chain) they are `vec2(0.0)`, `0.0`, `0.0`, `g_uv`. This lets a user
hash the Cell ID into a circle's radius while still using one wire.
Implementation: the assembler knows whether it is currently emitting a
field function (a flag/stack set in step 3) and `fieldCell.generateGLSL`
reads that through the compile context; if the definition API has no
context, special-case the type in the assembler as `scenePos` is.

### 3.4 Grid Pattern changes (`gridPattern.ts`)

- New inputs: `shape: { type: 'float', field: true }` and
  `picture: { type: 'vec3', field: true }`. Precedence when deciding the
  mask: Shape wired → its SDF; else Picture wired → whole placed cell
  shows the picture; else the built-in dropdown shape. Colour: Picture if
  wired, else Colour input/param.
- Call convention inside the node's GLSL: `shape(q, cid, inf, 0.0)` where
  `q` is the cell's already-effected coordinates (`_rq`, which is rotated
  and divided by the scale factor). Keep the current built-in path as the
  fallback.
- New param `overflow: 'none' | 'neighbours' | 'far'` (1, 3×3, 5×5).
  With overflow on, loop over neighbour offsets `(i, j)`; for each, derive
  that neighbour's `cid`, its jitter, influence and affect (reuse the same
  formulas; factor the per-cell part into a helper `gpCell(...)` that
  returns q, on, inf, scale for a given cell id and local offset), call the
  shape in that frame, and combine: `d = min(d, dn)` for distances; for
  pictures composite with each neighbour's mask (nearest cell last). Drop
  the `0.45` clamp on pull/push when overflow is not `none`. GLSL ES 1.00
  needs constant loop bounds: emit the 3×3 or 5×5 loop with literal bounds
  chosen at compile time from the param.
- Cost note in the hint: 9× / 25× shape evaluations.

### 3.5 Socket UI

In `src/components/NodeGraph/NodeComponent.tsx`, when the definition's input
has `field: true`, draw a small ƒ badge on the socket (the input-expression
mark already uses an ƒ glyph and `tk.kind.expr`; use a distinct tooltip:
“Takes the wired node's code as a function of position, evaluated per
cell”). Grid Paint's description and Grid Pattern's description should
mention both routes.

### 3.6 The Array node (after the above works)

`arrayField` (label “Array”, category 2D Space or Grid): inputs `shape`
(float, field), `picture` (vec3, field), `count`, `spacing` (vec2),
`origin` (vec2), `rotation`; params `layout: line | grid | ring`, `combine:
min | smin | add | max`, `smoothK`, `cols` (grid), `radius`,
`startAngle`, `sweep` (ring); per-index variation through the `Cell` node's
`index` output (e.g. `radius = 0.1 + 0.02 * index` via an input expression
or Multiply). Outputs `distance`, `mask`, `color`, `nearestIndex`. Compile
a loop with a literal bound (cap count at 64 for ES 1.00), positions from
the layout, `shape(uv - pos_i, vec2(i), 0.0, float(i))`, combine. The Play
Cloner layer (`docs/cloner-layer.md`) is the layer-side analogue; keep the
layout names the same.

## 4. Files you will touch

- `src/types/nodeGraph.ts`: `field?: boolean` on input definitions.
- `src/compiler/shaderAssembler.ts`: `compileFieldFunction`, the
  field-context flag, wiring into the per-node input resolution (where
  `inputVars` is built, near `compileNode` ~line 640–660), rejection list.
- `src/compiler/validate.ts` and the store's connect validation: allow a
  float/vec3 output into a field socket of the same base type.
- `src/nodes/definitions/gridPattern.ts`, new `fieldCell.ts`, later
  `arrayField.ts`; register in `definitions/index.ts` and
  `components/NodeGraph/NodeBrowser.tsx` (Grid → Layout; Sources).
- `src/components/NodeGraph/NodeComponent.tsx`: socket badge.
- `src/store/comboExamples.ts` (uses `graphBuilder.ts`): add an example per
  route (“Combo: Grid Pattern + Shape by wire”, “Combo: Array of stars”);
  `exampleIndex.ts` index rows and the Node Combos folder.
- Docs: extend `docs/cloner-layer.md`'s sibling, or add
  `docs/field-sockets.md`; README docs table.

## 5. Tests (must pass before pushing)

- New `src/compiler/__tests__/fieldSockets.test.ts`: (a) UV → Circle SDF →
  Grid Pattern Shape compiles, the shader contains one `fieldfn_` function
  whose parameter list starts with `vec2 g_uv`, and Grid Pattern calls it;
  (b) an unwired-position node in the chain (Circle SDF with no UV wired)
  still becomes cell-relative (the function body references the parameter,
  not a global); (c) Time and a param uniform inside the chain compile and
  the uniform name is unchanged; (d) Echo in the chain produces the
  rejection error; (e) the same chain wired into two field sockets emits
  one function; (f) Cell node outputs the parameters inside the chain and
  zeros outside; (g) overflow `neighbours` emits a 3×3 loop with literal
  bounds; (h) Array node with `ring` layout compiles for count 12.
- `src/nodes/__tests__/gridPattern.test.ts` keeps passing (built-in path).
- `src/compiler/__tests__/registry.test.ts` “no dead sliders” passes for
  the new nodes (every param must be read in the default configuration).
- `src/store/__tests__/examples.test.ts` for the new combos.
- Browser check with the dev server (`npx vite --port 5173`) and
  Playwright (Chromium is at `/opt/pw-browsers`; the store is exposed as
  `window.__shaderStudio`, examples load with
  `getState().loadExampleGraph(key)`, and the preview is the last `<canvas>`
  on the page): the shaders must compile with an empty
  `getState().glslErrors`.

Project checks: `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`,
`npx eslint src` (baseline is 121 problems; do not add to it).

## 6. Acceptance

- Circle SDF wired into Grid Pattern's Shape draws circles on the grid with
  nothing else wired; the circle's Radius slider still works live; a Cell →
  hash → Radius chain varies size per cell.
- With Affect = Pull and Overflow = Neighbours, a shape pulled past a cell
  edge continues into the next cell with no seam.
- Array node with a Shape by wire draws N copies on a line, grid or ring.
- Every existing example and test still passes; lint baseline unchanged.

## 7. Coordination

- Branch from `main` (all of the above context is on `main` as of commit
  `4405815`). Use your own branch; push to `main` only when green.
- Another session is building **function discovery** at the same time. Do
  not edit these files, they are in flight there:
  `src/glsl/discover.ts`, `src/glsl/__tests__/discover.test.ts`,
  `src/components/code/DiscoverFunctionsModal.tsx`,
  `src/components/code/GlslEditor.tsx`, `src/components/GLSLPage.tsx`,
  `docs/function-discovery.md`. If you must change one, keep the change
  minimal and mention it in the commit message.
- Commit messages: a short title, then a plain paragraph on what changed
  and why. No model names in commits.
