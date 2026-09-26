# GLSL → node graph: research, prototype, plan

*Status: converter in `src/glslToGraph/`, and a first UI: the **Convert** tab (`src/components/convert/`). Written 2026-09-26.*

## The question

Can we take a hand-written fragment shader, build a node graph that renders the
same picture, prove it does by rendering both, and tell the user up front which
parts will stay as code (Expression Blocks / Custom Functions) and which can't
convert at all?

**Short answer: yes.** The prototype converts 11 of 12 test shaders into graphs
that render **pixel-identical** to the original (max error 0 of 255 at 96×96,
dithering off, same GPU), and refuses the 12th before converting, naming the
reason (`discard`). Conversion is deterministic and takes 10–40 ms per shader.

## What exists now

| File | What it is |
|---|---|
| `src/glslToGraph/index.ts` | The converter: GLSL source → `{ nodes, report }`. Pure; no store, no UI. |
| `src/glslToGraph/__tests__/corpus/*.frag` | 12 shaders of rising difficulty (below). |
| `src/glslToGraph/__tests__/glslToGraph.test.ts` | Every corpus shader converts to a graph the compiler accepts, or is refused with a reason; determinism; slider/report checks. |
| `tools/g2n-roundtrip.ts` | Converts a folder of shaders, compiles each graph with the app's compiler, writes original + graph GLSL, uniforms, report. |
| `tools/g2n-pixel-compare.mjs` | Renders each pair headlessly (Playwright + SwiftShader) and reports max / mean error, PSNR, % bad pixels. |

Run it:

```
npx vite-node tools/g2n-roundtrip.ts src/glslToGraph/__tests__/corpus /tmp/g2n-out
node tools/g2n-pixel-compare.mjs /tmp/g2n-out
```

