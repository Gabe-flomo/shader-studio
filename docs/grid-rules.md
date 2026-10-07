# Grid Rules

A cellular simulation in one node. The **Grid Rules** node holds a board of cells and the rule that
steps it; its editor window writes the rule; the compiler turns it into the same Pass + Previous +
rule GLSL the wired [grid examples](simulations-grids.md) are built from; **Open as nodes** builds
that wired graph, every node with a note, for learning.

**Opening it:** the node browser's **Builders** section (first, on the desktop and on a phone) →
**Grid Rules** adds a Grid Rules node (on the Output when the graph is empty) and opens its editor;
so do the empty canvas's right-click → **Builders** → **Grid Rules…** and the Do… bar's "new grid
rules". "open grid rules" or "edit the rules" opens the selected (or only) one's editor; the card's
⊞ button and its rule line do too. The card's **Rule** chip shows the rule as text ("Life B3/S23 ·
240×135 · wrap") with **Copy** and **Open editor**.

Code:

| What | Where |
|---|---|
| The rule set: params, presets, signature, the custom update's names | `src/gridRules/spec.ts` |
| GLSL from the rule set: one step, and the coloured view | `src/gridRules/glsl.ts` |
| The node, its internal step, Mouse button | `src/nodes/definitions/gridRules.ts` |
| Patterns and Blocks: rules, symmetries, presets | `src/gridRules/stencils.ts` |
| Blocks: the dice and Jitter, as GLSL and as TypeScript (bit for bit the same) | `src/gridRules/dice.ts` |
| Opening the node into the Pass machinery | `src/compiler/gridRulesExpand.ts` (called from `passGraph.ts`) |
| Open as nodes | `src/store/gridRulesAsNodes.ts` |
| Editor window, card, CPU preview | `src/components/gridRules/`, `src/gridRules/cpu.ts` |
| Examples | `src/store/gridRulesExamples.ts`, `gridRulesExampleIndex.ts` |
| Tests | `src/compiler/__tests__/gridRules*.test.ts`, `gridHarness.ts`, `glslRun.ts`, `src/gridRules/__tests__/` |

## Using it

Add **Grid Rules** (Simulation), wire **Color** into the Output. The card shows the rule in one line
(click it, or ⊞ in the header, for the editor), a few presets of its type, Speed and the brush.
Hold the mouse button over the picture to paint cells: in the Studio preview, on the Play page and
on exported pages.

The editor window is tabs, one section at a time, each with its one-line "How this works" at the
top: **Presets** (the rule type and its presets) · **Neighbourhood** (Count and Stages: Moore,
von Neumann or a radius, each pictured as the cells it counts) · the rule's own tab (**Born &
Survive**, **Stages**, **Stencils**, **Blocks** or **Smooth**) · **Start** · **Brush** ·
**Colours** (what Color shows, and the colours). On the right, a live preview (the rule run on the
CPU on a 96 × 64 board). Rarely used settings (seed and speed, the brush's fill, afterglow and
ageing, the rule as B/S text) are folded with a summary. The editor opens on Presets the first
time, then on the tab last used. On a phone the same tabs fill the screen, with Preview as one
more tab.

**Born & Survive** explains itself:

- every switch is a tiny 3×3 picture: that many live neighbours round the middle cell, which is
  empty on the Born row and live on the Survive row. Hovering one says what it does: "empty + 3
  neighbours → comes alive", "live + 4 → dies (too crowded)", "live + 1 → dies of loneliness" (a
  count below every Survive count is loneliness, above them crowding).
- one sentence above them sums the rule up and follows the switches: "Cells are born with exactly
  3 neighbours and survive with 2 or 3; fewer and they die of loneliness, more and they die of
  crowding."
- a **mini-board** beside them (the same CPU run, 32 × 32) starts from a test pattern (**Glider**,
  **Blinker**, **R-pentomino**, **Random blob**), to see what the rule does to it; pause and step it.

Stages adds its **dying stages** pictured as cells fading from on to empty, in the rule's colours
(`gridRules/explain.ts` has the words and pictures).

From the **Do… bar** (⌘K), type a preset's name: "game of life", "highlife", "seeds", "day and
night", "brian's brain", "caves", "heat", "water ripples", "reaction diffusion", "falling sand",
"wireworld", "gas" (every preset's label works too). Optional: a board size ("chunky board",
"big cells", "120 cells across"), a speed ("slow", "fast", "speed 0.3"; above 1 is Steps a frame)
and colours (the first is the live cells, Smooth's high end; "… on black" or "black background" is
the empty cells). On an empty graph its Color goes to the Output; otherwise it is placed beside the
selection, unwired. A name that is also a Do… bar action or shape ("ripples", "swirl", "diamonds")
needs a grid word: "ripples grid". The phrases live in `src/suggestions/doBarGridRules.ts`.

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
  Life without Death, Caves, Diamonds (von Neumann), Bosco (radius 5), Majority (radius 4).

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

