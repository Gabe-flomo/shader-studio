# Grid Rules

A cellular simulation in one node. The **Grid Rules** node holds a board of cells and the rule that
steps it; its editor window writes the rule; the compiler turns it into the same Pass + Previous +
rule GLSL the wired [grid examples](simulations-grids.md) are built from; **Open as nodes** builds
that wired graph, every node with a note, for learning.

**Opening it:** the Do… bar's "new grid rules" adds a Grid Rules node (on the Output when the graph
is empty) and opens its builder. **Scene builder** → **Grid scene** opens the Grid builder
([grid-builder.md](grid-builder.md)), whose **Make it a simulation → Grid Rules** adds a Grid Rules
node starting from the drawing and opens this builder, with **‹ Pattern grid** in its top bar (and
"Simulation" in its crumb) to go back. The builder's header reads **Scene builder › Grid scene**
(back to the kinds); the main preview waits while it is open (its
own CPU try board runs); every slider resets on double-click, and right-click offers Add to Play
controls. "open grid rules" or "edit the rules" opens the selected (or only) one's editor; the card's
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
| The builder (shell, try board, sections), card | `src/components/gridRules/` |
| The CPU step, the try board's step-through, a drawn start | `src/gridRules/cpu.ts`, `tryRun.ts`, `startCells.ts` |
| A text start (words rasterised to cells, the stamps) | `src/gridRules/textCells.ts` (the font: `src/agentBuilder/strokeFont.ts`) |
| Your own neighbourhood: stencils, weights, presets; its editor | `src/gridRules/neighbourhoods.ts`, `src/components/gridRules/StencilEditor.tsx` |
| Before/after pictures, Smooth in plain words | `src/gridRules/ruleExamples.ts`, `smoothWords.ts` |
| Stacked rules on the base: the cards, headings, their CPU step and GPU stage, recipes | `src/gridRules/stack.ts`, `stackRecipes.ts`, `src/components/gridRules/StackForm.tsx` |
| Examples | `src/store/gridRulesExamples.ts`, `gridRulesExampleIndex.ts` |
| Tests | `src/compiler/__tests__/gridRules*.test.ts`, `gridHarness.ts`, `glslRun.ts`, `src/gridRules/__tests__/` |

## Using it

Add **Grid Rules** (Simulation), wire **Color** into the Output. The card shows the rule in one line
(click it, or ⊞ in the header, for the editor), a few presets of its type, Speed and the brush.
Hold the mouse button over the picture to paint cells: in the Studio preview, on the Play page and
on exported pages.

## The builder

The builder is on the Agent Builder's shell (`components/builders/studio/StudioShell.tsx`, the
layout of [agent-builder.md](agent-builder.md)): the board you try the rule on fills the middle,
the settings sit at the side.

- **Top bar:** Scene builder › Grid scene, the node's name and its rule ("Count B3/S23"); **‹ Pattern
  grid** on a node the Grid builder made; **Under the hood**, **Surprise me**, **Open as nodes** and **Done** (closes and frames the node,
  `builders/finish.ts`).
