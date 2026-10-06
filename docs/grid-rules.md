# Grid Rules

A cellular simulation in one node. The **Grid Rules** node holds a board of cells and the rule that
steps it; its editor window writes the rule; the compiler turns it into the same Pass + Previous +
rule GLSL the wired [grid examples](simulations-grids.md) are built from; **Open as nodes** builds
that wired graph, every node with a note, for learning.

Code:

| What | Where |
|---|---|
| The rule set: params, presets, signature, the custom update's names | `src/gridRules/spec.ts` |
| GLSL from the rule set: one step, and the coloured view | `src/gridRules/glsl.ts` |
| The node, its internal step, Mouse button | `src/nodes/definitions/gridRules.ts` |
| Opening the node into the Pass machinery | `src/compiler/gridRulesExpand.ts` (called from `passGraph.ts`) |
| Open as nodes | `src/store/gridRulesAsNodes.ts` |
| Editor window, card, CPU preview | `src/components/gridRules/`, `src/gridRules/cpu.ts` |
| Examples | `src/store/gridRulesExamples.ts`, `gridRulesExampleIndex.ts` |
| Tests | `src/compiler/__tests__/gridRules*.test.ts`, `gridHarness.ts`, `glslRun.ts` |

## Using it

Add **Grid Rules** (Simulation), wire **Color** into the Output. The card shows the rule in one line
(click it, or ⊞ in the header, for the editor), a few presets of its type, Speed and the brush.
Hold the mouse button over the picture to paint cells: in the Studio preview, on the Play page and
on exported pages.

The editor window has the rule types down the left, the chosen type's form in the middle, and on
the right a live preview (the rule run on the CPU on a 96 × 64 board) above the shared settings:
**Start and run**, **Brush** and **Colours**, folded with a summary until opened (each remembered
for the session).

Every setting is a param of the node. The numbers (switches, sliders, colours) are live uniforms:
clicking a switch, dragging a slider or a Play control never recompiles. The selects (rule type,
neighbourhood, radius, template, start, board size, edges) and Steps a frame shape the GLSL, so
they recompile.

## Rule types

### Count (Life-like)

Each step every cell counts its live neighbours. An empty cell with a count in **Born on** comes
alive; a live cell with a count in **Survive on** stays alive; every other cell is empty.

- **Born on / Survive on**: a row of switches 0…8 (0…4 for von Neumann), stored as bit masks
  (`bornMask`, `surviveMask`: bit k = count k). Type B/S notation (`B36/S23`) in **As text**.
- **Neighbourhood**: Moore (8), von Neumann (4), or **Radius N** (Larger than Life, 1–7, a box or a
  circle). A radius rule uses ranges: Born from…to, Survive from…to.
- **Presets**: Life, HighLife, Seeds, Day & Night, Maze, Coral, Anneal, Diamoeba, Replicator,
  Life without Death, Diamonds (von Neumann), Bosco (radius 5), Majority (radius 4).

### Stages (Generations)

Count's rule with dying stages: an on cell that doesn't survive goes to state 2, then 3…, and after
the last state it is empty. Only state 1 counts as a live neighbour. **States** (2–16) is live.
Presets (Golly's Generations list): Brian's Brain (/2/3), Star Wars (345/2/4), Frogs, Sticks,
Spirals, Swirl, Lava, Bloomerang.

### Smooth (continuous)

Two values per cell (u in red, v in green) and a template:

| Template | Update | Sliders |
|---|---|---|
| Diffusion (heat) | `u' = mix(u, avg4, Spread) × (1 − Cooling)` | Spread, Cooling |
| Waves | `u' = (2u − v + speed/2 × (Σ4 − 4u)) × Damping`, `v' = u` (Hugo Elias) | Wave speed, Damping |
| Reaction–diffusion | Gray–Scott as Karl Sims writes it: 9-point Laplacian, `A' = A + dA∇²A − AB² + f(1 − A)`, `B' = B + dB∇²B + AB² − (k + f)B` | Feed, Kill, Spread A, Spread B |
| Custom | your own expression for u' and v' | knobs a–d |

The **custom update** is one expression each, using `u v avg_u avg_v lap_u lap_v n s e w x y t rnd a b c d`
and GLSL's built-in functions (checked as you type: no `;`, no assignment, known names only; whole
numbers get a point, `2` → `2.0`). It is the escape hatch: the Heat and Forest fire examples are
written with it.

