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
- **The pattern's mask.** Patterns & warps → **Only in words**: the wave changes only the cells whose
  middle the words cover, and **Fill empty cells** puts its shape only there, so the fill spells the
  words and moves with the wave. Words, Size, Weight, Across and Up (cells from the grid's middle).
  In the shader the mask is a function of its own (`gs_mask`: the font's strokes, one line each, as
  the Agent Builder's text: no texture); the mini grid tints the same cells, worked out on the CPU
  with the same distance (`textMaskAt`; `gridText.test.ts` checks them cell for cell). Changing the
  words rebuilds; the pattern's numbers stay live.

### Sections

| Section | What it sets |
|---|---|
| **Shapes** | Up to six shapes: kind (circle, square, ring, diamond, triangle, hexagon, star, plus, cross, heart), colour, size (a share of half a cell: 1 touches the neighbours), turn, spin, pulse, outline. Add and remove shapes (a removed shape's cells and rules go with it). **Picture**: a picture the shape carries, and its mode (see Pictures in pieces). |
| **Motion** | The brush shape's path: still, up and down, side to side, both at once, circle, figure eight, bounce, travel, hop. The **XY control** sets how far (in cells, y up): drag the point, the path is drawn round it; X and Y sliders beside it. Speed (cycles a second) and lag (each cell starts (x + y) × lag of a cycle later: the motion runs through the drawing as a wave). Travel and hop wrap round the grid. |
| **Patterns & warps** | A wave over the cells: ripple, diagonal, checker, rings, spiral, stripes, random. It changes every shape's size, turn, push, hue or brightness by Amount; Waves is how many across the grid, Speed in cycles a second, Arms for the spiral. **Fill empty cells** puts a shape in every cell you didn't draw on, its size following the wave (checker + fill is a checkerboard that swaps). **Only in words** limits the wave and the fill to the cells some words cover (see Text). **Grid warps**: up to three space blocks from the 2D Scene Builder's library (the same picker: categories, search, Random), bending the space the whole grid is drawn in, lines and all. |
| **Rules** | When … Do … for every drawn cell, checked in the shader each frame, top to bottom. When a shape *is in the cell (x, y)*, *is in the column*, *is in the row*, *shares a cell with* another shape, or *is near* it (within N cells). Do: *becomes* another shape (its kind, size and colour), *turns a colour*, *swaps colours with* the other shape (both ways), *grows by*, *hides*, *spins*. A rule that names a shape that isn't there is shown as off. |
| **Look** | Background, grid lines (on or off, colour, width in cells), the grid's size, glow (amount, falloff), tone map. |

## What Build makes

```
UV ─► warps (Expression Blocks) ─┬─► Grid scene (Expression Block + helpers) ─► colour, d
Time ────────────────────────────┤      ▲ motion, look, edge, colour per shape
per shape: Colour, Shape A (Expression Block of sliders)
Ground & lines (Expression Block over the background) ◄─ the warped UV
Glow Layer (d, colour) ─► Add over the ground ─► SDF Fill ─► Tone Map ─► Output
```

- **Shape A, B…**: an Expression Block whose sliders are the shape's numbers (size, turn, spin,
  pulse, outline, move X and Y, speed, lag). Its result is the motion (x, y, speed, lag); `look`
  and `edge` are exposed outputs. Colour is a Colour node. All live: no recompile.
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
  by its range. Travel and Hop solve their wrap round the grid (with lag, each way round it). A
  square of cells round that home is read in the drawing; a cell is drawn only if it holds this
  shape.
- **The square's size is worked out live, every pixel**, from the shape's sliders as they are now:
  its size, pulse, outline, the pattern's grow (size) and push, its rules' grow and become, and the
  motion (reach and lag) as above. Glow adds a cell so halos stay. The loops run to the cap, 13 × 13,
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
  big motion with lag on every non-wrapping path, and with copies matching.

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
a motif (a mirrored pixel sprite, a ring, a diagonal, a border, a scatter); motion for most shapes;
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
- Rules see each shape where it is now; there is no memory (a shape that became a star goes back
  when it leaves the column). A "stays changed" Do would need a feedback pass.
- The jump to Grid Rules starts every drawn shape as state 1; shapes as different states (for
  Stages, Patterns, Blocks) are a follow-up.
- Keyframes and the Play menu on the builder's own sliders (as for the 2D and 3D builders); the
  built nodes' sliders have both.
