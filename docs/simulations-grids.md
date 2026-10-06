# Simulations: grids

Cellular automata and grid simulations built only from existing nodes: no new node types, no
changed node behaviour. The answer to "can we make Game of Life without new nodes?" is yes: a
**Pass** holds the board, its **Previous** output is the board one step ago, and ordinary nodes
(Sample, Neighbours, Compare, Mix, Max) write the rule.

Code: `src/store/simGridExamples.ts` (the folder), `src/compiler/__tests__/simGridExamples.test.ts`.
The folder is **Simulations: grids** in the Examples list. These are the wired versions, named
"… (under the hood)"; beside each is its **Grid Rules** version, the same simulation as one node
(see [grid-rules.md](grid-rules.md)), whose Open as nodes builds a graph like these.

## The building blocks

| Need | How | Notes |
|---|---|---|
| Memory between frames | A Pass, read through its **Previous** output | Each example's Pass has a label of its own: the texture is kept by the Pass's slug (made from its label) while the app runs, so two examples with the same label would hand one board to the other. |
| Blocky cells | Pass **Scale** ⅛ or ¼, **Filter** Nearest | One Pass pixel is one cell. Nearest means every read is exactly one cell, never a blend. |
| The cell next door | **Sample (texture)** on Previous, **Offset** = one cell in picture pixels (8 at ⅛, 4 at ¼) | Offsets are in picture pixels (`_px` is one picture pixel), so a cell at Scale ⅛ is 8. |
| Count the 8 neighbours | Eight Sample nodes into one small Expression Block (`n + ne + e + …`) | See "Counting neighbours" below. |
| "Any neighbour is X" | **Neighbours (texture)**, Max (3 × 3) | Max reads each pixel on the grid, so it is exact on a Nearest Pass (Forest fire). |
| Diffusion, the Laplacian | **Neighbours (texture)**, Average or Difference from average, on a Linear Pass | Heat and Water. These read between pixels (see below), which is right for smooth fields. |
| Rule tests | **Compare** ≈ with Smoothing 0.5 | Counts are whole numbers, so ≈ with 0.5 is an exact match. Compare's B has no slider: wire a Constant or a Constants card. |
| Pick by state | **Mix** with the state as Blend | `Mix(born, survives, alive)`: a dead cell takes Born, a live one Survives. |
| Speed below 60 steps a second | A step clock in a spare channel: `phase + Speed`, **Floor** is "step now", **Fract** the next phase | Mix(old, new, tick) holds the board on the other frames. |
| Many steps a frame | Pass **Repeat** | Cave (8), Heat (4). |
| Seed on the first frame | A channel written as 1 every frame (green or blue); Compare ≈ 0 on it is "first frame" | An empty Pass reads 0 in RGB. Its Alpha can read 1, so Alpha is not a safe flag (Wireworld stores 3 + phase there and tests "< 2"). |
| Reset | A Constant (a Play switch): Max(first frame, Reset) is "start over" | |
| Per-cell dice | **Noise Float**, Hash, with Time wired in | Different every cell, every frame. |
| Rare random events | Hash the event's number, Time × rate rounded down, into a position | See "Rare events" below. |
| Mouse painting | **Mouse** Pixels × the Pass's Scale (a vec2 Multiply), against **Pixel Coordinates**, in a Circle SDF | See "The mouse in a Pass" below. |

### Counting neighbours