Reaction–diffusion keeps **1 − A** in red, not A: A sits near 1, where a half-float texture has
steps of 1/2048 and Feed's f(1 − A) would round away (the Passes 4 example does the same).

Presets: Heat, Ripples, Mitosis, Coral growth, Worms, Spots, Labyrinth. A preset brings its colours
(and reaction–diffusion 8 steps a frame).

### Patterns and Blocks

Rule types of their own (3×3 stencils, Margolus 2×2 blocks), in a later part of this work.

## Shared settings

- **Start**: Noise (Density, Seed), Empty, Image (wire a picture into **Start image**: bright cells
  start on; Smooth takes its brightness), Centre seed. **Deal a new board** in the editor, or the
  **Reset** param (a Play switch).
- **Speed** below 1 steps on some frames only (a clock kept in the board's blue); **Steps a frame**
  above 1 is the board Pass's Repeat.
- **Board size**: the board Pass's scale, ½ to 1/32 (960 to 60 cells across at 1080p), always
  Nearest, so cells stay square.
- **Edges**: Wrap (a torus) or Walls. With walls the outer ring of cells is kept empty, so a read
  past the edge (which sees the edge) reads an empty cell; Smooth's walls reflect.
- **Brush**: size in cells, the state it paints (0 erases; Smooth: the value it sets), Fill (the
  share of cells under it painted each frame: a solid block of Life just dies). **Paint** (a Play
  switch) paints without the button.
- **Colours**: one per state (Empty, On; Stages' first and last dying stages, blended between;
  Smooth: a four-stop ramp), **Afterglow** (a cell that just switched off glows, the glow kept
  times Afterglow each step) and **Age fade** (live cells move towards Old cells as they age).

## Outputs

| Output | What |
|---|---|
| Color | The board at this pixel, coloured |
| State | The state here (0, 1, 2…); Smooth: u (reaction–diffusion: chemical A) |
| On | 1 where the state is 1; Smooth: u, 0–1 |
| Age | Age or afterglow; Smooth: v |
| Shade | The 0–1 shade the colours are read at |
| Texture | The coloured board as a texture (one more small pass, only when wired): for Glow, Sample, Texture tools, an Agents group |
| Cells | The raw board texture (red state, green age, alpha signature) |

## Under the hood

The compiler opens every Grid Rules node before cutting the graph at its passes
(`compiler/gridRulesExpand.ts`):

- **the board**: an ordinary Pass node (`<id>__cells`, labelled "<label> cells"), at the board
  size, Nearest, Edges Repeat or Clamp, Repeat = Steps a frame;
- **the step**: an internal `gridRulesStep` node (`<id>__step`), the whole of the board Pass's
  program, reading the board's Previous (and the Start image);
- **the node itself** stays, same id (so every wire out of it, its probe and its thumbnail still
  work), reading the board's Texture through an internal `__board` input, and compiles to the
  coloured view;
- **the picture** (only when Texture is wired): a second small Pass drawn by a copy of the node.

The step and the picture copy compile under the node's own slug and bind their sliders to its id
(`params.__bindAs`, honoured by `shaderAssembler.compileStandardNode`), so the node's params are
one set of uniforms in every program.

**The board's channels**: R the state (a whole number, rounded where it's read) or Smooth's u;
G age / afterglow or v; B the clock's phase; A the rule's **signature**, a whole number from 2 that
changes with the rule type, the neighbourhood (Count, Stages), the template and the start. A board
whose Alpha is anything else (an empty Pass reads 0 or, sometimes, 1) is new, and is dealt from
the start: no first-frame flag channel, and changing the kind of rule deals a new board.

