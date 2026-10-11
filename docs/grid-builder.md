# Grid builder

The Scene builder's **Grid scene** kind (docs/scene-builder.md). You work on a mini version of the
grid and draw on it: place shapes in cells, make them move, run a pattern over the cells, bend the
grid with warps, and add simple When/Do rules between shapes. Everything runs on the GPU as real
nodes. One switch turns the drawing into a Grid Rules simulation, and its editor has the way back.

Code: `src/gridScene/` (spec, GLSL, build, apply, store, surprise, templates, actions) and
`src/components/gridScene/` (the window and the mini grid).

## Grid scene and Grid Rules

The kind page's **Grid scene** opens the Grid builder. Grid Rules (the simulation grid: Life, sand,
heat, Wireworld) is reached from it:

- **Make it a simulation → Grid Rules** in the builder's header builds the drawing (if it changed),
  adds a Grid Rules node whose drawn start is it, puts the Output on the simulation and opens the Grid
  Rules editor.
- The Grid Rules editor of a node made that way has **‹ Pattern grid**: the Output goes back to the
  drawing and the Grid builder opens on it. The Grid Rules node stays; jumping again reuses it.
- A plain Grid Rules node is still one Do… bar phrase away ("new grid rules"), and a Grid Rules node
  already in the graph is listed by the Scene builder's "Edit this one" and opens in its editor.

Why one kind and not two: the two are the same idea seen two ways (cells you set up by hand, cells
that a rule steps), so the kind page keeps four cards and the switch between them sits where the
work is. Drawing first and then simulating is the path the jump makes easy; the other way round
(a simulation with no drawing) is the Do… bar's.

### What carries over

**A state per shape.** Make it a simulation lists the drawing's shapes, each with a state (0 leaves
it out, 1 and up a state of the rule; a Stages, Stencils or Blocks rule can be picked there too), so
walls, sand and air, or wires and sparks, start as different states. The picks are kept on the spec
(`simStates`), so the next jump uses them. `drawnStartOf` writes the rows with each shape's state
(digits, a–f above 9).

The drawing's placed cells, as they are at that moment, are the simulation's **drawn start**
(Grid Rules' Start: Your drawing, the node's `startCells`, see grid-rules.md "A drawn start"): every
drawn shape is a live cell (state 1), cropped to the drawn cells. The Grid Rules builder's try board
and the node's own board both start from it. A drawing of another size than the board is placed in
the middle, as the drawn-start mode does. The node is made with `startCells` in
`simulationFromGrid` (`gridScene/actions.ts`, `drawnStartOf`). The board is Coarse (⅛), so each
drawn cell is one board cell, and Life evolves it. **Reset** on the Grid Rules node deals the board
again from the drawing as it was when you jumped; jumping again updates the drawing on the same
node. Nodes made by an older jump (a Start image through a Pass) keep working, and the next jump
switches them to the drawn start. The rule starts as Life; any preset can be picked in the editor.

## The window

A viewport-first layout like the Agent Builder (StudioShell):

- **Left:** the brush (the shapes, A to F, and an eraser), the mini grid, columns and rows (2 to
  24), Clear cells, and the sections.
- **Centre:** the live preview: the graph Build makes, compiled and drawn by the builder's own
  WebGL canvas (useBuilderPreview: every frame, at the screen's density, uniforms only when only a
  number changed). The main preview behind the window is held while it is open.
- **Right:** the selected section's settings.
- **Bottom:** starting points (Pixel heart, Checker dance, Ripple pond, Spiral stars, Traffic,
  Warped weave, Orbiters). Loading one replaces the form, one undo step.
- **Header:** Scene builder › Grid scene (back to the kinds; a changed drawing is built first),
  Surprise me (seeded, one undo step), undo and redo, Make it a simulation, Build (Rebuild when
  editing a built grid) and **Done** (builds what changed, closes, and frames it on the graph:
  finishBuilder).

Every number is a BuilderSlider (double-click resets, bipolar ranges, typing past the end widens
it).

### Drawing

- Click or drag on the mini grid to place the brush's shape; a drag fills every cell it crosses and
  is one undo step however long it takes.
- Right-click (or Alt-drag, or the eraser) clears.
- The brush shape's motion paths are drawn faintly through its cells, from the same sums the
  shader uses (`motionAt`).