The first idea was `Neighbours (Average, 3 × 3) × 9 − self`. It doesn't give a count with the
Neighbours node as it is: Average and Difference read **between** pixels (one bilinear read half a
step off the grid is the mean of the 2 × 2 pixels round it, so 3 × 3 takes 4 reads). The four
2 × 2 means weight the 3 × 3 block 1-2-1 by 1-2-1 (centre 4, sides 2, corners 1, out of 16), a
tent, not 1 each. On a Nearest Pass the half-step reads land exactly on pixel borders and pick
arbitrary pixels. So the board examples count with eight Sample (texture) reads (exact on
Nearest) summed in one Expression Block, which is also what the grids guide describes ("eight
samples at ±1 texel give the Moore neighbourhood"). Neighbours stays where it fits: Max for "fire
next door", Average and Difference for heat and water, where the tent is a perfectly good blur and
Laplacian (Water's wave speed is set for it, below).

### Staying exactly 0 or 1

Compare is a smoothstep with a width of at least 0.00001, so on a circle's edge it can, very
rarely, land between 0 and 1. A half-alive cell then makes fractional counts, and in Falling sand a
fraction of a grain smeared until it filled the screen. Every board rounds its state before storing
it (a **Round** node, or `step(0.5, …)` in the sand step).

### Rare events

Noise Float's Hash is `fract(sin(…) × 43758.5)`; with 32-bit floats its numbers come in steps of
about 1/256 near 0, so "1 in a million per cell" happens about 1 in 500. Rare events (lightning,
raindrops) are instead timed: `Time × rate`, rounded down, is the event's number; two hashes of it
give a random position; a Circle SDF there is the event. Lightning is "strikes per second" rather
than Drossel–Schwabl's per-tree f.

### The mouse in a Pass

Inside a Pass at Scale ⅛, `u_resolution` is the Pass's own size, but `u_mouse` is in picture
pixels, so the Mouse node's UV output is off by the Scale there. The examples measure the brush in
cells instead: Mouse **Pixels** × Scale (a vec2 Multiply) against **Pixel Coordinates** (which
inside the Pass counts cells), into a Circle SDF.

The brush is gated by a Constant that Play maps to the **mouse button**. Mappings drive the
Constant in the Studio too, and the mouse button source now reads the Studio preview's button as
well (it used to listen only while performing), so the brush paints in the Studio, on the Play page
and in exported web pages. A graph can also read the button directly with the **Mouse button** node.

## The examples

### 1 · Game of Life

Conway's rule (Gardner 1970): a dead cell with exactly 3 live neighbours is born; a live cell with
2 or 3 survives; every other cell dies.

- **Board.** Pass "Life board", ⅛ size (240 × 135 cells at 1080p), Nearest, Edges Repeat (a torus).
  Alpha is alive; red the afterglow; green 1 (started); blue the step clock.
- **Rule.** Sample × 9 (self and 8) → Count → Compare ≈ Born with (3), ≈ Survives with (2), ≈ (3)
  from a Constants card → Max (survives) → Mix(born, survives, alive) → Mix with the tick (Speed).
- **Seed and Reset.** Noise Float (Hash, Time) < Density on the first frame or while Reset is on.
- **Mouse.** Paints a random half of the cells under the brush (a solid block would just die of
  crowding).
- **Colour.** Red keeps an afterglow (`max(alive, last × 0.93)`) through a Stops Palette; live
  cells take their own colour.

### 2 · Life-like rules

The same board, with the rule as 18 switches (Play groups "Born with" and "Survives with"), on two
Constants cards. Two small Expression Blocks look the count up in the switches. Starts as Day &
Night (B3678/S34678). The Play notes list HighLife B36/S23, Seeds B2/S, Maze B3/S12345, Coral
B3/S45678, Diamoeba B35678/S5678, Anneal B4678/S35678.

### 3 · Brian's Brain

Silverman's three-state rule: off → on with exactly 2 on neighbours; on → dying; dying → off.
Two channels hold three states (Alpha on, red dying); the count reads Alpha only. Board at ¼ size
(480 × 270), because on a small board the sparks can burn out. A second Pass ("Brain picture")
holds the coloured cells for Glow (texture).

### 4 · Cave generator

The 4-5 rule: a cell is rock when at least 5 of its 3 × 3 block (itself included) are rock. Pass
"Cave map", ⅛ size, Nearest, **Repeat 8**: a new map is seeded and smoothed within one frame, then
holds still. Seed and Rock density are stored in green and blue, so moving either starts a new map.
For the picture, Blur (texture) turns rock into height, Pass "Cave height" holds it, a Stops Palette
colours it as terrain and Flow (texture) shades the slopes.

### 5 · Water ripples

Hugo Elias's two-buffer water. Red is the height now, green the height a step before:
`new = (2h − h_old + Laplacian) × damping`, then the old red moves to green. The Laplacian is
Neighbours, Difference from average, on a ½-size Linear Pass. Its tent weighting makes it a quarter
of the 5-point Laplacian on smooth waves, so Strength 2 matches Elias's `neighbours / 2 − old`;
the scheme is stable up to Strength 4. Raindrops are timed events; the mouse pushes the surface.
Flow (texture) on the heights bends a photo (refraction); Levels picks the crests for a highlight.

### 6 · Heat diffusion

`T' = mix(T, Neighbours Average, Spread) × Cooling + heat`, four steps a frame (Repeat 4) on a
¼-size Linear Pass. The temperature is stored in Alpha and as grey in Color, so the Neighbours
Value (a brightness) is the temperature. Drifting Perlin hot spots and the mouse add heat; Levels
and a Stops Palette make a heat map.

### 7 · Forest fire

Drossel–Schwabl: empty → tree with chance p; tree → fire if a neighbour burns (here with a Spread
chance, so fronts turn ragged instead of square) or lightning strikes; fire → empty. Pass "Forest",
¼ size, Nearest. Alpha is fire, red tree, green the ash glow. Neighbours (texture), Max, gives "fire
next door"; one hashed die per cell per frame rolls growth (and, reused, the spread: growth only
matters on empty ground, spreading only on trees). Lightning is timed. Click to light trees.

### 8 · Falling sand

Possible with gathers only. A shader writes one cell and can't push a grain into its neighbour, so
every cell asks both questions from its 3 × 3 block: does my grain leave, and does a grain arrive?
A grain falls into an empty cell below; otherwise it slides diagonally to this step's side if that
cell is empty and nothing is falling into it from above. The side flips every step. The cell below
and to the side runs the mirror test (empty, nothing above, the grain up on the other side is
standing on something), so both cells always agree and grains are never lost or doubled. The
floor (bottom row) counts as full; on the top row nothing may arrive from above, because a read
past the edge reads the edge itself. Ledges are cells with green −1 (walls that never move), drawn
every frame from two Line Segment SDFs. The step is one Expression Block, explained line by line.
This is a "pull" formulation, not Margolus blocks: the Margolus neighbourhood would also work (a
2 × 2 block decides together, alternating its offset every step), but needs the block's corner
from the step parity and more branching.

### 9 · Wireworld

Silverman's four states: empty, copper, head, tail. Head → tail, tail → copper, copper → head with
exactly 1 or 2 head neighbours. Red head, green tail, blue copper; Alpha holds 3 + the step clock.
A small Expression Block lays out a starter circuit: square loops (3, 6 and 9 cells out) in each
24 × 24 tile, one electron each, with some outer loops bridged to their neighbours. The pen sends
sparks, or lays copper when "Pen draws copper" is on.

## Performance

Whole frame (every Pass program, Repeat included, then the picture) at 1920 × 1080, timed on a
WebGL2 context in headless Chrome (ANGLE Metal, Apple M3 Pro), each frame finished on the GPU:

| Example | Programs (draws) | Median ms per frame (range over runs) |
|---|---|---|
| Game of Life | 2 (2) | 0.6–2.0 |
| Life-like rules | 2 (2) | 0.6–2.0 |
| Brian's Brain | 8 (8, Glow's hidden passes) | 0.8–0.9 |
| Cave generator | 5 (12: Repeat 8, Blur) | 0.9 |
| Water ripples | 2 (2) | 0.7–0.8 |
| Heat diffusion | 2 (5: Repeat 4) | 0.6–0.7 |
| Forest fire | 8 (8) | 0.9–2.7 |
| Falling sand | 2 (2) | 0.6–1.1 |
| Wireworld | 8 (8) | 0.7–2.7 |