**Counting** reads each neighbour exactly: `texture2D(prev, (cell + d + 0.5) / size)` on a Nearest
texture, one read per neighbour (a constant-bounds loop for a radius), and counts state 1 only
(`step(0.5, s) − step(1.5, s)`), so dying stages never count. Born / survive look the count up in
the masks: `mod(floor((mask + 0.5) / exp2(count)), 2)`.

**Randomness** is a hash of the cell and the frame (Hoskins' hash13, no `sin`), so it has no
1/256 steps and a frame's dice don't slide along the board.

**Budget**: a Grid Rules board counts towards the 8 Pass nodes of a graph (its picture too, when
Texture is wired); the error says so.

## The mouse

- **Mouse button** (Sources) is 1 while the button is down over the picture (`u_mousebtn`, declared
  only by the nodes that read it). ShaderCanvas sets it on the Studio preview and the Play page
  (from a press inside the picture that isn't on a control; while held, the pointer moves u_mouse
  even over a layer drawn on top); exported pages set it from their pointer.
- The Play **mouse button** mapping (playEngine) only listened while performing. It now also reads
  the Studio preview's button (`playEngine.setPreviewButton`), so the wired grid examples' brushes
  paint in the Studio too.
- **The Mouse node in a smaller Pass**: u_mouse is in picture pixels but u_resolution is the pass's
  size, so its UV was off by the pass's scale. The compiler now hands the Mouse node the pass's
  scale when its UV, X or Y is read there (`__pictureScale`); Pixels stays in picture pixels. A
  graph that reads only Pixels (the grid examples' Pixels × Scale) compiles exactly as before.
  Exported pages set u_mouse in the picture's pixels in every program too (they used the pass's).

## Open as nodes

On the card or in the editor's header. It builds, below the node, the same simulation from ordinary
nodes in the grid examples' style (`store/gridRulesAsNodes.ts`), wires what read the node to it,
and leaves the node as it was (unwired: delete it when you like):

- a Pass (`<label> cells (nodes)`) at the same size and settings, reading its own Previous;
- Pixel Coordinates, UV, Time, Mouse, Mouse button;
- Sample (texture) of this cell and of each neighbour (8, 4, or 24 for radius 2);
- Count (Stages): Count the neighbours (an Expression Block summing `grIsOn(n.r) + …`), Constants
  cards of Born on / Survive on switches (or ranges), Born? / Survives? lookups, The rule, Age and
  afterglow;
- Smooth: Rule numbers (Constants), Update (the template's lines, or your update);
- the step clock, Start over? (signature or Reset), the start, the brush (Mouse Pixels × scale, Circle
  SDF, Mouse button or Paint, Fill), Mix nodes that hold, start and paint, Round;
- the look: Color cards and a Colour by state (or Colour ramp) Expression Block.

Every node has a note; every Expression Block's note explains each named line. Radius 3 and up
isn't built ((2N + 1)² − 1 Sample cards); the button says so. Seeding uses Noise Float's hash, so a
new board is a different (as random) deal.

**Equivalence** (`gridRulesAsNodes.test.ts`): the compact node's board program and the opened
graph's are both run on the CPU from the same board for six steps, for Life, HighLife with walls,
Diamonds (von Neumann), Larger than Life radius 2 (box, and circle with walls), Brian's Brain, Star
Wars at 3 steps a frame, Heat, Ripples with walls, Mitosis and a custom update: the same states
(red) and age (green) every step.

## Examples (Simulations: grids)

Each Grid Rules version sits beside the wired version it rebuilds, now named "… (under the hood)":

| Example | Rule | Nodes (Grid Rules / under the hood) |
|---|---|---|
| 1 · Game of Life | Count B3/S23, ⅛, wrap | 2 / 50 |
| 2 · Life-like rules | Count Day & Night | 2 / 49 |
| 3 · Brian's Brain | Stages /2/3, ¼, Texture → Glow | 4 / 55 |
| 4 · Cave generator | Count B5678/S45678, walls, 8 steps a frame | 2 / 35 |
| 5 · Water ripples | Smooth, Waves, ½, walls, centre drop | 2 / 41 |
| 6 · Heat diffusion | Smooth, Custom (diffusion + flares) | 2 / 25 |
| 7 · Forest fire | Smooth, Custom (0 ground, 1 tree, 2 fire) | 2 / 66 |

Falling sand and Wireworld need Blocks and Patterns: their Grid Rules versions come with them.

## Performance

Whole frame at 1920 × 1080 (every program, Repeat included, then the picture; offline renders in
headless Chrome, ANGLE Metal, Apple M3 Pro, each frame finished with a 1-pixel read back; median
of 75 frames):

| Example | Grid Rules: ms (draws) | Under the hood: ms (draws) |
|---|---|---|
| Game of Life | 1.1 (2) | 1.2 (2) |
| Life-like rules | 1.2 (2) | 1.1 (2) |
| Brian's Brain | 1.9 (10: picture pass + glow) | 1.6 (8) |
| Cave generator | 1.5 (9) | 1.8 (12) |
| Water ripples | 1.3 (3) | 1.4 (2) |
| Heat diffusion | 1.4 (5) | 1.4 (5) |
| Forest fire | 0.9 (2) | 1.4 (8) |

A board is small (⅛ is 32 400 cells at 1080p); the cost is the picture, and Repeat multiplies the
board's. A radius-7 Larger than Life rule reads 224 neighbours a cell.

## Limits

- **Half floats**: the board is a half-float texture. A device without half-float render targets
  falls back to 8-bit, where states above 1 and Smooth's values don't survive.
- **Patterns and Blocks** aren't in this part yet.
- **The CPU preview** in the editor doesn't run a custom Smooth update (it shows diffusion), and
  previews an Image start as noise.
- **Open as nodes** builds radius 1 and 2 only; it seeds with a different hash.
- **States** above 8 share colours: Stages blends its dying stages from State 2's colour to State
  3's; Patterns and Blocks give states past 7 the eighth colour.
- **Stages' born / survive** count only state 1 (Generations), never the dying stages.
- **Speed** below 1 steps the whole board on the same frames (one clock); Steps above 1 runs the
  brush and the seed every repeat.

## Sources

1. Martin Gardner, "Mathematical Games", *Scientific American* 223 (4), October 1970 (Life).
2. LifeWiki, "Life-like cellular automaton", "Larger than Life", "Generations" (conwaylife.com/wiki),
   and Golly's rule tables: the B/S and S/B/C notations and the presets.
3. Kellie Michele Evans, "Larger than Life: digital creatures in a family of two-dimensional cellular
   automata", *Discrete Mathematics and Theoretical Computer Science* AA, 2001 (Bosco's rule).
4. Tommaso Toffoli and Norman Margolus, *Cellular Automata Machines*, MIT Press, 1987 (Brian's Brain,
   the Margolus neighbourhood).
5. Hugo Elias, "2D Water" (archived): the two-buffer wave.
6. Karl Sims, "Reaction-Diffusion Tutorial" (karlsims.com/rd.html); John E. Pearson, "Complex
   patterns in a simple system", *Science* 261, 1993; Robert Munafo's xmorphia parameter map.
7. Barbara Drossel and Franz Schwabl, "Self-organized critical forest-fire model", *Physical Review
   Letters* 69 (11), 1992.
8. Dave Hoskins, "Hash without Sine" (shadertoy.com/view/4djSRW).