### Patterns (3×3 stencils)

An ordered list of rules (`params.patterns`, `gridRules/stencils.ts`). Each is a 3×3 picture: click a
cell to cycle it through **any** (·), each state, and **not empty** (≠0); the blue-ringed middle is
"this cell is"; the cell after the arrow is what it **becomes**. A rule can also ask for a **count**
("1 to 2 neighbours in state 1"). **Orientations**: as drawn, turns (four), or turns + mirrors
(eight). The first rule that matches wins; none matching, the cell stays. **States** 2–8.

Presets: **Wireworld** (head → tail → copper; copper → head with 1 or 2 heads round it: three
rules, the last with a count), **Falling dots**, **Crystal** (frost: an empty cell with exactly one
on neighbour freezes).

### Blocks (Margolus 2×2)

The board in 2×2 blocks whose grid shifts one cell diagonally every step (the parity is kept in the
board's blue as 2 + the phase on odd steps). A rule (`params.blocks`) is a **before** picture and an
**after** picture: before cells are any / a state / not empty (the board's edge counts as not empty);
after cells are **=** (unchanged) or a state. Orientations: as drawn, mirrored, or turns. **Chance**
fires the rule on a share of the matching blocks. The editor marks each rule **keeps every count**
when its after only rearranges its before (`blockConserves`).

All four cells of a block make the same choice: the variant tried first and the chance are rolled
once per block (a hash of the block's corner, wrapped, the frame and the Seed), so a rearranging
rule never loses or doubles a cell, at the seam of a wrapping board too. An odd last row or column
has no block and is kept empty.

**The dice** (`src/gridRules/dice.ts`) are a whole-number hash, `grDice`: each round adds an input,
applies x(2x + 1) mod 2048 (a permutation of 0…2047) and rotates the 11 bits by 5. Every value is
a whole number below 2²⁴ and every division is by a power of two, so float32 on the GPU holds each
one exactly: the editor's CPU preview rolls the same numbers, and the same board, frame and Seed
give the same next board on both (`gridRulesStencils.test.ts` checks it step by step). The GPU's
frame number is `mod(floor(time × 60), 997)`; the CPU's is its step count.

**Jitter** (`params.jitter`, 0–1, a live slider under the rules; a Play target). In plain Margolus
every grain that falls in a step ends it in its block's bottom row, so every falling grain sits on
the same row parity and a falling cloud shows as horizontal bands on every other row. Skipping
moves at random doesn't fix it (a grain that waits is back in step a step later), so Jitter
shuffles the grid instead: the board is cut into the step's two-cell columns, each column into
segments of 4 rows, and each segment takes the step's row parity or, with chance Jitter ÷ 2, the
other one. A block exists where its two rows agree; between two segments that disagree one row is
in no block and sits the step out. Blocks never overlap, so each still changes all four cells at
once and a rearranging rule keeps every count. Jitter 0 is the classic grid; at 1 each segment
picks its parity at random. Measured on a falling cloud (`blocks.test.ts`), the share of grains on
one parity beyond half goes 1.00 → 0.63 → 0.40 → 0.21 → 0.17 for Jitter 0, ¼, ½, ¾, 1. The cost:
grains fall about half a cell a step (a grain whose segment keeps its parity waits a step), and
slopes slide a little more loosely. Falling sand has Jitter 1 (and Speed 1 to keep its pace); the
gas has 0, since the HPP gas needs the plain grid to fly straight (with Jitter it diffuses).

Presets: **Falling sand** (0 air, 1 sand, 2 wall: grains fall, slide off heaps with chance 0.8, rest
on walls; Jitter 1), **Gas (HPP)** (particles fly diagonally and scatter at right angles, Toffoli
and Margolus; Jitter 0). Surprise me gives sand a Jitter of 0.6–1 and the gas 0.

**Image start** for every whole-number rule: the picture's brightness picks the state, 0 for black
up to the last state for white (two states: bright parts start on). Wireworld's example draws its
starter circuit that way.

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
| Neighbours | How many of the 8 (von Neumann 4) cells round this one are on; Smooth: their average u. Its texture reads are only made where something reads it |
| Cells | The raw board texture (red state, green age, alpha signature) |

**Show** (the editor's Colours tab, the `view` setting): what Color shows. *Colours* (the default:
the same shader as before), or *State*, *Age* or *Neighbours* as grey, to see why a rule behaves
as it does. Changing it recompiles.

## Built-in guidance

Every builder window (`components/builders/BuilderWindow.tsx`) carries the same help, with its
words in `components/builders/helpContent.ts`:

- **How this works.** Each section opens with a short card: what it is, what it does, "you can do
  X to get Y", and one or more **worked examples** (click to insert). **Got it** hides a card;
  **Tips** in the header turns them all off, and turning it back on brings back every card you
  dismissed. Both are remembered per builder.
- **Empty states** (no shapes, no rules) always show their guidance; with tips off it folds to one
  line and its examples.
- **Field hints.** Every control has a plain-language hint on a **?** beside its label (hover or
  focus shows it).
- **Type-ahead.** Text fields complete as you type: ↑ ↓ to choose, Tab (or Enter, outside the Do…
  bar) to take one, Esc to close (`lang/complete.ts`).

A new builder adds its block to `BUILDER_HELP` and gets all of this by using `BuilderWindow`
(`<BuilderHelp id>`, `<EmptyHelp id>`, `<HintMark text>`, `<HintLabel hint>`). A test checks
that every registered section has help.

In Grid Rules each rule type has its card (Count, Stages, Patterns, Blocks, Smooth), and so do
Presets, Neighbourhood, Born and survive, States, the stencil list, the block list and the shared
sections (Start and run, Brush, Colours, Show). Examples set the rule (Life, HighLife, Brian's
Brain, Heat, Show neighbour counts). Every slider's **?** reads the node's own parameter hint.

**Type-ahead and type checks.** *As text* completes a preset's name into its B/S rule ("high" →
B36/S23 HighLife). The Smooth custom update completes its names (u, lap_u, avg_v…) and functions,
and refuses an update that isn't one number: `vec3(u, v, 0.0)` → "The update is a number (float),
but this makes three numbers (vec3). Fix: take .x: (vec3(u, v, 0.0)).x" (`lang/typeCheck.ts`
reads the expression's type).

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

Patterns open as eight Sample reads and one **The patterns** Expression Block (each rule a named
line); Blocks as **Jitter** and **Seed** constants, **This cell's block** (the corner, from
`grBlockOf`, and the parity), four UVs and four Sample reads of the block's cells, and **The
blocks** Expression Block (whether the cell is in a block this step, each orientation's priority,
the per-block dice, each rule's answer), plus **Clock and parity** for blue.

**Equivalence** (`gridRulesAsNodes.test.ts`): the compact node's board program and the opened
graph's are both run on the CPU from the same board for six steps, for Life, HighLife with walls,
Diamonds (von Neumann), Larger than Life radius 2 (box, and circle with walls), Brian's Brain, Star
Wars at 3 steps a frame, Heat, Ripples with walls, Mitosis, Wireworld with walls, patterns with
turns, mirrors and a count, falling sand with its dice and walls, the gas on a torus, and a custom
update: the same states (red) and age (green) every step.

`gridRulesStencils.test.ts`: the variants each symmetry stands for, spec → GLSL, pattern matching
with rotations and counts against a CPU reference, an electron running along a Wireworld wire,
the gas against a Margolus reference (wrapping and walled), **conservation** (sand and gas, wrapping
and walled, even and odd boards, dice on), sand piling on the floor, the **CPU preview against the
GPU** board for twelve steps (sand at Jitter 1, 0.4 and 0, the gas at 0.7; walls and wrap; even and
odd boards), every preset, and the image start's brightness → state.

`blocks.test.ts` (the CPU preview): plain Margolus sand falls one cell a step and topples; with
Jitter a grain still reaches the floor and stays, a falling cloud's banding drops below 0.25, every
grain and wall is kept over 300 steps (Jitter 0.3 and 1, walls and wrap, odd boards; the gas too),
the same board and Seed give the same run (another Seed another), and a falling cloud settles into
a heap.

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
| 8 · Falling sand | Blocks, sand, ¼, walls | 2 / 52 |
| 9 · Wireworld | Patterns, a starter circuit drawn into a Pass as the Image start | 6 / 62 |

New ones, for the two editors: **10 · Pattern rules: frost** (one stencil with a count, Age fade
colours by when a cell froze; 2 nodes) and **11 · Block rules: gas** (the HPP gas from a ball in the
middle; 2 nodes).

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
| Falling sand | 0.8 (2) | 0.8 (2) |
| Wireworld | 0.8 (3: the starter Pass) | 1.1 (8) |
| Frost (new) | 0.8 (2) | |
| Gas (new) | 0.9 (2) | |

A board is small (⅛ is 32 400 cells at 1080p); the cost is the picture, and Repeat multiplies the
board's. A radius-7 Larger than Life rule reads 224 neighbours a cell.

## Limits

- **Half floats**: the board is a half-float texture. A device without half-float render targets
  falls back to 8-bit, where states above 1 and Smooth's values don't survive.
- **Blocks** on a board with an odd number of rows or columns: the last one has no block and stays
  empty (so a wrapping board wraps its even part).
- **Patterns and Blocks** hold up to 8 states; their rules are baked into the GLSL, so an edit
  recompiles.
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