The board passes are tiny (⅛ is 32 400 pixels at 1080p); the cost is the picture and the glows.

## Limits

- **Mouse UV in a scaled Pass** was off by the Pass's Scale (above). The Mouse node's UV, X and Y
  are now measured against the pass when read there; these examples keep Pixels × Scale.
- **Neighbours Average is a tent, not a box,** so it can't count neighbours (above).
- **Rare per-cell chances** below about 1/256 aren't honoured by the hash (above).
- **Langton's ant** was left out: it needs the ant's heading carried with it, which is a gather of
  "which neighbour holds an ant pointing at me" and the cell's colour flip under it. Possible with
  the same pattern as Falling sand, but less clear than the nine above.

## Sources

1. Martin Gardner, "Mathematical Games: The fantastic combinations of John Conway's new solitaire
   game 'life'", *Scientific American* 223 (4), October 1970, pp. 120–123.
2. LifeWiki, "Life-like cellular automaton" and the pages on HighLife, Seeds, Day & Night
   (conwaylife.com/wiki). B/S rule notation.
3. Tommaso Toffoli and Norman Margolus, *Cellular Automata Machines: A New Environment for
   Modeling*, MIT Press, 1987. Brian's Brain (Brian Silverman's rule) and the Margolus
   neighbourhood.
4. A. K. Dewdney, "Computer Recreations: The cellular automata programs that create Wireworld,
   Rugworld and other diversions", *Scientific American* 262 (1), January 1990.
   Wireworld (Brian Silverman, 1987).
5. Jim Babcock, "Cellular Automata Method for Generating Random Cave-Like Levels", RogueBasin; and
   Lawrence Johnson, Georgios N. Yannakakis, Julian Togelius, "Cellular automata for real-time
   generation of infinite cave levels", *PCGames '10*, 2010. The 4-5 rule.
6. Hugo Elias, "2D Water" (freespace.virgin.net/hugo.elias/graphics/x_water.htm, archived). The
   two-buffer wave.
7. Barbara Drossel and Franz Schwabl, "Self-organized critical forest-fire model", *Physical Review
   Letters* 69 (11), 1992, pp. 1629–1632.
8. The grids guide, part 4 ("Ripples, Game of Life and water on a grid") and the passes guide
   (1.8–1.12), which this folder follows.