- Cells a rule points at (a cell, a column, a row) are ringed. **Pick on the grid** in a rule waits
  for a click on a cell (Esc stops it).
- Every cell can be drawn (up to 24 × 24). The drawing is data, not code: drawing and erasing change
  numbers on the Grid scene node, never the shader, so nothing recompiles (see "How a pixel finds
  its shapes").
- **Draw mode** (under the brush): how the drawing covers the grid (see "Draw modes"). A click on a
  copy draws in the cell it copies; copies show faintly and the cells you draw in are outlined.

### Draw modes

The drawing stays the source; the shader maps each cell to the cell of the drawing it shows before
it reads the drawing, so a mode costs nothing per shape (`gs_cell`; `sourceCell` on the CPU):

| Mode | What it does |
|---|---|
| **Only here** | A shape goes only in the cell you draw it in (the default). |
| **Repeat** | Draw in one tile, Period X × Period Y cells starting at Offset; it repeats over the whole grid (cell id mod the period, as Cell Filter's Modulo). **Row shift** slides each row of tiles across: bricks, staggers. Period, offset and shift are live sliders on the Grid scene node. Repeat 1 × 1 fills every cell from one. |
| **Mirror X / Mirror Y / Mirror both** | Draw on the left half (top half, top-left quarter); it reflects. |
| **Rotate 4** | Draw in the top-left quarter; it turns round the middle into all four (a kaleidoscope; best on a square grid, as a turned cell can fall off a non-square one). |

By default motion lag, rules, the pattern's wave and the picture modes use the **shown** cell:
copies ripple across the grid with the lag, a rule on column 6 catches the copies there, and each
copy carries its own piece of a picture. **Copies match the drawn cell** (a toggle under the draw
mode) runs every copy as the cell it copies instead: its lag, pulse, wave, mask, rules and picture
are worked out in the drawing's own frame and the result is moved to the copy, so every copy moves
and looks exactly alike (and carries the drawn cell's piece of a picture). A rule with a partner is
then checked between drawn cells. Make it a simulation starts from what the grid shows, copies
included.

### Text

Words in the Agent Builder's stroke font (`agentBuilder/strokeFont.ts`), two ways
(`src/gridScene/textMask.ts`):

- **The text stamp.** **Text** beside the words and their height (3–12 cells) under the brush: while
  it is on, pointing at the mini grid fills the cells the letters will cover, and a click puts the
  brush's shape in every one (the first shape while the eraser is picked; right-click or Alt clears
  them). One undo step a stamp, within the 128 drawn cells. The cells are the ones Grid Rules' text
  start and try-board stamp use (`gridRules/textCells.ts`), so **Make it a simulation** starts Life
  from the letters.
- **How letters become cells.** A cell counts when a stroke reaches into it, not only when the
  stroke covers its middle: the distance is measured square-wise (the larger of the x and y gaps),
  so a thin stroke lying between two cells' middles marks both instead of neither, and every letter
  and digit keeps all its strokes at every size (an "HI" at 6 cells used to lose half the I and the
  H's bar). Letters are spaced at least two cells apart, so neighbours never run together, and the
  box the words are drawn in is sized from the strokes plus their reach, so nothing is cut off
  (`gridRules/__tests__/textCells.test.ts` checks A–Z and 0–9 at 3–24 cells).
- **The pattern's mask.** Patterns & warps → **Only in words**: the wave changes only the cells the
  words reach into, and **Fill empty cells** puts its shape only there, so the fill spells the
  words and moves with the wave. Words, Size, Weight, Across and Up (cells from the grid's middle).
  In the shader the mask is a function of its own (`gs_mask`: the font's strokes, one line each, as
  the Agent Builder's text: no texture); the mini grid tints the same cells, worked out on the CPU
  with the same square-wise distance (`textMaskAt`; `gridText.test.ts` checks them cell for cell). Changing the
  words rebuilds; the pattern's numbers stay live.

### Sections

| Section | What it sets |
|---|---|
| **Shapes** | Up to six shapes: kind (circle, square, ring, diamond, triangle, hexagon, star, plus, cross, heart), colour, size (a share of half a cell: 1 touches the neighbours), turn, spin, pulse, outline. Add and remove shapes (a removed shape's cells and rules go with it). **Picture**: a picture the shape carries, and its mode (see Pictures in pieces). |
| **Motion** | The brush shape's path: still, up and down, side to side, both at once, circle, figure eight, bounce, travel, hop, **Drawn** (your own; see Drawn paths) or **Math** (a formula or a curve; see Math paths), with **path modifiers** under them (see Path modifiers), **Vary per cell** (see below) and an **All shapes** card (Shared, Offset: see Shared motion). The **XY control** sets how far (in cells, y up): drag the point, the path is drawn round it; X and Y sliders beside it, and the reach's **Length**. **Angle** (degrees) turns the whole path round, keeping its length, and **Angle spin** (degrees a second) turns it on its own (see Angle). Speed (cycles a second) and lag (each cell starts (x + y) × lag of a cycle later: the motion runs through the drawing as a wave). Travel and hop wrap round the grid. |
| **Patterns & warps** | A wave over the cells: ripple, diagonal, checker, rings, spiral, stripes, random. It changes every shape's size, turn, push, hue or brightness by Amount; Waves is how many across the grid, Speed in cycles a second, Arms for the spiral. **Fill empty cells** puts a shape in every cell you didn't draw on, its size following the wave (checker + fill is a checkerboard that swaps). **Only in words** limits the wave and the fill to the cells some words cover (see Text). **Grid warps**: up to three space blocks from the 2D Scene Builder's library (the same picker: categories, search, Random), bending the space the whole grid is drawn in, lines and all. |
| **Rules** | When … Do … for every drawn cell, checked in the shader each frame, top to bottom. When a shape *is in the cell (x, y)*, *is in the column*, *is in the row*, *shares a cell with* another shape, or *is near* it (within N cells). Do: *becomes* another shape (its kind, size and colour), *turns a colour*, *swaps colours with* the other shape (both ways), *grows by*, *hides*, *spins*. A rule that names a shape that isn't there is shown as off. |
| **Look** | Background, grid lines (on or off, colour, width in cells), the grid's size, glow (amount, falloff, style), tone map. Glow style **Soft** (the default) is one shape: the shape's colour runs out into its glow, colour × (amount ÷ (distance outside + amount)) ^ falloff, which is 1 at the edge and inside, so the fill meets it without a seam. **Halo** is the Glow Layer's amount ÷ \|distance\|: a bright rim round a flat shape (the look before). |

### Angle

The motion's XY arrow, turned: the shape moves along `rotate((x, y), Angle + Angle spin × t)`.
X and Y stay the base, so a scene without an Angle moves exactly as before (Angle 0). Every path
turns: up and down, side to side and bounce swing off their axis, both at once points the arrow,
circle and figure eight turn their whole path, travel and hop set off at the angle, and a drawn
path turns with it. On the XY pad the point and the path are drawn turned (what the shape does),
with the X / Y as set faint and the angle's arc between; dragging places the turned point.

It is live and animatable: Angle and Angle spin are sliders on the built Shape node (`angle`,
`angleSpin`, so an LFO or Time can be wired into either), their right-click menu adds them to Play
controls, and nothing about them rebuilds the code. The node passes them to the Grid scene as
`dir`; the scene turns each shape's offset by them.

The search stays exact: a turn keeps the reach's length, and the search's bounds are worked out
from the turned path each frame (for a line its turned extent; circle and figure eight a box round
the turned path, the same as before at 0°). Spinning, the builder's warning uses the worst angle.

### Drawn paths

Pick **Drawn** and the pad becomes a drawing surface (−1 … 1 each way; X and Y stretch it into
cells, Angle turns it):

- **Draw**: drag on the pad; when the pointer lifts the stroke is kept (one undo step). With **Auto
  smooth** on it is thinned to its turning points first (Ramer–Douglas–Peucker) and capped at 64
  points. **Edit**: drag a point to move it; right-click (or Alt-click) it to delete it.
- **Smooth** rounds the corners (up to three passes of Chaikin's corner cutting), then the path is
  resampled to 32 points evenly spaced along its length, so the shape moves at an even speed
  however the stroke was drawn.
- **Closed** loops it seamlessly. An open path's end: **Snap back** (straight back to the start),
  **Ease back** (out over the rest of the cycle, then an eased glide straight home over **Back** of
  it), or **Ping-pong** (out and back along the path). **Ease** eases in and out along the path each
  cycle (0: an even speed).
- **Generate** makes a random path from a new seed (one undo step): a wobbly loop when Closed (a few
  smooth harmonics on a circle), a meander when open, with **Wiggle** and **Points**.

On the GPU the path is numbers: the 32 points (with the path's box and fastest step) are hidden
sliders on the Grid scene node (`pA0…`), its settings (closed, end mode, back, ease) on the Shape
node (`path`), so redrawing, smoothing or generating never rebuilds. The neighbour search bounds it
by its box (turned by the Angle) and, with lag, by its fastest step (Snap back jumps, so with lag
the box bounds it). Lag still ripples along it. The spec keeps the stroke and its settings
(`motion.drawn`), so Edit this one reopens it; Surprise me now and then gives a shape a generated
path. `src/gridScene/paths.ts` has the sums, the same on the CPU as in the shader.

### Math paths

Pick **Math** for a path from numbers (`src/gridScene/pathMods.ts`). The point is in pad units,
−1 … 1 (X and Y stretch it into cells, Angle turns it, lag ripples it across the cells):

- **Curve** (the default): Curve Trace's curves, built by its own `curvePoint`. A preset to start
  from (circle, Lissajous 3 : 2, figure eight, pretzel, rotary loops, counter-rotating star and
  flower, harmonograph spiral), its **motion** (lateral: X and Y on their own waves; rotary: two
  circles, the same way or opposite ways), the lateral waves (sine, triangle, square, saw), and
  its numbers as sliders: X / Y frequency, phase and size, Damping, Turns.
- **Formula**: `x =` and `y =` typed in the 2D Scene Builder's space-block language and checked by
  it as you type (errors in plain words; until it checks the shape goes round a circle). `t` runs
  0 → 1 round the cycle; `PI`, `TAU`, the formula's own sliders by name (Add a slider), and in the
  y line `x`, the x just worked out. Whole numbers are written as floats. Presets: circle, heart,
  rose (k petals), squircle, wobbly circle.

The sliders (a curve's numbers, a formula's own) are live sliders on the built Shape node
(`curveFreqX…`, `f_<name>`): animatable, wireable, in the Play menu, never rebuilding. The formula's
text and a curve's motion and waves are code.

### Path modifiers

A stack under the Motion section, for every path but Travel and Hop (they wrap round the grid),
applied top to bottom; each a card with its sliders, up / down / remove and the shared mute:

| Modifier | What it does |
|---|---|
| **Wave along** | A sine wobble across the path (its normal), Amount in cells, Waves a cycle, Speed (it runs along). |
| **Noise** | A smooth random wobble that loops with the path: Amount, Bumps a cycle, Drift, Seed. |
| **Scale** | Stretches across (X) and up (Y); negative flips. |
| **Rotate** | Turns the path by Angle, and Spin degrees a second (ties in with the motion's own Angle). |
| **Mirror** | Flips across, up and down, or both. |
| **Twist** | The radius swells with progress (Swell, Waves) and the path turns as it goes (Turns). |
| **Repeat** | Goes round the path Times a cycle. |
| **Ease** | Slow at each lap's ends, fast in the middle. |

Ease and Repeat change the progress along the path (wherever they sit); the rest change its
offset, in order. Whole Waves, Bumps, Turns and Times loop seamlessly. Every number is a live slider
on the Shape node (`m1amp`…), the mute a hidden number (`m1on`), so moving, muting and animating
never rebuild; adding, removing, reordering or changing a modifier's kind does.

**The search's bound.** A math path, or any path with modifiers, is bounded the general way
(`gs_bound`): a reach R round the home and a rate V (cells, a cycle), Euclidean so the Angle and
Rotate leave them alone, worked out each frame from the live numbers. The path's own (its formula
from the built-in path; a curve's from Curve Trace's bounds; a formula's sampled at 48 points plus
the largest step), then each modifier's: Scale multiplies both, Twist widens R by its swell and V
by its swell and turns, Wave and Noise add their amounts, Repeat and Ease speed the progress up.
Where the path can jump (a formula, a curve, Wave along, a twist that isn't whole), V is "far": with
lag the search is bounded by the reach alone. Tests check the bound against densely sampled paths,
random stacks and the shader's own `gs_bound`, and the search against brute force with lag.

### Vary per cell

A **Vary per cell** card under Motion gives each number a Random strength (0: every cell alike):
Reach, Angle, Speed, Phase and Modifiers (the path), Size, Spin and Pulse (the look). Every drawn
cell gets a stable random offset from a hash of its home cell and the scene's **Seed**, times the
strength: reach × (1 ± s), angle ± s × 180°, speed × (1 ± s) (cells drift out of step), phase ± s
cycles (a random lag), the wave, noise and twist amounts × (1 ± s), size × (1 ± s), spin ± s turns
a second, pulse × (1 ± s). Each number's randomness is **±** or **Up only**, and **each cell**
(a hash a cell) or **smooth** (two slow sine waves across the cells, drifting about a fifth from
one cell to the next: neighbouring cells alike, flowing regions). **Seed** (with Reroll) picks another pattern; the same
seed always gives the same one. Travel, Hop and Still vary only the look.

The strengths are live sliders on the Shape node (`v_reach…`; ± / up and smooth are hidden numbers
beside them), so they animate and sit in the Play menu; the Seed is on the Motion node. A scene
that never turned Vary on builds exactly the code it did; at strength 0 every cell moves as before.

The randoms are worked out once per candidate cell, where the search knows the cell (four keys in
one vector call), and handed to the motion function; the motion arrays are passed by reference.
Both keep the shader small: copying the arrays, or working the randoms out inside the motion
function at every call, made big scenes fail to compile on Apple GPUs (they drew black).

The search: while any path strength is above 0 the cells no longer move alike, so each shape is
looked for within its path's reach (`gs_bound`, widened by the reach's and the modifiers'
strengths) round the home, whatever the lag. Size and pulse widen the shape's own reach. Tests
check the search against brute force for each kind of vary, the shader against the CPU, ± / up and
smooth / independent, the seed, and strength 0 against a scene without Vary.

### Shared motion

An **All shapes** card at the top of Motion:

- **Shared**: one motion for every shape. Turning it on gives every shape this shape's motion;
  while it is on, editing the motion (path, reach, Angle, speed, modifiers, Vary…) edits them all.
  Off, each keeps its copy to change on its own. **Copy motion to all** does it once.
- **Offset** spreads the shapes out of step by their place (A 0, B 1, C 2…, by id, so muting one
  doesn't shift the rest): **Phase** (each shape that much of a cycle after the one before),
  **Angle** (turned that much more) and **Reach** (times 1 + that more). 0 is perfect sync. It
  combines with Vary per cell: the Offset is the same for every cell of a shape, the randomness
  differs per cell.

They are live on a **Motion (all shapes)** node the build adds only when a scene has them
(`offPhase`, `offAngle`, `offReach`, `seed`), wired into the Grid scene (and the rule memory), so
an LFO on `offPhase` makes the shapes chase each other. The search follows the offset exactly
(each shape's reach and angle), Travel and Hop included.

### The Play menu

Right-click a slider for the built node's Play menu (Add to Play controls, keyframes): the shapes'
size, turn, spin, pulse, outline, X, Y, speed, lag, Angle, Angle spin, a drawn path's Ease and Back,
a math path's numbers, the modifiers' numbers, Vary per cell's strengths, the Offset and the Seed,
the pattern's numbers and the glow's. It finds the node by its role in the build the builder edits,
so it needs a Build first (the menu says so).

### Rules that stay changed, and/or, else

- **And / or**: a rule can have more conditions on the same shape, each joined to everything before
  it, left to right ("in column 1 or row 1, and near B").
- **Else**: a second Do that applies while the conditions don't hold (it can't swap colours).
- **Stays changed**: once the rule has fired for a drawn cell, that cell keeps the change after the
  condition ends. Only when some rule is sticky, Build adds a small memory Pass (`Rule memory`: one
  texel a cell, Nearest, half float, reading its own Previous) that keeps a bit per sticky rule per
  cell, set when the rule fires and kept after; the scene reads it as "the rule holds here". A
  sticky rule's Else applies until the rule has fired. The Rule memory block's Reset (map a Play
  button to it), or the clock going back, forgets. The builder's own preview draws the Pass too (`components/builders/previewPasses.ts`).
- Tests: `src/gridScene/__tests__/gridRulesMore.test.ts` (and/or, else, old specs still reading, the
  memory pass and its bits, the change kept after the condition ends, the state per shape).

### Muting

A shape, the pattern or a grid warp can be muted for a while to see the grid without it: click the
mute switch (the same icon as a node's bypass) on the shape's card, the Pattern card, or a warp's row.
A muted piece shows a MUTED tag and dims, keeps every setting, is saved in the scene (so it is still
muted after Build and reopening) and is one undo step.

- **Warps** are still built, their Expression Block bypassed by a live uniform: the point coming in
  passes straight through, so muting and unmuting set a number and nothing recompiles. In the graph
  the warp's node shows the bypass style; its own mute switch there un-mutes it.
- **Shapes** and the **pattern** live inside the Grid scene node's generated code, which has nothing
  to pass through, so they are left out while muted: a muted shape's node, cells, rules and the
  pattern's fill of it are not built; a muted pattern builds as no pattern. Toggling these rebuilds
  the code.
- **Rules** already have their own on/off switch, which works the same way (left out while off).

Alt/Option-click a shape's or a warp's mute switch to solo it: every other shape (or warp) is muted;
solo the same one again to unmute them all. The Grid builder has no text recipe, so there is no
`muted` word to type here.

## What Build makes

```
UV ─► warps (Expression Blocks) ─┬─► Grid scene (Expression Block + helpers) ─► colour, d
Time ────────────────────────────┤      ▲ motion, look, edge, colour per shape
per shape: Colour, Shape A (Expression Block of sliders)
Ground & lines (Expression Block over the background) ◄─ the warped UV
Soft glow (d, colour; or Glow Layer for Halo) ─► Add over the ground ─► SDF Fill ─► Tone Map ─► Output
```

- **Shape A, B…**: an Expression Block whose sliders are the shape's numbers (size, turn, spin,
  pulse, outline, move X and Y, speed, lag, angle, angleSpin; a drawn path's ease and back). Its
  result is the motion (x, y, speed, lag); `look`, `edge`, `dir` (the angle and its spin, radians)
  and, for a drawn path, `path` are exposed outputs. Colour is a Colour node. All live: no recompile.
- **Grid scene**: an Expression Block with the pattern's sliders (amount, freq, speed, arms) and
  the drawing as hidden sliders (`g0…`, eight cells a number, three bits a cell: which shape, 0 for
  none), gathered into an array `gd` in its first line. Its helper functions (in the node's
  functions) draw the grid: for each shape, the drawn cells whose shape could be at this pixel now
  (see below), then the pattern's wave there, the rules, and the shape's distance; the nearest
  shape gives the colour. Each function's name ends in a hash of its code, so two grid scenes in a
  graph never clash. Result: the colour; `d`: the distance (picture units); `home` and `piece`: the
  winning shape's home cell centre and the place on a still picture this point of it came from
  (picture units; see "Pictures in pieces"). Pictures come in as `tx0…` (texture inputs); the
  draw mode Repeat adds periodX, periodY, offsetX, offsetY and shift.
- **Ground & lines**: the background, a faint checker of the cells (tint) and the cell borders,
  read in the warped space so the lines bend with the warps.
- Every node has a note. The structure (a path's kind, the shapes' kinds, the pattern's kind, the
  draw mode, the rules, the warps, the pictures) is code: changing it rebuilds; numbers, and the
  drawing itself, are uniforms. The notes never count drawn cells, so drawing leaves the shader text
  (notes are comments in it) exactly as it was.

### How a pixel finds its shapes

Every pixel looks only at the cells near it, not at every drawn cell:

- **Each shape is searched on its own.** Its motion is turned backwards to find the home cell a
  shape at this pixel would have come from (`gs_find…`): the fixed point h = X − (P(h) − h), the
  place a home's motion puts it at, iterated (up to 8 times, stopping when it settles). With lag,
  neighbouring cells are lag of a cycle apart, so their places differ by at most L = 2 · lag · the
  path's fastest rate a cell; while L is under 0.8 the iteration converges and the search stays
  small (reach ÷ (1 − L)) however big the motion. Lag 0 is exact in one step. Above it, shapes
  overtake each other and no single home is "the" one: the search is the middle of the path widened
  by its range. Travel and Hop solve their wrap round the grid (with lag, each way round it): the
  wrap count is solved with the lag's coupling (a wrap in x moves the home in y too), so however long
  the scene has run the home lands mid-grid and its copies one grid either way are tried. (Before,
  rounding h ÷ grid size alone drifted by lag × reach × wraps cells: with big reach or lag the shapes
  went missing in bands, cut by a straight seam.) A
  square of cells round that home is read in the drawing; a cell is drawn only if it holds this
  shape.
- **The square's size is worked out live, every pixel**, from the shape's sliders as they are now:
  its size, pulse, outline, the pattern's grow (size) and push, its rules' grow and become, and the
  motion (reach and lag) as above. Glow adds a cell to the reach (inside the inverse, so lag widens
  it too): every shape within a cell of the pixel is found. The glow's distance fades out by then
  (from 0.35 to 0.95 of a cell past a shape's edge, `GLOW_FADE`), so the halo never steps where
  neighbouring pixels search different cells (it used to show as faint cell-shaped patches); within
  0.35 of a cell it is as before. The loops run to the cap, 13 × 13,
  and stop at the live radius, so dragging any slider on the Shape or Grid scene node, as far as you
  like, never cuts a shape and never recompiles. Typically 3 × 3 (no glow) or 5 × 5. When a setting
  would need more than the cap (huge reach with a lot of lag), the builder's Motion section says so:
  some shapes may be cut.
- **The pattern's fill** is searched round the pixel's own cell the same way, so a fill shape bigger
  than its cell, pulsing or pushed reaches over the cell's edge instead of being cut there.
- **Rules with a partner** (*shares a cell with*, *is near*) search the partner shape's cells round
  the cell (or point) in question the same way.
- **Cost.** A 24 × 24 grid drawn full, one circle moving round, at 1920 × 1080 in the browser pane
  on this Mac: 5.3 ms a frame with glow (a 5 × 5 search), 2.6 ms without (3 × 3), against 13.9 ms for
  the old code (one block per drawn cell, every pixel testing every one; it allowed 128 cells, so
  576 is its worst case); the shader's grid code is 4 KB instead of 311 KB and links in about 85 ms
  instead of 1.5 s. Big motion with lag, the same grid (glow on unless said), before (the search
  sized from the path's range) and after (the fixed-point inverse, live radius):

  | Motion | Before | After |
  |---|---|---|
  | circle, reach 3, lag 0.02 | 24.8 ms (11 × 11) | 7.0 ms (5 × 5) |
  | the same, no glow | 16.9 ms (9 × 9) | 4.1 ms (3 × 3) |
  | up and down, reach 3, lag 0.03 (L ≈ 1.1: bounded by the range) | 23.9 ms (11 × 11) | 17.0 ms (9 × 9) |
  | circle, reach 2, lag 0.1 (L ≈ 2.5) | 17.9 ms (9 × 9) | 10.9 ms (7 × 7) |
  | circle, reach 0.3, lag 0.08 | 5.8 ms | 6.0 ms |

  (The last rows gain from the radius following the real size, not size 1.) Several shapes cost one
  search each.
- The old per-cell code is kept in the tests (`src/gridScene/__tests__/legacyGlsl.ts`): every
  template and a spread of Surprise scenes draw the same picture with the lookup (within 0.005 of a
  colour step for the templates), compared on the CPU (`gridLookup.test.ts`). The search is also
  checked against brute force (`gridProgram(spec, { brute: true })`, every cell for every shape) for
  big motion with lag on every non-wrapping path, with copies matching, and for Travel and Hop with
  big reach and lag late in time (near the wrap seam, with Repeat and Mirror too). The glow is
  sampled along rows crossing cell borders far from the shapes: no step. The old code is compared
  with the same glow fade applied.

The UV node keeps the spec (`gridScene`), so the Scene builder lists the build ("Grid scene · 10 ×
10 · 27 cells drawn") and **Edit this one** reopens it exactly as built. A rebuild keeps each node's
id (Play controls and your wires stay), its place, and a slider you changed on a node that the new
spec leaves alone (`src/gridScene/apply.ts`, the 2D Scene Builder's scheme).

## Textures

Pictures through the shared picker ([scene-builder.md](scene-builder.md#textures)). Every picture
the scene reads is a texture input of the Grid scene node (`tx0…`) that its scene function reads
itself (an Expression Block passes a texture input to its helpers by name), so a video or the
webcam plays inside the shapes: every frame is read again.

- **Pictures in pieces** (Shapes → Picture): any shape can carry a picture, in one of four modes
  (below). The shape kind **Picture** is a square that carries one (In each shape, by default).
- **Picture pattern:** the pattern **Picture** puts a picture over the grid; each shape takes the
  brightness at **its own cell** (the cell it is in now; the fill: its cell), as the wave: bright is
  the wave's top, so the picture drives the size, turn, push, hue or brightness, and the fill.
- **Picture mask** (Patterns): shapes only where **their own cell** is bright in a picture (**Cut**,
  live), or dark (**Invert**). A shape reaching into a neighbouring cell keeps its own cell's
  answer.

The pattern, the mask and the shapes share one texture input for the same picture.

### Pictures in pieces

Cut a picture up into the grid: the shapes carry it, so you don't see the picture itself, only the
shapes made of it. If the shapes move or wave, the picture does too (in the Matte modes).

| Mode | Where a shape reads the picture | Moving shapes |
|---|---|---|
| **In each shape** | The whole picture fitted to the shape's square (Fill), turning with it. | The picture goes with each shape, whole. |
| **Mask** | The point on the screen (before the warps): the picture stays put; the shapes are windows onto it. | Show different parts of the picture as they move. |
| **Matte: colour** | The picture's colour at the shape's **home cell's centre**: one flat colour a shape, a mosaic or halftone look. | Keep their colour wherever they go. |
| **Matte: piece** | Home cell centre + the point's offset within the shape, turned and scaled with it (its base Turn left out). At rest the pieces make up the picture (the same as Mask); then each carries its piece away, like After Effects' CC Ball Action. | Their piece moves, waves, spins, pulses and grows with them. |

All motion carries the picture in the Matte modes and not in Mask: the paths (up and down, circle,
figure eight, bounce, travel, hop), lag ripples, spin, pulse, the pattern's push, turn and size, and
the rules (a shape that *becomes* another takes that shape's picture and mode). Tests check the
sampling place under each path (`gridTextures.test.ts`, "where each picture mode reads the
picture"). The picture covers the whole grid (Fill, keeping its shape).

For a matte of your own, the Grid scene node's `home` and `piece` outputs are picture-unit points:
wire either into a Sample (texture)'s UV. For hand-built grids, the **Cell Picture** node does the
same from a Grid's or Grid Pattern's Cell Center, Cell UV and Cell Size (below).

Template: **A picture in pieces**: circles waving round their cells (circle path with lag), one
drawn cell repeated 1 × 1 into all 16 × 12, each carrying its piece (Matte: piece). Pick its picture
under Shapes → Picture.

### In the node graph

- **Cell Picture** (Grid): Mode Mask / Matte: colour / Matte: piece. Wire UV, Cell Center, Cell UV
  and Cell Size (Grid has all four; Grid Pattern now hands out Cell Size too), and its UV into a
  Texture's or Sample (texture)'s UV. Grid Pattern's Cell UV is already grown, pulled and spun, so
  the piece follows the shape. With Overflow on, the neighbours' shapes read the pixel's own cell.
- **Cell Pattern** (Grid): Cell ID in, Source ID out (and Is Source): Repeat (Period, Offset,
  Shift), Mirror X / Y / both and Rotate 4 round a Centre: the draw modes for any per-cell value
  (read a hash, a Cell Filter or a Pad Grid at Source ID).

## Surprise me

A whole grid scene from a seed (`src/gridScene/surprise.ts`), the same seed always the same:
a 6 to 14 cell grid; one to three shapes in one harmonious palette on a dark ground; cells drawn as
a motif (a mirrored pixel sprite, a ring, a diagonal, a border, a scatter); motion for most shapes
(now and then a generated Drawn path);
a pattern most of the time (sometimes filling the empty cells); now and then a gentle warp (one of
the library's blocks that bends a grid without tearing it, at or below its default strength) and a
rule between two shapes. One undo step; Reroll and Undo in its toast.

## The Do… bar

- "new grid scene", "grid builder", "draw on a grid" open the Grid builder on a new grid.
- "open the scene builder" (and "scene builder") opens the kind page; "3d scene builder" is the 3D
  Scene Builder.

## Not yet

- Huge reach with a lot of lag (shapes overtaking each other, past 13 × 13 cells) is capped; the
  builder warns.

- Shapes moving through the pattern's fill don't push it aside; the fill only skips the cells you
  drew on.
- A formula path's bound is sampled (48 points plus the largest step): a formula with detail finer
  than a forty-eighth of the cycle can stray past it and be cut where shapes overtake (with lag).