- **Left:** **What it is** (the kind of rule: Count, Stages, Stencils, Blocks, Smooth, with one
  line on each) and the **sections**, each with a one-line summary: the rule first (**Born &
  Survive**, **Born, Survive & Fade**, **Stencils**, **Blocks**, or Smooth named for what it makes:
  **Heat**, **Ripples**, **Growing patterns**, **Your own update**), then **Neighbourhood** (Count
  and Stages), **Stacked rules** (Count, Stages and Stencils, [below](#stacked-rules)), **Start**, **Speed**, **Brush**, **Look** and **As text**. The section shown is
  remembered; a section the rule type doesn't have falls back to the rule.
- **Right:** the section's settings, under its name, one line and a **Learn more**.
- **Bottom:** the kind's presets as pictures (each run on the CPU from its own start, made one at a
  time, `gridThumbs.ts`), **Keep the kind of rule** and **Surprise me** (a seeded rule that stays
  alive on a test board, one undo step; the seed shows and can be typed).

The side panels fold (⌘[ and ⌘]) and become drawers under 1100 px; a phone fills the screen.

### The try board

The middle is a small board run on the CPU with the node's own rule (`components/gridRules/
TryBoard.tsx`, `useTryRun.ts`, `gridRules/tryRun.ts`): 64 × 40 cells for whole-number rules, big
enough to draw on, and 96 × 60 for Smooth. It is dealt as the node's Start deals a board, and dealt
again when the kind of rule, the template or the start changes.

- **Draw:** click or drag to place cells of the state picked under the board; pressing a cell
  already that state erases it (and the drag goes on erasing); Shift-drag erases; ⌫ is state 0.
  Smooth drops a value. **Clear**, **Deal again** and, for counting rules, a **Test pattern**
  (Glider, Blinker, R-pentomino, a random blob).
- **Text stamp** (the **T** button): type words and pick how many cells tall; pointing at the board
  outlines the cells the letters will cover, and a click stamps them in the picked state (Shift-click
  erases them). The letters are the stroke font's, rasterised as a text start is (below).
- **Step through:** ⏮ back to the first step kept, ◀ one generation back, ▶ play or pause,
  ▶| one forward (← → and Space when the board has focus). The last 400 frames are kept, so back
  shows the very frame you saw, not a new step. Drawing on a frame keeps it and drops the frames
  after it. A rule edit keeps the frame shown and drops the ones after it too.
- **Speed of the try:** Slow (3 steps a second), Medium (10) or **As built** (the node's own pace,
  up to 240). Smooth starts As built.
- **The step counter** ("Step 12 · 34 live") and, pointing at a cell, what the rule makes of it:
  "empty + 3 neighbours → comes alive", a dying cell's stage, a cell's state and the next one, a
  Smooth cell's values.
- **Pictures for the section being edited:**
  - Born & Survive and Neighbourhood: what the next step does, a green ring where a cell is born, a
    red cross where one dies (Stages: an amber dot where it changes stage); the switch in the
    corner turns them off. Pointing at a cell outlines the cells it counts (your own
    neighbourhood's too), and the note under the step counter gives its count, weights included.
  - Pointing at a **count switch** lights the cells it stands for: the empty cells with that many
    live neighbours (Born) or the live ones (Survive).
  - Stencils: pointing at a rule lights the cells it matches now, with "Rule 2 matches 14 cells
    here".
  - Blocks: the 2×2 blocks the next step will cut the board into (the step's parity and Jitter's
    dice, as the CPU and GPU cut it).
- **Under the hood** (top bar): each cell's number (counting rules: how many live cells it counts;
  Stencils and Blocks: its state; Smooth: its value, zeros left out) and what the GPU keeps per
  cell (red the state, green the age, blue the clock, alpha the signature).
- **Use as the start:** the cells on the board become the node's start (**A drawn start**, below),
  as one undo step. Start's summary then reads "your drawing · 12 cells".

The CPU step is the GPU step: `gridRulesCpuGpu.test.ts` runs both from the same board, step after
step, for Life, HighLife with walls, von Neumann, a radius-2 circle with walls, Brian's Brain, Star
Wars, Wireworld, Falling dots, Crystal, sand (Jitter and dice) and the gas (the same states), and
Heat, Ripples with walls and Mitosis (the same values to 1e-4); stepping forward, back and forward
again lands on the GPU's boards. The CPU doesn't run a custom Smooth update (it shows plain
spreading; the node runs it).

### Born & Survive

- one sentence sums the rule up and follows the switches: "Cells are born with exactly 3
  neighbours and survive with 2 or 3; fewer and they die of loneliness, more and they die of
  crowding."
- every switch is a tiny 3×3 picture: that many live neighbours round the middle cell, which is
  empty on the Born row and live on the Survive row. Pointing at one says what it does ("live + 4
  → dies (too crowded)") and lights its cells on the board.
- a radius rule's counts run into the dozens: Born and Survive are ranges (sliders).
- Stages adds **Fading**: the dying stages pictured as cells fading from on to empty, in the rule's
  colours, and the number of states.
- **As B/S text** (folded): type `B36/S23` or a preset's name.

### Stencils

Each rule is a drawn 3×3 stencil round **this cell** (ringed): a coloured cell must be that state,
a hatched one isn't looked at (**any**), a dotted one is **not empty**. Click a cell and a row of
choices opens under the stencil (any, not empty, empty, each state); the cell after the arrow is
what this cell becomes. Each rule:

- reads as a sentence: "A cell that is 1 with below empty becomes empty.";
- flips, about once a second, between an example of what it matches and the middle cell after
  it (a count rule's example has the neighbours it asks for; click to flip by hand);
- lights the cells it matches on the board when you point at it;
- has its orientations (as drawn, turned any way, turned or mirrored) and an optional count ("and
  1 to 2 of the 8 round it are 1").

### Blocks

Each rule is its before → after 2×2 pictures (click a cell for its choices: any, not empty, a
state; after: unchanged or a state), and beside it a small 4 × 4 grid flipping from the rule's
before to its after: **the rule alone**. Under the rules, **Together**: one real step of every rule
on a small seeded board (`ruleExamples.ts comboStep`, the CPU step), flipping before → after with
each block a rule changed ringed in that rule's colour and a count per rule. Switch rules off and on
to see each alone, then in combinations; **Next step** goes on from the after, **New board** deals
another. A badge says whether a rule keeps every cell (it only moves them). Chance and Jitter are
sliders.

### Smooth, in plain words

Smooth's sections are named for what they make, and every setting has a plain name, one line and,
where it helps, a feel for the number (`gridRules/smoothWords.ts`). A before/after above the
settings runs the template's demo on the CPU (a hot dot, a drop, a seed of B) and shows it N steps
later; moving a slider redraws it.

| Template | Section | Settings (param) |
|---|---|---|
| Diffusion | **Heat**: every cell shares its heat with the four beside it | **Spreads** (spread), **Cools** (decay: "half gone after about 173 steps") |
| Waves | **Ripples**: each cell is the height of the water | **Ripple speed** (waveSpeed), **Ripples last** (damping: "half gone after about 138 steps") |
| Reaction–diffusion | **Growing patterns**: food (A) and a second chemical (B) that eats it | **Food added** (feed), **Cleared away** (kill); More: **Food spreads**, **B spreads**; and a map of food × cleared away with the presets as dots: click to try a spot |
| Custom | **Your own update** | the u and v lines, knobs a–d, the names |

**Waves' pace.** Ripples (the preset and the template's look) run one step every other frame, 30 a
second, with Ripple speed 0.5 (the default too). It used to be 2 steps a frame (120 a second) at
0.9: far too fast. Surprise me's ripples stay at 30 a second with a speed of 0.3–0.7.

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
- **Neighbourhood**: Moore (8), von Neumann (4), **Radius N** (Larger than Life, 1–7, a box or a
  circle), or **Your own** (a stencil you draw, below). A radius rule uses ranges: Born from…to,
  Survive from…to.
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
one exactly: the builder's CPU try board rolls the same numbers, and the same board, frame and Seed
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

### Your own neighbourhood

Neighbourhood → **Your own** (`neighbourhood: 'custom'`, the node's `stencil` param,
`src/gridRules/neighbourhoods.ts`): Count and Stages count the cells of a stencil you draw instead of
the 8 round, the 4 beside or a radius.

- **The editor** (`StencilEditor.tsx`): a 3×3, 5×5 or 7×7 square round **this cell** (ringed in the
  middle, never counted). Click a cell to count it, again to take it out. With **Weights** on, a click
  steps a cell 1 → ×2 → ×3 → off: a live cell there counts that many times. Shift-click or right-click
  takes a cell out. A line under it sums it up ("10 cells (weighted) · counts 0–14").
- **Presets**: Moore and von Neumann (exactly the built-in ones), **Hex-ish** (the 8 less two opposite
  corners: six neighbours, as a hexagonal grid sits on a square one), a **Ring** (the 16 cells two steps
  out, none of the 8 next to it) and a **Cross** (two cells each way: 8 in a plus).
- **Born and Survive** count against the stencil: a cell's count is the sum of its live neighbours'
  weights, 0 to the stencil's total. Up to a total of 23 they are switches (bit masks, exact as float
  uniforms to 2²⁴), shown as numbers (a 3×3 picture of 8 neighbours wouldn't be your stencil); above
  23 they are ranges, as a radius rule's. Crossing from one to the other brings counts that work there.
  B/S text (`B3/S23`) is offered for totals up to 8; past 9 the rule line puts commas between counts
  (`B3/S2,3`).
- **On the GPU** the step unrolls one read per counted cell, times its weight (`gridRules/glsl.ts`
  countLines); the CPU try board adds the same weights (`cpu.ts`). The stencil is baked into the
  GLSL, so an edit recompiles; it doesn't deal a new board. A custom neighbourhood's signature has a
  range of its own (500 up), so switching to it deals the board again.
- `gridRulesTextNb.test.ts`: the Moore and von Neumann presets give the built-in neighbourhoods'
  boards (Life, HighLife, Diamonds; CPU and GPU, 8 steps), a 5×5 stencil of ones is radius 2, and a
  weighted cross, the ring with walls, hex-ish Stages and a 7×7 weighted stencil counted as ranges
  step the same on the CPU and the GPU for 8 steps.

## Stacked rules

The rule picked under What it is is the **base**. On a Count, Stages or Stencils base you can stack
up to four **rule cards** that run after it, in order, every step (`gridRules/stack.ts`; the plan
for the wider simulation builder is [simulation-builder-plan.md](simulation-builder-plan.md)):

| Card | When | Does | Settings |
|---|---|---|---|
| **Cells meet → explode** | a live cell has from…to live neighbours (1…1: two cells touching and nothing else round them) | the empty cells `distance` away in the first `copies` directions (up, down, right, left, then the corners) become the copies' state; the meeting cells vanish | Meets with, …up to, Copies 1–8, Distance 1–4, Copies are (a state), The meeting cells stay, Chance |
| **Too crowded → die or move** | a live cell has at least N live neighbours | it dies, or steps one cell away from them (the sign of their offsets, turned round) into an empty cell | Crowded at, Dies / Moves away, Chance |
| **Drift in a direction** | always, where the cell ahead is empty | live cells (or every cell that isn't empty) step one cell in a direction | Direction (eight arrows), Live / Any not empty, Chance |
| **Big clusters change** | a live cell has at least N live cells within a square of radius R | it becomes a state (0 dies; on Stages, 2 starts it fading) | Looks within 1–4, Big at, Becomes, Chance |
| **Move along a heading** | a cell has a heading (or takes one) and the cell ahead is empty and claimed by no other mover | it steps one cell along its heading; a blocked one waits, bounces (turns round) or turns right | No heading: stay still / random / this way, When blocked, Which cells, Chance |
| **Movers collide → …** | two movers head-on (side by side, facing) or heading for the same empty cell | bounce, turn (right), stop, merge (one cell, heading the way the two add up to) or explode (they vanish; copies land round the meeting cell, flying outward) | Then they, Copies, Distance, Copies are, Copies fly outward, Which cells, Chance |

Every card also has **Only cells heading** (any, none, or one of the eight arrows): it then acts only on
cells with that heading ("only cells heading right"). Explode has **Copies fly outward**.

- **Order matters.** The base steps first; each card then works on the board the one before left,
  so a later card has the last word on the cells it touches. Crowd → explode is not explode → crowd
  (`gridRulesStack.test.ts` "stacking order matters as designed").
- **Gathered.** Each cell works out its own next state from what is round it (a fragment shader can
  only write itself): a copy lands where a meeting cell sits `distance` away; a mover's empty target
  takes it. Copies only land on empty cells. Two movers aiming at one empty cell leave one there.
- **Chance** is rolled per cell (explode: per meeting cell; moves: per moving cell) and step with
  Blocks' whole-number dice (`dice.ts`), keyed by the cell, the frame and the Seed, so the try
  board's CPU rolls what the GPU rolls.
- **The section:** a chain line (Base: Count B3/S23 → 1 explode → 2 drift), a card per rule with
  its sentence, on/off, order and remove (the Stencils cards' pieces), **Add another card**, and
  **Or start from one**, which sets a base and its cards as one undo step: *Life that explodes*,
  *Brain in the wind*, *Brain that spreads out*, *Crystals that burn out* (each tuned to stay alive
  on the try board for 300 steps). Pointing at a card lights, on the try board, the cells that card
  changes next step ("Card 1 changes 33 cells next step"); otherwise the board shows the whole
  step's born and dies marks. The nav reads "+ explode, drift"; the node's card reads "Count B3/S23
  + 2 rules".
- **As text:** `then` lines after the rule: `then explode copies=8 distance=3 chance=0.05`,
  `then crowd at=4 move`, `then drift dir=e any chance=0.3`, `then cluster radius=2 at=10 becomes=0`,
  `meet=1..2`, `state=`, `keep`, `@off`. A line that names its rule without `then` lines clears the
  cards (in the editor's As text).
- **On the GPU** the cards are stages of the same board Pass: its Repeat is Steps × (1 + cards) and
  the Pass's Step says which stage a draw is (0 the base, k card k). Each stage reads the one before
  through Previous, so a stack costs one more board draw per card and no Pass of its own. The base
  adds 2 to the board's blue on a frame it stepped; a card acts only then (not on a frame Speed
  skips, nor on a new deal). Steps a frame is cut to fit the Pass's 64 draws (16 → 12 with four
  cards).
- **Not yet:** cards on Blocks and Smooth (kept on the node, not run, as decided: Blocks keep counts
  in pairs and Smooth holds numbers); card settings as live uniforms (a card edit recompiles, as a Stencils
  edit does).

### Movers: headings and collisions

Cells can carry a **heading** as extra state (`gridRules/stack.ts`): 1 to 8 for up, up right, right…
clockwise, 0 for none. It rides in red's fraction: red = state + heading / 32. That is at most a
quarter, so everything that reads a state as `floor(red + 0.5)` (the base, the view, the other cards,
the try board) reads it as before, and every value is exact in a half float. The base keeps a cell's
heading while the cell stays (a survivor keeps it, a dying Stages cell too); a newborn, a painted or a
seeded cell has none. Drift, Crowd's step away and Move carry it along; Cluster keeps it.

**Claim and resolve.** A mover claims the cell ahead. A cell that is empty, inside the walls and
claimed by exactly one mover takes it; the mover's cell empties. Anything else is a conflict and the
mover is **blocked**: two movers claiming one cell, two facing each other side by side, a wall or a
cell ahead. Every cell works its answer out from the cells within two of it (a mover's target's
claimants), so no two cells ever write one cell and nothing is lost or doubled: moving, bouncing,
turning and stopping keep every cell (300 steps, walls and wrap, in the tests). A queue moves as
rule 184 traffic does: only the front car whose cell ahead is free moves this step.

The **Collide** card is the resolve pass: placed before a Move card it finds this step's conflicts
(head-on pairs and contested cells) and settles them; Move then moves what is left. Its chance is
rolled once per **meeting cell** (the contested cell, or the head-on pair's cell heading up, up right,
right or down right), so both movers do the same thing. Merge leaves one cell on the contested cell
with the first claimant's state (clockwise from above) and the heading of the sum of their steps
(head-on: they cancel and stop). Explode's copies land on empty cells `distance` from the meeting
cell, flying outward with Copies fly outward.

**On the try board** the arrows under the board (· for none, then the eight) set the heading cells are
drawn with, shown when a card moves or reads headings; every cell with a heading shows an arrow, and
pointing at a cell says its heading and the next step's. **Use as the start** keeps the arrows: the
drawn start has a `heads` row per row (`'.'` none, `1`…`8`), the GLSL bakes them as it bakes the
states, and a new set of arrows is a new signature.

**Recipes:** *Bouncing cells* (a still base, B/S012345678, collide bounce → move with random headings,
walls), *Fireworks* (collide explode, 8 copies flying 2 away → move → a cluster that thins crowds),
*Movers that merge*, *Traffic* (every cell heads right: rule 184).

**As text:** `then move assign=random blocked=bounce any`, `then collide explode copies=8 distance=2
fly`, `then collide merge`, and `heading=e` (or `heading=none`) on any card.

`gridRulesMovers.test.ts`: the GPU stages and the CPU try step from the same board (random states and
headings) give the same red (state and heading) and green, value for value, for ten steps: move with
random headings, bounce on walls, turn, the heading filter, collide bounce / turn / stop / merge /
explode (flying and still) before move, Life with movers, Brian's Brain with any cell moving, drift
carrying headings, crowd stepping away; every movers recipe; step-through back and forward. And by
hand: one cell a step, assign, two claimants waiting, bounce and turn (contested and head-on), merge
(sum of headings; head-on stops), explode's 8 copies flying outward, walls turning a bouncer round,
counts kept for 300 steps, a traffic jam, drawn headings dealt alike on both and kept through Use as
the start, `then` lines read and printed back, and the recipes still moving after 200 steps.

`gridRulesStack.test.ts`: every card (and four at once) on Life, Brian's Brain, Star Wars and
Wireworld, wrapping and walled, stepped on the GPU program (every stage, with the Pass's Step) and
on the CPU for eight steps: the same board each step; step-through back and forward lands on the
GPU's boards; a frame Speed skips leaves the cards out; the order tests; each card on a hand-laid
board; the spec → one board Pass with Repeat 1 + cards; the recipes compile; `then` lines read and
print back.

## Shared settings

- **Start**: **Your drawing** (below), **Text** (below), Noise (How full, Seed), A seed in the middle, Empty, A picture
  (wire a picture into **Start image**: bright cells start on; Smooth takes its brightness).
  **Deal a new board** in the builder, or the **Reset** param (a Play switch).
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

## A drawn start

Start **Your drawing** (`start: 'cells'`) deals a new board from cells you drew, placed in the middle
of the board whatever its size (`src/gridRules/startCells.ts`). The drawing is the node's
`startCells` param: `{ w, h, rows, ox?, oy? }`, rows top first, `.` empty and a digit (or a–f) the
state, cropped to its cells, at most 128 × 128, moved `ox` cells right and `oy` up from the middle
(a text start's position). A state above the rule's last is clamped; Smooth starts a drawn cell at 1
(Growing patterns: B).

- The GLSL bakes one test per drawn row, state and 16 cells (a bit of a whole-number mask) and
  places the drawing's bottom-left cell at floor((board − drawing) / 2), as the CPU stamps it.
- Its signature is 100 and up (past every other start's), with a hash of the drawing, so a new
  drawing deals a new board.
- As text it is `start=cells` (the drawing has no words; the text keeps the one on the node).
- Open as nodes builds it: a **Drawn start** Expression Block holding the drawing (see Open as nodes).

## A picture start

**Start → A picture** shows what **Start image** reads now and the scene builders' shared picture
picker ([scene-builder.md](scene-builder.md#textures)): upload, paste, a link, the image library, a
texture already in the graph, or a new Shader Texture. The pick is wired into Start image (one undo
step); its bright parts start on.

## A text start

Start **Text** (`start: 'text'`, the node's `startText`: `{ text, size, weight, x, y, state }`,
`src/gridRules/textCells.ts`): words in the Agent Builder's stroke font (`agentBuilder/strokeFont.ts`,
docs/agent-builder.md "Text as a shape or a wall"), rasterised on the CPU so that live cells form the
letters. Life (or any rule) then runs from the letters.

- **Words** (A–Z, 0–9 and `! ? . , : ' - + * / = #`, up to 16), **Size** (how many cells tall the
  letters are, 3–60), **Weight** (the strokes' half-width in the font's units, the letters being 2
  tall), **Across** and **Up** (cells from the board's middle), and, for rules with several states,
  the **State** the letters start in.
- A cell is on when the letters cover its middle: the nearest stroke is closer than the half-weight,
  or (so thin strokes stay joined) closer than half a cell.
- The cells become a drawn start (`gridShape` turns `startText` into `startCells`, offsets
  included), so the GLSL bakes them and the CPU stamps them exactly as a drawing, and the signature
  changes with the words. Editing the words, size or weight recompiles and deals the board again;
  the try board shows the new letters at once.
- As text: `start=text text="LIFE" text-size=12` (either `text=` or `text-size=` sets the start).
- `gridRulesTextNb.test.ts`: an L is a column and a foot, I is symmetric, O a closed ring, thin
  strokes stay 8-connected, the start is centred and moved by x and y, and the GPU deals the letters
  where the CPU stamps them (Count, Stages, Smooth), Life then stepping alike.

**From another builder.** `newGridRules({ params, startCells })` (`src/builders/open.ts`) adds a
Grid Rules node with those params and a drawn start (rows of states, top first, or a StartCells)
and opens the builder: the way a builder hands its drawn cells to Grid Rules
(`gridSeedParams` is the pure part). The Grid scene builder's "Make it a simulation" uses the same
start (`startCells`, each drawn shape a live cell). `newGridRules()` with nothing is as before.

## As text: the Recipe tab

The **Recipe** tab shows the whole rule as one line of the shared Playfield language
(`src/lang/dialects/grid.ts`; the plan is `docs/playfield-language-plan.md` §4.3). The words are the
same as in the Do… bar and the other builders. The line is a preset (or a rule type) and then
only what differs from it:

```
life walls board=480
count born=3,6 survive=2,3 neighbours=von-neumann
count neighbours=radius radius=5 born=34..45 survive=33..57       (this is bosco)
stages born=2 survive= states=3                                   (this is brians-brain)
smooth waves wave-speed=0.9 damping=0.995
smooth custom u={u + 0.2 * lap_u} v={v} a=0.5
patterns states=4
  stencil .../.1./... → 2
  stencil .../.3./... → 1 count=1:1..2
blocks states=3
  block 11/00 → 00/11
  block 10/*0 → 00/=1 @mirror chance=0.8
life · colours on=green empty=black · brush size=5 fill=0.3
```

- **Presets** are named by their slugged label: life, highlife, seeds, day-and-night, maze,
  coral, anneal, diamoeba, replicator, life-without-death, caves, diamonds, bosco, majority,
  brians-brain, star-wars, frogs, sticks, spirals, swirl, lava, bloomerang, heat, ripples,
  mitosis, coral-growth, worms, spots, labyrinth, wireworld, falling-dots, crystal, falling-sand
  and gas. The Count Maze is `maze` and the Smooth one is `labyrinth`.
- **Settings:**
  - `born=` / `survive=` take counts (`2,3`) or, with `neighbours=radius`, a range (`34..45`).
    `rule=B36/S23` and a bare `B36/S23` also read.
  - `neighbours=moore|von-neumann|radius|custom`, `radius=`, `shape=box|circle`, `states=`.
    `custom` is the stencil already on the node (Moore's when there is none): a stencil has no
    words.
  - `board=` is cells across at 1080p (960, 480, 240, 120, 60). `wrap` / `walls`.
  - `speed=` runs 0–1 a frame; above 1 it is steps a frame. `steps=`.
  - `start=noise|empty|image|centre|text`, `density=`, `start-seed=`; `text="LIFE"` and
    `text-size=12` (a text start).
  - Smooth: `spread=`, `cooling=`, `wave-speed=`, `damping=`, `feed=`, `kill=`, `spread-a=`,
    `spread-b=`, `u={…}`, `v={…}`, `a=` to `d=`, `gain=`.
  - `afterglow=`, `age-rate=`, `age-fade=`.
- **Stencils.** Cells read top row first: `.` any, `*` not empty, a state (0–9, a–f). `→` the
  state it becomes. `count=state:min..max` checks the neighbours. `@turns` and `@turns-mirrors`
  cover every orientation.
- **Blocks.** The before cells are `.`, `*` or a state; the after cells are `=` (unchanged) or a
  state. Add `chance=` and `@mirror` or `@turns`.
- `@off` switches a stencil or a block off.
- **Randomness:** `feed=random`, `kill=random(0.05..0.06)`, `colours on=random` and a leading
  `random` (`random stages`) draw from the interesting ranges of `src/lib/surprise`. `seed=42`
  repeats a result.

Typing reads the text as you go: mistakes are listed at their line and column with "did you mean".
**Apply** (or ⌘Enter, or leaving the box) writes the text into the form as one undo step. Rules bake
into the GLSL, so the text isn't applied on every keystroke. The Recipe chip on the card shows the
same line, with `grid` in front so it pastes into the Do… bar. In the bar, `grid` is needed only
for a name that is also another word (`grid swirl`, `grid ripples`, `grid diamonds`).

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

## Muting

Every stacked card, stencil and block has the builders' ⊘ in its header
([scene-builder.md](scene-builder.md#muting)): it is the card's old on/off switch with the shared
look. Click turns the card off (it shows MUTED, its body dims, its settings stay); Alt/Option-click
solos it (every other card in that list goes off; again turns them all back on). A muted card is left
out of the step, on the CPU and in the shader, so the step runs as if it were not there. Saved specs
keep reading: `off` is the stored flag, and a `muted: true` reads as off. In text a muted card prints
`@off`; `muted` and `@muted` read as off too. Tests: `src/gridRules/__tests__/mute.test.ts`.

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

Grid Rules is on the Agent Builder's shell now, and follows it instead of these cards: each
section has its name, one line and a **Learn more** (`GridRulesEditor.tsx LEARN`), and the pictures
on the try board do the explaining. Every slider's **?** reads the node's own parameter hint (or
its plain-words line, in Smooth). Its `grid-rules` help block is kept for the words it shares.

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

Every node has a note; every Expression Block's note explains each named line. Radius 3 and up, and
your own neighbourhood past 24 cells, are counted in one **Count the neighbours** Expression Block
that reads the board itself (its function reads each counted cell, one line a cell, weights
included), instead of a Sample (texture) card each. Seeding uses Noise Float's hash, so a
new board is a different (as random) deal.

- **A drawn or text start** opens as a **Drawn start** (or **Text start**) Expression Block: the
  drawing is data, held in its function (`grDrawn_<hash>`) as numbers, one per drawn row, state and 16
  cells whose bits are the cells, the same code the node bakes. Its result is the drawn state at this
  cell, clamped to the rule's last state; Start over? mixes it in on a new board (or Reset). Smooth
  reads it into Start values. A new drawing writes a new function.
- **Your own neighbourhood** opens as one Sample (texture) card per counted cell, and Count the
  neighbours multiplies each by its weight. Up to 24 counted cells (radius 2's); more are counted in
  one block (above).
- **Stacked rules** open as a Pass a card. The base is the board Pass (it also writes the step mark,
  **Clock and step mark**, and **Keep the heading** keeps a staying cell's heading); each card is a
  **Card k** Expression Block (its function is the very GLSL of the node's stage k: `stackStageGLSL`)
  and a Pass, `<label> card k (nodes)`, reading the Pass before it. The base's reads a step ago come
  from the last card's Previous, so a frame starts where the last card left the board; the look and
  the Board output read the last card. A drawn start with arrows adds **Drawn headings**. One step a
  frame (a chain of Passes can't Repeat as one: with Steps a frame above 1 the node steps faster).
  `gridRulesAsNodes.test.ts` steps the opened graph (every Pass in order) against the node for six
  steps from a board with headings: Life + explode, crowd + drift with walls, Brian's Brain + drift,
  Wireworld + cluster, collide bounce → move, fireworks, merge at Speed ½, and Life + move from a
  drawing with arrows (dealt alike); and radius 3 and a weighted 7 × 7 neighbourhood.
- `gridRulesTextNb.test.ts` opens Life from a drawing and from text, Brian's Brain from a drawing,
  Heat from text and a custom neighbourhood from a drawing: each compiles, deals the drawing on a new
  board exactly as the node does (and as the CPU stamps it) and steps as the node for five steps.

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
- **The try board** (CPU) doesn't run a custom Smooth update (it shows plain spreading), and deals
  an Image start as noise.
- **Open as nodes** counts radius 3 and up and big neighbourhoods of your own in one block; it
  seeds noise with a different hash (a drawn or text start is the same cells); stacked rules open
  one step a frame.
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