Parser: [`@shaderfrog/glsl-parser`](https://github.com/ShaderFrog/glsl-parser) 7.0.1
(ISC, zero deps, GLSL ES 1.00/3.00, full AST with scopes and a code generator).
It is the only JS parser that both parses to a typed AST and regenerates source,
which the "fall back to the original text" rungs below depend on.

## How the converter works

The source is normalised first (Shadertoy `mainImage(out vec4 fragColor, in vec2
fragCoord)` becomes `main()`; `iTime`/`iResolution`/`iMouse` become
`u_time`/`u_resolution`/`u_mouse`; simple `#define NAME value` macros are
expanded; `vUv` becomes fragCoord ÷ resolution). Then `main()` is walked
statement by statement, keeping an environment of *variable name → value in
flight*, where a value is either a node output or a float literal not yet spent.
Each expression takes the highest rung it can:

1. **A node.** `a * b` → Multiply, `sin(x)` → Sin (freq 1, amp 1), `vec3(r, g, b)`
   → Make Vec3, `p.x` → Split Vec2, `smoothstep(e0, e1, x)` → Smoothstep, `gl_FragCoord`
   → Frag Coord, `u_time` → Time… A **literal operand becomes the node's slider**:
   `uv * 4.0` is a Multiply with B = 4. That is the "procedural" payoff: the
   graph arrives with every magic number already draggable (case 06 yields 17
   sliders, case 07 15).
2. **An Expression Block.** Anything rung 1 can't express becomes an Expression
   Block whose inputs are the live variables it reads and whose expression is
   the original sub-expression **verbatim** (regenerated from the AST). Examples:
   `abs(x)` (no Abs node), `.xyx` swizzles, `vec3(vec2, float)`, `mat2(...) * uv`,
   `a / b` when `b` might be ≤ 0 (see traps). The block is as small as possible:
   only the offending sub-expression, so its neighbours still become nodes.
3. **A Custom Function region.** A call to a user function, or a loop that can't
   be a group, becomes a Custom Function node carrying that code plus every
   helper it reaches (transitively, in program order). Loops that change one
   live variable become `T loop(inputs) { … return v; }`.

Statements: declarations and assignments (including `+=` etc. and single-component
writes like `uv.x *= …`, done with Split + Make); `if`/`else` where both branches
are evaluated on copies of the environment and each changed variable becomes a
ternary block `(cond) ? then : else`.

**`for` loops** with constant bounds (1 to 16 iterations) and no early exit
become the app's own loop construct, an **iterated group**: the body converts
to nodes inside the group's subgraph, the loop variable is a **Loop Index**
(scaled and offset when the loop doesn't count 0, 1, 2…), and every outer
variable the body changes gets a **Loop Carry**: init from outside through an
input port, next from the body's last value for it, the final value on an
output port that the code after the loop reads. Other outer values the body
reads (variables, time, resolution…) come in through ports too, one per value.
Carry init ports are emitted first, in the output ports' order, because the
compiler pairs input and output ports by position as carries: that pairing
then names the same carries the Loop Carry nodes do. An `if` inside the loop
is a ternary block inside the group. Loops with `break`/`continue`/`return`,
non-constant bounds, more than 16 iterations, or a loop inside a loop stay
rung 3 (a region), which is why the 64-step raymarcher is still code.

The **report** lists every block and region with the reason, counts sliders
and loops, and lists what makes the shader unconvertible (`unsupported`):
`discard`, textures, uniforms with no source node, globals, arrays, `return`
in main. That report is the preview step.

The graph is laid out in columns by depth (sources left, Output right).

## Results

| # | Shader | Nodes | Blocks | Regions | Sliders | Pixels vs original |
|---|---|---|---|---|---|---|
| 01 | circle (smoothstep) | 8 | 0 | 0 | 3 | identical |
| 02 | cosine palette (`uv.xyx`) | 6 | 1 | 0 | 0 | identical |
| 03 | rings with glow (`abs`) | 20 | 2 | 0 | 3 | identical |
| 04 | helper function `sdBox` | 18 | 1 | 1 | 3 | identical |
| 05 | `if` branch + step | 15 | 2 | 0 | 0 | identical |
| 06 | `for` loop, 4 iterations → iterated group carrying `a` | 16 | 0 | 0 | 5 | identical |
| 07 | plasma (sqrt) | 49 | 1 | 0 | 15 | identical |
| 08 | rotation + hash + `discard` | – | – | – | – | **refused: `discard`** (preview still lists 2 regions) |
| 09 | Shadertoy fbm (`mainImage`, 3 nested helpers, loop) | 15 | 0 | 1 | 0 | identical |
| 10 | inline `mat2` rotation, box SDF | 25 | 4 | 0 | 4 | identical |
| 11 | raymarcher (64-step loop with `break`) | 18 | 2 | 1 | 2 | identical |
| 12 | editor-style (`#define`, `vUv`, value noise helper) | 34 | 0 | 1 | 8 | identical |
| 13 | loop carrying three variables (`v`, `p`, `a`) | 10 | 0 | 0 | 3 | identical |
| 14 | loop with a stepped counter (`k = 1; k <= 7; k += 2`) | 10 | 0 | 0 | 3 | identical |
| 15 | `if` inside a loop, two carries | 8 | 1 | 0 | 2 | identical |

Determinism: converting each shader twice gives byte-identical graphs (15/15).

Comparison recipe (from the WebGL CTS / GraphicsFuzz survey): same context,
`antialias: false`, dither disabled, `highp`, fixed `u_time = 1.5`, fixed
resolution and mouse, sliders set to their compiled values, max-abs error and
PSNR reported. The gate I'd ship with: max ≤ 2/255 on ≥ 99.9 % of pixels and
PSNR ≥ 40 dB counts as "same"; anything else shows the diff.

## Traps found (worth knowing regardless of this feature)

- **Several math nodes are "safe" versions of GLSL, not GLSL.** Divide emits
  `a / max(b, 0.0001)` (wrong for negative divisors), Pow clamps its base to ≥ 0,
  Sqrt clamps its input. The converter maps `/` to Divide only when the divisor
  is provably positive (a literal, the resolution or one of its components) and
  never maps `pow`/`sqrt`; otherwise it keeps the original text in a block. The
  equivalence check is what makes this visible: an early version mapped `/`
  blindly and was caught. A future "exact" flag on those nodes would let more
  expressions become nodes.
- **Sliders are uniforms.** The compiled graph reads slider values from uniforms
  (`paramUniforms`), so any standalone render of graph GLSL must set them; the
  first comparison run had every slider at 0.
- The parser files calls to user functions under `type_specifier` (as if
  constructors); overload resolution is by name + arity only.
- `vUv` (0..1) and the UV node (`g_uv`, centred, aspect-corrected) are different
  frames; imported shaders keep theirs (fragCoord ÷ resolution).

## Prior art (survey, with links)

- Nobody decomposes shader code into fine-grained nodes as a product. Shaderfrog
  ([core](https://github.com/ShaderFrog/core)) wraps a whole program per node and
  inlines ASTs into a megashader; NodeToy, Unity Shader Graph, Amplify, Unreal,
  Substance, TouchDesigner, Godot all offer a "custom code" node and no
  code→nodes import. Unreal's [HLSLMaterial](https://github.com/Phyronnaz/HLSLMaterial)
  and Blender's [Malt](https://github.com/bnpr/Malt) make one node per
  *function signature*.
- The closest real precedent is three.js's own
  [GLSL → TSL transpiler](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/transpiler)
  (hand-written parser, emits TSL node chains, `Loop()`, `If()`, `Fn()`): a
  code-to-node-graph decompiler in all but UI. Its shape matches this prototype.
- Techniques that would improve graph *quality*, not correctness: hash-consing
  for common-subexpression sharing; e-graphs / equality saturation
  ([egg](https://github.com/egraphs-good/egg)) to canonicalise `x*x` vs `pow`,
  `0.5 + 0.5*cos(...)` → a Palette node, etc., with a cost model preferring
  library nodes; SSA (what the environment map already is).
- Equivalence testing: WebGL CTS uses exact match for colour tests and 1–12/255
  tolerances for built-in-function emulation; GraphicsFuzz uses histogram
  distance and renders twice to detect nondeterminism.

## What can't convert yet, and how each would

| Construct | Today | Plan |
|---|---|---|
| `discard` | refused | `if (c) discard;` → alpha 0 through Output (RGBA); a general `discard` stays refused |
| textures / `iChannelN` | refused | Texture Input node + `texture2D` → its colour/alpha outputs; iChannel slots become upload prompts in the preview |
| unknown uniforms | refused | become Play controls (a uniform *is* a slider) or Constant nodes; the preview asks for a default |
| global variables | refused | treat as first-assignment locals when only written in main; else region |
| arrays, structs | refused | region (Custom Function) |
| loop changing 2+ variables | iterated group (done) | a loop with `break` still needs a region; a "stop when" port on iterated groups would lift that |
| vec4 arithmetic, `vec3` length/dot/normalize, `abs`, `pow`, `sqrt`, `min/max` on vectors | block | new nodes or type-generic versions of existing ones; an "exact" switch on Divide/Pow/Sqrt |
| `.xyx`-style swizzles | block | a general Swizzle node (any pattern, any width) |
| `mat2(c,-s,s,c) * v` | block | recognise the rotate pattern → Rotate 2D node |

## The Convert page (shipped)

`Convert` in the top nav is the Studio with the shader beside it:

- **Left: the shader**, in the GLSL page's editor (line numbers, colouring,
  Tab/Enter/bracket handling, its own undo; `GlslEditor` is now shared by both
  pages). Paste a file, open one, or pick an example. Under it, **the check**:
  the original and the converted graph rendered on one clock (two small WebGL
  canvases with the same uniforms and time) with a **Same picture / Differs**
  badge (max error and % of pixels off), then what can't convert, the inexact
  nodes (each a switch between *Node ≈* and *Expression Block*), kept
  expressions, kept functions, notes.
- **Centre: the real canvas, read-only.** The converted graph is put on the
  Studio's own `NodeGraph` through the store's *scratch* mode
  (`beginScratch` / `setScratchNodes` / `endScratch`): the user's graph, Play
  setup, saved-graph identity and dirty flag are kept aside while the page is
  open and restored when it closes. The canvas is `locked`: cards and wires are
  a picture (no drags, sockets, menus, palette, auto layout or clear), the view
  still pans, zooms, fits and box-selects; undo/redo and the editing shortcuts
  sit out. Click a card for its details (a floating card, with the ≈ choice).
  The view starts at a readable zoom on the sources when the whole chain
  wouldn't fit legibly. The app's preview on the right renders the graph live.
- **Materialize** keeps the scratch graph as the real one (undoable, unsaved)
  and opens the Studio; kept code carries a `FROM CODE` badge, inexact nodes an
  `≈` badge with the reason on hover. **Keep as one node…** is the older import.

Layout: the converter places nodes with the Studio's rank columns (440 px
apart, card heights estimated the way auto layout does), in program order down
each column.

Decisions taken with you: badges on imported code (yes); inexact expressions
are offered as the node with a warning, with the option to keep the code
exactly, per expression; the preview is the real canvas, read-only until
materialized.

## Product plan

**Where it lives.** Two entry points, both already natural in the app:

1. **GLSL page → "Convert to nodes".** The editor already has the shader
   rendering; the button opens the preview.
2. **Import → paste GLSL / Shadertoy.** Today this makes one code node (the
   existing `convertFragmentShader`). It gains a "Break into nodes" choice.

**The preview step** (the one the request describes):

- Left: the original rendering (already there). Right: the converted graph
  rendered live, with a **Same / Differs** badge from the pixel comparison and a
  diff view on hover. Both rendered by the app's own canvas, so the comparison
  is the real thing.
- A list, from the report: *N nodes · M sliders discovered · K expression blocks
  · J code regions*, each block/region named by its code with the reason
  ("abs has no node yet", "loop can't be unrolled"). Unsupported items shown in
  red with the plain-language fix ("this shader uses a texture; textures can't
  be imported yet — keep it as one node").
- Choices: **Convert** (place the graph), **Keep as one node** (today's path),
  Cancel. If the comparison says Differs, Convert stays available but says so.

**Deterministic by construction.** Same source → same graph, verified by test.
No randomness, no timestamps in ids (ids are sequential per conversion).

**Roadmap.**

- *Phase 1 (ship):* preview dialog + Convert, using the converter as is, for
  straight-line shaders and helper functions. Equivalence badge via the app's
  offline renderer (the export path already renders a graph at a fixed time and
  reads pixels back; render the original through the GLSL page's material the
  same way). ~1 week.
- *Phase 2 (coverage):* the node additions in the table above, an "exact" switch
  on the guarded math nodes, discard→alpha, unknown uniforms → Play controls.
  Each addition moves shaders from blocks to nodes; the corpus and pixel gate
  keep them honest. ~1–2 weeks, incremental.
- *Phase 3 (quality):* common-subexpression sharing (hash-consing on
  `(op, inputs, params)`), pattern recognition for the app's higher-level nodes
  (palette, SDF shapes, rotate), a layout pass that groups a helper function's
  nodes into a Group. This is where an e-graph would earn its place; a small
  port is a few hundred lines.
- *Phase 4:* textures, Shadertoy buffers (multi-pass → Prev Frame); loops with
  `break` (an early-exit port on iterated groups) and loops over 16 iterations.

**Open questions for you.**

1. Should blocks and regions be *visibly different* on the canvas after import
   (a badge "from imported code"), so people know where to click to keep
   refactoring by hand?
2. When the comparison differs (say, a `pow` on a signed base), do you want
   Convert to insist on exactness (keep that part as a block, which it does
   today) or offer the node with a warning?
3. Which corpus do you want it judged against? Your own shaders would be the
   best test set; paste a handful into `src/glslToGraph/__tests__/corpus/` and
   the round-trip tool reports on them.
